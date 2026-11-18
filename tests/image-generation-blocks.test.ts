import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { imageGenerationBlocks } from '../desktop/shared/image-generation-blocks';
import { ImageGenerationAnswer } from '../desktop/renderer/chat/components/image-generation';
const receipt={type:'being.image-generation',version:1,being_id:'alice',jobs:[{index:1,title:'猫咪 {窗边} 和 "阳光" \\ 测试',submission:'accepted',generation_id:'gen_one',client_request_id:'cat-one',error_code:null}]};
const json=JSON.stringify(receipt);
const render=(text:string,streaming=false)=>renderToStaticMarkup(createElement(ImageGenerationAnswer,{text,streaming,enabled:true,scope:'room',endpoint:'https://echo.beings.town/alice',children:'fallback'}));
describe('mixed image generation replies',()=>{
  it.each([json,'```json\n'+json+'\n```','```being-image-generation\n'+json+'\n```','~~~json\n'+json+'\n~~~','```\n'+json+'\n```'])('extracts receipt between intact prose: %s',source=>{
    const blocks=imageGenerationBlocks('已提交三张图片。\n\n'+source+'\n\n稍后可下载原图。');
    expect(blocks.map(b=>b.kind)).toEqual(['text','receipt','text']);
    expect(blocks[0].text).toBe('已提交三张图片。\n\n');
    expect(blocks[1]).toMatchObject({receipt});expect(blocks[2].text.trim()).toBe('稍后可下载原图。');
    const html=render('已提交三张图片。\n\n'+source+'\n\n稍后可下载原图。');
    expect(html.indexOf('已提交三张图片')).toBeLessThan(html.indexOf('image-generation-card'));
    expect(html.indexOf('image-generation-card')).toBeLessThan(html.indexOf('稍后可下载原图'));
    expect(html).not.toContain('<pre');expect(html).not.toContain('client_request_id');
  });
  it('keeps ordinary JSON, nested examples, quoted examples, inline code and non-JSON code fences untouched',()=>{
    for(const source of ['{"type":"other"}',JSON.stringify({example:receipt}),'`'+json+'`','> '+json,'    '+json,'```typescript\n'+json+'\n```','````markdown\n```json\n'+json+'\n```\n````']) {
      expect(imageGenerationBlocks(source)).toEqual([{kind:'text',id:'text-0',text:source}]);
      expect(render(source)).toBe('fallback');
    }
  });
  it('handles escaped quotes/braces without truncating and supports reordered fields',()=>{
    expect(imageGenerationBlocks(json+'\n后续')[0]).toMatchObject({receipt});
    const reordered=JSON.stringify({jobs:receipt.jobs,version:1,being_id:'alice',type:receipt.type});
    expect(imageGenerationBlocks(reordered)[0]).toMatchObject({receipt});
  });
  it('holds incomplete stream receipts and preserves prose on either side of complete streaming blocks',()=>{
    const partial='前文\n```json\n{"type":"being.image-generation",';
    const html=render(partial,true);expect(html).toContain('前文');expect(html).toContain('正在确认图片任务');expect(html).not.toContain('image-generation-card');
    const complete=render('前文\n'+json+'\n后文',true);
    expect(complete).toContain('前文');expect(complete).toContain('后文');expect(complete).not.toContain('image-generation-card');
  });
  it('isolates invalid receipts and preserves following text and valid receipts',()=>{
    const text='前文\n```json\n{"type":"being.image-generation","version":99}\n```\n后文\n'+json;
    const html=render(text);expect(html).toContain('不要重新生成');expect(html).toContain('后文');expect(html).toContain('image-generation-card');
    expect(imageGenerationBlocks(text).filter(b=>b.kind==='receipt')).toHaveLength(2);
  });
  it('keeps multiple independent receipt blocks in place and suppresses exact duplicate task batches',()=>{
    const second=JSON.stringify({...receipt,jobs:[{...receipt.jobs[0],generation_id:'gen_two',client_request_id:'cat-two'}]});
    expect((render(json+'\n文字\n'+second).match(/class="image-generation-card"/g)||[])).toHaveLength(2);
    const duplicate=render(json+'\n文字\n```json\n'+json+'\n```');
    expect((duplicate.match(/class="image-generation-card"/g)||[])).toHaveLength(1);expect(duplicate).toContain('未重复查询');
  });
  it('allows trailing prose to grow without changing receipt identity',()=>{
    const before=imageGenerationBlocks('前文\n'+json+'\n后');
    const after=imageGenerationBlocks('前文\n'+json+'\n后文加长');
    expect(before.find(b=>b.kind==='receipt')).toEqual(after.find(b=>b.kind==='receipt'));
  });
});

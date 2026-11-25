import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageGenerationAnswer } from '../desktop/renderer/chat/components/image-generation';
import { ScheduledMessage } from '../desktop/renderer/chat/components/scheduling';
const src='https://beings.town/api/being-service/v1/assets/att_old/view?token=signature_3a&variant=original';
const receipt=JSON.stringify({type:'being.image-generation',version:1,being_id:'alice',jobs:[{index:1,title:'新图',submission:'accepted',generation_id:'gen_new',client_request_id:'cat-new',error_code:null}]});
const render=(text:string)=>renderToStaticMarkup(createElement(ImageGenerationAnswer,{text,streaming:false,enabled:true,scope:'room',endpoint:'https://echo.beings.town/alice',children:(part:string)=>createElement(ScheduledMessage,{text:part,streaming:false,intelligentUI:true})}));
const assertImage=(html:string)=>{
  expect(html).toContain('aria-label="预览 旧图片"');
  expect(html).toContain(`src="${src.replace('&','&amp;')}"`);
};
describe('legacy Markdown images alongside generation receipts',()=>{
  it('keeps old signed Markdown images on the preview path without generation cards',()=>{
    const html=render(`旧图片已完成。\n\n![旧图片](${src})\n\n说明文字`);
    assertImage(html);expect(html).not.toContain('image-generation-card');expect(html).toContain('说明文字');
  });
  it.each([receipt,'```json\n'+receipt+'\n```'])('preserves images on either side of new receipt blocks',block=>{
    const html=render(`![旧图片](${src})\n\n${block}\n\n![另一张旧图](${src})`);
    assertImage(html);expect(html).toContain('aria-label="预览 另一张旧图"');expect(html).toContain('image-generation-card');
    expect(html.indexOf('预览 旧图片')).toBeLessThan(html.indexOf('image-generation-card'));
    expect(html.indexOf('image-generation-card')).toBeLessThan(html.indexOf('预览 另一张旧图'));
  });
  it('keeps reference-style image definitions across receipt boundaries and the intelligent-answer split',()=>{
    for(const divider of ['',receipt]) {
      const html=render(`![旧图片][original]\n\n${divider}\n\n[original]: ${src} "原图"`);
      assertImage(html);expect(html).not.toContain('![旧图片]');
    }
  });
  it('still renders old images when an adjacent new receipt is invalid',()=>{
    const html=render(`![旧图片](${src})\n\n{"type":"being.image-generation","version":99}`);
    assertImage(html);expect(html).toContain('不要重新生成');
  });
});

import {describe,it,expect} from 'vitest';
import {csvRows,validFilePreview} from '../desktop/renderer/app/lib/file-preview-data';
describe('file previews',()=>{
  it('keeps CSV commas, newlines, escaped quotes and zero/false cells',()=>{
    expect(csvRows('name,note,value\r\n"a,b","line 1\nline ""2""",0\r\nx,false,')).toEqual([['name','note','value'],['a,b','line 1\nline "2"','0'],['x','false','']]);
  });
  it('accepts only bounded known formats from the chat bridge',()=>{
    const base={id:'att_123',name:'sample.json',extension:'json',text:'{"a":false}'};
    expect(validFilePreview(base)).toBe(true);
    expect(validFilePreview({...base,extension:'html'})).toBe(false);
    expect(validFilePreview({...base,id:'../../file'})).toBe(false);
    expect(validFilePreview({...base,text:'a'.repeat(2*1024*1024+1)})).toBe(false);
    expect(validFilePreview({...base,extension:'pdf',blob:new Blob(['pdf'],{type:'text/html'})})).toBe(false);
    expect(validFilePreview({...base,extension:'pptx',blob:new Blob(['pptx'],{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})})).toBe(true);
    expect(validFilePreview({...base,extension:'pptx',segments:[{label:'',text:'not a slide'}]})).toBe(false);
    expect(validFilePreview({...base,extension:'xlsx',blob:new Blob(['xlsx'],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})})).toBe(true);
    expect(validFilePreview({...base,extension:'xlsx',segments:[{label:'',text:'old parsed text'}]})).toBe(false);
    expect(validFilePreview({...base,extension:'docx',segments:[{label:'page',text:'content'}]})).toBe(true);
  });
});

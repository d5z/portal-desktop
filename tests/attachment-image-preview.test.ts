import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AttachmentCard} from '../desktop/renderer/chat/components/attachments';
import {AttachmentImageGallery} from '../desktop/renderer/chat/components/attachment-image';
import {AttachmentImageUpload} from '../desktop/renderer/chat/components/attachment-image-upload';
import {AttachmentMessageContent} from '../desktop/renderer/chat/components/message-content';
import type {Message} from '../desktop/renderer/chat/models/chat';
const part:any={type:'attachment',attachment_id:'att_image',name:'picture.png',mime:'image/png',size:3,parse_status:'parsing'};
describe('image preview continuity',()=>{
  it('uses the local thumbnail immediately after upload while parsing',()=>{
    const endpoint='https://echo.beings.town/a';
    const card=createElement(AttachmentCard,{part,endpoint,localImage:{src:'blob:local-preview',blob:new Blob(['png'])}});
    const html=renderToStaticMarkup(createElement(AttachmentImageGallery,{ids:[part.attachment_id],endpoint,children:card}));
    expect(html).toContain('src="blob:local-preview"');expect(html).not.toContain('attachment-image-placeholder');
  });
  it('overlays progress on the thumbnail and removes only progress on completion',()=>{
    const props={src:'blob:local-preview',name:'picture.png',blob:new Blob(['png'])};
    const pending=renderToStaticMarkup(createElement(AttachmentImageUpload,{...props,status:'正在上传 · 45%',percent:45}));
    expect(pending).toContain('src="blob:local-preview"');expect(pending).toContain('45%');expect(pending).toContain('<progress');
    const done=renderToStaticMarkup(createElement(AttachmentImageUpload,props));
    expect(done).toContain('src="blob:local-preview"');expect(done).not.toContain('<progress');expect(done).not.toContain('上传完成');
  });
  it('renders a skeleton without loading text for remote images',()=>{
    const html=renderToStaticMarkup(createElement(AttachmentCard,{part,endpoint:'https://echo.beings.town/a'}));
    expect(html).toContain('attachment-image-skeleton');expect(html).toContain('aria-busy="true"');expect(html).not.toContain('正在加载图片…');
  });
  it('groups adjacent attachment images without moving intervening files',()=>{
    const images=[1,2,3,4,5].map(n=>({...part,attachment_id:`att_${n}`,name:`${n}.png`}));
    const file={...part,attachment_id:'file',name:'notes.txt',mime:'text/plain',parse_status:'ready'};
    const message={role:'user',text:'',attachmentEndpoint:'https://echo.beings.town/a',attachmentViews:[
      {message_id:'view',channel:'portal',parts:[...images.slice(0,3),file,...images.slice(3)]},
    ]} as Message;
    const html=renderToStaticMarkup(createElement(AttachmentMessageContent,{message}));
    expect(html).toMatch(/data-count="3".*图片 1\.png.*图片 2\.png.*图片 3\.png.*notes\.txt.*data-count="2".*图片 4\.png.*图片 5\.png/s);
  });
});

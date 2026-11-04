import { describe, expect, it, vi } from 'vitest';
import { checkLocalFiles } from '../desktop/renderer/app/services/local-file-check';

describe('local file check compatibility', () => {
  const path = '/Users/d5/portal-desktop Workspace/qimen-study/奇门遁甲.html';
  it('uses metadata checks without reading contents on current clients', async () => {
    const previewLocalFile=vi.fn();
    expect(await checkLocalFiles({checkLocalFiles:async()=>[true,false],previewLocalFile},[path,'missing.html'])).toEqual([true,false]);
    expect(previewLocalFile).not.toHaveBeenCalled();
  });
  it.each([undefined,vi.fn(async()=>{throw new Error('No handler registered');})])('preserves previews with older preload/main versions', async check => {
    const releaseLocalFilePreview=vi.fn(async()=>{});
    const previewLocalFile=vi.fn(async(file:string)=>{
      if(file==='missing.html')throw new Error('本地文件不存在或无法读取');
      return {id:'temporary',path:file,name:'奇门遁甲.html',extension:'html'};
    });
    expect(await checkLocalFiles({checkLocalFiles:check,previewLocalFile,releaseLocalFilePreview},[path,'missing.html'])).toEqual([true,false]);
    expect(releaseLocalFilePreview).toHaveBeenCalledExactlyOnceWith('temporary');
  });
  it('distinguishes an unavailable bridge from a missing file', async()=>{
    expect(await checkLocalFiles({},[path])).toEqual([null]);
    expect(await checkLocalFiles({checkLocalFiles:async()=>{throw new Error('not ready');},previewLocalFile:async()=>{throw new Error('No handler registered');},releaseLocalFilePreview:async()=>{}},[path])).toEqual([null]);
  });
});

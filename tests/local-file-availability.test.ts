import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();});
describe('local file check transport',()=>{
  it('retries only unknown paths and ignores late replies from earlier attempts',async()=>{
    vi.useFakeTimers();
    const host=new EventTarget();
    const requests:any[]=[];
    const parent={postMessage:vi.fn(request=>requests.push(request))};
    const reply=(request:any,available:(boolean|null)[])=>host.dispatchEvent(Object.assign(new Event('message'),{
      source:parent,data:{type:'beings:local-files-checked',id:request.id,revision:request.revision,available},
    }));
    vi.stubGlobal('window',Object.assign(host,{parent}));
    vi.stubGlobal('location',new URL('beings://chat/?revision=fixture'));
    const {checkLocalFile}=await import('../desktop/renderer/shared/services/local-file-availability');
    const known=checkLocalFile('/tmp/exists.html');
    const unknown=checkLocalFile('/tmp/later.html');
    const settled=vi.fn();void unknown.then(settled);
    await vi.advanceTimersByTimeAsync(0);
    reply(requests[0],[true,null]);
    expect(await known).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(requests[1].paths).toEqual(['/tmp/later.html']);
    expect(requests[1].id).not.toBe(requests[0].id);
    reply(requests[0],[false,false]);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    reply(requests[1],[true]);
    expect(await unknown).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['not-ready','dropped'] as const)('retries a %s check instead of declaring an existing file missing',async mode=>{
    vi.useFakeTimers();
    const host=new EventTarget();
    let calls=0;
    const parent={postMessage:vi.fn((request:any)=>{
      calls++;
      if(calls===1 && mode==='dropped')return;
      host.dispatchEvent(Object.assign(new Event('message'),{
        source:parent,data:{type:'beings:local-files-checked',id:request.id,revision:request.revision,available:[calls===1 ? null : true]},
      }));
    })};
    vi.stubGlobal('window',Object.assign(host,{parent}));
    vi.stubGlobal('location',new URL('beings://chat/?revision=fixture'));
    const {checkLocalFile}=await import('../desktop/renderer/shared/services/local-file-availability');
    const result=checkLocalFile('/tmp/页面.html');
    await vi.advanceTimersByTimeAsync(mode==='dropped'?5250:250);
    expect(await result).toBe(true);
    expect(calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { HomeTransport, validateInput } from '../desktop/main/home/transport';
import { framePoint, keyModifiers } from '../desktop/renderer/home/input';
import type { BrowserState } from '../desktop/shared/home-viewer';
const state: BrowserState = { ready: true, can_control: true, controller: 'human', lease_remaining_seconds: 60,
  view_mode: 'native', frame_width: 1280, frame_height: 900 };
describe('cloud browser input boundary', () => {
  it('maps the actual letterboxed canvas, not the surrounding panel or device scale', () => {
    const rect = { left: 200, top: 150, width: 640, height: 450 };
    expect(framePoint(520, 375, rect, state, { width: 1280, height: 900 })).toEqual({ x: 640, y: 450 });
    expect(framePoint(190, 375, rect, state, { width: 1280, height: 900 })).toBeNull();
    expect(framePoint(840, 375, rect, state, { width: 1280, height: 900 })).toBeNull();
    expect(framePoint(520, 375, rect, state, { width: 1024, height: 768 })).toBeNull();
  });
  it('accepts Chinese text and maps Mac shortcuts to the remote native Control modifier', () => {
    expect(validateInput({ action: 'native_type', text: '中文输入' }, state)).toEqual({ action: 'native_type', text: '中文输入' });
    expect(keyModifiers({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false }, true)).toBe(2);
    expect(keyModifiers({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false }, false)).toBe(4);
  });
  it('rejects out-of-bounds, unbounded and arbitrary operations before sending any request', () => {
    for (const input of [ { action: 'native_click', x: 1280, y: 0 }, { action: 'native_click', x: NaN, y: 0 },
      { action: 'native_type', text: 'a'.repeat(4001) }, { action: 'native_scroll', x: 0, y: 0, delta_y: Infinity },
      { action: 'native_key', key: 'Enter', modifiers: 100 }, { action: 'execute', command: 'anything' },
      { action: 'click', x: 1, y: 1 } ]) expect(() => validateInput(input, state)).toThrow();
  });
});


describe('cloud control lifecycle', () => {
  it('keeps queued input valid while renewing and releases on explicit close', async () => {
    const calls: string[] = [];
    let finishRenew!: () => void;
    const renewed = new Promise<void>(resolve => { finishRenew = resolve; });
    const jar = { fetch: async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(init.body as string).action : 'state'; calls.push(action);
      if (action === 'renew') await renewed;
      return new Response(JSON.stringify({ ...state, can_control: action !== 'release' }), { headers: { 'Content-Type': 'application/json' } });
    } };
    const transport = new HomeTransport(jar as any, 'fixture', () => {}, () => {});
    transport.setActive(true); await transport.read(); await transport.control('claim');
    const renewing = transport.control('renew');
    await transport.input({ action: 'native_type', text: '续租期间输入' });
    finishRenew(); await renewing;
    transport.disconnect();
    const recovered = await transport.read();
    expect(recovered.can_control).toBe(false);
    expect(recovered.owns_control).toBe(true);
    expect(recovered.controlled_elsewhere).toBe(false); // this viewer can still release its lease
    await transport.close();
    expect(calls).toEqual(['state', 'claim', 'renew', 'native_type', 'state', 'release']);
  });

  it.each([false, true])('reconciles a lost release response and allows retry (server applied release: %s)', async applied => {
    let human = false, failRelease = true;
    const diagnostics: unknown[] = [];
    const jar = { fetch: async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(init.body as string).action : 'state';
      if (action === 'claim') human = true;
      if (action === 'release') {
        if (failRelease) {
          if (applied) human = false;
          throw new Error('https://fixture.invalid/?ticket=private-ticket Cookie=private-cookie');
        }
        human = false;
      }
      return new Response(JSON.stringify({ ...state, controller: human ? 'human' : 'being', can_control: human }));
    } };
    const transport = new HomeTransport(jar as any, 'fixture', () => {}, () => {}, undefined,
      (event, fields) => diagnostics.push({ event, ...fields }));
    transport.setActive(true);
    await transport.control('claim');
    await expect(transport.control('release')).rejects.toThrow();
    const uncertain = await transport.read();
    expect(uncertain).toMatchObject({ controller: applied ? 'being' : 'human', can_control: false, owns_control: !applied });
    await expect(transport.input({ action: 'native_type', text: 'must not dispatch' })).rejects.toThrow();
    failRelease = false;
    expect(await transport.control('release')).toMatchObject({ controller: 'being', can_control: false, owns_control: false });
    expect(diagnostics).toContainEqual(expect.objectContaining({ event: 'control_failed', action: 'release' }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ event: 'control_result', action: 'release', owns_control: false }));
    expect(JSON.stringify(diagnostics)).not.toMatch(/private-ticket|private-cookie|must not dispatch/);
    await transport.close();
  });

  it('serializes a release behind in-flight renewal and ignores a state read from before release confirmation', async () => {
    let finishRenew!: () => void, finishRead!: () => void, startedRenew!: () => void;
    let holdRead = false, human = false;
    const renewing = new Promise<void>(resolve => { finishRenew = resolve; });
    const renewalStarted = new Promise<void>(resolve => { startedRenew = resolve; });
    const reading = new Promise<void>(resolve => { finishRead = resolve; });
    const calls: string[] = [];
    const jar = { fetch: async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(init.body as string).action : 'state';
      calls.push(action);
      if (action === 'renew') { startedRenew(); await renewing; }
      if (action === 'claim') human = true;
      if (action === 'release') human = false;
      const snapshot = { ...state, controller: human ? 'human' : 'being', can_control: human };
      if (action === 'state' && holdRead) await reading;
      return new Response(JSON.stringify(snapshot));
    } };
    const transport = new HomeTransport(jar as any, 'fixture', () => {}, () => {});
    transport.setActive(true); await transport.control('claim');
    const renew = transport.control('renew');
    const cancelled = expect(renew).rejects.toThrow('控制操作已取消');
    await renewalStarted;
    const release = transport.control('release');
    holdRead = true;
    const staleRead = transport.read();
    expect(calls).not.toContain('release');
    finishRenew();
    await cancelled;
    expect(await release).toMatchObject({ controller: 'being', owns_control: false });
    finishRead();
    expect(await staleRead).toMatchObject({ controller: 'being', owns_control: false });
    expect(calls.filter(value => value !== 'state')).toEqual(['claim', 'renew', 'release']);
    await transport.close();
  });
  it('releases a claim that completes after its panel was hidden', async () => {
    const calls: string[] = [];
    let finishClaim!: () => void, startedClaim!: () => void;
    const claimed = new Promise<void>(resolve => { finishClaim = resolve; });
    const claimStarted = new Promise<void>(resolve => { startedClaim = resolve; });
    const jar = { fetch: async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(init.body as string).action : 'state'; calls.push(action);
      if (action === 'claim') { startedClaim(); await claimed; }
      return new Response(JSON.stringify({ ...state, can_control: action === 'claim' }), { headers: { 'Content-Type': 'application/json' } });
    } };
    const transport = new HomeTransport(jar as any, 'fixture', () => {}, () => {});
    transport.setActive(true); await transport.read();
    const claim = transport.control('claim');
    const rejected = expect(claim).rejects.toThrow('控制操作已取消');
    await claimStarted;
    transport.setActive(false); finishClaim(); await rejected;
    expect(calls).toEqual(['state', 'claim', 'release']);
    await transport.close();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewPortalOperation } from '../desktop/main/chat/approval-review';
import { ToolApproval } from '../desktop/main/chat/tool-approval';
import { permissionMode, type PermissionMode } from '../desktop/shared/security';
import { PermissionPicker, permissionChoices } from '../desktop/renderer/shared/components/permission-picker';

const request = (value: object) => ({endpoint:'https://fixture.test/being', verb:'security-approve', sceneId:'scene-a', args:JSON.stringify(value)});
const web = (url: string) => ({tool:'portal_web_fetch', isolation:'public-web-read', workspace:'D:\\work', arguments:{url}});

describe('Portal permission profiles', () => {
  it('offers three action approval modes while preserving an existing read-only restriction', () => {
    expect(permissionChoices.map(c => c.value)).toEqual(['supervised','auto-review','full-access']);
    expect(permissionMode('auto-review')).toBe('auto-review');
    expect(permissionMode('read-only')).toBe('read-only');
    const current = renderToStaticMarkup(createElement(PermissionPicker, {value:'auto-review',onChange:()=>{}}));
    expect(current).toContain('帮我批准');
    expect(current).toContain('自动批准可信文档读取');
    expect(permissionMode(undefined)).toBe('auto-review');
    expect(permissionMode('supervised')).toBe('supervised');
    expect(current).not.toContain('旧版只读');
    const legacy = renderToStaticMarkup(createElement(PermissionPicker, {value:'read-only',onChange:()=>{}}));
    expect(legacy).toContain('旧版只读');
    expect(legacy).toContain('aria-checked="true"');
  });

  it('automatically reviews only known documentation hosts without credentials or query strings', () => {
    expect(reviewPortalOperation(web('https://docs.python.org/3/library/pathlib.html'))).toBe('allow');
    for (const url of ['https://example.com/', 'https://docs.python.org.attacker.example/', 'https://127.0.0.1/',
      'http://docs.python.org/', 'https://docs.python.org:9443/', 'https://user:pass@docs.python.org/',
      'https://docs.python.org/?token=secret', 'https://docs.python.org/#secret', 'not-a-url']) {
      expect(reviewPortalOperation(web(url))).toBe('ask');
    }
    expect(reviewPortalOperation({...web('https://docs.python.org/'), tool:'custom_read'})).toBe('ask');
    expect(reviewPortalOperation({...web('https://docs.python.org/'), isolation:'host-tool'})).toBe('ask');
    expect(reviewPortalOperation({...web('https://docs.python.org/'), arguments:{url:'https://docs.python.org/',headers:{Authorization:'secret'}}})).toBe('ask');
  });

  it('uses automatic review only in auto-review and falls back to the user for host/file operations', async () => {
    let mode: PermissionMode = 'supervised';
    const prompt = vi.fn(async () => false);
    const approval = new ToolApproval(() => mode, prompt);
    const signal = new AbortController().signal;
    expect(await approval.request(request(web('https://docs.python.org/')), signal)).toBe('deny');
    expect(prompt).toHaveBeenCalledTimes(1);
    mode = 'auto-review';
    expect(await approval.request(request(web('https://docs.python.org/')), signal)).toBe('allow-once');
    expect(prompt).toHaveBeenCalledTimes(1);
    for (const value of [web('https://example.com/'),
      {tool:'portal_file_write',workspace:'D:\\work',isolation:'file-scope',target:'D:\\other.txt',arguments:{path:'D:\\other.txt',content:'x'}},
      {tool:'portal_exec',workspace:'D:\\work',isolation:'host-tool',arguments:{command:'echo test',sandbox_permissions:'require_escalated'}}]) {
      expect(await approval.request(request(value), signal)).toBe('deny');
    }
    expect(prompt).toHaveBeenCalledTimes(4);
  });

  it('binds an approval to its initial mode and displays the canonical file target', async () => {
    let mode: PermissionMode = 'auto-review';
    let resolve!: (value: boolean) => void;
    const prompt = vi.fn(() => new Promise<boolean>(r => {resolve=r;}));
    const approval = new ToolApproval(() => mode, prompt);
    const pending = approval.request(request({tool:'portal_file_edit',workspace:'D:\\work',isolation:'file-scope',
      target:'D:\\outside.txt',arguments:{path:'../outside.txt',old_text:'a',new_text:'b'}}), new AbortController().signal);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({detail:expect.stringContaining('outside.txt')}));
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({detail:expect.stringContaining('仅限下方目标')}));
    mode = 'supervised'; resolve(true);
    expect(await pending).toBe('deny');
  });
});

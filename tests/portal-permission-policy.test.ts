import { permissionChoices } from '../desktop/renderer/shared/lib/permissions';
import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolApproval } from '../desktop/main/chat/tool-approval';
import { permissionMode } from '../desktop/shared/security';
import { PermissionPicker } from '../desktop/renderer/shared/components/permission-picker';

it('offers only always allow and ask every time, defaulting legacy automatic review to asking', () => {
  expect(permissionChoices.map(c => [c.value, c.title])).toEqual([
    ['full-access', '始终允许'], ['supervised', '每次询问'],
  ]);
  for (const value of [undefined, 'auto-review', 'read-only', 'supervised']) {
    expect(permissionMode(value)).toBe('supervised');
  }
  expect(permissionMode('full-access')).toBe('full-access');
  const markup = renderToStaticMarkup(createElement(PermissionPicker, {value:'supervised',onChange:()=>{}}));
  expect(markup).toContain('每次询问');
  expect(markup).not.toContain('帮我批准');
  expect(markup.match(/role="radio"/g)).toHaveLength(2);
});

it('asks again for repeated documentation reads rather than automatically approving or remembering', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'supervised', prompt);
  const request = {endpoint:'https://fixture.test/being', verb:'security-approve', sceneId:'scene-a',
    args:JSON.stringify({tool:'portal_web_fetch', isolation:'public-web-read', workspace:'D:\\work',
      arguments:{url:'https://docs.python.org/'}})};
  for (let i = 0; i < 2; i++) {
    expect(await approval.request(request, new AbortController().signal)).toBe('allow-once');
  }
  expect(prompt).toHaveBeenCalledTimes(2);
});

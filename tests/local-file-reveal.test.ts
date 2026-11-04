import { describe, expect, it } from 'vitest';
import { revealLocalFile } from '../desktop/renderer/app/services/local-file-reveal';

const path = '/Users/d5/portal-desktop Workspace/qimen-study/奇门遁甲.html';
describe('reveal local file errors', () => {
  it('asks for a full restart when preload or main IPC is missing', async () => {
    expect(await revealLocalFile({}, path)).toContain('完全退出并重新启动');
    expect(await revealLocalFile({ revealLocalFile: async () => { throw new Error("Error invoking remote method 'beings:local-file-reveal': Error: No handler registered for 'beings:local-file-reveal'"); } }, path)).toContain('完全退出并重新启动');
  });
  it('distinguishes deleted files, permissions and invalid paths', async () => {
    expect(await revealLocalFile({ revealLocalFile: async () => ({ ok: false, reason: 'missing' }) }, path)).toContain('移动或删除');
    expect(await revealLocalFile({ revealLocalFile: async () => ({ ok: false, reason: 'permission' }) }, path)).toContain('没有权限');
    expect(await revealLocalFile({ revealLocalFile: async () => ({ ok: false, reason: 'invalid-path' }) }, path)).toContain('无法识别');
  });
  it('accepts both current and legacy success without treating unknown failures as missing files', async () => {
    expect(await revealLocalFile({ revealLocalFile: async () => ({ ok: true }) }, path)).toBe('');
    expect(await revealLocalFile({ revealLocalFile: async () => true }, path)).toBe('');
    expect(await revealLocalFile({ revealLocalFile: async () => false }, path)).toBe('系统未能打开所在文件夹，请重试。');
    expect(await revealLocalFile({ revealLocalFile: async () => { throw new Error('OS failure'); } }, path)).toBe('系统未能打开所在文件夹，请重试。');
  });
});

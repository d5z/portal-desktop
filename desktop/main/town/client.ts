import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SecretStorage } from '../app/settings';
import { normalizeTownDisplay, validTownIdentity } from '../../shared/town-identity';

export { TownClient, TOWN_ORIGIN, townRoute } from '../../shared/town-client';

export class TownCredentials {
  token = '';
  beingId = '';
  display = '';
  constructor(private directory: string, private storage: SecretStorage) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(path.join(this.directory, 'town-credential.json'), 'utf8'));
      this.token = this.storage.decryptString(Buffer.from(data.credential, 'base64'));
      this.beingId = validTownIdentity(data.beingId) ? data.beingId : '';
      this.display = this.token && this.beingId ? normalizeTownDisplay(data.display) : '';
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Town 凭据无法解密，请在 Town 设置中重新保存。'); }
  }
  async save(token: string, beingId = '', display = '') {
    if (typeof token !== 'string' || (token && !/^[a-zA-Z0-9._~-]{16,2048}$/.test(token))) throw new Error('请输入有效的 Town 专用凭据。');
    if (!this.storage.isEncryptionAvailable()) throw new Error('系统密钥库不可用。');
    if (beingId && !validTownIdentity(beingId)) throw new Error('无效的 Town ID 或 Being 名。');
    const pairedDisplay = token && beingId ? normalizeTownDisplay(display) : '';
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'town-credential.json');
    await writeFile(file + '.tmp', JSON.stringify({ credential: this.storage.encryptString(token).toString('base64'), beingId: token ? beingId : '', display: pairedDisplay }), { mode: 0o600 });
    await rename(file + '.tmp', file);
    this.token = token;
    this.beingId = token ? beingId : '';
    this.display = pairedDisplay;
  }
}

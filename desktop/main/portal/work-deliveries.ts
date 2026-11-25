import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localFileReference } from '../../shared/local-file';
import type { WorkDeliveryFile } from '../../shared/work';
import { directoryProject } from './work-projects';

export function workDeliveryReferences(text: string) {
  const links = [...text.matchAll(/\]\(<?([^)>\r\n]+)>?\)/g)].map(match => match[1]);
  const paths = [...text.matchAll(/`([^`\r\n]+\.(?:html?|md|txt|pdf|pptx?|docx?|xlsx?|csv|json|png|svg))`/gi)].map(match => match[1]);
  return [...new Set([...links, ...paths])].slice(0, 20);
}

export async function archiveWorkDelivery(directory: string, projectDirectory: string, value: string): Promise<WorkDeliveryFile | undefined> {
  const reference = localFileReference(value, true);
  if (!reference) return;
  const source = await realpath(path.resolve(projectDirectory, reference)).catch(() => '');
  if (!source || !directoryProject([{ directory: projectDirectory }], source)) return;
  const info = await stat(source);
  if (!info.isFile() || info.size > 32 * 1024 * 1024) return;
  const content = await readFile(source);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const name = path.basename(source);
  const folder = path.join(directory, sha256);
  const archived = path.join(folder, name);
  await mkdir(folder, { recursive: true });
  const temporary = path.join(folder, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, archived);
  } finally {
    await rm(temporary, { force: true });
  }
  return { source, path: archived, name, sha256, bytes: content.length };
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { localFileReference } from '../../shared/local-file';
import type { WorkDeliveryFile } from '../../shared/work';
import { directoryProject } from './work-projects';

export async function archiveWorkDeliveries(directory: string, projectDirectory: string, summary: string) {
  const links = new Set<string>();
  const paths = new Set<string>();
  marked.walkTokens(marked.lexer(summary), token => {
    if (token.type === 'link') links.add(token.href);
    else if (token.type === 'codespan' && /\.(?:html?|md|txt|pdf|pptx?|docx?|xlsx?|csv|json|png|svg)$/i.test(token.text))
      paths.add(token.text);
  });
  const save = async (references: Set<string>) => (await Promise.all([...references].slice(0, 20).map(value =>
    archiveWorkDelivery(directory, projectDirectory, value).catch(() => undefined)))).filter(file => file !== undefined);
  // A reply can mention other tasks' filenames. Prefer its linked deliverables.
  const linked = await save(links);
  const files = linked.length ? linked : await save(paths);
  return [...new Map(files.map(file => [file.source, file])).values()];
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

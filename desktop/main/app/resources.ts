import { app } from 'electron';
import path from 'node:path';

/** Native files live outside app.asar so child processes can open them. */
export function nativeResource(...parts: string[]) {
  return path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), ...parts);
}

export function bundledNpmCLI() {
  const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'node_modules');
  return path.join(root, 'npm/bin/npm-cli.js');
}

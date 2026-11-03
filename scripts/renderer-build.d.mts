import type { BuildOptions, BuildResult } from 'esbuild';

export function build<T extends BuildOptions>(options: T): Promise<BuildResult<T>>;

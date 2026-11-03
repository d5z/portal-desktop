import { build as esbuild } from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';

// Keep standalone renderer builds and UI fixtures on the same SCSS pipeline.
// Vite handles .module.scss natively with the installed Sass compiler.
export function build(options) {
  return esbuild({
    ...options,
    plugins: [
      ...(options.plugins || []),
      sassPlugin({ filter: /\.module\.scss$/, type: 'local-css' }),
      sassPlugin({ filter: /\.scss$/, type: 'css' }),
    ],
  });
}

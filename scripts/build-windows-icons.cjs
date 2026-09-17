// Regenerate Windows ICOs and padded notification images from transparent logos.
// Run with Electron: node_modules/electron/dist/electron.exe scripts/build-windows-icons.cjs
const { app, nativeImage } = require('electron');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
app.whenReady().then(() => {
  for (const color of ['black', 'white']) {
    const source = nativeImage.createFromPath(path.resolve('resources/branding', color === 'white' ? 'logo-white.png' : 'logo.png'));
    const original = source.getSize();
    if (source.isEmpty()) throw new Error('Missing branding source');
    // Windows gives appLogoOverride a fixed square. Keep the artwork within
    // its central 62.5% so wide strokes remain visible at toast sizes.
    for (const factor of [1, 2]) {
      const size = 64 * factor, content = 40 * factor;
      const scale = content / Math.max(original.width, original.height);
      const width = Math.round(original.width * scale), height = Math.round(original.height * scale);
      const pixels = source.resize({ width, height, quality: 'best' }).toBitmap();
      const square = Buffer.alloc(size * size * 4);
      for (let row = 0; row < height; row++) pixels.copy(square,
        ((row + Math.floor((size - height) / 2)) * size + Math.floor((size - width) / 2)) * 4,
        row * width * 4, (row + 1) * width * 4);
      writeFileSync(path.resolve('resources/branding', `notification-${color}${factor === 2 ? '@2x' : ''}.png`),
        nativeImage.createFromBitmap(square, { width: size, height: size }).toPNG());
    }
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = sizes.map(size => {
      const scale = size / Math.max(original.width, original.height);
      const width = Math.round(original.width * scale), height = Math.round(original.height * scale);
      const pixels = source.resize({ width, height, quality: 'best' }).toBitmap();
      const square = Buffer.alloc(size * size * 4);
      for (let row = 0; row < height; row++) pixels.copy(square,
        ((row + Math.floor((size - height) / 2)) * size + Math.floor((size - width) / 2)) * 4,
        row * width * 4, (row + 1) * width * 4);
      return nativeImage.createFromBitmap(square, { width: size, height: size }).toPNG();
    });
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    images.forEach((data, i) => {
      const entry = 6 + i * 16;
      header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
      offset += data.length;
    });
    writeFileSync(path.resolve('resources/branding', `logo-${color}.ico`), Buffer.concat([header, ...images]));
  }
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });

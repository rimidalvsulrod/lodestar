// Renders build/logo.svg into the PNG/ICO icons used by the app and installer.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = __dirname;
const svg = fs.readFileSync(path.join(dir, 'logo.svg'));

function ico(pngs) {
  // ICO container with embedded PNGs (supported since Windows Vista)
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

(async () => {
  await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile(path.join(dir, 'icon.png'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, buf: await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer() });
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(pngs));
  fs.copyFileSync(path.join(dir, 'logo.svg'), path.join(dir, '..', 'src', 'renderer', 'logo.svg'));
  console.log('icons written');
})();

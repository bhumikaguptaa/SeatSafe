// Generates the logo assets and app icons from the source logo (a transparent 1024×1024 PNG).
//   node scripts/make-icons.mjs [path/to/logo.png]
// Writes: public/logo.png (source copy), public/logo-mark.png (trimmed to the ticket, for the UI),
//         app/icon.png (512, transparent), app/apple-icon.png (180, on black: iOS ignores transparency),
//         app/favicon.ico (16/32/48 PNG entries).
import { copyFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const src = process.argv[2] ?? "public/logo.png";
if (src !== "public/logo.png") await copyFile(src, "public/logo.png");

// Trim the transparent padding so the ticket fills its box in the UI.
const mark = await sharp("public/logo.png").trim({ threshold: 1 }).png().toBuffer();
// UI copy: 360px wide is plenty for a ~28px-tall nav mark at 3× density.
await writeFile("public/logo-mark.png", await sharp(mark).resize({ width: 360 }).png({ compressionLevel: 9 }).toBuffer());

// Square icon: the trimmed ticket centred with a little padding.
const square = (size, pad, background) =>
  sharp(mark)
    .resize(Math.round(size * (1 - pad * 2)), Math.round(size * (1 - pad * 2)), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.round(size * pad),
      bottom: size - Math.round(size * (1 - pad * 2)) - Math.round(size * pad),
      left: Math.round(size * pad),
      right: size - Math.round(size * (1 - pad * 2)) - Math.round(size * pad),
      background,
    })
    .png()
    .toBuffer();

const clear = { r: 0, g: 0, b: 0, alpha: 0 };
const black = { r: 0, g: 0, b: 0, alpha: 1 };
await writeFile("app/icon.png", await square(512, 0.06, clear));
// sharp flattens before resize/extend, so put the transparent icon on a black square in a second pass.
await writeFile(
  "app/apple-icon.png",
  await sharp({ create: { width: 180, height: 180, channels: 4, background: black } })
    .composite([{ input: await square(180, 0.12, clear) }])
    .png()
    .toBuffer(),
);

// favicon.ico: ICONDIR + one ICONDIRENTRY per size, each pointing at an embedded PNG.
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => square(s, 0.02, clear)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e); // width
  header.writeUInt8(s, e + 1); // height
  header.writeUInt8(0, e + 2); // palette
  header.writeUInt8(0, e + 3); // reserved
  header.writeUInt16LE(1, e + 4); // colour planes
  header.writeUInt16LE(32, e + 6); // bits per pixel
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await writeFile("app/favicon.ico", Buffer.concat([header, ...pngs]));

const m = await sharp("public/logo-mark.png").metadata();
console.log(`logo-mark ${m.width}×${m.height}; icon.png, apple-icon.png, favicon.ico (${sizes.join("/")}) written`);

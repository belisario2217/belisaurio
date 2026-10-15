import sharp from "sharp";

/** Lighten only neutral light pixels connected to the picture's outer edge.
 * This is deliberately conservative: it does not invent a face or replace a
 * coloured background. The untouched source is retained for human review.
 */
export async function prepareCredentialPhoto(buffer: Buffer, improve = true) {
  const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().flatten({ background: "#ffffff" }).toColourspace("srgb");
  const original = await image.clone().jpeg({ quality: 97, chromaSubsampling: "4:4:4" }).toBuffer();
  const sample = await image.clone().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = sample.info, count = width * height;
  const mask = new Uint8Array(count), queue = new Int32Array(count);
  let head = 0, tail = 0, border = 0, lightBorder = 0;
  const faceArea = (x: number,y: number,w: number,h: number) => {
    const dx = (x / w - .5) / .3, dy = (y / h - .42) / .3;
    return dx * dx + dy * dy <= 1;
  };
  const neutral = (data: Buffer, index: number) => {
    const r = data[index], g = data[index + 1], b = data[index + 2];
    return Math.min(r,g,b) >= 170 && Math.max(r,g,b) - Math.min(r,g,b) <= 35;
  };
  const add = (index: number) => {
    if (faceArea(index % width,Math.floor(index / width),width,height)) return;
    if (mask[index] || !neutral(sample.data,index * channels)) return;
    mask[index] = 1; queue[tail++] = index;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x !== 0 && x !== width - 1 && y !== 0 && y !== height - 1) continue;
    border++; if (neutral(sample.data,(y * width + x) * channels)) lightBorder++;
    add(y * width + x);
  }
  while (head < tail) {
    const index = queue[head++], x = index % width, y = Math.floor(index / width);
    if (x) add(index - 1); if (x + 1 < width) add(index + 1);
    if (y) add(index - width); if (y + 1 < height) add(index + width);
  }
  let adjustedPixels = 0, prepared = original;
  if (improve && tail) {
    const full = await image.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const fw = full.info.width, fh = full.info.height, fc = full.info.channels;
    for (let y = 0; y < fh; y++) {
      const sy = Math.min(height - 1, Math.floor(y * height / fh));
      for (let x = 0; x < fw; x++) {
        if (faceArea(x,y,fw,fh)) continue;
        if (!mask[sy * width + Math.min(width - 1,Math.floor(x * width / fw))]) continue;
        const index = (y * fw + x) * fc;
        if (!neutral(full.data,index)) continue;
        if (Math.min(full.data[index],full.data[index + 1],full.data[index + 2]) < 250) adjustedPixels++;
        full.data[index] = full.data[index + 1] = full.data[index + 2] = 255;
      }
    }
    if (adjustedPixels) prepared = await sharp(full.data,{ raw: { width: fw, height: fh, channels: fc } }).jpeg({ quality: 97, chromaSubsampling: "4:4:4" }).toBuffer();
  }
  const adjusted = adjustedPixels > 0, borderCoverage = border ? Number((lightBorder / border).toFixed(3)) : 0;
  return { original, prepared, processing: { adjusted, borderCoverage,
    note: adjusted ? "Se aclararon las zonas claras conectadas al borde del fondo. Administración revisará el resultado."
      : "Se conservó el aspecto de la fotografía. Administración comprobará el fondo blanco, el uniforme y el encuadre." } };
}

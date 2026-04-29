// Rasterize logo/icon-filled.svg to PNGs at the four sizes Chrome MV3 expects.
//
// Why icon-filled.svg and not icon.svg?
//   - icon.svg uses a 7px outline stroke on a 128 viewBox. At 16×16 that's
//     ~0.875px — sub-pixel, fragile, often rendered as ghost-thin or invisible.
//   - icon-filled.svg is a solid square + stroke, so the silhouette stays
//     bold and recognisable at every size, including 16×16 favicon scale.
//   - The outline mark stays as the canonical brand mark for marketing /
//     docs / lockup contexts (in logo/icon.svg). The toolbar wants the bolder
//     filled variant.
//
// Run: npm run gen:icons   (also runs automatically in vite build via copy-static-assets)

import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE = resolve(ROOT, 'logo/icon-filled.svg');
const OUT_DIR = resolve(ROOT, 'logo');
const SIZES = [16, 32, 48, 128];

const svg = readFileSync(SOURCE, 'utf8');

mkdirSync(OUT_DIR, { recursive: true });

for (const size of SIZES) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
    shapeRendering: 2,        // 2 = geometricPrecision (vs crispEdges/auto)
    textRendering: 1,         // 1 = optimizeLegibility (no text in this svg, but cheap)
    imageRendering: 0,        // 0 = optimizeQuality
  });
  const pngBuffer = resvg.render().asPng();
  const outPath = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(outPath, pngBuffer);
  console.log(`[gen:icons] ${size.toString().padStart(3)} → ${outPath}`);
}

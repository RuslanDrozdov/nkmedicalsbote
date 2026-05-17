/**
 * Generates SVG hit paths from brain-background.png color masks.
 * Run: npm run generate:brain-zones
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const INPUT = join(ROOT, "src/assets/brain-background.png");
const OUTPUT = join(ROOT, "src/assets/brainZones.generated.ts");

function brightness(r, g, b) {
  return r + g + b;
}

function isSurveyPixel(r, g, b, x, w) {
  if (x > w * 0.52) return false;
  const br = brightness(r, g, b);
  return br > 140 && b > 130 && b > r + 20 && g < 175 && b > g + 10;
}

function isSettingsPixel(r, g, b, x, w) {
  if (x < w * 0.46) return false;
  const br = brightness(r, g, b);
  return br > 130 && r > 105 && b > 75 && g < 125 && r + b > g + 100;
}

function morphClose(mask, w, h, radius = 2) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) on = 1;
        }
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

function morphOpen(mask, w, h, radius = 1) {
  const eroded = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 1;
      for (let dy = -radius; dy <= radius && on; dy++) {
        for (let dx = -radius; dx <= radius && on; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) on = 0;
        }
      }
      eroded[y * w + x] = on;
    }
  }
  return morphClose(eroded, w, h, radius);
}

function largestComponent(mask, w, h) {
  const visited = new Uint8Array(mask.length);
  let best = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || visited[i]) continue;
      const stack = [[x, y]];
      const comp = [];
      visited[i] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      if (comp.length > best.length) best = comp;
    }
  }

  const out = new Uint8Array(mask.length);
  for (const [x, y] of best) out[y * w + x] = 1;
  return out;
}

/** Trace outer boundary (clockwise) of mask using Moore-neighbor. */
function traceContour(mask, w, h) {
  let start = null;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        start = [x, y];
        break outer;
      }
    }
  }
  if (!start) return [];

  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];

  const at = (x, y) => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x];

  let [px, py] = start;
  let dir = 0;
  const contour = [];
  const maxSteps = w * h * 4;
  let steps = 0;

  do {
    contour.push([px, py]);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + i + 5) % 8;
      const nx = px + dirs[d][0];
      const ny = py + dirs[d][1];
      if (at(nx, ny)) {
        px = nx;
        py = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found) break;
    steps++;
  } while ((px !== start[0] || py !== start[1] || contour.length < 3) && steps < maxSteps);

  return contour;
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(x - projX, y - projY);
}

function simplifyRDP(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyRDP(points.slice(0, index + 1), tolerance);
    const right = simplifyRDP(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function contourToPath(points) {
  if (points.length < 3) return "";
  const [first, ...rest] = points;
  const fmt = (n) => n.toFixed(1).replace(/\.0$/, "");
  let d = `M ${fmt(first[0])} ${fmt(first[1])}`;
  for (const [x, y] of rest) d += ` L ${fmt(x)} ${fmt(y)}`;
  return `${d} Z`;
}

function centroid(mask, w, h) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (!n) return { x: 0.5, y: 0.5 };
  return { x: sx / n / w, y: sy / n / h };
}

function buildZoneMask(data, w, h, classifier) {
  const raw = new Uint8Array(w * h);
  const border = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < border || x >= w - border || y < border || y >= h - border) continue;
      const i = (y * w + x) * 3;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      raw[y * w + x] = classifier(r, g, b, x, w) ? 1 : 0;
    }
  }
  const closed = morphClose(raw, w, h, 2);
  const opened = morphOpen(closed, w, h, 1);
  return largestComponent(opened, w, h);
}

async function main() {
  const { data, info } = await sharp(INPUT).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  const surveyMask = buildZoneMask(data, w, h, isSurveyPixel);
  const settingsMask = buildZoneMask(data, w, h, isSettingsPixel);

  const surveyContour = traceContour(surveyMask, w, h);
  const settingsContour = traceContour(settingsMask, w, h);

  const surveySimplified = simplifyRDP(surveyContour, 3);
  const settingsSimplified = simplifyRDP(settingsContour, 3);

  const surveyPath = contourToPath(surveySimplified);
  const settingsPath = contourToPath(settingsSimplified);

  const surveyLabelAnchor = centroid(surveyMask, w, h);
  const settingsLabelAnchor = centroid(settingsMask, w, h);

  const ts = `// Auto-generated by scripts/generate-brain-zones.mjs — do not edit manually
export const BRAIN_VIEWBOX = { width: ${w}, height: ${h} } as const;

export const surveyPath = ${JSON.stringify(surveyPath)};

export const settingsPath = ${JSON.stringify(settingsPath)};

export const surveyLabelAnchor = { x: ${surveyLabelAnchor.x.toFixed(4)}, y: ${surveyLabelAnchor.y.toFixed(4)} } as const;

export const settingsLabelAnchor = { x: ${settingsLabelAnchor.x.toFixed(4)}, y: ${settingsLabelAnchor.y.toFixed(4)} } as const;
`;

  writeFileSync(OUTPUT, ts, "utf8");
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  survey: ${surveySimplified.length} points`);
  console.log(`  settings: ${settingsSimplified.length} points`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

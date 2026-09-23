/**
 * 生成站点图标
 * ------------------------------------------------------------------
 * 用法：node tools/make-icons.mjs
 * 生成到 static/ 目录：
 *   favicon.ico              浏览器标签页图标（内含 16px + 32px）
 *   favicon-16x16.png
 *   favicon-32x32.png
 *   apple-touch-icon.png     加到手机主屏时的图标
 *   safari-pinned-tab.svg    Safari 固定标签页的剪影图标
 *
 * 想换配色：改下面的 C1 / C2 两个颜色，重新跑一次即可。
 * ------------------------------------------------------------------
 */

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

// ============ 可调参数 ============

const C1 = [99, 102, 241]; // 渐变起点  #6366F1（靛蓝）
const C2 = [67, 56, 202]; //  渐变终点  #4338CA（深靛蓝）
const BAR = [255, 255, 255]; // 文字条颜色
const BG_RADIUS = 0.22; // 圆角半径（占边长比例）
const SUPERSAMPLE = 4; // 超采样倍数，越大边缘越平滑

// 三条"文字线"的几何形状，坐标是 0~1 的相对值
const BARS = [
  { x0: 0.265, x1: 0.735, yc: 0.355, h: 0.088 },
  { x0: 0.265, x1: 0.735, yc: 0.5, h: 0.088 },
  { x0: 0.265, x1: 0.575, yc: 0.645, h: 0.088 },
];

// ============ PNG 编码 ============

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 颜色类型 6 = RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // 每行开头的 filter byte
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ============ 绘制 ============

/** 点是否落在圆角矩形内 */
function inRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 归一化坐标 (u,v) 处的颜色，返回 [r,g,b,a]，a 为 0~1 */
function sample(u, v, rounded) {
  const r = rounded ? BG_RADIUS : 0;
  if (!inRoundRect(u, v, 0, 0, 1, 1, r)) return [0, 0, 0, 0];

  for (const b of BARS) {
    const y0 = b.yc - b.h / 2;
    const y1 = b.yc + b.h / 2;
    if (inRoundRect(u, v, b.x0, y0, b.x1, y1, b.h / 2)) {
      return [BAR[0], BAR[1], BAR[2], 1];
    }
  }

  const t = (u + v) / 2;
  return [
    C1[0] + (C2[0] - C1[0]) * t,
    C1[1] + (C2[1] - C1[1]) * t,
    C1[2] + (C2[2] - C1[2]) * t,
    1,
  ];
}

/** 渲染成 size×size 的 RGBA Buffer */
function render(size, { rounded = true } = {}) {
  const out = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0,
        ag = 0,
        ab = 0,
        aa = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const u = (x + (sx + 0.5) / SUPERSAMPLE) / size;
          const v = (y + (sy + 0.5) / SUPERSAMPLE) / size;
          const [r, g, b, a] = sample(u, v, rounded);
          ar += r * a;
          ag += g * a;
          ab += b * a;
          aa += a;
        }
      }
      const i = (y * size + x) * 4;
      if (aa > 0) {
        out[i] = Math.round(ar / aa);
        out[i + 1] = Math.round(ag / aa);
        out[i + 2] = Math.round(ab / aa);
      }
      out[i + 3] = Math.round((aa / n) * 255);
    }
  }
  return out;
}

// ============ ICO 封装 ============

function buildICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dirs = [];
  const blobs = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size;
    d[1] = e.size >= 256 ? 0 : e.size;
    d[2] = 0; // 调色板数
    d[3] = 0; // reserved
    d.writeUInt16LE(1, 4); // 颜色平面
    d.writeUInt16LE(32, 6); // 位深
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
    dirs.push(d);
    blobs.push(e.png);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}

// ============ 输出 ============

const outDir = path.join(process.cwd(), "static");
fs.mkdirSync(outDir, { recursive: true });

const png16 = encodePNG(16, 16, render(16));
const png32 = encodePNG(32, 32, render(32));
const png180 = encodePNG(180, 180, render(180, { rounded: false }));
const ico = buildICO([
  { size: 16, png: png16 },
  { size: 32, png: png32 },
]);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path fill="#000" d="M22 0h56a22 22 0 0 1 22 22v56a22 22 0 0 1-22 22H22A22 22 0 0 1 0 78V22A22 22 0 0 1 22 0Z"/>
  <g fill="#fff">
    <rect x="26.5" y="31.1" width="47" height="8.8" rx="4.4"/>
    <rect x="26.5" y="45.6" width="47" height="8.8" rx="4.4"/>
    <rect x="26.5" y="60.1" width="31" height="8.8" rx="4.4"/>
  </g>
</svg>
`;

const files = [
  ["favicon.ico", ico],
  ["favicon-16x16.png", png16],
  ["favicon-32x32.png", png32],
  ["apple-touch-icon.png", png180],
  ["safari-pinned-tab.svg", Buffer.from(svg, "utf8")],
];

for (const [name, data] of files) {
  const p = path.join(outDir, name);
  fs.writeFileSync(p, data);
  console.log(`  ${name.padEnd(24)} ${String(data.length).padStart(7)} 字节`);
}
console.log("图标生成完毕 → static/");

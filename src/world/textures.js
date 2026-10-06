// 절차적 텍스처 (캔버스). 외부 이미지 파일을 쓰지 않는다.
import * as THREE from 'three';
import { Random } from '../core/Random.js';

const cache = new Map();
let maxAniso = 4;

export function setMaxAnisotropy(v) {
  maxAniso = v;
}

// ---------------------------------------------------------------------------
// 주기적(타일링 가능) 값 노이즈
class PeriodicNoise {
  constructor(rng, period) {
    this.p = period;
    this.v = new Float32Array(period * period);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next();
  }

  sample(x, y) {
    const p = this.p;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % p) + p) % p;
    const y0 = ((yi % p) + p) % p;
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.v[y0 * p + x0];
    const b = this.v[y0 * p + x1];
    const c = this.v[y1 * p + x0];
    const d = this.v[y1 * p + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

function makeFbm(seed, basePeriod, octaves) {
  const rng = new Random(seed);
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(new PeriodicNoise(rng, basePeriod << o));
  // u,v: 0..1 (타일 좌표)
  return (u, v, gain = 0.5) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const per = basePeriod << o;
      sum += layers[o].sample(u * per, v * per) * amp;
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  };
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { srgb = true, repeat = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = mips;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// 픽셀 단위 생성 보조
function pixelTexture(size, fn, opts) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const col = [0, 0, 0, 255];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      col[3] = 255;
      fn(x / size, y / size, col, x, y);
      const i = (y * size + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = col[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, opts);
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// ---------------------------------------------------------------------------
// 지면 재질 텍스처 (지형 스플랫용). 재질마다 알베도(sRGB, A = 거칠기 배수)와
// 노멀(RG = 탄젠트 x·y)·높이(B)를 캔버스로 그려 배열 텍스처의 층 하나씩에 넣는다.
// 층 순서는 지형 셰이더(terrainShader.js)와 같다:
//  0 젖은 갈아엎은 흑토  1 그루터기 밭  2 마른 풀밭  3 진흙  4 밝은 하층토  5 자갈 섞인 흙길  6 근거리 디테일
// 밭 재질(0, 1)의 u 는 고랑을 가로지르는 방향, v 는 고랑을 따라가는 방향이다.
export const GROUND_LAYER_COUNT = 7;
// 높이 0..1 이 나타내는 실제 높이 (m) → 노멀 세기
const GROUND_HEIGHT_RANGE = [0.05, 0.03, 0.028, 0.02, 0.035, 0.024, 0.005];

// 가로·세로 주기가 다른 타일링 값 노이즈 (흙덩이를 한 방향으로 길쭉하게)
class RectNoise {
  constructor(rng, pu, pv) {
    this.pu = pu;
    this.pv = pv;
    this.v = new Float32Array(pu * pv);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng.next();
  }

  sample(x, y) {
    const { pu, pv } = this;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % pu) + pu) % pu;
    const y0 = ((yi % pv) + pv) % pv;
    const x1 = (x0 + 1) % pu;
    const y1 = (y0 + 1) % pv;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = this.v[y0 * pu + x0];
    const b = this.v[y0 * pu + x1];
    const c = this.v[y1 * pu + x0];
    const d = this.v[y1 * pu + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
}

function rectFbm(seed, pu, pv, octaves) {
  const rng = new Random(seed);
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(new RectNoise(rng, pu << o, pv << o));
  return (u, v, gain = 0.5) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += layers[o].sample(u * (pu << o), v * (pv << o)) * amp;
      norm += amp;
      amp *= gain;
    }
    return sum / norm;
  };
}

const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = sat((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])},${a})`;
const hcss = (h, rough, a = 1) => `rgba(${clamp255(h * 255)},${clamp255(rough * 255)},0,${a})`;

// 재질 한 층: 색 캔버스 + 높이 캔버스(R = 높이, G = 거칠기 배수)
class GroundLayer {
  constructor(size, seed) {
    this.S = size;
    this.k = size / 512; // 붓 크기 배율 (512px 기준으로 정함)
    this.seed = seed;
    this.rng = new Random(seed);
    this.col = canvas(size);
    this.hgt = canvas(size);
    this.cc = this.col.getContext('2d');
    this.hc = this.hgt.getContext('2d');
  }

  jit(c, a = 0.12) {
    const m = 1 + (this.rng.next() - 0.5) * a * 2;
    return [c[0] * m, c[1] * m, c[2] * m];
  }

  // 픽셀 단위 바탕: fn(u, v, o) → o = [r, g, b, 높이 0..1, 거칠기 배수 0..1]
  base(fn) {
    const S = this.S;
    const ci = this.cc.createImageData(S, S);
    const hi = this.hc.createImageData(S, S);
    const o = [0, 0, 0, 0.5, 1];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        o[3] = 0.5;
        o[4] = 1;
        fn(x / S, y / S, o);
        const i = (y * S + x) * 4;
        ci.data[i] = clamp255(o[0]);
        ci.data[i + 1] = clamp255(o[1]);
        ci.data[i + 2] = clamp255(o[2]);
        ci.data[i + 3] = 255;
        hi.data[i] = clamp255(o[3] * 255);
        hi.data[i + 1] = clamp255(o[4] * 255);
        hi.data[i + 2] = 0;
        hi.data[i + 3] = 255;
      }
    }
    this.cc.putImageData(ci, 0, 0);
    this.hc.putImageData(hi, 0, 0);
  }

  // 타일 경계를 넘는 도형은 반대편에도 그린다
  wrap(x, y, r, draw) {
    const S = this.S;
    for (const ox of [-S, 0, S]) {
      if (x + ox < -r || x + ox > S + r) continue;
      for (const oy of [-S, 0, S]) {
        if (y + oy < -r || y + oy > S + r) continue;
        draw(x + ox, y + oy);
      }
    }
  }

  // 선 (풀잎·지푸라기·금). h < 0 이면 색만 칠한다
  line(x0, y0, x1, y1, w, rgb, h, rough = 1, alpha = 1) {
    const r = Math.hypot(x1 - x0, y1 - y0) + w;
    const dx = x1 - x0;
    const dy = y1 - y0;
    this.wrap(x0, y0, r, (px, py) => {
      const targets = h < 0 ? [[this.cc, css(rgb, alpha)]] : [[this.cc, css(rgb, alpha)], [this.hc, hcss(h, rough, alpha)]];
      for (const [ctx, st] of targets) {
        ctx.strokeStyle = st;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + dx, py + dy);
        ctx.stroke();
      }
    });
  }

  // 꺾인 선 (금·물기 자국)
  path(pts, w, rgb, h, rough = 1, alpha = 1) {
    const [sx, sy] = pts[0];
    let r = 0;
    for (const [x, y] of pts) r = Math.max(r, Math.hypot(x - sx, y - sy));
    this.wrap(sx, sy, r + w, (px, py) => {
      const targets = h < 0 ? [[this.cc, css(rgb, alpha)]] : [[this.cc, css(rgb, alpha)], [this.hc, hcss(h, rough, alpha)]];
      for (const [ctx, st] of targets) {
        ctx.strokeStyle = st;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(px + pts[i][0] - sx, py + pts[i][1] - sy);
        ctx.stroke();
      }
    });
  }

  // 타원 덩어리 (흙덩이·돌). 높이는 가운데가 솟고 가장자리는 바탕에 녹는다. h < 0 이면 색만
  blob(x, y, rx, ry, rot, rgb, h, rough = 1, alpha = 1) {
    const r = Math.max(rx, ry) + 1;
    this.wrap(x, y, r, (px, py) => {
      const c = this.cc;
      c.save();
      c.translate(px, py);
      c.rotate(rot);
      c.scale(rx, ry);
      c.fillStyle = css(rgb, alpha);
      c.beginPath();
      c.arc(0, 0, 1, 0, Math.PI * 2);
      c.fill();
      c.restore();
      if (h < 0) return;
      const hc = this.hc;
      hc.save();
      hc.translate(px, py);
      hc.rotate(rot);
      hc.scale(rx, ry);
      const g = hc.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, hcss(h, rough, alpha));
      g.addColorStop(0.6, hcss(h, rough, alpha * 0.75));
      g.addColorStop(1, hcss(h, rough, 0));
      hc.fillStyle = g;
      hc.beginPath();
      hc.arc(0, 0, 1, 0, Math.PI * 2);
      hc.fill();
      hc.restore();
    });
  }

  // 그림자 진 덩어리 (아래쪽에 어두운 테 → 위에서 비치는 흐린 빛에서도 덩어리가 읽힌다)
  lump(x, y, rx, ry, rot, rgb, shade, h, rough = 1) {
    const k = this.k;
    this.blob(x + 1.2 * k, y + 1.4 * k, rx * 1.05, ry * 1.05, rot, shade, -1, 1, 0.55);
    this.blob(x, y, rx, ry, rot, rgb, h, rough, 1);
  }

  // 불규칙한 흙덩이: 꼭짓점 반지름을 흔든 다각형 + 빛 방향(-x,-y)으로 밝아지는 기울기.
  // 매끈한 타원 lump 는 가까이서 동전·조약돌처럼 보이므로 흙에는 이것을 쓴다
  clod(x, y, rx, ry, rot, rgb, shade, h, rough = 1) {
    const { rng, k } = this;
    const n = 6 + Math.floor(rng.next() * 4);
    const a0 = rng.next() * Math.PI * 2;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + (rng.next() - 0.5) * 0.6) / n) * Math.PI * 2;
      const m = 0.62 + rng.next() * 0.5;
      const lx = Math.cos(a) * rx * m;
      const ly = Math.sin(a) * ry * m;
      pts.push([lx * cr - ly * sr, lx * sr + ly * cr]);
    }
    const r = Math.max(rx, ry) * 1.15;
    const shape = (ctx, ox, oy, sc) => {
      ctx.beginPath();
      ctx.moveTo(ox + pts[0][0] * sc, oy + pts[0][1] * sc);
      for (let i = 1; i < n; i++) ctx.lineTo(ox + pts[i][0] * sc, oy + pts[i][1] * sc);
      ctx.closePath();
    };
    const lit = [rgb[0] * 1.12, rgb[1] * 1.12, rgb[2] * 1.12];
    const dim = [rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8];
    this.wrap(x, y, r + 2 * k, (px, py) => {
      const c = this.cc;
      c.fillStyle = css(shade, 0.45);
      shape(c, px + 1.1 * k, py + 1.3 * k, 1.04);
      c.fill();
      const g = c.createLinearGradient(px - r * 0.7, py - r * 0.7, px + r * 0.7, py + r * 0.7);
      g.addColorStop(0, css(lit));
      g.addColorStop(1, css(dim));
      c.fillStyle = g;
      shape(c, px, py, 1);
      c.fill();
      const hc = this.hc;
      const hg = hc.createRadialGradient(px - r * 0.15, py - r * 0.15, 0, px, py, r);
      hg.addColorStop(0, hcss(h, rough, 1));
      hg.addColorStop(0.55, hcss(h, rough, 0.7));
      hg.addColorStop(1, hcss(h, rough, 0));
      hc.fillStyle = hg;
      shape(hc, px, py, 1);
      hc.fill();
    });
  }

  // 배열 텍스처 데이터로 옮긴다 (노멀은 높이에서 중앙차분)
  pack(alb, nrm, li, tile, hRange) {
    const S = this.S;
    const c = this.cc.getImageData(0, 0, S, S).data;
    const h = this.hc.getImageData(0, 0, S, S).data;
    const off = li * S * S * 4;
    const k = (hRange * S) / (2 * tile);
    const H = (x, y) => h[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        alb[off + i] = c[i];
        alb[off + i + 1] = c[i + 1];
        alb[off + i + 2] = c[i + 2];
        alb[off + i + 3] = h[i + 1];
        const sx = (H(x + 1, y) - H(x - 1, y)) * k;
        const sy = (H(x, y + 1) - H(x, y - 1)) * k;
        const l = Math.sqrt(sx * sx + sy * sy + 1);
        nrm[off + i] = clamp255((-sx / l) * 127.5 + 128);
        nrm[off + i + 1] = clamp255((-sy / l) * 127.5 + 128);
        nrm[off + i + 2] = h[i];
        nrm[off + i + 3] = 255;
      }
    }
  }
}

// 0 젖은 갈아엎은 흑토: 검정이 아니라 진한 회갈색, 고랑 방향으로 길쭉한 흙덩이·물기 고인 틈
function gPlowed(L) {
  const { rng, S, k } = L;
  // 흙덩이 크기(10~25cm)의 높이장. 타일(2.2m) 규모의 큰 얼룩은 넣지 않는다 — 반복되어 낮은 시선에서 빗살 무늬가 됨.
  // 큰 규모 밝기·물기 변화는 셰이더의 월드 좌표 노이즈가 맡는다.
  const clod = rectFbm(L.seed + 1, 16, 11, 4);
  const fine = rectFbm(L.seed + 2, 48, 48, 2);
  const crev = [38, 34, 30];
  const mid = [62, 55, 48];
  const top = [86, 77, 66];
  L.base((u, v, o) => {
    const h = sat(0.52 + (clod(u, v, 0.5) - 0.5) * 1.5 + (fine(u, v) - 0.5) * 0.45);
    let c = mix3(crev, mid, smooth(0.18, 0.5, h));
    c = mix3(c, top, smooth(0.62, 0.92, h));
    o[0] = c[0];
    o[1] = c[1];
    o[2] = c[2];
    o[3] = h;
    o[4] = 0.7 + 0.3 * smooth(0.2, 0.55, h);
  });
  // 쟁기가 넘긴 흙덩이: 고랑 방향(v)으로 조금 길쭉. 큰 덩이 사이에 부스러기
  for (let i = 0; i < 420; i++) {
    const rx = rng.range(5, 12) * k;
    L.clod(rng.next() * S, rng.next() * S, rx, rx * rng.range(1.1, 1.6), rng.range(-0.4, 0.4), L.jit(mix3(mid, top, rng.range(0.2, 0.85))), crev, rng.range(0.65, 0.95), rng.range(0.9, 1));
  }
  for (let i = 0; i < 520; i++) {
    const rx = rng.range(1.5, 4) * k;
    L.clod(rng.next() * S, rng.next() * S, rx, rx * rng.range(0.8, 1.3), rng.next() * 3, L.jit(mix3(mid, top, rng.range(0.1, 0.7))), crev, rng.range(0.55, 0.8), 1);
  }
  for (let i = 0; i < 55; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const a = Math.PI / 2 + rng.range(-1.2, 1.2);
    const len = rng.range(10, 28) * k;
    L.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rng.range(1, 1.7) * k, L.jit([126, 113, 88]), 0.78);
  }
  for (let i = 0; i < 45; i++) {
    const r = rng.range(1.5, 3.2) * k;
    L.lump(rng.next() * S, rng.next() * S, r, r * rng.range(0.7, 1), rng.next() * 3, L.jit([108, 102, 94]), crev, 0.85, 0.7);
  }
}

// 1 그루터기 밭: 마른 흙 위에 줄지어 선 짧은 그루터기 + 쓰러진 지푸라기
function gStubble(L) {
  const { rng, S, k } = L;
  const soil = rectFbm(L.seed + 1, 10, 10, 4);
  const fine = rectFbm(L.seed + 2, 32, 32, 2);
  const moss = rectFbm(L.seed + 3, 7, 7, 3);
  L.base((u, v, o) => {
    const h = sat(0.35 + (soil(u, v) - 0.5) * 0.6 + (fine(u, v) - 0.5) * 0.35);
    let c = mix3([60, 54, 46], [84, 76, 64], smooth(0.2, 0.6, h));
    c = mix3(c, [86, 88, 72], smooth(0.58, 0.8, moss(u, v)) * 0.6);
    o[0] = c[0];
    o[1] = c[1];
    o[2] = c[2];
    o[3] = h;
  });
  const straw = [
    [150, 136, 104],
    [128, 116, 90],
    [166, 152, 118],
    [108, 97, 76],
  ];
  for (let i = 0; i < 1500; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const a = Math.PI / 2 + (rng.next() - 0.5) * 0.9;
    const len = rng.range(14, 55) * k;
    L.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rng.range(0.8, 1.8) * k, L.jit(rng.pick(straw)), rng.range(0.5, 0.72), 1, 0.85);
  }
  // 그루터기 줄 (한 장에 12줄 → 약 0.17m 간격)
  const rows = 12;
  for (let r = 0; r < rows; r++) {
    const x0 = ((r + 0.5) * S) / rows;
    for (let y = rng.next() * 8; y < S; y += rng.range(7, 13) * k) {
      if (rng.next() > 0.88) continue;
      const x = x0 + rng.range(-2.5, 2.5) * k;
      const rr = rng.range(1.7, 2.8) * k;
      L.blob(x + 2 * k, y + 1.2 * k, rr * 1.2, rr, 0, [50, 44, 36], -1, 1, 0.6);
      L.blob(x, y, rr, rr * rng.range(0.8, 1.1), 0, L.jit([176, 160, 124]), 1.0, 1);
      L.blob(x, y, rr * 0.35, rr * 0.35, 0, [96, 86, 66], -1, 1, 0.9);
    }
  }
  for (let i = 0; i < 70; i++) {
    const r = rng.range(3, 8) * k;
    L.blob(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit([90, 93, 76]), 0.62, 1, 0.8);
  }
}

// 2 마른 풀밭: 바랜 짚색(채도 낮게) + 회녹색 + 갈색 풀잎이 비·바람에 눕혀져 엉킨 바닥.
// 한 점에서 사방으로 뻗는 풀잎(별 모양)은 인공 무늬로 읽히므로, 포기마다 한 방향으로 누운 풀잎 다발 + 흩어진 지푸라기로 그린다
function gGrass(L) {
  const { rng, S, k } = L;
  const n1 = rectFbm(L.seed + 1, 8, 8, 4);
  const n2 = rectFbm(L.seed + 4, 20, 20, 2);
  L.base((u, v, o) => {
    const n = n1(u, v);
    const c = mix3([54, 50, 40], [76, 70, 55], n);
    const m = 0.92 + 0.16 * n2(u, v);
    o[0] = c[0] * m;
    o[1] = c[1] * m;
    o[2] = c[2] * m;
    o[3] = 0.25 + n * 0.25;
  });
  const pal = [
    [[110, 102, 82], 0.36],
    [[120, 112, 92], 0.12],
    [[86, 90, 76], 0.27],
    [[82, 73, 59], 0.25],
  ];
  const pick = () => {
    let r = rng.next();
    for (const [c, w] of pal) {
      r -= w;
      if (r <= 0) return c;
    }
    return pal[0][0];
  };
  // 살짝 휜 풀잎 한 가닥 (밑동 → 끝)
  const blade = (x, y, a, len, w, col, h, alpha) => {
    const bend = (rng.next() - 0.5) * 0.5;
    const mx = x + Math.cos(a) * len * 0.5;
    const my = y + Math.sin(a) * len * 0.5;
    const a2 = a + bend;
    L.path([[x, y], [mx, my], [mx + Math.cos(a2) * len * 0.5, my + Math.sin(a2) * len * 0.5]], w, col, h, 1, alpha);
  };
  // 아래층: 눌려 엉킨 묵은 풀 (어둡고 짧게, 방향은 칸마다 조금씩 다른 흐름)
  const flow = rectFbm(L.seed + 5, 3, 3, 2);
  const N0 = 3200;
  for (let i = 0; i < N0; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const a = flow(x / S, y / S) * Math.PI * 4 + (rng.next() - 0.5) * 1.1;
    blade(x, y, a, rng.range(10, 30) * k, rng.range(0.8, 1.7) * k, L.jit(mix3(pick(), [60, 55, 44], 0.35), 0.12), 0.3 + (0.25 * i) / N0, 0.9);
  }
  // 풀 포기: 밑동이 좁은 띠에 모여 한 방향(포기마다 다름)으로 누운 풀잎 다발
  for (let t = 0; t < 110; t++) {
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    const dir = rng.next() * Math.PI * 2;
    const spread = rng.range(0.25, 0.5);
    const n = rng.int(14, 34);
    const base = pick();
    for (let i = 0; i < n; i++) {
      const off = rng.range(-6, 6) * k;
      const x = cx + Math.cos(dir + Math.PI / 2) * off + rng.range(-2, 2) * k;
      const y = cy + Math.sin(dir + Math.PI / 2) * off + rng.range(-2, 2) * k;
      blade(x, y, dir + (rng.next() - 0.5) * spread * 2, rng.range(16, 44) * k, rng.range(0.9, 1.8) * k, L.jit(rng.chance(0.7) ? base : pick(), 0.12), rng.range(0.6, 0.9), 0.93);
    }
  }
  // 위층: 흩어진 마른 지푸라기·풀잎 (길고 가늘게, 아무 방향)
  for (let i = 0; i < 1500; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    blade(x, y, rng.next() * Math.PI * 2, rng.range(14, 40) * k, rng.range(0.7, 1.4) * k, L.jit(pick(), 0.15), rng.range(0.7, 1.0), 0.85);
  }
}

// 3 진흙: 매끈하게 젖은 진흙, 오목한 곳은 물기로 광택(거칠기 낮음), 문질린 자국
function gMud(L) {
  const { rng, S, k } = L;
  const big = rectFbm(L.seed + 1, 9, 9, 4);
  const mid = rectFbm(L.seed + 2, 18, 18, 3);
  const warp = rectFbm(L.seed + 3, 5, 5, 2);
  L.base((u, v, o) => {
    const w = (warp(u, v) - 0.5) * 0.08;
    const h = sat(0.5 + (big(u + w, v - w) - 0.5) * 1.15 + (mid(u, v) - 0.5) * 0.4);
    let c = mix3([40, 35, 30], [58, 50, 43], smooth(0.2, 0.45, h));
    c = mix3(c, [76, 66, 56], smooth(0.6, 0.85, h));
    o[0] = c[0];
    o[1] = c[1];
    o[2] = c[2];
    o[3] = h;
    o[4] = 0.35 + 0.6 * smooth(0.25, 0.65, h);
  });
  for (let i = 0; i < 60; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const a = rng.next() * Math.PI;
    const len = rng.range(40, 120) * k;
    L.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rng.range(2, 5) * k, rng.chance(0.5) ? [70, 61, 51] : [44, 38, 33], -1, 1, 0.25);
  }
  for (let i = 0; i < 130; i++) {
    const r = rng.range(2, 6) * k;
    L.lump(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit([68, 59, 50]), [34, 30, 26], rng.range(0.6, 0.8), 0.9);
  }
  for (let i = 0; i < 25; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const a = rng.next() * Math.PI * 2;
    const len = rng.range(10, 24) * k;
    L.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, 1.2 * k, [116, 104, 82], 0.7, 1, 0.8);
  }
}

// 4 밝은 하층토: 파낸 황갈색 흙 (구덩이 분출물·참호 흉벽·수로 둔덕). 부스러진 작은 흙덩이, 가는 마른 금(실금),
// 군데군데 축축하게 짙어진 얼룩, 섞인 흑토 부스러기. 큰 둥근 덩어리 + 굵은 검은 금은 돌담·자갈처럼 읽혀서 쓰지 않는다
function gSubsoil(L) {
  const { rng, S, k } = L;
  const n1 = rectFbm(L.seed + 1, 10, 10, 4);
  const f1 = rectFbm(L.seed + 2, 36, 36, 2);
  const damp = rectFbm(L.seed + 3, 4, 4, 3);
  L.base((u, v, o) => {
    const f = f1(u, v);
    const h = sat(0.45 + (n1(u, v) - 0.5) * 1.0 + (f - 0.5) * 0.4);
    const c = mix3([122, 106, 83], [148, 129, 101], smooth(0.25, 0.7, h));
    // 축축한 얼룩: 넓고 부드럽게 조금 짙게
    const m = (0.95 + 0.1 * f) * (1 - 0.13 * smooth(0.5, 0.75, damp(u, v)));
    o[0] = c[0] * m;
    o[1] = c[1] * m;
    o[2] = c[2] * m;
    o[3] = h;
    o[4] = 0.85 + 0.15 * smooth(0.3, 0.7, damp(u, v));
  });
  // 부스러진 흙덩이: 작고 많이, 그림자는 옅게
  for (let i = 0; i < 520; i++) {
    const r = rng.range(2.2, 8) * k;
    L.clod(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit([146, 128, 100], 0.07), [118, 102, 80], rng.range(0.62, 0.85));
  }
  for (let i = 0; i < 380; i++) {
    const r = rng.range(1, 2.4) * k;
    L.clod(rng.next() * S, rng.next() * S, r, r * rng.range(0.7, 1), rng.next() * 3, L.jit([154, 136, 108], 0.08), [120, 104, 82], rng.range(0.6, 0.8));
  }
  // 가는 마른 금: 짧고 옅게 (실금)
  for (let i = 0; i < 40; i++) {
    let x = rng.next() * S;
    let y = rng.next() * S;
    let a = rng.next() * Math.PI * 2;
    const pts = [[x, y]];
    const n = rng.int(3, 8);
    for (let st = 0; st < n; st++) {
      a += rng.range(-0.8, 0.8);
      const len = rng.range(3, 7) * k;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
    }
    L.path(pts, rng.range(0.45, 0.8) * k, [108, 92, 70], 0.32, 1, 0.5);
  }
  // 섞여 든 흑토 부스러기: 작고 성기게 (큰 검은 반점 무늬가 되지 않게)
  for (let i = 0; i < 90; i++) {
    const r = rng.range(1.2, 3) * k;
    L.lump(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit([92, 80, 65]), [78, 67, 55], 0.72);
  }
  for (let i = 0; i < 30; i++) {
    const r = rng.range(0.7, 1.6) * k;
    L.blob(rng.next() * S, rng.next() * S, r, r, 0, [164, 150, 124], 0.75);
  }
}

// 5 자갈 섞인 흙길: 다져진 흙과 진흙 사이에 박힌 작은 회갈색 자갈. 돌은 작고 모양이 불규칙하며 밝기 차이가 작다
// (크고 하얀 둥근 돌은 동전·물방울 무늬로 읽힘). 자갈이 많은 곳·적은 곳, 그 사이 고운 모래알·진흙 얼룩
function gGravel(L) {
  const { rng, S, k } = L;
  const n1 = rectFbm(L.seed + 1, 8, 8, 4);
  const f1 = rectFbm(L.seed + 2, 48, 48, 2);
  const dens = rectFbm(L.seed + 3, 5, 5, 3);
  L.base((u, v, o) => {
    const n = n1(u, v);
    const f = f1(u, v);
    const h = sat(0.28 + (n - 0.5) * 0.4 + (f - 0.5) * 0.3);
    let c = mix3([74, 67, 58], [98, 90, 78], smooth(0.2, 0.75, n * 0.7 + f * 0.3));
    // 진흙 얼룩 (자갈이 적은 곳)
    c = mix3(c, [62, 55, 47], smooth(0.55, 0.3, dens(u, v)) * 0.6);
    o[0] = c[0];
    o[1] = c[1];
    o[2] = c[2];
    o[3] = h;
    o[4] = 0.8 + 0.2 * n;
  });
  const stones = [
    [104, 98, 88],
    [116, 108, 96],
    [88, 82, 74],
    [110, 98, 82],
    [124, 116, 102],
  ];
  // 고운 모래알
  for (let i = 0; i < 3200; i++) {
    const r = rng.range(0.5, 1.1) * k;
    L.blob(rng.next() * S, rng.next() * S, r, r, 0, L.jit(rng.pick(stones), 0.12), rng.range(0.4, 0.6), 1, 0.7);
  }
  // 자갈: 밀도 노이즈가 높은 곳에 몰리게 (불규칙한 모양, 그림자 옅게)
  let placed = 0;
  for (let i = 0; i < 9000 && placed < 2400; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    if (rng.next() > smooth(0.3, 0.7, dens(x / S, y / S)) * 0.9 + 0.1) continue;
    placed++;
    const r = (1.1 + 3.2 * Math.pow(rng.next(), 2.2)) * k;
    L.clod(x, y, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit(rng.pick(stones), 0.08), [62, 56, 48], rng.range(0.55, 0.9), rng.range(0.6, 0.8));
  }
}

// 6 근거리 디테일: 회색 바탕의 흙 알갱이 높이 (셰이더가 높이로 밝기를, 노멀로 미세 요철을 더함)
function gDetail(L) {
  const { rng, S, k } = L;
  const f1 = rectFbm(L.seed + 1, 16, 16, 4);
  const f2 = rectFbm(L.seed + 2, 64, 64, 2);
  L.base((u, v, o) => {
    const h = sat(0.5 + (f1(u, v) - 0.5) * 1.0 + (f2(u, v) - 0.5) * 0.6);
    const g = 128 + (h - 0.5) * 80;
    o[0] = g;
    o[1] = g;
    o[2] = g;
    o[3] = h;
  });
  for (let i = 0; i < 500; i++) {
    const r = rng.range(1, 3.2) * k;
    L.blob(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, [150, 150, 150], 0.85);
  }
}

const GROUND_GENERATORS = [gPlowed, gStubble, gGrass, gMud, gSubsoil, gGravel, gDetail];

// tiles: 층마다 텍스처 한 장이 덮는 크기 (m) — 노멀 세기 계산에 쓴다
export function groundTextures(size = 512, tiles = [2.2, 2.0, 2.6, 3.0, 2.4, 2.0, 0.55]) {
  return cached('groundLayers_' + size, () => {
    const S = size;
    const n = GROUND_LAYER_COUNT;
    const alb = new Uint8Array(S * S * 4 * n);
    const nrm = new Uint8Array(S * S * 4 * n);
    GROUND_GENERATORS.forEach((gen, li) => {
      const L = new GroundLayer(S, 900 + li * 37);
      gen(L);
      L.pack(alb, nrm, li, tiles[li], GROUND_HEIGHT_RANGE[li]);
    });
    const mk = (data, srgb) => {
      const t = new THREE.DataArrayTexture(data, S, S, n);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = maxAniso;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    // albedoLow: 같은 데이터의 낮은 이방성 사본 (혼합되는 두 번째 층용, 픽셀당 비용 절약)
    return { albedo: mk(alb, true), albedoLow: mk(alb, true), normal: mk(nrm, false), layers: n };
  });
}

// 큰 규모 변화용 타일링 노이즈 (R: 큰 얼룩, G: 반복 깨기 섞기, B: 중간 얼룩). 선형 색공간
export function groundMacroTexture() {
  return cached('groundMacro', () => {
    const fr = makeFbm(41, 4, 5);
    const fg = makeFbm(42, 3, 4);
    const fb = makeFbm(43, 8, 4);
    const st = (v) => clamp255(((v - 0.5) * 2.3 + 0.5) * 255);
    return pixelTexture(
      256,
      (u, v, col) => {
        col[0] = st(fr(u, v, 0.55));
        col[1] = st(fg(u, v, 0.5));
        col[2] = st(fb(u, v, 0.5));
      },
      { srgb: false },
    );
  });
}

// ---------------------------------------------------------------------------
// 건축 재질 (sRGB 색)
export function brickTexture(kind = 'red') {
  return cached('brick_' + kind, () => {
    const size = 512;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = new Random(kind === 'red' ? 41 : 42);
    const f = makeFbm(kind === 'red' ? 43 : 44, 4, 4);
    const base = kind === 'red' ? [118, 70, 54] : [168, 163, 150];
    const mortar = kind === 'red' ? [120, 112, 100] : [140, 136, 126];
    ctx.fillStyle = `rgb(${mortar.join(',')})`;
    ctx.fillRect(0, 0, size, size);
    const rows = 16;
    const rowH = size / rows;
    const cols = 8;
    const colW = size / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * colW * 0.5;
      for (let k = -1; k < cols + 1; k++) {
        const x = k * colW + off;
        const y = r * rowH;
        const v = (rng.next() - 0.5) * 34;
        const soot = rng.next() < 0.12 ? -35 : 0;
        ctx.fillStyle = `rgb(${clamp255(base[0] + v + soot)},${clamp255(base[1] + v * 0.8 + soot)},${clamp255(base[2] + v * 0.7 + soot)})`;
        ctx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);
      }
    }
    // 얼룩·그을음: 타일(벽 2m) 안의 얼룩은 옅게만 (진하면 긴 벽에서 같은 얼룩이 2m 마다 되풀이되어 보인다).
    // 큰 규모 얼룩·습기 띠는 축사 벽 정점색(Structures.shadeWall)이 월드 좌표로 맡는다. 벽돌 표면 잔알갱이는 1px 해시
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const n = f(x / size, y / size, 0.55);
        const grime = (n - 0.5) * 26 + (hashPx(x, y, kind === 'red' ? 5 : 6) - 0.5) * 10;
        img.data[i] = clamp255(img.data[i] + grime);
        img.data[i + 1] = clamp255(img.data[i + 1] + grime);
        img.data[i + 2] = clamp255(img.data[i + 2] + grime);
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c);
  });
}

// 픽셀 좌표 해시 0..1 (골재 알갱이·기공 같은 1px 단위 무늬)
function hashPx(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 일반 콘크리트 (저장탑·창고·방벽·배수관 등, 미터 단위로 반복): 고운 골재 노이즈 회색 + 옅은 얼룩 + 빗물 세로줄.
// 큰 검은 반점(젖소 무늬)이 생기지 않게 큰 규모 명암은 약하게만 둔다.
export function concreteTexture() {
  return cached('concrete', () => {
    const f = makeFbm(51, 4, 5);
    const grain = makeFbm(53, 96, 2);
    const streak = rectFbm(54, 40, 2, 2);
    return pixelTexture(512, (u, v, col, x, y) => {
      const n = f(u, v, 0.5);
      let s = 128 + (n - 0.5) * 24 + (grain(u, v, 0.5) - 0.5) * 20;
      const h = hashPx(x, y, 7);
      if (h < 0.06) s += (h / 0.06 - 0.5) * 34; // 골재 알갱이 (밝고 어두운 점)
      else if (h > 0.996) s -= 30; // 작은 기공
      // 빗물 자국 (세로 줄)
      s -= smooth(0.56, 0.82, streak(u, v, 0.5)) * 11;
      col[0] = clamp255(s * 1.0);
      col[1] = clamp255(s * 0.985);
      col[2] = clamp255(s * 0.95);
    });
  });
}

// 수로 라이닝 프리캐스트 판 아틀라스: 판 하나(1 x 2m) = 가로 한 칸 (variants 칸). UV v = 0 이 수로 바닥 쪽 끝이고,
// 캔버스 위쪽이 비탈 위쪽 끝이다. 고운 골재 노이즈 회색 + 위에서 흘러내린 빗물 얼룩 세로줄 + 바닥 쪽 습기로 짙어진 띠
// (물때 선이 들쭉날쭉) + 아래쪽·이음매의 약간의 이끼와 위쪽의 옅은 지의류 + 가장자리(이음매)의 어두운 선과 깨진 모서리,
// 일부 칸에는 가는 금. 큰 검은 반점 무늬는 없다.
export function canalSlabTexture(w = 1024, h = 512, variants = 4) {
  return cached(`canalSlab${w}x${h}x${variants}`, () => {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const cw = Math.floor(w / variants);
    const grain = rectFbm(1301, 40, 80, 2);
    const mottle = rectFbm(1302, 3, 6, 3);
    const streak = rectFbm(1303, 34, 2, 2);
    const streakLen = rectFbm(1307, 9, 3, 2);
    const tide = rectFbm(1308, 5, 1, 2);
    const moss = rectFbm(1304, 7, 14, 4);
    const lichen = rectFbm(1305, 12, 24, 3);
    const chip = rectFbm(1306, 20, 40, 2);
    // 가는 금 (칸 1, 3): 무작위 걸음으로 그린 1px 선
    const crack = new Uint8Array(w * h);
    const rng = new Random(1309);
    for (let vi = 0; vi < variants; vi++) {
      if (vi % 2 === 0) continue;
      const lines = 2 + rng.int(0, 2);
      for (let l = 0; l < lines; l++) {
        let px = vi * cw + rng.range(0.1, 0.9) * cw;
        let py = rng.range(0.15, 0.85) * h;
        let a = rng.range(0, Math.PI * 2);
        const steps = 60 + rng.int(0, 160);
        for (let s = 0; s < steps; s++) {
          a += rng.range(-0.45, 0.45);
          px += Math.cos(a);
          py += Math.sin(a);
          const ix = Math.round(px);
          const iy = Math.round(py);
          if (ix < vi * cw + 2 || ix >= (vi + 1) * cw - 2 || iy < 2 || iy >= h - 2) break;
          crack[iy * w + ix] = 2;
          for (const [ox, oy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const k = (iy + oy) * w + ix + ox;
            if (!crack[k]) crack[k] = 1;
          }
        }
      }
    }
    const lim = [72, 80, 52];
    for (let y = 0; y < h; y++) {
      const V = y / h; // 0 = 비탈 위쪽 끝, 1 = 바닥 쪽 끝
      for (let x = 0; x < w; x++) {
        const vi = Math.min(variants - 1, Math.floor(x / cw));
        const lx = x - vi * cw;
        const U = lx / cw;
        const uo = U + vi * 0.37; // 칸마다 다른 무늬
        let s = 118 + (vi - 1.5) * 2.5;
        s += (grain(uo, V, 0.5) - 0.5) * 18 + (mottle(uo, V, 0.5) - 0.5) * 16;
        const hp = hashPx(x, y, 3);
        if (hp < 0.06) s += (hp / 0.06 - 0.6) * 26;
        else if (hp > 0.995) s -= 30;
        // 빗물 얼룩: 위쪽 끝(흙 둑)에서 흘러내린 세로줄, 줄마다 길이·진하기가 다르고 드문드문하다
        const reach = 0.2 + 0.8 * streakLen(uo, 0.5, 0.5);
        const st = smooth(0.6, 0.85, streak(uo, V * 0.5, 0.5)) * (1 - smooth(reach - 0.2, reach + 0.1, V)) * (0.35 + 0.65 * mottle(uo * 2.3, 0.4, 0.5));
        s -= st * 10;
        // 습기 띠: 들쭉날쭉한 물때 선 아래가 짙고, 바닥 끝은 더 짙다
        const tideV = 0.7 + (tide(uo, 0.3, 0.5) - 0.5) * 0.16;
        const damp = smooth(tideV - 0.03, tideV + 0.06, V);
        s -= damp * 26 + smooth(0.9, 1.0, V) * 14;
        // 가장자리(이음매) 때와 깨진 모서리
        const ex = Math.min(lx, cw - 1 - lx);
        const ey = Math.min(y, h - 1 - y);
        const e = Math.min(ex, ey);
        const ch = chip(uo, V, 0.5);
        const ew = 1.6 + 2.2 * ch;
        let edge = 0;
        if (e < ew) edge = 1 - e / ew;
        const chipped = e < 7 && ch > 0.68;
        if (chipped) s += 8 - e * 0.6; // 떨어져 나간 모서리: 조금 밝은 새 단면
        s -= edge * 46;
        if (crack[y * w + x] === 2) s -= 34;
        else if (crack[y * w + x] === 1) s -= 9;
        let r = s;
        let g = s * 0.985;
        let b = s * 0.95;
        // 습기 띠는 조금 차갑고 푸르스름하게
        g += damp * 2;
        b += damp * 3;
        // 이끼: 아래쪽 습기 띠와 이음매 가까이
        const mo = smooth(0.56, 0.7, moss(uo, V, 0.55)) * Math.min(1, damp * 0.85 + smooth(10, 0, e) * 0.55 + 0.05);
        r += (lim[0] - r) * mo * 0.7;
        g += (lim[1] - g) * mo * 0.7;
        b += (lim[2] - b) * mo * 0.7;
        // 지의류: 위쪽의 옅은 점
        const li = smooth(0.72, 0.82, lichen(uo, V, 0.5)) * (1 - damp) * 0.16;
        r += (176 - r) * li;
        g += (180 - g) * li;
        b += (164 - b) * li;
        const i = (y * w + x) * 4;
        d[i] = clamp255(r);
        d[i + 1] = clamp255(g);
        d[i + 2] = clamp255(b);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { repeat: false });
  });
}

export function slateTexture() {
  return cached('slate', () => {
    const f = makeFbm(61, 4, 5);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u, v, 0.55);
      const wave = Math.sin(u * Math.PI * 2 * 8) * 0.5 + 0.5; // 골판 슬레이트
      let s = 120 + (n - 0.5) * 60 + wave * 34;
      if (n < 0.33) s -= 30; // 이끼·때
      col[0] = clamp255(s * 0.96);
      col[1] = clamp255(s * 0.98);
      col[2] = clamp255(s * 0.93);
    });
  });
}

export function rustTexture() {
  return cached('rust', () => {
    const f = makeFbm(71, 4, 6);
    const g = makeFbm(72, 8, 4);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u, v, 0.55);
      const m = g(u, v, 0.5);
      // 녹 (주황갈색) 과 남은 도장 (흐린 녹색·회색) 의 혼합
      const rust = [118 + n * 50, 62 + n * 30, 34 + n * 14];
      const paint = [84 + m * 20, 88 + m * 20, 70 + m * 14];
      const t = m > 0.52 ? 1 : 0;
      col[0] = clamp255(rust[0] * (1 - t) + paint[0] * t);
      col[1] = clamp255(rust[1] * (1 - t) + paint[1] * t);
      col[2] = clamp255(rust[2] * (1 - t) + paint[2] * t);
    });
  });
}

export function burntTexture() {
  return cached('burnt', () => {
    const f = makeFbm(81, 4, 6);
    const g = makeFbm(82, 16, 3);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u, v, 0.55);
      const m = g(u, v, 0.5);
      // 불탄 금속: 검은 그을음 + 녹 + 회백색 재
      let r = 38 + n * 30;
      let gg = 32 + n * 22;
      let b = 28 + n * 18;
      if (m > 0.55) {
        r += 60 * (m - 0.55) * 4;
        gg += 25 * (m - 0.55) * 4;
        b += 8 * (m - 0.55) * 4;
      }
      if (n > 0.7) {
        r += 40;
        gg += 38;
        b += 34;
      }
      col[0] = clamp255(r);
      col[1] = clamp255(gg);
      col[2] = clamp255(b);
    });
  });
}

// ---------------------------------------------------------------------------
// 중간 지대 차량 잔해 (장갑차·민간 차량·트랙터)
// 불탄 차체 (미터 단위 반복, 한 장 = 2m 로 쓴다): 그을음 낀 어두운 회갈색 바탕 + 열에 변색된 녹(적갈색~주황갈색)
// + 회백색 재·산화 얼룩 + 남은 도장 조각 + 위에서 흘러내린 녹물 세로줄 + 1px 반점.
// 큰 검은 덩어리 무늬(젖소 무늬)가 생기지 않게 명암 차이는 중간·작은 얼룩에만 주고 색끼리 밝기를 가깝게 둔다.
// kind: 'armor' = 장갑차 (그을음이 짙고 올리브 도장이 남음), 'car' = 민간 차량·트랙터 (주황빛 녹과 재가 많음)
// 캔버스 위쪽 = 부품 위쪽 (상자 옆면 UV v 가 위로 증가) → 녹물 줄은 세로로 흐른다.
export function wreckTexture(kind = 'car', size = 512) {
  return cached(`wreck:${kind}:${size}`, () => {
    const armor = kind === 'armor';
    const s0 = armor ? 301 : 311;
    const big = makeFbm(s0, 2, 5); // 넓고 부드러운 색 변화 (경계 없이 이어짐)
    const sootN = makeFbm(s0 + 1, 3, 5);
    const mottle = makeFbm(s0 + 2, 24, 3); // 녹 표면의 고운 얼룩
    const flake = makeFbm(s0 + 3, 12, 3); // 재·남은 도장 조각 (작게)
    const streak = rectFbm(s0 + 4, 36, 3, 3);
    const rustD = armor ? [66, 50, 40] : [84, 54, 38];
    const rustL = armor ? [92, 64, 46] : [118, 74, 46];
    const soot = armor ? [38, 36, 34] : [44, 39, 35];
    const ashC = armor ? [98, 95, 90] : [112, 107, 100];
    const paintC = armor ? [64, 67, 52] : [78, 80, 78];
    return pixelTexture(size, (u, v, col, x, y) => {
      const n = big(u, v, 0.55);
      const m = mottle(u, v, 0.55);
      // 녹 바탕: 어두운 녹 ↔ 밝은 녹이 경계 없이 이어지고, 고운 얼룩이 겹친다
      let c = mix3(rustD, rustL, smooth(0.3, 0.72, n * 0.7 + m * 0.45));
      // 그을음 (넓고 부드럽게 짙어짐, 장갑차는 더 많이)
      const ts = smooth(armor ? 0.36 : 0.4, armor ? 0.62 : 0.66, sootN(u, v, 0.5) + (m - 0.5) * 0.2) * (armor ? 0.88 : 0.74);
      c = mix3(c, soot, ts);
      // 작은 조각: 남은 도장(그을음이 덜 탄 곳) / 회백색 재·산화
      const fl = flake(u, v, 0.5) + (m - 0.5) * 0.25;
      c = mix3(c, paintC, smooth(0.62, 0.7, fl) * (armor ? 0.6 : 0.35) * (1 - ts * 0.5));
      c = mix3(c, ashC, smooth(armor ? 0.25 : 0.33, armor ? 0.17 : 0.22, fl) * (armor ? 0.4 : 0.5));
      // 녹물 세로줄 (어둡고 붉게)
      const st = smooth(0.56, 0.8, streak(u, v, 0.5)) * 0.45;
      c = mix3(c, [rustD[0] * 0.78, rustD[1] * 0.7, rustD[2] * 0.68], st);
      // 고운 명암 + 1px 반점 (녹 알갱이·재 가루)
      const k = 0.9 + m * 0.2;
      const h = hashPx(x, y, s0);
      const sp = h < 0.06 ? (h / 0.06 - 0.5) * 20 : 0;
      col[0] = clamp255(c[0] * k + sp);
      col[1] = clamp255(c[1] * k + sp * 0.9);
      col[2] = clamp255(c[2] * k + sp * 0.8);
    });
  });
}

// 궤도 (u = 궤도 길이 방향, 한 장 = 링크 4개 → uvScale 0.6m 이면 링크 간격 15cm, v = 폭 방향):
// 링크 판·가로 돌기(그라우저)·가운데 안내 돌기, 링크 사이 틈과 틈에 낀 진흙, 모서리의 녹
export function trackTexture() {
  return cached('track', () => {
    const f = makeFbm(321, 8, 3);
    const mud = makeFbm(322, 4, 4);
    return pixelTexture(256, (u, v, col, x, y) => {
      const lu = (u * 4) % 1; // 링크 안 위치
      const n = f(u, v, 0.5);
      let c = [44 + (n - 0.5) * 14, 43 + (n - 0.5) * 13, 42 + (n - 0.5) * 12];
      // 가로 돌기 (밝은 모서리 = 닳은 쇠)
      if (lu > 0.3 && lu < 0.46) c = mix3(c, [74, 72, 68], lu < 0.34 ? 0.9 : 0.5);
      // 가운데 안내 돌기 자리
      if (Math.abs(v - 0.5) < 0.06 && lu > 0.22 && lu < 0.7) c = mix3(c, [70, 68, 64], 0.6);
      // 핀 구멍 (양 끝)
      if ((v < 0.08 || v > 0.92) && (lu < 0.14 || lu > 0.86)) c = [22, 21, 20];
      // 녹 (가장자리·돌기, 옅게)
      c = mix3(c, [78, 56, 42], smooth(0.6, 0.74, n) * 0.4);
      // 링크 사이 틈
      if (lu < 0.07 || lu > 0.95) c = [18, 17, 16];
      // 틈에 낀 진흙
      const md = smooth(0.56, 0.7, mud(u, v, 0.5) + (lu < 0.12 || lu > 0.9 ? 0.12 : 0));
      c = mix3(c, [52, 45, 37], md * 0.6);
      const h = hashPx(x, y, 323);
      const sp = h < 0.04 ? (h / 0.04 - 0.5) * 14 : 0;
      col[0] = clamp255(c[0] + sp);
      col[1] = clamp255(c[1] + sp);
      col[2] = clamp255(c[2] + sp);
    });
  });
}

// 빈 탄약 상자 (중간 지대 작은 잔해, Structures.debrisTemplates): 바랜 국방색 도장 판자.
// 한 장 = 0.6m (boxGeo uvScale), 판자 6장이 v 방향으로 쌓이고 (판자 폭 10cm) 결은 u 방향.
// 판자 사이 어두운 틈, 먼지로 바랜 칠 얼룩, 판자 모서리부터 벗겨져 드러난 회갈색 나무, 1px 반점.
// 인스턴스 색(밝은 무채색)과 곱해지므로 이 텍스처가 상자의 최종 색을 정한다
// (예전처럼 나무 텍스처 × 올리브 인스턴스 색 × 정점색을 겹쳐 곱하면 알베도가 3% 쯤으로 거의 검게 나온다).
export function crateTexture() {
  return cached('crate', () => {
    const boards = 6;
    const grain = rectFbm(331, 2, 48, 3);
    const fade = makeFbm(332, 4, 4);
    const chip = makeFbm(333, 28, 3);
    const paint = [100, 104, 72];
    const dust = [124, 122, 102];
    const wood = [128, 118, 100];
    return pixelTexture(256, (u, v, col, x, y) => {
      const bv = v * boards;
      const board = Math.floor(bv);
      const lv = bv - board;
      const edge = Math.min(lv, 1 - lv); // 판자 가장자리까지 (판자 폭 비율)
      const g = grain((u + board * 0.37) % 1, v, 0.5);
      const n = fade(u, v, 0.55);
      // 칠 벗겨짐: 작은 조각, 판자 가장자리(모서리 닳음)에 몰린다
      const ch = chip(u, v, 0.5) + Math.max(0, 0.16 - edge) * 1.9 + ((board * 7) % 3) * 0.015;
      const bare = smooth(0.7, 0.74, ch);
      let c = mix3(paint, dust, smooth(0.25, 0.85, n) * 0.38);
      c = mix3(c, wood, bare);
      // 판자마다 조금 다른 바램 + 결 (드러난 나무에서 더 뚜렷하게)
      const k = 0.94 + (g - 0.5) * (0.14 + bare * 0.3) + (((board * 13) % 5) - 2) * 0.018;
      const gap = edge < 0.035 ? 0.42 : edge < 0.07 ? 0.85 : 1; // 판자 틈 (어두운 선)
      const h = hashPx(x, y, 334);
      const sp = h < 0.05 ? (h / 0.05 - 0.5) * 16 : 0;
      col[0] = clamp255(c[0] * k * gap + sp);
      col[1] = clamp255(c[1] * k * gap + sp);
      col[2] = clamp255(c[2] * k * gap + sp * 0.9);
    });
  });
}

export function woodTexture() {
  return cached('wood', () => {
    const f = makeFbm(91, 4, 4);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u * 0.25, v * 2, 0.5);
      const grain = Math.sin((v * 40 + n * 6) * Math.PI) * 0.5 + 0.5;
      const plank = Math.floor(u * 4);
      const pv = ((plank * 37) % 11) / 11;
      let s = 96 + grain * 26 + pv * 20 + (n - 0.5) * 30;
      if ((u * 4) % 1 < 0.025) s -= 40; // 판자 틈
      col[0] = clamp255(s * 0.95);
      col[1] = clamp255(s * 0.86);
      col[2] = clamp255(s * 0.72);
    });
  });
}

export function barkTexture() {
  return cached('bark', () => {
    const f = makeFbm(101, 8, 4);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u * 3, v * 0.6, 0.55);
      const ridge = Math.abs(Math.sin((u * 14 + n * 2.5) * Math.PI));
      const s = 46 + ridge * 40 + n * 22;
      col[0] = clamp255(s * 1.0);
      col[1] = clamp255(s * 0.88);
      col[2] = clamp255(s * 0.75);
    });
  });
}

// 모래주머니 천 (마대): 고운 올 무늬, 부드러운 흙 얼룩 (문턱 없이 smoothstep — 경계가 칼 같은 검은 반점 무늬가 되지 않게),
// 양끝을 접어 꿰맨 솔기 (어두운 가는 선 + 밝은 바늘땀). UV 는 Structures.bagGeometry: u = 자루 길이 방향(솔기 u ≈ 0.07·0.93), v = 단면 둘레
export function sandbagTexture() {
  return cached('sandbag', () => {
    const f = makeFbm(111, 4, 4);
    const g = makeFbm(117, 10, 3);
    return pixelTexture(256, (u, v, col, x, y) => {
      const n = f(u, v, 0.5);
      const m = g(u, v, 0.5);
      // 올 무늬: 씨실·날실이 엇갈린 잔무늬 (밝기 차 작게)
      const weave = ((x >> 1) + (y >> 1)) & 1 ? 2.5 : -2.5;
      // 흙 얼룩: 넓고 옅은 것 + 작고 조금 짙은 것 (부드러운 경계)
      const dirt = smooth(0.52, 0.3, n) * 16 + smooth(0.44, 0.26, m) * 12;
      // 접어 꿰맨 양끝: 끝으로 갈수록 조금 어둡고(접힌 천 + 흙), 옅은 바늘땀 한 줄 (자루 둘레를 도는 선이라 진하면 테두리처럼 보인다)
      const ue = Math.min(u, 1 - u);
      const fold = smooth(0.1, 0.02, ue) * 10;
      const du = Math.abs(ue - 0.07) * 256;
      const stitch = du < 1.2 && y % 6 < 3 ? 6 : 0;
      const s = 126 + (n - 0.5) * 18 + (m - 0.5) * 8 + weave - dirt - fold + stitch;
      col[0] = clamp255(s * 1.05);
      col[1] = clamp255(s * 0.97);
      col[2] = clamp255(s * 0.8);
    });
  });
}

export function earthTexture() {
  return cached('earth', () => {
    const f = makeFbm(121, 8, 5);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u, v, 0.55);
      const s = 52 + n * 40;
      col[0] = clamp255(s * 1.0);
      col[1] = clamp255(s * 0.86);
      col[2] = clamp255(s * 0.72);
    });
  });
}

// 위장복 아틀라스: 왼쪽 3/4 = 위장 무늬, 오른쪽 1/4 = 흰색 (단색 부위용)
export function camoAtlas() {
  return cached('camo', () => {
    const size = 256;
    const f = makeFbm(131, 4, 4);
    const g = makeFbm(132, 4, 4);
    const h = makeFbm(133, 8, 3);
    return pixelTexture(
      size,
      (u, v, col) => {
        if (u >= 0.75) {
          col[0] = col[1] = col[2] = 255;
          return;
        }
        const uu = u / 0.75;
        const a = f(uu, v, 0.5);
        const b = g(uu + 0.3, v, 0.5);
        const c = h(uu, v, 0.5);
        // 흐린 올리브·갈색·회녹색 얼룩 (양측이 비슷한 복장)
        let r = 104;
        let gg = 100;
        let bb = 78;
        if (a > 0.55) {
          r = 82;
          gg = 76;
          bb = 56;
        }
        if (b > 0.6) {
          r = 66;
          gg = 72;
          bb = 52;
        }
        if (c > 0.68) {
          r = 48;
          gg = 44;
          bb = 36;
        }
        col[0] = r;
        col[1] = gg;
        col[2] = bb;
      },
      { repeat: false },
    );
  });
}

// ---------------------------------------------------------------------------
// 알파 텍스처 (식생, 위장망)

// 알파 테스트용 식생 텍스처: 캔버스 그림 → 밉맵 단계마다 '알파 > cutoff' 인 텍셀 비율(덮는 비율)을 원본과 같게 맞춘다.
// 보통 밉맵은 멀리서 가는 줄기·잎의 알파를 평균으로 옅게 만들어 알파 테스트에서 통째로 사라지게 한다
// (먼 해바라기밭·풀이 비어 보이거나 칼같이 끊김). 투명 텍셀의 색은 밉맵 평균색으로 채워(pull-push)
// 가장자리가 검게 번지지 않게 한다. 결과는 밉맵을 직접 지정한 DataTexture (첫 행 = 텍스처 아래, 캔버스와 위아래 반대).
function coverageTexture(c, cutoff = 0.5) {
  const w = c.width;
  const h = c.height;
  const src = c.getContext('2d').getImageData(0, 0, w, h).data;
  const levels = [];
  let cur = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * 4;
      const di = (y * w + x) * 4;
      const a = src[si + 3] / 255;
      cur[di] = (src[si] / 255) * a;
      cur[di + 1] = (src[si + 1] / 255) * a;
      cur[di + 2] = (src[si + 2] / 255) * a;
      cur[di + 3] = a;
    }
  }
  levels.push({ data: cur, width: w, height: h });
  let lw = w;
  let lh = h;
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, lw >> 1);
    const nh = Math.max(1, lh >> 1);
    const sx = lw > 1 ? 2 : 1;
    const sy = lh > 1 ? 2 : 1;
    const nxt = new Float32Array(nw * nh * 4);
    const inv = 1 / (sx * sy);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const o = (y * nw + x) * 4;
        for (let dy = 0; dy < sy; dy++) {
          for (let dx = 0; dx < sx; dx++) {
            const i = ((y * sy + dy) * lw + x * sx + dx) * 4;
            nxt[o] += cur[i] * inv;
            nxt[o + 1] += cur[i + 1] * inv;
            nxt[o + 2] += cur[i + 2] * inv;
            nxt[o + 3] += cur[i + 3] * inv;
          }
        }
      }
    }
    levels.push({ data: nxt, width: nw, height: nh });
    cur = nxt;
    lw = nw;
    lh = nh;
  }
  // 색 (premultiplied → 원래 색). 투명 텍셀은 한 단계 거친 밉맵의 색
  const cols = new Array(levels.length);
  for (let L = levels.length - 1; L >= 0; L--) {
    const { data, width, height } = levels[L];
    const col = new Float32Array(width * height * 3);
    const up = cols[L + 1];
    const uw = L + 1 < levels.length ? levels[L + 1].width : 1;
    const uh = L + 1 < levels.length ? levels[L + 1].height : 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = y * width + x;
        const a = data[k * 4 + 3];
        if (a > 1e-4) {
          col[k * 3] = data[k * 4] / a;
          col[k * 3 + 1] = data[k * 4 + 1] / a;
          col[k * 3 + 2] = data[k * 4 + 2] / a;
        } else if (up) {
          const u = Math.min(uh - 1, y >> 1) * uw + Math.min(uw - 1, x >> 1);
          col[k * 3] = up[u * 3];
          col[k * 3 + 1] = up[u * 3 + 1];
          col[k * 3 + 2] = up[u * 3 + 2];
        } else col.fill(0.5, k * 3, k * 3 + 3);
      }
    }
    cols[L] = col;
  }
  const coverage = (data, s) => {
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] * s > cutoff) n++;
    return n / (data.length / 4);
  };
  const cov0 = coverage(levels[0].data, 1);
  const mips = levels.map(({ data, width, height }, L) => {
    // 덮는 비율이 원본 이상이 되는 가장 작은 알파 배수 (이분 탐색)
    let s = 1;
    if (L > 0 && cov0 > 0) {
      let lo = 1;
      let hi = 64;
      if (coverage(data, lo) < cov0) {
        for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) * 0.5;
          if (coverage(data, mid) >= cov0) hi = mid;
          else lo = mid;
        }
        s = hi;
      }
    }
    const out = new Uint8Array(width * height * 4);
    const col = cols[L];
    for (let k = 0; k < width * height; k++) {
      out[k * 4] = clamp255(col[k * 3] * 255 + 0.5);
      out[k * 4 + 1] = clamp255(col[k * 3 + 1] * 255 + 0.5);
      out[k * 4 + 2] = clamp255(col[k * 3 + 2] * 255 + 0.5);
      out[k * 4 + 3] = clamp255(Math.min(1, data[k * 4 + 3] * s) * 255 + 0.5);
    }
    return { data: out, width, height };
  });
  const t = new THREE.DataTexture(mips[0].data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = mips;
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

// 끝이 가늘어지는 잎·줄기 하나 (2차 곡선 띠). pts = [[x,y],[cx,cy],[x,y]], 폭 w0 → w1 (px)
function taperedBlade(ctx, x0, y0, cx, cy, x1, y1, w0, w1) {
  const n = 7;
  const L = [];
  const R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const px = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const py = u * u * y0 + 2 * u * t * cy + t * t * y1;
    let tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    let ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const hw = (w0 + (w1 - w0) * t) * 0.5;
    L.push([px - ty * hw, py + tx * hw]);
    R.push([px + ty * hw, py - tx * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
}

// 말라 죽은 해바라기 빌보드 아틀라스 (중·원거리 교차 카드용). 변형 variants 개 × (옆모습, 앞모습) = 가로로 칸 2×variants 개.
// 한 칸 = 카드 cardW × cardH (m), 카드 아래 끝 = 지면 아래 bottom. 모양은 근거리 3D 모형과 같은 수치(shape)로 그린다:
//  shape = { stem: [[x, y, 반지름]...], head: {x, y, radius, tiltDeg, thick}, leaves: [{y, az, len}...], leafWidth }
//  옆모습 = 모형의 x-y 평면 (머리가 +x 쪽으로 숙임), 앞모습 = z-y 평면 (숙인 꽃판 얼굴이 보임).
//  변형 0: 기본, 1: 목이 더 꺾여 꽃판이 낮게, 2: 줄기가 조금 휘고 꽃판이 작음, 3: 꽃판이 떨어져 나간 줄기
// 색은 sRGB 의 진한 회갈색~검정 (인스턴스 색·조명이 곱해진다)
export function sunflowerCardTexture(shape, opts = {}) {
  return cached('sunflowerCard', () => coverageTexture(sunflowerCardCanvas(shape, opts)));
}

// 원거리 해바라기밭 띠 아틀라스: 밭 칸 하나를 옆에서 본 모습 (포기 여럿이 겹친 덩어리). 가로로 칸 counts.length 개 (성김 → 빽빽함).
// 한 칸 = 폭 w × 높이 h (m), 칸 아래 끝 = 지면 아래 bottom. 포기는 근거리 빌보드 그림(같은 모양·색, card = sunflowerCardTexture 옵션)을
// 줄여 찍는다: 가운데 spread(m) 폭 안에 무작위로, 키 height(m)·폭 배수, 좌우 반전, 약한 기울기 + 일부는 많이 기울거나 꽃판이 없음.
// 칸 평균 키 = shape.height 가 되게 (인스턴스 세로 배수 = 실제 평균 키 / shape.height). 덮는 비율을 지키는 밉맵 → 멀어져도 띠가 이어짐
export function sunflowerBandTexture(shape, card = {}, { tile = 256, w = 3.9, h = 2.4, bottom = 0.05, counts = [7, 7, 15, 15, 24, 24, 34, 34], spread = 3.4, height = [1.4, 2.0], leanChance = 0.14 } = {}) {
  return cached('sunflowerBand', () => {
    const src = sunflowerCardCanvas(shape, card);
    const cTile = card.tile ?? 128;
    const cardW = card.cardW ?? 0.925;
    const cardH = card.cardH ?? 1.85;
    const cBottom = card.bottom ?? 0.05;
    const cVariants = card.variants ?? 4;
    const cK = cTile / cardW;
    const k = tile / w;
    const th = Math.round(h * k);
    const c = canvas(tile * counts.length, th);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const rng = new Random(173);
    for (let v = 0; v < counts.length; v++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(v * tile, 0, tile, th);
      ctx.clip();
      // 가로 위치는 층화 (칸마다 고르게 — 덩어리져 나무 한 그루처럼 보이지 않게), 그리는 순서는 무작위 깊이
      const plants = [];
      for (let i = 0; i < counts[v]; i++) plants.push({ x: ((i + rng.next()) / counts[v] - 0.5) * spread, d: rng.next() });
      plants.sort((a, b) => a.d - b.d);
      for (const p of plants) {
        const headless = rng.next() < 0.07;
        const variant = headless ? cVariants - 1 : Math.floor(rng.next() * (cVariants - 1));
        const view = rng.next() < 0.5 ? 0 : 1;
        const hs = rng.range(height[0], height[1]) / shape.height;
        const ws = rng.range(0.9, 1.15);
        const lean = rng.next() < leanChance ? rng.range(0.2, 0.5) * (rng.next() < 0.5 ? -1 : 1) : rng.range(-0.08, 0.08);
        const flip = rng.next() < 0.5 ? -1 : 1;
        const s = k / cK;
        ctx.save();
        // 밑동(지면) 기준으로 기울이고 줄인다
        ctx.translate(v * tile + tile / 2 + p.x * k, (h - bottom) * k);
        ctx.rotate(lean);
        ctx.scale(flip * s * ws, s * hs);
        ctx.drawImage(src, (variant * 2 + view) * cTile, 0, cTile, src.height, -cTile / 2, -(cardH - cBottom) * cK, cTile, src.height);
        ctx.restore();
      }
      ctx.restore();
    }
    return coverageTexture(c);
  });
}

// 굵기가 바뀌는 띠 (잎): 점 pts = [[x, y]...] (px), 점마다 폭 ws (px). half = 0 이면 전체, 1 / -1 이면 가운데 줄에서 한쪽 반만
function ribbon(ctx, pts, ws, half = 0) {
  const L = [];
  const R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const hw = ws[i] * 0.5;
    const [px, py] = pts[i];
    L.push(half > 0 ? [px, py] : [px - ty * hw, py + tx * hw]);
    R.push(half < 0 ? [px, py] : [px + ty * hw, py - tx * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (const p of L) ctx.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fill();
}

// 해바라기 빌보드 그림 (캔버스, 위 두 아틀라스가 같이 쓴다). 근거리 3D 모형(Vegetation.sunflowerGeometry)과 같은 점으로 그린다:
//  지팡이 손잡이처럼 꺾인 목, 그 아래·바깥에 얼굴을 땅으로 숙이고 매달린 두꺼운 컵 꽃판 (둥근 등 + 말린 가장자리),
//  바깥으로 휘었다가 끝이 줄기 쪽으로 오그라든 큰 마른 잎 (가운데 줄로 접혀 한쪽 반이 어둡다)
function sunflowerCardCanvas(shape, { tile = 128, cardW = 0.925, cardH = 1.85, bottom = 0.05, variants = 4 } = {}) {
  return cached('sunflowerCardCanvas', () => {
    const th = Math.round((tile * cardH) / cardW);
    const c = canvas(tile * 2 * variants, th);
    const ctx = c.getContext('2d');
    const k = tile / cardW;
    const rng = new Random(171);
    ctx.clearRect(0, 0, c.width, c.height);
    const COL = {
      stem: [58, 50, 42],
      stemTop: [46, 39, 33],
      face: [26, 21, 18],
      back: [48, 40, 33],
      rim: [37, 31, 26],
      leaf: [66, 56, 46],
      leafDark: [48, 41, 33],
    };
    const H = shape.head;
    const curl = H.curl ?? 0.02;
    const LC = shape.leafCurve ?? { base: [0.035, 0.012], bow: [0.17, -0.13], tip: [0.045, -1] };
    const nStem = shape.stem.length;
    for (let v = 0; v < variants; v++) {
      const headless = v === 3;
      // 변형 1: 목이 더 꺾여 꽃판이 낮게 (내려오는 목 두 점과 꽃판을 drop 만큼 내림), 2: 줄기가 조금 휘고 꽃판이 작고 덜 숙임
      const drop = v === 1 ? 0.09 : 0;
      const tilt = ((H.tiltDeg + (v === 1 ? 12 : v === 2 ? -8 : 0)) * Math.PI) / 180;
      const hr = H.radius * (v === 2 ? 0.86 : 1);
      const ht = H.thick * (v === 2 ? 0.9 : 1);
      const bend = v === 2 ? 0.05 : 0;
      // 줄기 점 (모형 좌표): 변형별로 조금씩
      // 점 = [x, y, 반지름, z]
      const stem = shape.stem.map(([x, y, r, z = 0], i) => {
        const t = y / shape.stem[1][1];
        return [x + bend * Math.min(1, t) ** 2, y - (i >= nStem - 2 ? drop : 0), r, z];
      });
      const top = headless ? stem.filter((p) => p[1] < 1.52) : stem;
      if (headless) top.push([top[top.length - 1][0] + 0.01, 1.5, top[top.length - 1][2] * 0.9, 0]);
      for (let view = 0; view < 2; view++) {
        const ox = (v * 2 + view) * tile;
        const X = (m) => ox + (m + cardW / 2) * k;
        const Y = (m) => (cardH - bottom - m) * k;
        // 줄기 (옆모습: x, 앞모습: z — 목이 옆으로 비틀리지 않았으면 꺾여 내려오는 부분이 올라간 줄기와 겹치므로 꼭대기까지만)
        let pts = top;
        if (view === 1 && !top.some((p) => p[3] > 0.01)) {
          let e = 1;
          while (e < top.length && top[e][1] > top[e - 1][1]) e++;
          pts = top.slice(0, e);
        }
        const L = [];
        const R = [];
        for (let i = 0; i < pts.length; i++) {
          const [sx, sy, sr] = pts[i];
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          let dx = view === 0 ? b[0] - a[0] : b[3] - a[3];
          let dy = b[1] - a[1];
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl;
          dy /= dl;
          const hw = Math.max(0.6 / k, sr);
          const px = view === 0 ? sx : pts[i][3];
          L.push([X(px - dy * hw), Y(sy + dx * hw)]);
          R.push([X(px + dy * hw), Y(sy - dx * hw)]);
        }
        const g = ctx.createLinearGradient(0, Y(0), 0, Y(1.7));
        g.addColorStop(0, css(COL.stem));
        g.addColorStop(1, css(COL.stemTop));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(L[0][0], L[0][1]);
        for (const p of L) ctx.lineTo(p[0], p[1]);
        for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath();
        ctx.fill();
        if (headless) {
          // 부러진 끝: 쪼개진 짧은 가닥
          ctx.strokeStyle = css(COL.stemTop);
          ctx.lineWidth = 1.2;
          const tp = top[top.length - 1];
          for (let s = 0; s < 3; s++) {
            ctx.beginPath();
            ctx.moveTo(X(view === 0 ? tp[0] : 0), Y(tp[1]));
            ctx.lineTo(X((view === 0 ? tp[0] : 0) + (s - 1) * 0.02), Y(tp[1] + 0.03 + rng.next() * 0.04));
            ctx.stroke();
          }
        }
        // 잎: 잎자루로 나와 바깥으로 휘었다가 끝이 줄기 쪽으로 오그라들며 늘어진다 (근거리 3D 모형과 같은 2차 곡선)
        const nLeaves = headless ? 2 : shape.leaves.length;
        for (let li = 0; li < nLeaves; li++) {
          const lf = shape.leaves[li];
          const az = ((lf.az + v * 47) * Math.PI) / 180;
          const ca = Math.cos(az);
          const sa = Math.sin(az);
          const dirV = view === 0 ? ca : sa; // 보이는 평면 안 뻗는 방향 성분
          const perpV = view === 0 ? -sa : ca; // 잎 폭 방향 성분
          let sx = 0;
          for (const p of stem) if (p[1] <= lf.y) sx = p[0];
          const bx = view === 0 ? sx : 0;
          const len = lf.len * (0.9 + 0.2 * rng.next());
          const wv = Math.max(0.35, Math.abs(perpV)) * shape.leafWidth;
          const P0 = LC.base;
          const P1 = [LC.bow[0], LC.bow[1] * len];
          const P2 = [LC.tip[0], LC.tip[1] * len];
          const lp = [];
          const lw = [];
          for (let i = 0; i <= 8; i++) {
            const s = i / 8;
            const u = 1 - s;
            const o = u * u * P0[0] + 2 * u * s * P1[0] + s * s * P2[0];
            const y = u * u * P0[1] + 2 * u * s * P1[1] + s * s * P2[1];
            lp.push([X(bx + dirV * o), Y(lf.y + y)]);
            // 잎자루 쪽은 좁고, 1/3 쯤에서 가장 넓고, 끝은 오그라들어 뾰족
            lw.push(Math.max(1, wv * k * Math.sin(Math.PI * (0.12 + 0.88 * s)) ** 0.8 * (1 - 0.35 * s)));
          }
          // 잎자루
          ctx.strokeStyle = css(COL.leafDark);
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(X(bx), Y(lf.y));
          ctx.lineTo(lp[0][0], lp[0][1]);
          ctx.stroke();
          ctx.fillStyle = css(rng.next() < 0.5 ? COL.leaf : COL.leafDark);
          ribbon(ctx, lp, lw);
          // 가운데 줄로 접힌 한쪽 반은 그늘
          ctx.fillStyle = css(COL.leafDark, 0.85);
          ribbon(ctx, lp, lw, rng.next() < 0.5 ? 1 : -1);
        }
        if (headless) continue;
        // 꽃판: 꽃판 좌표 (u = 원판 평면 p 방향, w = 등 쪽 거리) → 모형 좌표 = 중심 + p·u − n·w
        const hx = H.x + bend;
        const hy = H.y - drop;
        const hz = H.z ?? 0;
        const sT = Math.sin(tilt);
        const cT = Math.cos(tilt);
        if (view === 0) {
          // 옆모습: 뒤집혀 매달린 두꺼운 컵 (둥근 등 껍질 + 얼굴 쪽으로 말린 가장자리 + 오목한 얼굴의 어두운 아랫단)
          const P = (u, w) => [X(hx + u * sT - w * cT), Y(hy + u * cT + w * sT)];
          const dome = [];
          for (let i = 0; i <= 12; i++) {
            const f = (i / 12) * Math.PI;
            dome.push(P(hr * Math.cos(f), -curl + (ht + curl) * Math.sin(f) ** 0.9));
          }
          const faceW = (u) => -curl * (u / hr) ** 2 - curl * 0.25 * (1 - (u / hr) ** 2);
          const faceL = [];
          for (let i = 0; i <= 6; i++) {
            const u = -hr + (2 * hr * i) / 6;
            faceL.push([u, faceW(u)]);
          }
          ctx.fillStyle = css(COL.back);
          ctx.beginPath();
          ctx.moveTo(dome[0][0], dome[0][1]);
          for (const q of dome) ctx.lineTo(q[0], q[1]);
          for (const [u, w] of faceL) ctx.lineTo(...P(u, w));
          ctx.closePath();
          ctx.fill();
          // 얼굴 아랫단 (어두운 씨앗 면이 가장자리 안쪽으로 조금 보임)
          ctx.fillStyle = css(COL.face);
          ctx.beginPath();
          for (const [u, w] of faceL) ctx.lineTo(...P(u, w));
          for (let i = faceL.length - 1; i >= 0; i--) {
            const [u, w] = faceL[i];
            ctx.lineTo(...P(u * 0.94, w + 0.022 * (1 - 0.5 * (u / hr) ** 2)));
          }
          ctx.closePath();
          ctx.fill();
          // 말라붙은 꽃받침 조각: 등 껍질 둘레에 짧고 들쭉날쭉한 가닥
          ctx.strokeStyle = css(COL.rim);
          ctx.lineWidth = 1.1;
          for (let s = 0; s < 8; s++) {
            const f = ((s + 0.5) / 8) * Math.PI;
            const u = hr * Math.cos(f);
            const w = -curl + (ht + curl) * Math.sin(f) ** 0.9;
            const [ax, ay] = P(u, w);
            const [bx2, by2] = P(u * 1.12 + (rng.next() - 0.5) * 0.02, w - 0.02 - rng.next() * 0.02);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx2, by2);
            ctx.stroke();
          }
        } else {
          // 앞모습: 숙인 얼굴 (어두운 타원, 반지름 × cos 숙인 각) 뒤로 둥근 등 껍질이 위로 조금 솟는다. 목은 그 위로 올라가 꺾인다
          const cy0 = hy - curl * sT;
          const ry = Math.max(1.2 / k, hr * Math.abs(cT));
          const domeTop = hy + Math.max(ht * sT, (H.bulge ?? 0.8) * hr * Math.abs(cT) + (H.shoulder ?? 0.5) * ht * sT);
          ctx.fillStyle = css(COL.back);
          ctx.beginPath();
          for (let i = 0; i <= 12; i++) {
            const f = (i / 12) * Math.PI;
            ctx.lineTo(X(hz + hr * 0.97 * Math.cos(f)), Y(cy0 + (domeTop - cy0) * Math.sin(f) ** 0.8));
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = css(COL.rim);
          ctx.beginPath();
          ctx.ellipse(X(hz), Y(cy0), hr * k, ry * k + 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = css(COL.face);
          ctx.beginPath();
          ctx.ellipse(X(hz), Y(cy0 - curl * 0.3), hr * 0.86 * k, ry * 0.82 * k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = css(COL.rim);
          ctx.lineWidth = 1.1;
          for (let s = 0; s < 9; s++) {
            const f = ((s + 0.5) / 9) * Math.PI * 2;
            const zx = hr * Math.cos(f);
            const yy = cy0 + ry * Math.sin(f);
            ctx.beginPath();
            ctx.moveTo(X(hz + zx), Y(yy));
            ctx.lineTo(X(hz + zx * 1.12 + (rng.next() - 0.5) * 0.012), Y(yy - 0.012 - rng.next() * 0.015));
            ctx.stroke();
          }
        }
      }
    }
    return c;
  });
}

// 마른 풀 포기 카드 아틀라스 (가로 2칸): 밝은 중성 짚색 잎 (실제 색은 인스턴스 색이 정한다 — 바랜 짚색 / 회녹색)
//  칸 0: 빽빽하게 선 포기, 칸 1: 성기고 꺾여 누운 잎이 많은 포기. 아래 가운데에서 부채꼴로 퍼진다
export function grassTuftTexture() {
  return cached('grassTuft', () => {
    const tile = 128;
    const c = canvas(tile * 2, tile);
    const ctx = c.getContext('2d');
    const rng = new Random(141);
    ctx.clearRect(0, 0, c.width, c.height);
    for (let v = 0; v < 2; v++) {
      const ox = v * tile;
      const n = v === 0 ? 70 : 44;
      for (let i = 0; i < n; i++) {
        const x0 = ox + tile * (0.5 + (rng.next() - 0.5) * (v === 0 ? 0.42 : 0.6));
        const hgt = tile * (0.42 + rng.next() * 0.56) * (v === 1 ? 0.85 : 1);
        const lean = (x0 - ox - tile / 2) * 0.9 + (rng.next() - 0.5) * 36;
        const b = rng.next();
        const s = b < 0.15 ? 0.78 : b > 0.85 ? 1.1 : 0.9 + rng.next() * 0.12;
        ctx.fillStyle = `rgb(${clamp255(200 * s)},${clamp255(190 * s)},${clamp255(162 * s)})`;
        const bent = rng.next() < (v === 0 ? 0.18 : 0.42);
        const x1 = Math.max(ox + 2, Math.min(ox + tile - 2, x0 + lean * (bent ? 1.4 : 1)));
        const y1 = bent ? tile - hgt * 0.45 : tile - hgt;
        taperedBlade(ctx, x0, tile, x0 + lean * 0.25, tile - hgt * (bent ? 0.9 : 0.55), x1, y1, 2.4 + rng.next() * 1.4, 0.45);
        // 씨 이삭 몇 개
        if (!bent && rng.next() < 0.12) {
          ctx.beginPath();
          ctx.ellipse(x1, y1 + 4, 1.4, 5, Math.atan2(lean, hgt), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    return coverageTexture(c);
  });
}

// 이전 이름 (다른 곳에서 부르면 같은 텍스처)
export function grassBladeTexture() {
  return grassTuftTexture();
}

// 마른 갈대 카드 아틀라스 (가로 3칸, 한 칸 128x384 = 폭 1 × 높이 1 카드). 곧은 줄기(굵기 1~1.5cm 상당)가 가운데 좁은 폭에서
// 올라가 위로 조금씩 벌어지고 (카드 옆 가장자리가 세로로 잘린 벽처럼 보이지 않게), 줄기마다 키가 달라 윗선이 들쭉날쭉하다.
// 잎은 마디에서 비스듬히 위로 나와 휘어 끝이 처지거나(마른 잎) 아래로 늘어진다. 줄기 끝에는 한쪽으로 숙인 밝은 회갈색 깃털 이삭.
//  칸 0: 빽빽한 무더기, 칸 1: 군락 가장자리 — 성기고 낮고 꺾여 고개 숙인 줄기·늘어진 잎, 칸 2: 무더기 위로 솟은 이삭 줄기 2개.
//  색은 바랜 짚색 (인스턴스 색이 곱해진다)
export function reedTexture() {
  return cached('reed', () => {
    const tw = 128;
    const th = 384;
    const tiles = 3;
    const c = canvas(tw * tiles, th);
    const ctx = c.getContext('2d');
    const rng = new Random(181);
    ctx.clearRect(0, 0, c.width, c.height);
    const rgb = (r, g, b, s, a = 1) => `rgba(${clamp255(r * s)},${clamp255(g * s)},${clamp255(b * s)},${a})`;
    // 이삭: 줄기 끝 (x, y) 에서 side 쪽으로 숙인 원뿔꽃차례 — 가운데 촘촘한 몸통(물방울 꼴) + 둘레의 가는 가닥
    const plume = (x, y, side, len, n, s) => {
      const ax = x + side * len * 0.42;
      const ay = y + len * 0.62;
      const cx = x + side * len * 0.12;
      const cy = y - len * 0.12;
      const at = (t) => {
        const u = 1 - t;
        return [u * u * x + 2 * u * t * cx + t * t * ax, u * u * y + 2 * u * t * cy + t * t * ay];
      };
      // 몸통: 축을 따라 폭이 가운데서 가장 넓은 띠
      ctx.fillStyle = rgb(192, 180, 160, s);
      const pts = [];
      const ws = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        pts.push(at(t));
        ws.push(Math.max(1.2, len * 0.17 * Math.sin(Math.PI * (0.15 + 0.85 * t)) ** 0.7));
      }
      ribbon(ctx, pts, ws);
      // 가닥: 축에서 바깥·아래로 처진 가는 선 (밝기가 조금씩 다름)
      ctx.lineCap = 'round';
      for (let p = 0; p < n; p++) {
        const t = 0.1 + rng.next() * 0.9;
        const [px, py] = at(t);
        const pl = len * (0.12 + rng.next() * 0.22) * (0.6 + 0.6 * t);
        const sgn = rng.next() < 0.65 ? side : -side;
        const k = 0.85 + rng.next() * 0.3;
        ctx.strokeStyle = rgb(208, 196, 178, k, 0.95);
        ctx.lineWidth = 1 + rng.next() * 0.9;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + sgn * pl * 0.5, py - pl * 0.1, px + sgn * pl * 0.7, py + pl * 0.55);
        ctx.stroke();
      }
    };
    // 잎: 마디 (lx, ly) 에서 dir 쪽으로 비스듬히 위로 나와 휘어 끝이 처진다. hang = 마른 잎이 아래로 늘어짐
    const leaf = (ox, lx, ly, dir, ll, s, hang) => {
      const lim = (v) => Math.max(ox + 2, Math.min(ox + tw - 2, v));
      ctx.fillStyle = rgb(186, 170, 128, s);
      if (hang) taperedBlade(ctx, lx, ly, lim(lx + dir * ll * 0.32), ly - ll * 0.12, lim(lx + dir * ll * 0.42), ly + ll * 0.62, 3.0, 0.5);
      else taperedBlade(ctx, lx, ly, lim(lx + dir * ll * 0.3), ly - ll * 0.78, lim(lx + dir * ll * 0.72), ly - ll * 0.42, 3.2, 0.5);
    };
    for (let v = 0; v < tiles; v++) {
      const ox = v * tw;
      const mid = ox + tw / 2;
      const n = v === 0 ? 11 : v === 1 ? 7 : 2;
      // 칸 밖으로 번지지 않게 (이삭 가닥·잎 끝)
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox + 1, 0, tw - 2, th);
      ctx.clip();
      for (let i = 0; i < n; i++) {
        // 밑동: 가운데 좁은 폭 (칸 폭의 ±13%), 키: 칸마다 범위가 다르고 줄기마다 달라 윗선이 들쭉날쭉
        const off = ((i + rng.next()) / n - 0.5) * (v === 2 ? 0.18 : 0.26) * tw;
        const x0 = mid + off;
        const hk = v === 2 ? 0.84 + rng.next() * 0.08 : v === 0 ? 0.6 + rng.next() * 0.34 : 0.42 + rng.next() * 0.4;
        const hgt = th * hk;
        // 바깥쪽 줄기일수록 조금 바깥으로 기운다 (위로 벌어진 다발)
        const lean = off * (v === 2 ? 0.8 : 1.3) + (rng.next() - 0.5) * 10;
        const x1 = Math.max(ox + 8, Math.min(ox + tw - 8, x0 + lean));
        const y1 = th - hgt;
        const s = 0.84 + rng.next() * 0.28;
        const side = lean >= 0 ? 1 : -1;
        const sw = v === 2 ? 5.4 : 3.6;
        ctx.fillStyle = rgb(198, 182, 140, s);
        const broken = v === 1 && rng.next() < 0.45;
        let tipX = x1;
        let tipY = y1;
        if (broken) {
          // 꺾여 고개 숙인 줄기: 아래쪽 60% 는 서고, 위는 꺾여 옆으로 늘어진다
          const kx = x0 + lean * 0.6;
          const ky = th - hgt * 0.62;
          taperedBlade(ctx, x0, th, x0 + lean * 0.2, th - hgt * 0.3, kx, ky, sw, sw * 0.7);
          tipX = Math.max(ox + 6, Math.min(ox + tw - 6, kx + side * hgt * 0.2));
          tipY = ky + hgt * 0.14;
          taperedBlade(ctx, kx, ky, kx + side * hgt * 0.12, ky - hgt * 0.05, tipX, tipY, sw * 0.7, sw * 0.45);
        } else taperedBlade(ctx, x0, th, x0 + lean * 0.2, th - hgt * 0.5, x1, y1, sw, sw * 0.45);
        // 잎 2~3장: 마디에서 번갈아 양쪽으로 (일부는 마른 채 늘어짐)
        const nl = v === 2 ? 1 : 2 + Math.floor(rng.next() * 2);
        let dir = rng.next() < 0.5 ? -1 : 1;
        for (let l = 0; l < nl; l++) {
          const t = 0.2 + (l / nl) * 0.45 + rng.next() * 0.1;
          const lx = x0 + (x1 - x0) * t * t;
          const ly = th - hgt * t * (broken ? 0.62 : 1);
          const ll = (v === 1 ? 40 : 52) + rng.next() * 44;
          leaf(ox, lx, ly, dir, ll, s * (0.9 + rng.next() * 0.1), rng.next() < (v === 1 ? 0.6 : 0.3));
          dir = -dir;
        }
        // 이삭: 칸 2 는 모든 줄기 (크게), 칸 0 은 대부분, 칸 1 은 일부 (꺾인 줄기 끝에도)
        const pc = v === 2 ? 1 : v === 0 ? 0.75 : 0.4;
        if (rng.next() < pc) {
          const plen = (v === 2 ? 0.19 : 0.13) * th * (0.8 + rng.next() * 0.35);
          plume(tipX, tipY, broken ? side : side * (rng.next() < 0.75 ? 1 : -1), plen, v === 2 ? 26 : 14, s);
        }
      }
      ctx.restore();
    }
    return coverageTexture(c);
  });
}

export function camoNetTexture() {
  return cached('camoNet', () => {
    const size = 256;
    const c = canvas(size);
    const ctx = c.getContext('2d');
    const rng = new Random(151);
    ctx.clearRect(0, 0, size, size);
    for (let k = 0; k < 420; k++) {
      const x = rng.next() * size;
      const y = rng.next() * size;
      const s = 4 + rng.next() * 12;
      const t = rng.next();
      ctx.fillStyle = t < 0.4 ? 'rgb(88,84,62)' : t < 0.75 ? 'rgb(112,102,74)' : 'rgb(70,72,56)';
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * (0.4 + rng.next() * 0.6), rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,58,48,0.9)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= size; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }
    return finish(c);
  });
}

// ---------------------------------------------------------------------------
// 파티클 텍스처
export function smokeParticleTexture() {
  return cached('smokeParticle', () => {
    const size = 128;
    const f = makeFbm(161, 4, 4);
    return pixelTexture(
      size,
      (u, v, col) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = f(u, v, 0.55);
        let a = Math.max(0, 1 - r * r);
        a = Math.pow(a, 1.6) * (0.45 + n * 1.0);
        // 가장자리 울퉁불퉁
        if (r > 0.6) a *= Math.max(0, 1 - (r - 0.6) * (1.6 - n));
        col[0] = col[1] = col[2] = 255;
        col[3] = clamp255(Math.min(1, a) * 255);
      },
      { repeat: false },
    );
  });
}

export function glowParticleTexture() {
  return cached('glowParticle', () => {
    const size = 64;
    return pixelTexture(
      size,
      (u, v, col) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const a = Math.max(0, 1 - r);
        const core = Math.pow(a, 3);
        col[0] = col[1] = col[2] = 255;
        col[3] = clamp255((a * a * 0.6 + core * 0.8) * 255);
      },
      { repeat: false },
    );
  });
}

// 연기 기둥용 부드러운 원형 스프라이트: 가장자리로 갈수록 매끈하게 옅어지고, 안쪽은 낮은 주파수 얼룩만 약하게
// (여러 장이 겹쳐 뭉게뭉게한 결이 생긴다. 윤곽이 울퉁불퉁한 덩어리 한 장처럼 보이지 않게)
export function smokePuffTexture() {
  return cached('smokePuff', () => {
    const size = 128;
    const f = makeFbm(613, 3, 4);
    return pixelTexture(
      size,
      (u, v, col) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = f(u, v, 0.55);
        const rr = r * (0.92 + (n - 0.5) * 0.22);
        let a = Math.max(0, 1 - rr * rr);
        a = a * a * (3 - 2 * a); // 부드러운 가장자리
        a *= 0.72 + (n - 0.5) * 0.7;
        col[0] = col[1] = col[2] = 255;
        col[3] = clamp255(Math.min(1, Math.max(0, a)) * 255);
      },
      { repeat: false },
    );
  });
}

// 흐린 하늘 층운 구름 두께 (타일링, R = 두께 0..1, 색공간 없음). u 방향으로 길게 늘어진 무늬 (바람 방향에 맞춘다)
// 주기 노이즈를 주기 노이즈로 비틀어(도메인 워프) 층운의 부드럽게 휘는 띠·덩어리를 만든다
export function cloudTexture(size = 256) {
  return cached('cloud' + size, () => {
    const base = rectFbm(911, 3, 6, 5);
    const warpA = makeFbm(912, 3, 3);
    const warpB = makeFbm(913, 3, 3);
    return pixelTexture(
      size,
      (u, v, col) => {
        const wu = (warpA(u, v, 0.5) - 0.5) * 0.12;
        const wv = (warpB(u, v, 0.5) - 0.5) * 0.12;
        let d = base(u + wu, v + wv, 0.55);
        d = sat((d - 0.5) * 2.3 + 0.5);
        col[0] = col[1] = col[2] = clamp255(d * 255);
      },
      { srgb: false },
    );
  });
}

export function flashTexture() {
  return cached('flash', () => {
    const size = 128;
    return pixelTexture(
      size,
      (u, v, col) => {
        const dx = (u - 0.5) * 2;
        const dy = (v - 0.5) * 2;
        const r = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);
        // 별 모양 총구 화염
        const spikes = Math.pow(Math.abs(Math.cos(ang * 2.5)), 6) * 0.6 + 0.25;
        let a = Math.max(0, 1 - r / spikes);
        a = Math.min(1, a * 1.6 + Math.max(0, 1 - r * 3));
        col[0] = 255;
        col[1] = clamp255(210 + a * 40);
        col[2] = clamp255(140 + a * 90);
        col[3] = clamp255(a * 255);
      },
      { repeat: false },
    );
  });
}

export function streakTexture() {
  return cached('streak', () => {
    const w = 16;
    const h = 128;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const dx = Math.abs(x / (w - 1) - 0.5) * 2;
        const along = y / (h - 1); // 0 = 머리 (밝음), 1 = 꼬리
        const a = Math.max(0, 1 - dx) ** 1.5 * Math.pow(1 - along, 1.2);
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = clamp255(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c, { repeat: false });
  });
}

export function bulletHoleTexture() {
  return cached('bulletHole', () => {
    const size = 64;
    const f = makeFbm(171, 4, 3);
    return pixelTexture(
      size,
      (u, v, col) => {
        const dx = u - 0.5;
        const dy = v - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = f(u, v, 0.5);
        const rr = r + (n - 0.5) * 0.35;
        let a = 0;
        let s = 30;
        if (rr < 0.22) {
          a = 1;
          s = 12;
        } else if (rr < 0.85) {
          a = (1 - (rr - 0.22) / 0.63) * 0.65;
          s = 60;
        }
        col[0] = col[1] = col[2] = s;
        col[3] = clamp255(a * 255);
      },
      { repeat: false },
    );
  });
}

// ---------------------------------------------------------------------------
// 적 진지·집단농장 (축사 그을음·탄흔 데칼, 곡물 저장탑, 소련식 무늬 콘크리트 담장, 썩은 건초, 벽돌 잔해 더미)

// w x h RGBA 픽셀 캔버스 (정사각형이 아닌 것). fn(x, y, col) — col = [r, g, b, a] (0..255)
function pixelCanvas(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const col = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      col[3] = 255;
      fn(x, y, col);
      const i = (y * w + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = col[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 벽 데칼 아틀라스 (4 x 2 칸, 칸마다 알파 무늬). UV 칸 번호는 Structures 의 DECAL 표와 같다:
//  0 창·구멍 위로 번진 그을음 (아래 가운데에서 위로 넓어짐)  1 포탄 구멍·무너진 곳 가장자리 그을림 띠 (아래 끝 = 구멍 가장자리)
//  2 탄흔 무리 (어두운 구멍 + 밝게 떨어져 나간 둘레)  3 떨어져 나간 회반죽·벽면 (밝은 얼룩 + 어두운 테두리)
//  4 위에서 흘러내린 빗물·그을음 세로줄  5 벽 아래 습기·이끼 띠  6 금 (가지 친 가는 선)  7 포탄 구멍 둘레 빠지고 깨진 벽돌 무리
// 칸 가장자리 몇 px 는 비워 밉맵 번짐을 막는다. 칸 안 y 는 위로 증가 (캔버스는 뒤집어 그린다).
export function farmDecalTexture(w = 1024, h = 512) {
  return cached(`farmDecal${w}x${h}`, () => {
    const cw = w / 4;
    const ch = h / 2;
    const fA = makeFbm(601, 4, 4);
    const fB = makeFbm(602, 8, 3);
    const streakN = rectFbm(603, 24, 2, 3);
    const pad = 6;
    const c = pixelCanvas(w, h, (x, y, col) => {
      const cell = Math.floor(x / cw) + 4 * Math.floor(y / ch);
      const lx = x % cw;
      const ly = y % ch;
      const u = lx / cw;
      const v = 1 - ly / ch; // 칸 안에서 위로 증가
      const edge = Math.min(lx, ly, cw - 1 - lx, ch - 1 - ly);
      const n = fA(u + cell * 0.31, v * 0.9 + cell * 0.17, 0.55);
      const m = fB(u * 1.3 + cell * 0.23, v + cell * 0.41, 0.5);
      let a = 0;
      let rgb = [26, 23, 21];
      if (cell === 0) {
        // 그을음 기둥: 아래(v=0) 가운데에서 위로 넓어지며 옅어짐
        const wdt = 0.16 + 0.34 * v + (n - 0.5) * 0.22;
        const dx = Math.abs(u - 0.5 - (m - 0.5) * 0.25 * v);
        a = (1 - smooth(wdt * 0.55, wdt, dx)) * Math.pow(1 - v, 0.8) * (0.55 + 0.6 * n);
        a = Math.min(0.9, a * 1.15);
      } else if (cell === 1) {
        // 가장자리 그을림 띠: v=0(구멍 가장자리)에서 가장 짙고 들쭉날쭉하게 사라짐
        const reach = 0.55 + (n - 0.5) * 0.7 + (m - 0.5) * 0.3;
        a = (1 - smooth(reach * 0.25, reach, v)) * 0.9;
        rgb = [30, 26, 22];
      } else if (cell === 3) {
        // 떨어져 나간 벽면: 날카로운 경계의 밝은 얼룩 + 어두운 테두리
        const r = Math.hypot(u - 0.5, v - 0.5) * 2 + (n - 0.5) * 0.7;
        const inside = 1 - smooth(0.6, 0.64, r);
        const rim = smooth(0.5, 0.6, r) * (1 - smooth(0.64, 0.72, r));
        if (inside > 0.01) {
          const s = 132 + (m - 0.5) * 40 + (hashPx(x, y, 31) - 0.5) * 24;
          rgb = [s, s * 0.97, s * 0.92];
          a = inside * 0.6;
        }
        if (rim > 0.01) {
          rgb = [48, 44, 40];
          a = Math.max(a, rim * 0.6);
        }
      } else if (cell === 4) {
        // 빗물·그을음 세로줄: 위(v=1)에서 아래로 흘러내림
        const sN = streakN(u, v, 0.5);
        const len = 0.25 + sN * 0.9;
        a = smooth(0.42, 0.75, sN) * smooth(1 - len, 1, v) * 0.7;
        rgb = [40, 38, 34];
      } else if (cell === 5) {
        // 벽 아래 습기·이끼: 물결진 경계
        const top = 0.38 + (n - 0.5) * 0.3;
        a = (1 - smooth(top * 0.6, top, v)) * (0.55 + 0.3 * m);
        rgb = mix3([46, 44, 36], [58, 66, 44], smooth(0.45, 0.7, m));
      } else if (cell === 7) {
        // 포탄 구멍 둘레의 빠지고 깨진 벽돌 무리 (0.75 x 0.375m 사각형 = 벽돌 3장 x 3줄, 줄마다 반 장 엇갈림 — 놓는 높이를 벽돌 줄에 맞춤):
        // 가운데로 갈수록 빠진 벽돌(줄눈째 떨어져 나간 시커먼 자리 + 부서진 밝은 줄눈 테두리)이 많고, 일부는 모서리만 깨져 밝은 속살이 드러난다.
        // 둘레에 옅은 그을음
        const row = Math.min(2, Math.floor(v * 3));
        const bu = u * 3 + (row % 2) * 0.5;
        const bi = Math.floor(bu);
        const fu = bu - bi;
        const fv = v * 3 - row;
        const h = hashPx(bi + 17, row + 5, 71);
        const h2 = hashPx(bi + 3, row + 11, 73);
        const bcx = (bi + 0.5 - (row % 2) * 0.5) / 3;
        const r = Math.hypot((bcx - 0.5) * 2, ((row + 0.5) / 3 - 0.5) * 2) / 1.2;
        const grain = (hashPx(x, y, 75) - 0.5) * 0.06;
        const mg = 0.06 + 0.07 * n + grain; // 들쭉날쭉한 깨진 가장자리
        const edgeD = Math.min(fu, 1 - fu, fv, 1 - fv);
        const soot = (1 - smooth(0.35, 1.0, Math.hypot(u - 0.5, (v - 0.5) * 0.5) * 2 + (m - 0.5) * 0.5)) * 0.32;
        a = soot;
        rgb = [30, 27, 24];
        if (h < 0.78 * (1 - r * r)) {
          // 빠진 벽돌 (가끔 반 장만)
          const half = h2 < 0.3 ? (h2 < 0.15 ? fu > 0.5 : fu < 0.5) : true;
          if (half && edgeD > mg) {
            const s = 22 + (m - 0.5) * 14 + (hashPx(x, y, 77) - 0.5) * 10;
            rgb = [s, s * 0.92, s * 0.85];
            a = 0.9;
          } else if (half && edgeD > mg - 0.07) {
            const s = 118 + (hashPx(x, y, 79) - 0.5) * 30;
            rgb = [s, s * 0.95, s * 0.88];
            a = 0.5;
          }
        } else if (h2 > 0.6) {
          // 모서리만 깨진 벽돌: 밝은 속살 + 어두운 깨진 선
          const cu = h2 > 0.8 ? fu : 1 - fu;
          const cv = h > 0.9 ? fv : 1 - fv;
          const chip = cu + cv * 0.8 - (0.42 + (n - 0.5) * 0.25);
          if (chip < 0 && edgeD > 0.03) {
            const s = 150 + (hashPx(x, y, 81) - 0.5) * 34;
            rgb = [s, s * 0.94, s * 0.86];
            a = 0.55;
          } else if (chip < 0.05 && edgeD > 0.03) {
            rgb = [34, 30, 27];
            a = 0.6;
          }
        }
      }
      if (edge < pad) a = 0;
      col[0] = clamp255(rgb[0]);
      col[1] = clamp255(rgb[1]);
      col[2] = clamp255(rgb[2]);
      col[3] = clamp255(a * 255);
    });
    const ctx = c.getContext('2d');
    const rng = new Random(611);
    // 2: 탄흔 무리 — 밝게 떨어져 나간 둘레 + 어두운 구멍
    {
      const ox = cw * 2;
      const oy = 0;
      for (let k = 0; k < 46; k++) {
        const r = Math.abs(rng.gaussian()) * cw * 0.17;
        const ang = rng.next() * Math.PI * 2;
        const px = ox + cw / 2 + Math.cos(ang) * r;
        const py = oy + ch / 2 + Math.sin(ang) * r;
        if (px < ox + 14 || px > ox + cw - 14 || py < oy + 14 || py > oy + ch - 14) continue;
        const s = 1.8 + rng.next() * 3;
        ctx.fillStyle = 'rgba(150,145,136,0.42)';
        ctx.beginPath();
        ctx.ellipse(px, py, s * 1.8, s * (1.3 + rng.next() * 0.8), rng.next() * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(22,20,18,0.92)';
        ctx.beginPath();
        ctx.ellipse(px, py, s, s * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 6: 금 — 가운데에서 가지 치며 뻗는 가는 선
    {
      const ox = cw * 2;
      const oy = ch;
      ctx.strokeStyle = 'rgba(24,22,20,0.85)';
      ctx.lineCap = 'round';
      const branch = (x, y, ang, len, wdt, depth) => {
        let px = x;
        let py = y;
        ctx.lineWidth = wdt;
        ctx.beginPath();
        ctx.moveTo(px, py);
        const steps = Math.max(2, Math.round(len / 6));
        for (let i = 0; i < steps; i++) {
          ang += (rng.next() - 0.5) * 0.7;
          px += Math.cos(ang) * 6;
          py += Math.sin(ang) * 6;
          px = Math.max(ox + 8, Math.min(ox + cw - 8, px));
          py = Math.max(oy + 8, Math.min(oy + ch - 8, py));
          ctx.lineTo(px, py);
          if (depth < 3 && rng.next() < 0.18) {
            ctx.stroke();
            branch(px, py, ang + (rng.next() < 0.5 ? -1 : 1) * (0.5 + rng.next() * 0.6), len * 0.5, wdt * 0.7, depth + 1);
            ctx.lineWidth = wdt;
            ctx.beginPath();
            ctx.moveTo(px, py);
          }
        }
        ctx.stroke();
      };
      for (let k = 0; k < 5; k++) branch(ox + cw / 2, oy + ch / 2, (k / 5) * Math.PI * 2 + rng.next() * 0.6, 110 + rng.next() * 40, 2.2, 0);
    }
    return finish(c, { repeat: false });
  });
}

// 곡물 저장탑 (둘레 u 0..1 = 남쪽(+z)부터 동쪽으로 한 바퀴, 캔버스 위 = 탑 꼭대기). 슬립폼 이음 줄(1.2m 마다),
// 위에서 흘러내린 빗물 세로줄, 큰 구멍(holes) 아래 녹물·위로 번진 그을음, 아래쪽 습기 띠,
// 남쪽(플레이어 쪽) 아래 절반에 몰린 탄흔. 구멍은 거의 검은 들쭉날쭉한 자리 + 부서진 밝은 테두리 + 철근.
export function siloTexture(w, h, { r, height, holes, pocks }) {
  return cached(`silo${w}x${h}`, () => {
    const circ = Math.PI * 2 * r;
    const f = makeFbm(621, 4, 5);
    const g = makeFbm(622, 16, 3);
    const streak = rectFbm(623, 48, 3, 3);
    const pxPerM = h / height;
    const holePx = holes.map((o) => ({
      cx: ((((o.ang / (Math.PI * 2)) % 1) + 1) % 1) * w,
      cy: (1 - o.y) * h,
      hw: ((o.w / circ) * w) / 2,
      hh: (o.h * pxPerM) / 2,
    }));
    const c = pixelCanvas(w, h, (x, y, col) => {
      const u = x / w;
      const v = y / h; // 0 = 꼭대기
      const n = f(u, v * 1.2, 0.5);
      let s = 134 + (n - 0.5) * 22 + (g(u, v, 0.5) - 0.5) * 12;
      const hp = hashPx(x, y, 17);
      if (hp < 0.05) s += (hp / 0.05 - 0.5) * 30;
      // 슬립폼 이음 (1.2m 마다 가는 가로줄)
      const lift = (y / pxPerM) % 1.2;
      if (lift < 0.035) s -= 12;
      // 빗물 세로줄 (위에서 시작해 길이가 제각각)
      const sN = streak(u, v * 0.5, 0.5);
      s -= smooth(0.5, 0.8, sN) * (1 - smooth(0.2 + sN * 0.7, 1.0, v)) * 26;
      // 아래쪽 습기 띠
      const hm = height * (1 - v);
      s -= (1 - smooth(0.6, 1.8 + n * 0.8, hm)) * 28;
      let rr = s;
      let gg = s * 0.985;
      let bb = s * 0.95;
      // 구멍 아래 녹물 줄 / 위로 번진 그을음
      for (const o of holePx) {
        let dx = Math.abs(x - o.cx);
        dx = Math.min(dx, w - dx);
        const below = y - (o.cy + o.hh * 0.6);
        if (below > 0 && dx < o.hw * 0.9) {
          const k = (1 - smooth(o.hw * 0.25, o.hw * 0.9, dx + (n - 0.5) * o.hw)) * (1 - smooth(0, pxPerM * (3 + n * 4), below));
          rr = rr * (1 - k * 0.35) + 120 * k * 0.35;
          gg = gg * (1 - k * 0.45) + 70 * k * 0.45;
          bb = bb * (1 - k * 0.55) + 40 * k * 0.55;
        }
        const above = o.cy - o.hh - y;
        if (above > -o.hh && dx < o.hw * 2.2) {
          const reach = pxPerM * (2.5 + n * 2);
          const k = (1 - smooth(o.hw * (0.6 + Math.max(0, above) / reach), o.hw * 2.2, dx)) * (1 - smooth(0, reach, Math.max(0, above)));
          rr *= 1 - k * 0.7;
          gg *= 1 - k * 0.7;
          bb *= 1 - k * 0.7;
        }
      }
      col[0] = clamp255(rr);
      col[1] = clamp255(gg);
      col[2] = clamp255(bb);
    });
    const ctx = c.getContext('2d');
    const rng = new Random(631);
    // 탄흔: 남쪽(u≈0, 1) 아래쪽에 몰림
    for (let k = 0; k < pocks; k++) {
      const uu = (rng.gaussian() * 0.16 + 1) % 1;
      const vv = 1 - Math.min(0.95, Math.abs(rng.gaussian()) * 0.32 + 0.02);
      const px = uu * w;
      const py = vv * h;
      const s = 0.7 + rng.next() * 1.2;
      ctx.fillStyle = 'rgba(178,174,166,0.32)';
      ctx.beginPath();
      ctx.arc(px, py, s * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(46,44,42,0.85)';
      ctx.beginPath();
      ctx.arc(px, py, s * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // 큰 구멍: 들쭉날쭉한 검은 자리 + 밝게 부서진 테두리 + 철근
    for (const o of holePx) {
      for (const pass of [0, 1]) {
        ctx.fillStyle = pass === 0 ? 'rgba(188,182,170,0.9)' : 'rgba(14,13,12,1)';
        const grow = pass === 0 ? 1.28 : 1;
        ctx.beginPath();
        const N = 22;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const jag = 0.72 + rng.next() * 0.36;
          const px = o.cx + Math.cos(a) * o.hw * grow * jag;
          const py = o.cy + Math.sin(a) * o.hh * grow * jag;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(70,52,40,0.95)';
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) {
        const py = o.cy + (k / 3 - 0.5) * o.hh * 1.4;
        ctx.beginPath();
        ctx.moveTo(o.cx - o.hw * 1.1, py);
        ctx.quadraticCurveTo(o.cx, py + (rng.next() - 0.3) * o.hh * 0.8, o.cx + o.hw * (0.2 + rng.next() * 0.9), py + rng.next() * 3);
        ctx.stroke();
      }
    }
    return finish(c);
  });
}

// 소련식 무늬 콘크리트 담장 판 (ПО-2 마름모 무늬, 판 한 장 = 텍스처 한 장: u = 길이, v = 높이).
// 가장자리 테두리 + 마름모 격자를 빛(왼쪽 위)으로 음영을 넣어 돋을새김처럼, 위에서 흘러내린 빗물 줄,
// 아래쪽 흙탕물 튄 자국·이끼, 위쪽 걸이 고리 아래 녹물.
export function fencePanelTexture(w = 512, h = 256) {
  return cached(`fencePanel${w}x${h}`, () => {
    const f = makeFbm(641, 4, 4);
    const streak = rectFbm(642, 32, 2, 3);
    const cols = 12;
    const rows = 6;
    const border = 0.045;
    const c = pixelCanvas(w, h, (x, y, col) => {
      const u = x / w;
      const v = y / h; // 0 = 위
      const n = f(u, v, 0.5);
      let s = 150 + (n - 0.5) * 22;
      const hp = hashPx(x, y, 23);
      if (hp < 0.05) s += (hp / 0.05 - 0.5) * 26;
      // 무늬: 테두리 안쪽만
      const bu = Math.min(u, 1 - u) * 4.0;
      const bv = Math.min(v, 1 - v) * 2.2;
      const inB = Math.min(bu, bv);
      if (inB < border) s += 10;
      else if (inB < border + 0.012) s -= 18; // 테두리 안쪽 그늘
      else {
        const cu = ((u - border / 4) * cols) % 1;
        const cv = ((v - border / 2.2) * rows) % 1;
        const du = cu - 0.5;
        const dv = cv - 0.5;
        const d = Math.abs(du) * 2 + Math.abs(dv) * 2;
        if (d < 0.86) {
          // 마름모 피라미드 면: 왼쪽 위를 향한 면은 밝게, 오른쪽 아래는 어둡게
          const lit = (du < 0 ? 1 : -1) * 0.55 + (dv < 0 ? 1 : -1) * 0.8;
          s += lit * 13;
        } else if (d < 0.97) s -= 14; // 홈
      }
      // 빗물 세로줄 (위에서)
      const sN = streak(u, v * 0.6, 0.5);
      s -= smooth(0.5, 0.78, sN) * (1 - smooth(0.15 + sN * 0.6, 0.95, v)) * 22;
      let rr = s;
      let gg = s * 0.985;
      let bb = s * 0.95;
      // 아래 흙탕물·이끼
      const bot = 1 - smooth(0.68 + (n - 0.5) * 0.18, 0.95, v);
      const mossy = smooth(0.55, 0.7, f(u * 3 + 5, v * 2, 0.5));
      rr = rr * (0.62 + 0.38 * bot);
      gg = gg * (0.66 + 0.34 * bot) + (1 - bot) * mossy * 8;
      bb = bb * (0.6 + 0.4 * bot);
      // 걸이 고리 아래 녹물 (u = 0.2, 0.8)
      for (const hu of [0.2, 0.8]) {
        const dx = Math.abs(u - hu) * w;
        const k = (1 - smooth(1.5, 6 + n * 5, dx)) * (1 - smooth(0.04, 0.5 + n * 0.3, v));
        rr = rr * (1 - k * 0.3) + 118 * k * 0.3;
        gg = gg * (1 - k * 0.4) + 72 * k * 0.4;
        bb = bb * (1 - k * 0.5) + 44 * k * 0.5;
      }
      col[0] = clamp255(rr);
      col[1] = clamp255(gg);
      col[2] = clamp255(bb);
    });
    return finish(c);
  });
}

// 썩은 건초: 왼쪽 절반 = 곤포 옆면 (짚 결이 u 방향), 오른쪽 절반 = 곤포 마구리 (말린 소용돌이). 오래 비 맞아 거무스름한 회갈색,
// 바랜 짚 가닥, 검게 썩은 얼룩과 약간의 곰팡이.
export function hayTexture(size = 256) {
  return cached(`hay${size}`, () => {
    const f = makeFbm(651, 4, 4);
    const fib = rectFbm(652, 2, 64, 2);
    const c = pixelCanvas(size, size, (x, y, col) => {
      const u = x / size;
      const v = y / size;
      const n = f(u, v, 0.55);
      let fiber;
      if (u < 0.5) fiber = fib(u * 2, v, 0.5);
      else {
        const dx = u - 0.75;
        const dy = v - 0.5;
        const rr = Math.hypot(dx, dy) * 4;
        const ang = Math.atan2(dy, dx);
        fiber = fib(ang / (Math.PI * 2) + 0.5, rr * 0.45 + ang * 0.02, 0.5);
        fiber = fiber * 0.6 + (Math.sin((rr * 9 + ang / Math.PI) * Math.PI) * 0.5 + 0.5) * 0.4;
      }
      let s = 104 + (fiber - 0.5) * 70 + (n - 0.5) * 30;
      const rot = smooth(0.58, 0.72, n);
      s *= 1 - rot * 0.4;
      const mold = smooth(0.62, 0.75, f(u * 2 + 3, v * 2, 0.5)) * 0.35;
      col[0] = clamp255(s * 1.06 - mold * 10);
      col[1] = clamp255(s * 0.96 + mold * 8);
      col[2] = clamp255(s * 0.76);
    });
    return finish(c);
  });
}

// 벽돌 잔해 더미: 먼지 낀 모르타르 바탕 위 깨진 벽돌·콘크리트 조각 (밝기만 다른 무채색 — 색은 정점색으로 축사 벽돌에 맞춘다)
export function rubbleTexture(size = 256) {
  return cached(`rubble${size}`, () => {
    const f = makeFbm(661, 4, 4);
    const c = pixelCanvas(size, size, (x, y, col) => {
      const n = f(x / size, y / size, 0.55);
      const s = 96 + (n - 0.5) * 40 + (hashPx(x, y, 29) - 0.5) * 22;
      col[0] = col[1] = clamp255(s);
      col[2] = clamp255(s * 0.95);
    });
    const ctx = c.getContext('2d');
    const rng = new Random(662);
    for (let k = 0; k < 420; k++) {
      const x = rng.next() * size;
      const y = rng.next() * size;
      const L = 4 + rng.next() * 14;
      const W = L * (0.35 + rng.next() * 0.4);
      const a = rng.next() * Math.PI;
      const sh = 110 + rng.next() * 110;
      for (const [dx, dy] of [
        [0, 0],
        [size, 0],
        [-size, 0],
        [0, size],
        [0, -size],
      ]) {
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(20,18,16,0.55)';
        ctx.fillRect(-L / 2 + 1.5, -W / 2 + 1.5, L, W);
        ctx.fillStyle = `rgb(${sh | 0},${(sh * 0.96) | 0},${(sh * 0.9) | 0})`;
        ctx.fillRect(-L / 2, -W / 2, L, W);
        ctx.restore();
      }
    }
    return finish(c);
  });
}

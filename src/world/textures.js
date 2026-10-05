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

// 2 마른 풀밭: 바랜 짚색(채도 낮게) + 회녹색 + 갈색 풀잎이 엉킨 바닥, 군데군데 풀 포기
function gGrass(L) {
  const { rng, S, k } = L;
  const n1 = rectFbm(L.seed + 1, 8, 8, 4);
  L.base((u, v, o) => {
    const n = n1(u, v);
    const c = mix3([52, 48, 38], [76, 70, 55], n);
    o[0] = c[0];
    o[1] = c[1];
    o[2] = c[2];
    o[3] = 0.25 + n * 0.25;
  });
  const pal = [
    [[124, 114, 90], 0.35],
    [[140, 131, 107], 0.13],
    [[92, 96, 80], 0.27],
    [[86, 76, 60], 0.25],
  ];
  const pick = () => {
    let r = rng.next();
    for (const [c, w] of pal) {
      r -= w;
      if (r <= 0) return c;
    }
    return pal[0][0];
  };
  const N = 7000;
  for (let i = 0; i < N; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const a = rng.next() * Math.PI * 2;
    const len = rng.range(10, 40) * k;
    L.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rng.range(0.8, 2.1) * k, L.jit(pick(), 0.15), 0.35 + (0.55 * i) / N, 1, 0.92);
  }
  for (let t = 0; t < 30; t++) {
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    for (let i = 0; i < 50; i++) {
      const a = rng.next() * Math.PI * 2;
      const r0 = rng.range(0, 6) * k;
      const len = rng.range(12, 45) * k;
      const x = cx + Math.cos(a) * r0;
      const y = cy + Math.sin(a) * r0;
      L.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, rng.range(0.9, 2) * k, L.jit(pick(), 0.15), rng.range(0.75, 1.0), 1, 0.95);
    }
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

// 4 밝은 하층토: 파낸 황갈색 흙 (구덩이 분출물·참호 흉벽). 덩어리·마른 금·섞인 흑토 부스러기
function gSubsoil(L) {
  const { rng, S, k } = L;
  const n1 = rectFbm(L.seed + 1, 10, 10, 4);
  const f1 = rectFbm(L.seed + 2, 36, 36, 2);
  L.base((u, v, o) => {
    const f = f1(u, v);
    const h = sat(0.45 + (n1(u, v) - 0.5) * 1.1 + (f - 0.5) * 0.4);
    const c = mix3([120, 104, 82], [150, 131, 103], smooth(0.25, 0.7, h));
    const m = 0.95 + 0.1 * f;
    o[0] = c[0] * m;
    o[1] = c[1] * m;
    o[2] = c[2] * m;
    o[3] = h;
  });
  for (let i = 0; i < 260; i++) {
    const r = rng.range(5, 19) * k;
    L.clod(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit([152, 133, 104], 0.08), [106, 92, 72], rng.range(0.7, 0.95));
  }
  for (let i = 0; i < 45; i++) {
    let x = rng.next() * S;
    let y = rng.next() * S;
    let a = rng.next() * Math.PI * 2;
    const pts = [[x, y]];
    const n = rng.int(6, 18);
    for (let s = 0; s < n; s++) {
      a += rng.range(-0.7, 0.7);
      const len = rng.range(4, 9) * k;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
    }
    L.path(pts, rng.range(0.8, 1.5) * k, [94, 78, 57], 0.18, 1, 0.9);
  }
  // 섞여 든 흑토 부스러기: 작고 성기게 (큰 검은 반점 무늬가 되지 않게)
  for (let i = 0; i < 90; i++) {
    const r = rng.range(1.2, 3) * k;
    L.lump(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit([88, 76, 62]), [70, 60, 50], 0.75);
  }
  for (let i = 0; i < 70; i++) {
    const r = rng.range(1, 2.5) * k;
    L.blob(rng.next() * S, rng.next() * S, r, r, 0, [188, 176, 150], 0.8);
  }
}

// 5 자갈 섞인 흙길: 다져진 흙에 박힌 자갈 (돌은 조금 매끈)
function gGravel(L) {
  const { rng, S, k } = L;
  const n1 = rectFbm(L.seed + 1, 8, 8, 4);
  const f1 = rectFbm(L.seed + 2, 48, 48, 2);
  L.base((u, v, o) => {
    const n = n1(u, v);
    const f = f1(u, v);
    const h = sat(0.28 + (n - 0.5) * 0.4 + (f - 0.5) * 0.3);
    const c = mix3([78, 71, 62], [104, 96, 84], smooth(0.2, 0.75, n * 0.7 + f * 0.3));
    o[0] = c[0];
    o[1] = c[1];
    o[2] = c[2];
    o[3] = h;
    o[4] = 0.8 + 0.2 * n;
  });
  const stones = [
    [124, 120, 112],
    [146, 142, 134],
    [84, 80, 74],
    [118, 102, 82],
    [160, 150, 132],
  ];
  for (let i = 0; i < 2600; i++) {
    const r = (1.5 + 5 * Math.pow(rng.next(), 2)) * k;
    L.lump(rng.next() * S, rng.next() * S, r, r * rng.range(0.6, 1), rng.next() * 3, L.jit(rng.pick(stones), 0.1), [58, 53, 46], rng.range(0.55, 1.0), rng.range(0.6, 0.8));
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
    // 얼룩·그을음
    const img = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const n = f(x / size, y / size, 0.55);
        const grime = (n - 0.5) * 70 - (y / size) * 0; // 위아래 같은 정도
        img.data[i] = clamp255(img.data[i] + grime);
        img.data[i + 1] = clamp255(img.data[i + 1] + grime);
        img.data[i + 2] = clamp255(img.data[i + 2] + grime);
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c);
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const f = makeFbm(51, 4, 6);
    const g = makeFbm(52, 32, 2);
    return pixelTexture(512, (u, v, col) => {
      const n = f(u, v, 0.55);
      const pits = g(u, v, 0.5);
      let s = 128 + (n - 0.5) * 70;
      if (pits > 0.72) s -= 40;
      // 빗물 자국 (세로 줄)
      s -= Math.max(0, Math.sin(u * 60 + n * 4)) * 6;
      col[0] = clamp255(s * 1.0);
      col[1] = clamp255(s * 0.99);
      col[2] = clamp255(s * 0.95);
    });
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

export function sandbagTexture() {
  return cached('sandbag', () => {
    const f = makeFbm(111, 4, 5);
    return pixelTexture(256, (u, v, col) => {
      const n = f(u, v, 0.55);
      const weave = (Math.sin(u * 256 * 1.2) * Math.sin(v * 256 * 1.2)) * 6;
      const dirt = n < 0.4 ? -30 : 0;
      const s = 120 + (n - 0.5) * 40 + weave + dirt;
      col[0] = clamp255(s * 1.05);
      col[1] = clamp255(s * 0.97);
      col[2] = clamp255(s * 0.78);
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
export function grassBladeTexture() {
  return cached('grassBlade', () => {
    const w = 128;
    const h = 128;
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const rng = new Random(141);
    ctx.clearRect(0, 0, w, h);
    for (let k = 0; k < 46; k++) {
      const x0 = 8 + rng.next() * (w - 16);
      const hgt = h * (0.45 + rng.next() * 0.55);
      const lean = (rng.next() - 0.5) * 40;
      const b = rng.next();
      const r = clamp255(150 + b * 60);
      const g = clamp255(138 + b * 52);
      const bl = clamp255(104 + b * 40);
      ctx.strokeStyle = `rgb(${r},${g},${bl})`;
      ctx.lineWidth = 1.2 + rng.next() * 1.8;
      ctx.beginPath();
      ctx.moveTo(x0, h);
      ctx.quadraticCurveTo(x0 + lean * 0.3, h - hgt * 0.6, x0 + lean, h - hgt);
      ctx.stroke();
    }
    return finish(c, { repeat: false });
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

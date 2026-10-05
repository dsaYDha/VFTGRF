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
export function sunflowerCardTexture(shape, { tile = 128, cardW = 0.925, cardH = 1.85, bottom = 0.05, variants = 4 } = {}) {
  return cached('sunflowerCard', () => {
    const th = Math.round((tile * cardH) / cardW);
    const c = canvas(tile * 2 * variants, th);
    const ctx = c.getContext('2d');
    const k = tile / cardW;
    const rng = new Random(171);
    ctx.clearRect(0, 0, c.width, c.height);
    const COL = {
      stem: [58, 50, 42],
      stemTop: [46, 39, 33],
      face: [30, 25, 21],
      back: [56, 47, 39],
      leaf: [74, 63, 50],
      leafDark: [54, 46, 37],
    };
    for (let v = 0; v < variants; v++) {
      const headless = v === 3;
      const drop = v === 1 ? 0.09 : 0;
      const tilt = ((shape.head.tiltDeg + (v === 1 ? 14 : v === 2 ? -6 : 0)) * Math.PI) / 180;
      const hr = shape.head.radius * (v === 2 ? 0.86 : 1);
      const bend = v === 2 ? 0.05 : 0;
      // 줄기 점 (모형 좌표): 변형별로 조금씩
      const stem = shape.stem.map(([x, y, r], i) => {
        const t = y / shape.stem[shape.stem.length - 1][1];
        return [x + bend * t * t, y - (i >= shape.stem.length - 2 ? drop : 0), r];
      });
      const top = headless ? stem.filter((p) => p[1] < 1.52) : stem;
      if (headless) top.push([top[top.length - 1][0] + 0.01, 1.5, top[top.length - 1][2] * 0.9]);
      for (let view = 0; view < 2; view++) {
        const ox = (v * 2 + view) * tile;
        const X = (m) => ox + (m + cardW / 2) * k;
        const Y = (m) => (cardH - bottom - m) * k;
        // 줄기 (옆모습: x 오프셋, 앞모습: z = 0)
        ctx.beginPath();
        const L = [];
        const R = [];
        for (let i = 0; i < top.length; i++) {
          const [sx, sy, sr] = top[i];
          const a = top[Math.max(0, i - 1)];
          const b = top[Math.min(top.length - 1, i + 1)];
          let dx = view === 0 ? b[0] - a[0] : 0;
          let dy = b[1] - a[1];
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl;
          dy /= dl;
          const hw = Math.max(0.6 / k, sr);
          const px = view === 0 ? sx : 0;
          L.push([X(px - dy * hw), Y(sy + dx * hw)]);
          R.push([X(px + dy * hw), Y(sy - dx * hw)]);
        }
        const g = ctx.createLinearGradient(0, Y(0), 0, Y(1.7));
        g.addColorStop(0, css(COL.stem));
        g.addColorStop(1, css(COL.stemTop));
        ctx.fillStyle = g;
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
        // 잎: 줄기에서 나와 아래로 늘어진 오그라든 잎
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
          const wv = Math.max(0.3, Math.abs(perpV)) * shape.leafWidth;
          ctx.fillStyle = css(rng.next() < 0.5 ? COL.leaf : COL.leafDark);
          // 잎자루
          ctx.strokeStyle = css(COL.leafDark);
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(X(bx), Y(lf.y));
          ctx.quadraticCurveTo(X(bx + dirV * 0.015), Y(lf.y + 0.012), X(bx + dirV * 0.03), Y(lf.y + 0.012));
          ctx.stroke();
          // 거의 수직으로 늘어지고 끝은 줄기 쪽으로 오그라든 잎 (근거리 3D 모형과 같은 점)
          taperedBlade(
            ctx,
            X(bx + dirV * 0.03),
            Y(lf.y + 0.012),
            X(bx + dirV * 0.1),
            Y(lf.y - len * 0.35),
            X(bx + dirV * (0.05 + 0.02 * rng.next())),
            Y(lf.y - len),
            wv * k * 1.4,
            wv * k * 0.3,
          );
        }
        if (headless) continue;
        // 꽃판: 옆모습은 기울어진 납작한 원판(두께), 앞모습은 숙인 얼굴(타원)
        const hx = shape.head.x + bend;
        const hy = shape.head.y - drop;
        const ht = shape.head.thick;
        if (view === 0) {
          const pdx = Math.sin(tilt);
          const pdy = Math.cos(tilt);
          ctx.save();
          ctx.translate(X(hx), Y(hy));
          ctx.rotate(Math.atan2(-pdy, pdx));
          // 둥근 등 (뒤쪽 = 회전 좌표 -y) + 얼굴 (+y, 거의 땅을 향함)
          ctx.fillStyle = css(COL.back);
          ctx.beginPath();
          ctx.ellipse(0, -ht * 0.35 * k, hr * 0.92 * k, ht * 0.75 * k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = css(COL.face);
          ctx.beginPath();
          ctx.ellipse(0, ht * 0.1 * k, hr * k, ht * 0.3 * k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          const ry = hr * Math.cos(tilt) + ht * 0.5 * Math.sin(tilt);
          ctx.fillStyle = css(COL.back);
          ctx.beginPath();
          ctx.ellipse(X(0), Y(hy + ht * 0.2), hr * k, ry * k, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = css(COL.face);
          ctx.beginPath();
          ctx.ellipse(X(0), Y(hy - ht * 0.15), hr * 0.92 * k, ry * 0.85 * k, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        // 말라붙은 꽃받침 조각 (가장자리 들쭉날쭉)
        ctx.strokeStyle = css(COL.back);
        ctx.lineWidth = 1.1;
        const cxp = view === 0 ? X(hx) : X(0);
        const cyp = Y(hy);
        for (let s = 0; s < 9; s++) {
          const a = (s / 9) * Math.PI * 2 + rng.next() * 0.4;
          const rx = hr * k * (view === 0 ? 0.55 : 1.0);
          const ry2 = hr * k * (view === 0 ? 0.55 : Math.cos(tilt));
          ctx.beginPath();
          ctx.moveTo(cxp + Math.cos(a) * rx * 0.9, cyp + Math.sin(a) * ry2 * 0.9);
          ctx.lineTo(cxp + Math.cos(a) * rx * 1.18, cyp + Math.sin(a) * ry2 * 1.18 + 2);
          ctx.stroke();
        }
      }
    }
    return coverageTexture(c);
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

// 마른 갈대 군락 카드 아틀라스 (가로 2칸, 한 칸 128x256): 가는 줄기, 늘어진 긴 잎, 줄기 끝 회갈색 이삭
export function reedTexture() {
  return cached('reed', () => {
    const tw = 128;
    const th = 256;
    const c = canvas(tw * 2, th);
    const ctx = c.getContext('2d');
    const rng = new Random(181);
    ctx.clearRect(0, 0, c.width, c.height);
    for (let v = 0; v < 2; v++) {
      const ox = v * tw;
      const n = v === 0 ? 24 : 17;
      for (let i = 0; i < n; i++) {
        const x0 = ox + tw * (0.5 + (rng.next() - 0.5) * 0.55);
        const hgt = th * (0.68 + rng.next() * 0.3);
        const lean = (x0 - ox - tw / 2) * 0.35 + (rng.next() - 0.5) * 16;
        const s = 0.85 + rng.next() * 0.25;
        const x1 = Math.max(ox + 6, Math.min(ox + tw - 6, x0 + lean));
        const y1 = th - hgt;
        ctx.fillStyle = `rgb(${clamp255(196 * s)},${clamp255(180 * s)},${clamp255(138 * s)})`;
        taperedBlade(ctx, x0, th, x0 + lean * 0.2, th - hgt * 0.5, x1, y1, 2.2, 1.0);
        // 긴 잎: 줄기 중간에서 비스듬히 나와 늘어진다
        for (let l = 0; l < 2; l++) {
          if (rng.next() < 0.35) continue;
          const t = 0.25 + rng.next() * 0.4;
          const lx = x0 + (x1 - x0) * t;
          const ly = th - hgt * t;
          const dir = rng.next() < 0.5 ? -1 : 1;
          const ll = 30 + rng.next() * 40;
          ctx.fillStyle = `rgb(${clamp255(184 * s)},${clamp255(168 * s)},${clamp255(126 * s)})`;
          taperedBlade(ctx, lx, ly, lx + dir * ll * 0.5, ly - ll * 0.45, Math.max(ox + 1, Math.min(ox + tw - 1, lx + dir * ll * 0.8)), ly + ll * 0.15, 3.2, 0.4);
        }
        // 이삭: 줄기 끝 윗부분에서 한쪽으로 기운 깃털 모양 원뿔꽃차례 (밝은 회갈색, 가는 가닥 여럿)
        const side = lean >= 0 ? 1 : -1;
        const plen = hgt * (0.13 + rng.next() * 0.07);
        const np = 14 + Math.floor(rng.next() * 8);
        ctx.lineWidth = 1.2;
        for (let p = 0; p < np; p++) {
          const t = rng.next();
          const px = x1 - (x1 - x0) * t * 0.12;
          const py = y1 + plen * t;
          const ang = side * (0.35 + rng.next() * 0.6) + (rng.next() - 0.5) * 0.5;
          const pl = (5 + rng.next() * 10) * (1 - 0.5 * t);
          const k = 0.9 + rng.next() * 0.25;
          ctx.strokeStyle = `rgba(${clamp255(176 * k)},${clamp255(162 * k)},${clamp255(140 * k)},0.95)`;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + Math.sin(ang) * pl * 0.5, py - pl * 0.5, px + Math.sin(ang) * pl, py - pl * 0.35);
          ctx.stroke();
        }
        // 꼭대기가 무게로 살짝 숙인 끝
        ctx.strokeStyle = `rgba(${clamp255(168 * s)},${clamp255(154 * s)},${clamp255(132 * s)},0.95)`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x1, y1 + 2);
        ctx.quadraticCurveTo(x1 + side * 4, y1 - 6, x1 + side * 9, y1 - 2);
        ctx.stroke();
      }
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

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
// 지형 디테일 (회색 0.5 중심, 셰이더에서 x2 곱함, 선형 색공간)
export function soilDetail() {
  return cached('soilDetail', () => {
    const f = makeFbm(11, 8, 5);
    const g = makeFbm(12, 32, 3);
    return pixelTexture(
      512,
      (u, v, col) => {
        let n = f(u, v, 0.55);
        const clod = g(u, v, 0.5);
        // 흙덩이: 높은 주파수의 밝은/어두운 점
        let s = 0.5 + (n - 0.5) * 1.25 + (clod - 0.5) * 0.75;
        // 고랑 줄무늬 (밭갈이) — 가로 방향
        s += Math.sin(v * Math.PI * 2 * 6 + (f(u * 0.5, v, 0.5) - 0.5) * 3) * 0.1;
        const val = clamp255(s * 255);
        col[0] = val;
        col[1] = clamp255(val * 0.98);
        col[2] = clamp255(val * 0.95);
      },
      { srgb: false },
    );
  });
}

export function grassDetail() {
  return cached('grassDetail', () => {
    const f = makeFbm(21, 16, 4);
    const rng = new Random(22);
    const c = canvas(512);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(122,122,122)';
    ctx.fillRect(0, 0, 512, 512);
    const img = ctx.getImageData(0, 0, 512, 512);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const i = (y * 512 + x) * 4;
        const n = f(x / 512, y / 512, 0.6);
        const v = clamp255(90 + n * 90);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 마른 풀잎 줄기 (타일 경계 넘어 그리기)
    for (let k = 0; k < 2600; k++) {
      const x = rng.next() * 512;
      const y = rng.next() * 512;
      const len = 6 + rng.next() * 18;
      const ang = -Math.PI / 2 + (rng.next() - 0.5) * 1.6;
      const b = 100 + rng.next() * 110;
      ctx.strokeStyle = `rgba(${b},${b},${b},0.55)`;
      ctx.lineWidth = 0.6 + rng.next() * 1.2;
      for (const ox of [-512, 0, 512]) {
        for (const oy of [-512, 0, 512]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.lineTo(x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
          ctx.stroke();
        }
      }
    }
    return finish(c, { srgb: false });
  });
}

export function mudDetail() {
  return cached('mudDetail', () => {
    const f = makeFbm(31, 4, 5);
    const g = makeFbm(32, 16, 3);
    return pixelTexture(
      512,
      (u, v, col) => {
        const n = f(u, v, 0.5);
        const m = g(u, v, 0.5);
        // 매끈한 진흙 + 물기 있는 밝은 부분
        let s = 0.5 + (n - 0.5) * 0.6 + (m - 0.5) * 0.3;
        if (n > 0.62) s += (n - 0.62) * 0.9; // 물 고인 듯한 반사
        const val = clamp255(s * 255);
        col[0] = val;
        col[1] = val;
        col[2] = clamp255(val * 1.02);
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

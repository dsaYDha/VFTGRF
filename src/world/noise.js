// 시드 고정 2D 그래디언트 노이즈 (Perlin 계열). 반환값 대략 [-1, 1]
export class Noise2D {
  constructor(rng) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.gx = new Float32Array(256);
    this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const d00 = this.gx[aa] * xf + this.gy[aa] * yf;
    const d10 = this.gx[ba] * (xf - 1) + this.gy[ba] * yf;
    const d01 = this.gx[ab] * xf + this.gy[ab] * (yf - 1);
    const d11 = this.gx[bb] * (xf - 1) + this.gy[bb] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const x1 = d00 + (d10 - d00) * u;
    const x2 = d01 + (d11 - d01) * u;
    return (x1 + (x2 - x1) * v) * 1.4;
  }

  fbm(x, y, octaves = 3, gain = 0.5) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq + o * 17.3, y * freq - o * 9.1) * amp;
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }
}

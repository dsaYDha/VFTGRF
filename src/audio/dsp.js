// 간단한 합성용 DSP 도구 (샘플 배열을 만들어 AudioBuffer 로 변환)
export const SR = 44100;

export function buf(dur) {
  return new Float32Array(Math.max(1, Math.ceil(dur * SR)));
}

// 시드 고정 난수 (변형마다 다른 소리)
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function noise(a, amp = 1, r = Math.random, from = 0, to = a.length) {
  for (let i = from; i < to; i++) a[i] += (r() * 2 - 1) * amp;
  return a;
}

// 갈색 잡음 (낮은 소리 위주)
export function brown(a, amp = 1, r = Math.random) {
  let last = 0;
  for (let i = 0; i < a.length; i++) {
    last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
    a[i] += last * 3.5 * amp;
  }
  return a;
}

export function lowpass(a, fc, passes = 1) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < a.length; i++) {
      y += (a[i] - y) * k;
      a[i] = y;
    }
  }
  return a;
}

export function highpass(a, fc, passes = 1) {
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < a.length; i++) {
      y += (a[i] - y) * k;
      a[i] = a[i] - y;
    }
  }
  return a;
}

// RBJ 바이쿼드 대역통과 (fc 고정 또는 함수)
export function bandpass(a, fc, q = 1) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const fixed = typeof fc === 'number';
  let b0;
  let b2;
  let a0;
  let a1;
  let a2;
  const coef = (f) => {
    const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR;
    const alpha = Math.sin(w) / (2 * q);
    b0 = alpha;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * Math.cos(w);
    a2 = 1 - alpha;
  };
  if (fixed) coef(fc);
  for (let i = 0; i < a.length; i++) {
    if (!fixed && i % 32 === 0) coef(fc(i / SR));
    const x = a[i];
    const y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    a[i] = y;
  }
  return a;
}

// 지수 감쇠 엔벨로프 (attack 선형, decay 시정수)
export function env(a, attack, decay, from = 0, hold = 0) {
  for (let i = 0; i < a.length; i++) {
    const t = i / SR - from;
    let g;
    if (t < 0) g = 0;
    else if (t < attack) g = t / attack;
    else if (t < attack + hold) g = 1;
    else g = Math.exp(-(t - attack - hold) / decay);
    a[i] *= g;
  }
  return a;
}

// 사인 (주파수 변화·감쇠)
export function sine(a, f0, f1, amp, decay, from = 0, sweepTime = 0.1, phase = 0) {
  let ph = phase;
  const start = Math.floor(from * SR);
  for (let i = start; i < a.length; i++) {
    const t = (i - start) / SR;
    const k = Math.min(1, t / sweepTime);
    const f = f0 + (f1 - f0) * k;
    ph += (2 * Math.PI * f) / SR;
    a[i] += Math.sin(ph) * amp * Math.exp(-t / decay) * Math.min(1, t * 2000);
  }
  return a;
}

export function add(a, b, gain = 1, offset = 0) {
  const o = Math.floor(offset * SR);
  for (let i = 0; i < b.length && i + o < a.length; i++) a[i + o] += b[i] * gain;
  return a;
}

export function scale(a, g) {
  for (let i = 0; i < a.length; i++) a[i] *= g;
  return a;
}

export function softClip(a, drive = 1.5) {
  const n = Math.tanh(drive);
  for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * drive) / n;
  return a;
}

export function normalize(a, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) scale(a, peak / m);
  return a;
}

// 끝부분 페이드 (딸깍 소리 방지)
export function fadeOut(a, time = 0.01) {
  const n = Math.min(a.length, Math.floor(time * SR));
  for (let i = 0; i < n; i++) a[a.length - 1 - i] *= i / n;
  return a;
}

export function toBuffer(ctx, channels) {
  const chs = Array.isArray(channels) ? channels : [channels];
  const b = ctx.createBuffer(chs.length, chs[0].length, SR);
  chs.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

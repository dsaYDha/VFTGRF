// =============================================================================
// SoundBank — Web Audio 합성음 (외부 사운드 파일 없음). 시작할 때 버퍼로 미리 만든다.
// 종류마다 변형 여러 개를 만들어 반복감을 줄인다.
// =============================================================================
import { SR, buf, rng, noise, brown, lowpass, highpass, bandpass, env, sine, add, softClip, normalize, fadeOut, toBuffer } from './dsp.js';

function variants(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(rng(1000 + i * 7919), i));
  return out;
}

// ------------------------------------------------------------------ 총성
// 가까운 총성 (내 총): 날카로운 파열 + 묵직한 저음 + 짧은 잔향 꼬리
function shotNear(r) {
  const dur = 1.3;
  const out = buf(dur);
  const crack = env(highpass(noise(buf(0.06), 1, r), 1400), 0.0003, 0.006);
  add(out, crack, 1.1);
  const mid = env(bandpass(noise(buf(0.12), 1, r), 1100 + r() * 300, 0.9), 0.0005, 0.03);
  add(out, mid, 1.6);
  const body = buf(0.4);
  sine(body, 170 + r() * 30, 48, 1, 0.07, 0, 0.09);
  add(out, body, 0.9);
  const low = env(lowpass(noise(buf(0.5), 1, r), 420, 2), 0.001, 0.09);
  add(out, low, 2.2);
  const tail = env(lowpass(brown(buf(dur), 1, r), 900), 0.02, 0.38, 0.03);
  add(out, tail, 0.6);
  softClip(out, 1.8);
  normalize(out, 0.95);
  return fadeOut(out, 0.1);
}

// 먼 총성: 날카로움은 줄고 '퍽' 하는 소리 + 굴러가는 메아리
function shotFar(r) {
  const dur = 2.4;
  const out = buf(dur);
  const pop = env(lowpass(noise(buf(0.08), 1, r), 2600, 2), 0.0008, 0.012);
  add(out, pop, 1.3);
  const body = buf(0.6);
  sine(body, 120 + r() * 20, 42, 1, 0.12, 0, 0.12);
  add(out, body, 0.9);
  const thump = env(lowpass(noise(buf(0.6), 1, r), 260, 2), 0.002, 0.12);
  add(out, thump, 2.6);
  // 굴러가는 메아리: 진폭 변조된 저역 잡음
  const roll = lowpass(brown(buf(dur), 1, r), 520);
  for (let i = 0; i < roll.length; i++) {
    const t = i / SR;
    const am = 0.55 + 0.45 * Math.sin(t * (9 + r() * 0.02) + Math.sin(t * 3.1) * 2);
    roll[i] *= am * Math.exp(-Math.max(0, t - 0.05) / 0.75) * Math.min(1, t * 12);
  }
  add(out, roll, 1.1, 0.04);
  // 건물 반사 (짧은 지연 메아리)
  const echo = env(lowpass(noise(buf(0.3), 1, r), 1200), 0.002, 0.05);
  add(out, echo, 0.35, 0.18 + r() * 0.2);
  softClip(out, 1.3);
  normalize(out, 0.9);
  return fadeOut(out, 0.2);
}

// 초음속 파열음: N파 + 날카로운 고역 + 지면 반사
function crack(r) {
  const out = buf(0.12);
  const nlen = Math.floor(SR * (0.00035 + r() * 0.0002));
  for (let i = 0; i < nlen; i++) out[i] += 1 - (2 * i) / nlen;
  const snap = env(highpass(noise(buf(0.03), 1, r), 2800, 2), 0.0001, 0.004);
  add(out, snap, 0.8);
  const zip = env(bandpass(noise(buf(0.06), 1, r), 4200, 2), 0.0005, 0.012);
  add(out, zip, 0.6);
  const refl = buf(0.1);
  for (let i = 0; i < nlen; i++) refl[i] += 0.4 * (1 - (2 * i) / nlen);
  add(out, highpass(refl, 1500), 1, 0.012 + r() * 0.01);
  normalize(out, 0.95);
  return fadeOut(out, 0.02);
}

// 도탄 소리 (피융)
function ricochet(r) {
  const dur = 0.55;
  const out = buf(dur);
  const f0 = 2600 + r() * 900;
  const f1 = 900 + r() * 400;
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const f = f0 + (f1 - f0) * Math.min(1, t / dur) + Math.sin(t * 90) * 60;
    ph += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.22) * Math.min(1, t * 200) * 0.5;
  }
  add(out, env(highpass(noise(buf(0.05), 1, r), 2000), 0.0002, 0.008), 0.7);
  normalize(out, 0.8);
  return fadeOut(out, 0.03);
}

// ------------------------------------------------------------------ 탄착
function impactDirt(r) {
  const out = buf(0.5);
  add(out, env(lowpass(noise(buf(0.2), 1, r), 650, 2), 0.0005, 0.035), 2.2);
  sine(out, 95, 55, 0.6, 0.05, 0, 0.05);
  // 흩어지는 흙
  add(out, env(bandpass(noise(buf(0.45), 1, r), 3200, 0.7), 0.02, 0.12, 0.02), 0.25);
  normalize(out, 0.9);
  return fadeOut(out);
}
function impactMud(r) {
  const out = buf(0.4);
  add(out, env(lowpass(noise(buf(0.2), 1, r), 420, 2), 0.001, 0.045), 2.4);
  add(out, env(bandpass(noise(buf(0.25), 1, r), (t) => 400 + t * 3000, 2), 0.01, 0.05, 0.01), 0.5);
  normalize(out, 0.85);
  return fadeOut(out);
}
function impactConcrete(r) {
  const out = buf(0.45);
  add(out, env(highpass(noise(buf(0.05), 1, r), 1800), 0.0002, 0.006), 1.5);
  add(out, env(bandpass(noise(buf(0.1), 1, r), 2100 + r() * 600, 3), 0.0003, 0.02), 1.4);
  add(out, env(lowpass(noise(buf(0.4), 1, r), 3500), 0.004, 0.09, 0.008), 0.35);
  normalize(out, 0.9);
  return fadeOut(out);
}
function impactMetal(r) {
  const out = buf(0.9);
  add(out, env(highpass(noise(buf(0.03), 1, r), 2500), 0.0001, 0.004), 1.2);
  const partials = [1.0, 1.59, 2.31, 2.95, 3.7];
  const base = 1300 + r() * 1400;
  partials.forEach((p, i) => sine(out, base * p, base * p, 0.35 / (i + 1), 0.25 + r() * 0.3, 0, 0.01, r() * 6));
  normalize(out, 0.8);
  return fadeOut(out, 0.05);
}
function impactWood(r) {
  const out = buf(0.35);
  add(out, env(bandpass(noise(buf(0.12), 1, r), 750 + r() * 250, 2), 0.0005, 0.03), 2.2);
  sine(out, 420 + r() * 80, 380, 0.4, 0.05, 0, 0.02);
  add(out, env(highpass(noise(buf(0.03), 1, r), 2500), 0.0002, 0.004), 0.6);
  normalize(out, 0.85);
  return fadeOut(out);
}
function impactWater(r) {
  const out = buf(0.5);
  add(out, env(bandpass(noise(buf(0.4), 1, r), 1800, 0.8), 0.003, 0.08), 1.6);
  sine(out, 300, 900, 0.4, 0.06, 0.005, 0.06);
  normalize(out, 0.8);
  return fadeOut(out);
}
function impactFlesh(r) {
  const out = buf(0.25);
  add(out, env(lowpass(noise(buf(0.2), 1, r), 320, 2), 0.001, 0.035), 2.5);
  normalize(out, 0.8);
  return fadeOut(out);
}

// ------------------------------------------------------------------ 총 조작음
function click(r, f = 3500, d = 0.004, amp = 1) {
  const out = buf(0.05);
  add(out, env(bandpass(noise(buf(0.05), 1, r), f, 2), 0.0002, d), amp);
  return out;
}
function magOut(r) {
  const out = buf(0.35);
  add(out, click(r, 3000, 0.004, 1.4));
  add(out, env(bandpass(noise(buf(0.2), 1, r), 2200, 1.2), 0.02, 0.06), 0.5, 0.03);
  add(out, click(r, 1800, 0.01, 1.2), 1, 0.2);
  normalize(out, 0.8);
  return fadeOut(out);
}
function pouch(r) {
  const out = buf(0.45);
  const rust = bandpass(noise(buf(0.45), 1, r), 1400, 0.6);
  for (let i = 0; i < rust.length; i++) {
    const t = i / SR;
    rust[i] *= Math.max(0, Math.sin(t * 40 + r() * 0.3)) * Math.exp(-t / 0.2);
  }
  add(out, rust, 0.9);
  normalize(out, 0.6);
  return fadeOut(out);
}
function magIn(r) {
  const out = buf(0.3);
  add(out, env(lowpass(noise(buf(0.06), 1, r), 1500), 0.0003, 0.012), 1.6);
  sine(out, 190, 160, 0.6, 0.03);
  add(out, click(r, 4200, 0.003, 1.2), 1, 0.02);
  normalize(out, 0.9);
  return fadeOut(out);
}
function boltBack(r) {
  const out = buf(0.3);
  add(out, env(bandpass(noise(buf(0.15), 1, r), (t) => 2500 + t * 9000, 3), 0.005, 0.04), 1.2);
  add(out, click(r, 3800, 0.004, 1), 1, 0.09);
  normalize(out, 0.8);
  return fadeOut(out);
}
function boltForward(r) {
  const out = buf(0.4);
  add(out, env(highpass(noise(buf(0.05), 1, r), 1500), 0.0002, 0.008), 1.5);
  sine(out, 1250, 1240, 0.35, 0.07);
  sine(out, 2750, 2740, 0.2, 0.05);
  sine(out, 160, 120, 0.5, 0.04);
  normalize(out, 0.95);
  return fadeOut(out);
}
function selector(r) {
  const out = buf(0.15);
  add(out, click(r, 3200, 0.005, 1));
  add(out, click(r, 2600, 0.006, 0.9), 1, 0.045);
  normalize(out, 0.6);
  return out;
}
function dryFire(r) {
  const out = buf(0.1);
  add(out, click(r, 2400, 0.006, 1));
  normalize(out, 0.5);
  return out;
}
function casing(r) {
  const out = buf(0.35);
  for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
    const off = k * (0.05 + r() * 0.06);
    const f = 4200 + r() * 2600;
    const b = buf(0.1);
    sine(b, f, f, 0.5 / (k + 1), 0.018);
    sine(b, f * 1.47, f * 1.47, 0.3 / (k + 1), 0.012);
    add(out, b, 1, off);
  }
  lowpass(out, 6000);
  normalize(out, 0.5);
  return fadeOut(out);
}

// ------------------------------------------------------------------ 탄창 채우기 (탄약 상자, 클립 장전)
// 클립을 탄창 장전 가이드에 꽂는 소리: 금속 딸깍 + 짧은 둔탁음
function clipIn(r) {
  const out = buf(0.18);
  add(out, click(r, 3800 + r() * 500, 0.004, 1.3));
  add(out, env(lowpass(noise(buf(0.08), 1, r), 900), 0.001, 0.015), 0.8, 0.004);
  add(out, click(r, 2400, 0.006, 0.6), 1, 0.05 + r() * 0.02);
  normalize(out, 0.7);
  return fadeOut(out);
}
// 엄지로 탄을 눌러 내리는 소리: 탄 10발이 차례로 탄창에 걸리는 딸깍 + 스프링 긁힘 (점점 빨라짐)
function clipPress(r) {
  const dur = 1.25;
  const out = buf(dur);
  let t = 0.03;
  for (let k = 0; k < 10; k++) {
    const f = 2700 + r() * 900;
    add(out, click(r, f, 0.003 + r() * 0.002, 0.8 + r() * 0.4), 1, t);
    add(out, env(bandpass(noise(buf(0.06), 1, r), 1700 + r() * 400, 1.5), 0.004, 0.018), 0.25, t + 0.008);
    t += (0.125 - k * 0.006) * (0.85 + r() * 0.3);
  }
  // 손가락·클립 마찰 (낮게 깔리는 긁힘)
  const rub = bandpass(noise(buf(dur), 1, r), 1200, 0.8);
  for (let i = 0; i < rub.length; i++) rub[i] *= 0.12 * Math.min(1, (i / SR) * 8) * Math.exp(-(i / SR) / 0.9);
  add(out, rub, 1);
  normalize(out, 0.65);
  return fadeOut(out, 0.03);
}
// 빈 클립을 빼서 버리는 소리: 긁힘 + 땅에 떨어지는 가벼운 금속음
function clipOut(r) {
  const out = buf(0.55);
  add(out, env(bandpass(noise(buf(0.12), 1, r), (t) => 1800 + t * 14000, 2), 0.01, 0.03), 0.9);
  const ping = buf(0.3);
  const f = 3300 + r() * 900;
  sine(ping, f, f, 0.35, 0.03);
  sine(ping, f * 1.52, f * 1.52, 0.2, 0.02);
  add(ping, env(lowpass(noise(buf(0.05), 1, r), 700), 0.001, 0.012), 0.6);
  add(out, ping, 1, 0.24 + r() * 0.06);
  normalize(out, 0.55);
  return fadeOut(out);
}

// ------------------------------------------------------------------ 무전기 (분대 콜아웃)
// 송신 시작 스켈치: 딸깍 + 짧은 대역 제한 잡음 버스트 (지직) + 드문 튀는 잡음
function radioOpen(r) {
  const dur = 0.24;
  const out = buf(dur);
  add(out, click(r, 1700 + r() * 400, 0.003, 1.4));
  const st = noise(buf(dur), 1, r);
  // 드문 크래클 (튀는 잡음)
  for (let i = 0; i < st.length; i++) if (r() < 0.003) st[i] += (r() < 0.5 ? -1 : 1) * (3 + r() * 4);
  highpass(st, 420, 2);
  lowpass(st, 3000, 2);
  env(st, 0.004, 0.035 + r() * 0.015, 0.012, 0.07 + r() * 0.04);
  add(out, st, 1.1, 0.006);
  softClip(out, 2.2);
  normalize(out, 0.7);
  return fadeOut(out, 0.02);
}
// 송신 끝 스켈치 꼬리: 잡음이 잠깐 열렸다 딸깍 닫힘
function radioClose(r) {
  const dur = 0.2;
  const out = buf(dur);
  const st = noise(buf(0.14), 1, r);
  highpass(st, 500, 2);
  lowpass(st, 3200, 2);
  env(st, 0.003, 0.03, 0, 0.06 + r() * 0.03);
  add(out, st, 1.0);
  add(out, click(r, 1500 + r() * 300, 0.003, 1.1), 1, 0.1 + r() * 0.02);
  softClip(out, 2);
  normalize(out, 0.6);
  return fadeOut(out, 0.015);
}

// ------------------------------------------------------------------ 발소리
function stepMud(r) {
  const out = buf(0.35);
  add(out, env(lowpass(noise(buf(0.3), 1, r), 600, 2), 0.025, 0.06), 2.2);
  add(out, env(bandpass(noise(buf(0.25), 1, r), (t) => 300 + t * 5000, 2.5), 0.03, 0.05, 0.04), 0.7);
  normalize(out, 0.7);
  return fadeOut(out);
}
function stepGrass(r) {
  const out = buf(0.3);
  add(out, env(bandpass(noise(buf(0.25), 1, r), 3600, 0.8), 0.015, 0.06), 1.2);
  add(out, env(lowpass(noise(buf(0.1), 1, r), 300), 0.005, 0.03), 1.0);
  normalize(out, 0.55);
  return fadeOut(out);
}
function stepGravel(r) {
  const out = buf(0.3);
  for (let k = 0; k < 14; k++) {
    const b = env(highpass(noise(buf(0.02), 1, r), 2500), 0.0002, 0.002 + r() * 0.003);
    add(out, b, 0.4 + r() * 0.6, r() * 0.12);
  }
  add(out, env(lowpass(noise(buf(0.1), 1, r), 300), 0.004, 0.03), 1.0);
  normalize(out, 0.6);
  return fadeOut(out);
}
function stepWater(r) {
  const out = buf(0.45);
  add(out, env(bandpass(noise(buf(0.4), 1, r), 1300, 0.7), 0.02, 0.09), 1.4);
  add(out, env(lowpass(noise(buf(0.3), 1, r), 350), 0.02, 0.08), 1.0);
  normalize(out, 0.65);
  return fadeOut(out);
}
function stepHard(r) {
  const out = buf(0.2);
  add(out, env(lowpass(noise(buf(0.1), 1, r), 900), 0.002, 0.02), 1.5);
  add(out, click(r, 2000, 0.003, 0.4));
  normalize(out, 0.5);
  return fadeOut(out);
}

// ------------------------------------------------------------------ 환경음
function windLoop(r) {
  const dur = 6;
  const L = lowpass(brown(buf(dur), 1, r), 700);
  const R = lowpass(brown(buf(dur), 1, r), 700);
  // 루프 경계 교차 페이드
  const n = Math.floor(0.5 * SR);
  for (const a of [L, R]) {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      a[i] = a[i] * t + a[a.length - n + i] * (1 - t);
    }
  }
  const l2 = L.subarray(0, L.length - n);
  const r2 = R.subarray(0, R.length - n);
  normalize(l2, 0.8);
  normalize(r2, 0.8);
  return [l2.slice(), r2.slice()];
}
function artillery(r) {
  const dur = 4.5;
  const out = buf(dur);
  add(out, env(lowpass(noise(buf(1.5), 1, r), 160, 3), 0.01, 0.35), 3);
  const roll = lowpass(brown(buf(dur), 1, r), 220);
  for (let i = 0; i < roll.length; i++) {
    const t = i / SR;
    roll[i] *= Math.exp(-t / 1.4) * (0.6 + 0.4 * Math.sin(t * 5 + Math.sin(t * 1.3) * 3)) * Math.min(1, t * 8);
  }
  add(out, roll, 1.6, 0.05);
  normalize(out, 0.9);
  return fadeOut(out, 0.3);
}

export function buildSoundBank(ctx) {
  const B = (arr) => toBuffer(ctx, arr);
  const bank = {
    shotNear: variants(4, shotNear).map(B),
    shotFar: variants(5, shotFar).map(B),
    crack: variants(5, crack).map(B),
    ricochet: variants(3, ricochet).map(B),
    dirt: variants(4, impactDirt).map(B),
    mud: variants(3, impactMud).map(B),
    concrete: variants(4, impactConcrete).map(B),
    brick: variants(3, impactConcrete).map(B),
    metal: variants(4, impactMetal).map(B),
    wood: variants(3, impactWood).map(B),
    water: variants(3, impactWater).map(B),
    sand: variants(2, impactDirt).map(B),
    flesh: variants(2, impactFlesh).map(B),
    plate: variants(2, impactMetal).map(B),
    magOut: variants(2, magOut).map(B),
    pouch: variants(2, pouch).map(B),
    magIn: variants(2, magIn).map(B),
    boltBack: variants(2, boltBack).map(B),
    boltForward: variants(2, boltForward).map(B),
    selector: variants(1, selector).map(B),
    dryFire: variants(1, dryFire).map(B),
    casing: variants(4, casing).map(B),
    step_mud: variants(4, stepMud).map(B),
    step_grass: variants(4, stepGrass).map(B),
    step_gravel: variants(3, stepGravel).map(B),
    step_water: variants(3, stepWater).map(B),
    step_hard: variants(3, stepHard).map(B),
    wind: [B(windLoop(rng(77)))],
    artillery: variants(3, artillery).map(B),
    // 2단계: 탄약 상자에서 탄창 채우기 (클립 장전)
    clipIn: variants(2, clipIn).map(B),
    clipPress: variants(3, clipPress).map(B),
    clipOut: variants(2, clipOut).map(B),
    // 2단계: 무전 스켈치 (음성 버스로 재생)
    radioOpen: variants(3, radioOpen).map(B),
    radioClose: variants(2, radioClose).map(B),
  };
  return bank;
}

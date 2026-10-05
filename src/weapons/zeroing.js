// 가늠자 영점: 주어진 거리에서 탄이 조준선과 만나도록 하는 총열 앙각 (rad)
// 게임과 같은 탄도식(중력 + 이차 공기저항)으로 미리 계산해 둔다.
import { CONFIG } from '../config.js';

const cache = new Map();

function simulateY(ammo, angle, range, sightHeight) {
  const g = CONFIG.ballistics.gravity;
  const k = ammo.dragK;
  let x = 0;
  let y = -sightHeight;
  let vx = ammo.muzzleVelocity * Math.cos(angle);
  let vy = ammo.muzzleVelocity * Math.sin(angle);
  const dt = 1 / CONFIG.ballistics.integrationHz;
  let t = 0;
  while (x < range && t < 4) {
    const sp = Math.hypot(vx, vy);
    const px = x;
    const py = y;
    vx += -k * sp * vx * dt;
    vy += (-g - k * sp * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    if (x >= range) {
      const f = (range - px) / (x - px);
      return py + (y - py) * f;
    }
  }
  return y;
}

export function elevationFor(ammo, range, sightHeight = 0) {
  const key = `${ammo.muzzleVelocity}_${ammo.dragK}_${Math.round(range)}_${sightHeight}`;
  if (cache.has(key)) return cache.get(key);
  let lo = -0.01;
  let hi = 0.08;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (simulateY(ammo, mid, range, sightHeight) > 0) hi = mid;
    else lo = mid;
  }
  const a = (lo + hi) / 2;
  cache.set(key, a);
  return a;
}

// AI 용: 임의 거리 (25m 간격 표를 보간)
const tables = new Map();
export function elevationInterp(ammo, range) {
  let tbl = tables.get(ammo);
  if (!tbl) {
    tbl = [];
    for (let r = 0; r <= 900; r += 25) tbl.push(r === 0 ? 0 : elevationFor(ammo, r, 0));
    tables.set(ammo, tbl);
  }
  const f = Math.max(0, Math.min(tbl.length - 1.001, range / 25));
  const i = Math.floor(f);
  return tbl[i] + (tbl[i + 1] - tbl[i]) * (f - i);
}

// 디버그·튜닝용: 거리별 낙차/속도 표
export function trajectoryTable(ammo) {
  const out = [];
  for (const r of [100, 200, 300, 400, 500, 600]) {
    out.push({ range: r, elevationMrad: +(elevationFor(ammo, r, ammo.sightHeight) * 1000).toFixed(2) });
  }
  return out;
}

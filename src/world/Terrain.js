// =============================================================================
// Terrain — 높이장(0.5m 격자)에 완만한 기복·수로·참호·포탄 구덩이·농로를 실제로 파낸 지형.
// 충돌·높이 질의는 이 격자를 쓰고, 렌더 메시는 5m 청크마다 필요한 해상도로 따로 만들어
// 100m 묶음마다 근거리/원거리 2단계 LOD 로 묶는다(해상도가 다른 청크 사이는 스커트로 틈 가림).
// 지면 재질은 맵 배치 데이터에서 만든 혼합 마스크(0.5m)와 재질별 절차적 텍스처를 셰이더에서 섞는다.
// 밭 고랑(0.4~0.6m 간격)은 셰이더 노멀·어둡기 + 플레이어 가까이의 얕은 실제 형상(골판 메시, 렌더 전용)이다.
// heightAt 은 고랑의 평균면이고, 렌더 형상(내린 밭 지면·고랑 마루)은 평균면에서 ±geomDepth/2(5cm) 이내다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG, SURFACES } from '../config.js';
import { MAP } from './mapData.js';
import { Random } from '../core/Random.js';
import { Noise2D } from './noise.js';
import { clamp, smoothstep, polylineDistance } from '../core/mathUtils.js';
import { groundTextures, groundMacroTexture } from './textures.js';
import { terrainShaderParts, ROAD_RANGE, TRACK_RANGE, MAX_PARCELS, MAX_TRACK_SEGS } from './terrainShader.js';
import { farRoadSegments, applySilhouetteFog } from './Distant.js';

const SID = Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, v.id]));

// 혼합 마스크 재질 채널 (풀 = 나머지)
const GM = { plowed: 0, stubble: 1, mud: 2, subsoil: 3, gravel: 4, grass: -1 };
const WHITE = [1, 1, 1];

// 앰비언트 오클루전 수평선 탐색 방향 (8방향)
const AO_DIRS = [];
for (let q = 0; q < 8; q++) AO_DIRS.push(Math.cos((q * Math.PI) / 4), Math.sin((q * Math.PI) / 4));

// 0..1 구간 비대칭 혹 (peak 위치에서 최대 1)
function bump(t, peak = 0.5) {
  if (t <= 0 || t >= 1) return 0;
  if (t < peak) return Math.sin((Math.PI / 2) * (t / peak));
  return Math.cos((Math.PI / 2) * ((t - peak) / (1 - peak)));
}

// 평평한 바닥 + 매끈한 벽 단면: d <= flat 이면 1, d >= flat + wall 이면 0
function flatProfile(d, flat, wall) {
  if (d <= flat) return 1;
  if (d >= flat + wall) return 0;
  const t = (d - flat) / wall;
  return 1 - t * t * (3 - 2 * t);
}

// 청크 크기를 나누어떨어지게 하는 해상도 (r 이하 중 가장 큰 값)
function snapRes(r, cs) {
  return cs / Math.max(1, Math.ceil(cs / r - 1e-6));
}

function bbox(points) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return { x0, x1, z0, z1 };
}

// 차량 바닥 크기 (반길이·반폭, 로컬 x = 차체 길이 방향)
const VEHICLE_HALF = {
  apc: [3.6, 1.6],
  tractor: [2.3, 1.3],
  sedan: [2.3, 0.95],
  van: [2.5, 1.05],
  truck: [3.5, 1.3],
};

export class Terrain {
  constructor() {
    const W = CONFIG.world;
    this.half = W.halfSize;
    this.res = W.heightRes;
    this.n = Math.round((2 * this.half) / this.res) + 1;
    this.h = new Float32Array(this.n * this.n);
    this.sres = W.surfaceRes;
    this.sn = Math.round((2 * this.half) / this.sres) + 1;
    this.surf = new Uint8Array(this.sn * this.sn);
    this.rng = new Random(W.seed);
    this.noise = new Noise2D(new Random(W.seed + 7));
    this.detailRegions = [];
    this.craters = [];
    this.puddles = [];
    this.mask = null;
    this.lods = [];
    this._tmp = {};
    this._n = new THREE.Vector3();
    this.parcels = this.buildParcels();
    this.vehiclePads = this.buildVehiclePads();
    this.footprints = this.buildingFootprints();
    // 기복을 줄일 바닥 (건물·차량) 경계 상자
    const pd = CONFIG.terrain.undulation.padDampDist[1];
    this.padBoxes = [...this.footprints, ...this.vehiclePads].map((f) => {
      const r = Math.hypot(f.hx, f.hz);
      return { x: f.x, z: f.z, r, reach: r + pd };
    });
    this.aoBoxes = this.buildAOBoxes();
    // 기복을 줄일 참호선 (경계 상자로 먼저 거른다)
    const td = CONFIG.terrain.undulation.trenchDampDist[1];
    this.trenchDampLines = MAP.trench.lines.map((line) => {
      const b = bbox(line);
      return { line, x0: b.x0 - td, x1: b.x1 + td, z0: b.z0 - td, z1: b.z1 + td };
    });
  }

  // ------------------------------------------------------------------ 밭 구획 (고랑 방향·간격·색)
  buildParcels() {
    const F = MAP.fields;
    const T = CONFIG.terrain.furrow;
    const list = [null];
    const add = (f, kind) => {
      if (list.length >= MAX_PARCELS) return;
      const a = ((f.furrowDeg ?? (f.rowDir === 'x' ? 90 : 0)) * Math.PI) / 180;
      // 방위각(0 = 북) → 월드 방향 (북 = -Z)
      list.push({
        index: list.length,
        kind,
        x0: f.x0,
        x1: f.x1,
        z0: f.z0,
        z1: f.z1,
        dirX: Math.sin(a),
        dirZ: -Math.cos(a),
        spacing: f.spacing ?? (kind === 'stubble' ? 0.16 : 0.5),
        depth: kind === 'plowed' ? T.depth : kind === 'sunflower' ? T.sunflowerDepth : 0,
        tint: f.tint || WHITE,
      });
    };
    for (const f of F.plowed || []) add(f, 'plowed');
    for (const f of F.sunflower || []) add(f, 'sunflower');
    for (const f of F.stubble || []) add(f, 'stubble');
    return list;
  }

  buildVehiclePads() {
    const list = [];
    const add = (v, kind) => {
      const [hx, hz] = VEHICLE_HALF[kind] || [2.3, 1.0];
      list.push({ x: v.x, z: v.z, hx, hz, rot: v.rot || 0, c: Math.cos(v.rot || 0), s: Math.sin(v.rot || 0) });
    };
    if (MAP.apc) add(MAP.apc, 'apc');
    if (MAP.tractor) add(MAP.tractor, 'tractor');
    for (const c of MAP.cars || []) add(c, c.kind);
    return list;
  }

  buildAOBoxes() {
    const list = [];
    for (const f of this.footprints) list.push({ x: f.x, z: f.z, hx: f.hx, hz: f.hz, c: 1, s: 0, k: 0.32, fall: 2.4 });
    for (const v of this.vehiclePads) list.push({ x: v.x, z: v.z, hx: v.hx, hz: v.hz, c: v.c, s: v.s, k: 0.55, fall: 1.7 });
    for (const d of MAP.dugouts || []) {
      list.push({ x: d.x, z: d.z, hx: d.w / 2, hz: d.d / 2, c: Math.cos(d.rot), s: Math.sin(d.rot), k: 0.22, fall: 1.2 });
    }
    for (const b of list) b.r = Math.hypot(b.hx, b.hz) + b.fall;
    return list;
  }

  // ------------------------------------------------------------------ 질의
  baseHeight(x, z) {
    const W = CONFIG.world;
    const slope = clamp((MAP.canal.z - z) * W.northRiseSlope, -1.6, 3.2);
    return slope + this.undulation(x, z) + this.trenchGlacis(x, z);
  }

  // 완만한 기복: 파장 50~150m, 높이차 0.5~1.5m. 수로~적 진지 사이(사격 회랑)에서는 솟은 곳을 눌러
  // 우묵한 곳(국지 사각지대)만 남기고, 수로·건물·차량 바닥 둘레에서는 줄인다.
  undulation(x, z) {
    const U = CONFIG.terrain.undulation;
    const nz = this.noise;
    let u =
      U.large.amp * nz.noise(x / U.large.size + 31.7, z / U.large.size - 12.3) +
      U.medium.amp * nz.noise(x / U.medium.size - 7.1, z / U.medium.size + 44.9);
    if (u > 0) {
      const c = U.corridor;
      const ox = Math.max(c.x0 - x, x - c.x1, 0);
      const oz = Math.max(c.z0 - z, z - c.z1, 0);
      const inC = 1 - smoothstep(0, c.fade, Math.hypot(ox, oz));
      u *= 1 - inC * (1 - c.ridgeMul);
    }
    const dc = Math.abs(z - this.canalZ(x));
    let damp = U.canalDamp + (1 - U.canalDamp) * smoothstep(U.canalDampDist[0], U.canalDampDist[1], dc);
    const pd = U.padDampDist;
    for (const p of this.padBoxes) {
      const dx = Math.abs(x - p.x);
      const dz = Math.abs(z - p.z);
      if (dx > p.reach || dz > p.reach) continue;
      const d = Math.max(0, Math.hypot(dx, dz) - p.r);
      damp *= 0.15 + 0.85 * smoothstep(pd[0], pd[1], d);
    }
    const td = U.trenchDampDist;
    let tdamp = 1;
    for (const t of this.trenchDampLines) {
      if (x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) continue;
      tdamp *= U.trenchDamp + (1 - U.trenchDamp) * smoothstep(td[0], td[1], polylineDistance(t.line, x, z));
    }
    return u * damp * tdamp + U.fine.amp * tdamp * nz.noise(x / U.fine.size + 3.3, z / U.fine.size - 9.9) + U.trenchOffset * (1 - tdamp);
  }

  // 맵 밖(원경) 지형 높이 (heightAt 이 높이 격자 밖에서 쓴다): 기본 기복 + 먼 언덕 + 맵 밖으로 이어지는 수로·농로
  farHeight(x, z) {
    let h = this.baseHeight(x, z) + this.farHills(x, z) + this.farRoadDh(x, z);
    if (Math.abs(z - MAP.canal.z) < 9) h += this.canalDh(x, z);
    return h;
  }

  // 먼 언덕 (CONFIG.distant.terrain.hills 노이즈 + MAP.distant.hills 둔덕): 맵 가장자리 밖 start ~ full 사이에서 커지고,
  // 수로 둘레는 눌러 수로가 낮은 골을 따라간다
  farHills(x, z) {
    const H = CONFIG.distant.terrain.hills;
    const out = Math.max(Math.abs(x), Math.abs(z)) - this.half;
    if (out <= H.start) return 0;
    const nz = this.noise;
    let v = 0.7 * nz.noise(x / H.size[0] + 51.3, z / H.size[0] - 17.9) + 0.3 * nz.noise(x / H.size[1] - 8.4, z / H.size[1] + 33.1);
    if (v < 0) v *= H.valley;
    let h = H.amp * v;
    for (const b of (MAP.distant && MAP.distant.hills) || []) {
      // 둥근 둔덕 (중심점까지 거리) 또는 능선 (len: 방위각 angle 방향 마루 선분까지 거리, 마루 높이는 노이즈로 들쭉날쭉)
      let d;
      let k = 1;
      if (b.len) {
        const ux = Math.sin((b.angle * Math.PI) / 180);
        const uz = -Math.cos((b.angle * Math.PI) / 180);
        const t = clamp((x - b.x) * ux + (z - b.z) * uz, -b.len / 2, b.len / 2);
        d = Math.hypot(x - b.x - ux * t, z - b.z - uz * t);
        k = 1 + H.crestWobble * nz.noise(t / H.crestSize + b.x * 0.013, b.z * 0.013 - 4.1);
      } else d = Math.hypot(x - b.x, z - b.z);
      if (d < b.r) h += b.h * k * 0.5 * (1 + Math.cos((Math.PI * d) / b.r));
    }
    const cv = H.canalValley;
    return h * smoothstep(H.start, H.full, out) * smoothstep(cv[0], cv[1], Math.abs(z - this.canalZ(x)));
  }

  // 맵 밖으로 이어지는 농로의 첫 구간 (맵 가장자리에서 시작하는 직선, MAP.distant.roads): 단면을 판다
  farRoadCarves() {
    if (this._farCarves) return this._farCarves;
    const out = [];
    for (const r of (MAP.distant && MAP.distant.roads) || []) {
      const [a, b] = r.points;
      if (!b || Math.max(Math.abs(a[0]), Math.abs(a[1])) < this.half - 1) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      out.push({ ax: a[0], az: a[1], ux: (b[0] - a[0]) / len, uz: (b[1] - a[1]) / len, len, hw: CONFIG.distant.terrain.roadHalf });
    }
    this._farCarves = out;
    return out;
  }

  farRoadDh(x, z) {
    const R = CONFIG.terrain.road;
    let dh = 0;
    for (const c of this.farRoadCarves()) {
      const t = (x - c.ax) * c.ux + (z - c.az) * c.uz;
      if (t < -1 || t > c.len) continue;
      const d = Math.abs((x - c.ax) * c.uz - (z - c.az) * c.ux);
      if (d > c.hw + R.ditchOffset + R.ditchHalf + 1.2) continue;
      dh += this.roadSectionDh(d, c.hw) * (1 - smoothstep(c.len - 60, c.len, t));
    }
    return dh;
  }

  // 농로 단면 높이 변화 (applyRoads 와 같은 식, 수로 위 예외 없음): 길 중심 거리 d, 반폭 hw
  roadSectionDh(d, hw) {
    const R = CONFIG.terrain.road;
    let dh = 0;
    if (d < hw + 0.3) {
      const inner = 1 - smoothstep(hw - 0.2, hw + 0.3, d);
      dh -= R.sink * inner;
      dh += R.crown * (1 - Math.min(1, (d / hw) ** 2)) * inner;
      dh -= R.rutDepth * flatProfile(Math.abs(d - R.rutOffset), R.rutFlat, R.rutWall);
    }
    dh += 0.05 * bump((d - hw) / 0.7, 0.4);
    const dd = Math.abs(d - (hw + R.ditchOffset));
    dh -= R.ditchDepth * flatProfile(dd, R.ditchHalf * 0.35, R.ditchHalf * 0.65);
    dh += 0.07 * bump((d - hw - R.ditchOffset - R.ditchHalf) / 1.1, 0.35);
    return dh;
  }

  // 높이 격자 쌍선형 표본 (가장자리 포함, 격자 밖 좌표는 가장자리로 고정) — 원경 지형의 맵 가장자리 정점용
  gridSample(x, z) {
    const n = this.n;
    const fx = clamp((x + this.half) / this.res, 0, n - 1.0001);
    const fz = clamp((z + this.half) / this.res, 0, n - 1.0001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    const h = this.h;
    return h[k] * (1 - tx) * (1 - tz) + h[k + 1] * tx * (1 - tz) + h[k + n] * (1 - tx) * tz + h[k + n + 1] * tx * tz;
  }

  heightAt(x, z) {
    const fx = (x + this.half) / this.res;
    const fz = (z + this.half) / this.res;
    const n = this.n;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return this.farHeight(x, z);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    const h = this.h;
    const h00 = h[k];
    const h10 = h[k + 1];
    const h01 = h[k + n];
    const h11 = h[k + n + 1];
    return h00 + (h10 - h00) * tx + (h01 - h00) * tz + (h00 - h10 - h01 + h11) * tx * tz;
  }

  normalAt(x, z, out = this._n) {
    const e = 0.35;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  surfaceAt(x, z) {
    const i = Math.round((x + this.half) / this.sres);
    const j = Math.round((z + this.half) / this.sres);
    if (i < 0 || j < 0 || i >= this.sn || j >= this.sn) return SID.grass;
    return this.surf[j * this.sn + i];
  }

  canalZ(x) {
    const C = MAP.canal;
    return C.z + C.wiggleAmp * Math.sin(x / C.wiggleLen);
  }

  // 수로 중심선 기울기 dz/dx
  canalDzDx(x) {
    const C = MAP.canal;
    return (C.wiggleAmp / C.wiggleLen) * Math.cos(x / C.wiggleLen);
  }

  isCanalLined(x) {
    for (const [a, b] of MAP.canal.linedSections) if (x >= a && x <= b) return true;
    return false;
  }

  // 북쪽 사격 발판 안쪽 끝: 비탈이 발판 깊이에 닿는 거리 (수로 중심에서)
  canalBenchInner() {
    const C = MAP.canal;
    return C.floorHalf + ((C.depth - C.bench.depth) * (C.topHalf - C.floorHalf)) / C.depth;
  }

  // 북쪽 둔덕 마루 높이 (자연 지면 기준): 노이즈 + 흙무더기, 모래주머니 사격 틈은 berm.gapHeight 로 낮춘다
  canalBermHeight(x) {
    const C = MAP.canal;
    const B = C.berm;
    let h = B.height + B.heightVar * this.noise.noise(x / 23, 3.3);
    for (const m of C.mounds) {
      const t = Math.abs(x - m.x) / (m.len * 0.5);
      if (t < 1.4) h += Math.max(0, m.h - h) * (1 - smoothstep(0.55, 1.4, t));
    }
    const slot = CONFIG.canal.sandbag.slot;
    for (const sx of C.sandbagPositions) {
      const dx = Math.abs(x - sx);
      if (dx < slot) h = Math.min(h, B.gapHeight + Math.max(0, h - B.gapHeight) * smoothstep(slot * 0.5, slot, dx));
    }
    return h;
  }

  // 엎드려쏴 사격 홈 가중치 (0..1, 홈 가운데 1)
  canalNotchWeight(x) {
    const N = MAP.canal.notches;
    let w = 0;
    for (const nx of N.list) {
      const dx = Math.abs(x - nx);
      if (dx < N.halfWidth + N.edge) w = Math.max(w, 1 - smoothstep(N.halfWidth, N.halfWidth + N.edge, dx));
    }
    return w;
  }

  // 수로 단면: 자연 지면 대비 높이 변화. dn = 수로 중심에서 북쪽(+)·남쪽(-) 거리 (배수관 둑은 canalDh 에서 섞는다)
  //  바닥(평평) → 사다리꼴 비탈(평면: 라이닝 판이 그대로 붙는다) → 북쪽: 사격 발판 → 둔덕 앞면 → 둥근 마루 → 완만한 뒤쪽
  canalSection(x, dn) {
    const C = MAP.canal;
    const d = Math.abs(dn);
    const D = C.depth;
    const lined = this.isCanalLined(x);
    const nz = this.noise;
    // 사다리꼴 수로: 비탈 위 모서리는 edgeRound 반폭으로 둥글린다 (0.5m 격자가 꺾인 모서리를 깎아 판이 뜨지 않게, 판은 그 아래에서 끝난다)
    const k = D / (C.topHalf - C.floorHalf);
    const r = C.edgeRound;
    const chan = (dd) => {
      if (dd <= C.floorHalf) return -D;
      if (dd >= C.topHalf + r) return 0;
      const lin = -D + (dd - C.floorHalf) * k;
      if (dd <= C.topHalf - r) return lin;
      const e = dd - (C.topHalf - r);
      return lin - (k * e * e) / (4 * r);
    };
    let h = chan(d);
    // 진흙 바닥의 완만한 요철 (판 아래쪽 끝은 바닥 밑에 묻혀 있어 몇 cm 는 괜찮다)
    if (d < C.floorHalf + 0.2) h += 0.03 * nz.noise(x / 7 + 1.3, 9.1) * (1 - smoothstep(C.floorHalf - 0.2, C.floorHalf + 0.2, d));
    // 라이닝 없는 흙 비탈: 무너지고 패인 요철 (라이닝 구간 끝 판 옆에서는 잦아든다)
    let rough = 0;
    if (!lined) {
      let gap = Infinity;
      for (const [a, b] of C.linedSections) gap = Math.min(gap, Math.abs(x - a), Math.abs(x - b));
      rough = 0.035 * nz.noise(x / 2.3 + 4.1, d * 1.4 + 0.7) * smoothstep(0.3, 2.0, gap);
    }
    // 라이닝 판 위쪽 끝 너머 비탈 마루에 흙이 조금 쌓였다. 판 끝에서 조금 떨어져 시작한다 — 판 끝을 덮으면 흙과 판 윗면이
    // 만나는 선이 렌더 격자를 따라 판마다 톱니처럼 들쭉날쭉해진다 (판 끝 곧은 모서리가 경계가 되게)
    if (lined && this.slabBand) h += C.slabSoil * bump((d - this.slabBand[1] - 0.1) / 0.9, 0.3);
    if (dn <= 0) {
      if (d > C.floorHalf) h += rough * (1 - smoothstep(C.topHalf, C.topHalf + 1, d));
      return h + C.southBank.height * bump((d - C.topHalf) / C.southBank.width, 0.4);
    }
    const bench = C.bench;
    const B = C.berm;
    const y0 = lined ? chan(bench.outer) : -bench.depth;
    if (d <= bench.outer) {
      if (!lined && d > this.canalBenchInner()) h = -bench.depth;
      return d > C.floorHalf ? h + rough * 0.7 : h;
    }
    // 둔덕: 발판 바깥 끝(y0)에서 마루(H)까지 가파른 앞면, 마루 뒤는 완만히 자연 지면으로
    const H = this.canalBermHeight(x);
    const face = B.face + B.faceVar * nz.noise(x / 13 + 5.1, 1.7);
    const crest = bench.outer + face;
    let hb;
    if (d < crest) {
      const t = (d - bench.outer) / face;
      hb = y0 + (H - y0) * t * t * (3 - 2 * t);
    } else {
      const t = (d - crest) / B.back;
      hb = t < 1 ? H * (1 - t * t * (3 - 2 * t)) : 0;
    }
    // 흙덩이 요철 (마루 윤곽이 칼같이 곧지 않게, 모래주머니 사격 틈에서는 작게)
    let slotW = 0;
    const slot = CONFIG.canal.sandbag.slot;
    for (const sx of C.sandbagPositions) slotW = Math.max(slotW, 1 - smoothstep(slot * 0.5, slot * 1.5, Math.abs(x - sx)));
    const lumps = 0.03 * nz.noise(x * 1.1 + 2.7, d * 1.1 - 3.3) + 0.035 * nz.noise(x / 1.3 - 8.1, d * 0.6 + 2.2) * (1 - 0.7 * slotW);
    hb += (lumps + rough * 0.5) * (1 - smoothstep(crest + 1.5, crest + B.back, d));
    // 엎드려쏴 사격 홈: 발판에서 짧게 올라 자연 지면 높이의 엎드릴 자리, 그 앞은 둔덕을 끝까지 파낸 홈
    const wN = this.canalNotchWeight(x);
    if (wN > 0) {
      const N = C.notches;
      const up = 0.35;
      let hn;
      if (d < bench.outer + up) {
        const t = (d - bench.outer) / up;
        hn = y0 + (N.floor - y0) * t * t * (3 - 2 * t);
      } else if (d < bench.outer + up + N.platform) hn = N.floor;
      else {
        // 앞쪽 끝: 총을 걸치는 낮은 흙 턱, 그 너머는 자연 지면으로
        const t = (d - bench.outer - up - N.platform) / 1.05;
        hn = (t < 1 ? N.floor * (1 - t * t * (3 - 2 * t)) : 0) + N.lip * bump(t, 0.25);
      }
      hb += (hn - hb) * wN;
    }
    return hb;
  }

  // 수로가 자연 지면에 더하는 높이 (배수관 둑 포함)
  canalDh(x, z) {
    const C = MAP.canal;
    const dn = this.canalZ(x) - z;
    if (Math.abs(dn) > 7.5) return 0;
    const cross = smoothstep(C.crossing.halfWidth * 0.5, C.crossing.halfWidth + 1.4, Math.abs(x - C.crossing.x));
    let dh = this.canalSection(x, dn) * cross;
    if (cross < 1) dh += (1 - cross) * 0.18 * (Math.abs(dn) < 5 ? 1 - Math.abs(dn) / 5 : 0);
    return dh;
  }

  // 수로 둘레의 해석적 지면 높이 (격자 보간 없이) — 라이닝 판·잡동사니를 비탈에 정확히 붙일 때 쓴다
  canalSurfaceY(x, z) {
    return this.baseHeight(x, z) + this.canalDh(x, z);
  }

  // 라이닝 판 배치 (Terrain·Structures 공용, 결정적). 구간마다 판 폭 간격으로 남(-1)·북(+1) 비탈에 하나씩.
  // kind: ok | missing (빠짐) | corner (모서리 깨짐) | cracked (금 가서 어긋남) | tilted (기울어짐·미끄러짐)
  buildCanalSlabs() {
    const K = CONFIG.canal;
    const C = MAP.canal;
    const P = K.slabChance;
    const rng = new Random(CONFIG.world.seed + 211);
    const run = C.topHalf - C.floorHalf;
    const cosA = run / Math.hypot(run, C.depth);
    // 판이 덮는 수평 거리 범위 (아래쪽 끝은 바닥 밑에 toe 만큼 묻힌다)
    this.slabBand = [C.floorHalf, C.floorHalf + (K.slab.length - K.slab.toe) * cosA];
    this.slabSections = [];
    for (const [a, b] of C.linedSections) {
      const w = K.slab.width;
      const n = Math.floor((b - a) / w + 1e-6);
      const sec = { a, b: a + n * w, w, n, north: [], south: [] };
      for (let i = 0; i < n; i++) {
        for (const side of [1, -1]) {
          const r = rng.next();
          let kind = 'ok';
          if (r < P.missing) kind = 'missing';
          else if (r < P.missing + P.corner) kind = 'corner';
          else if (r < P.missing + P.corner + P.cracked) kind = 'cracked';
          else if (r < P.missing + P.corner + P.cracked + P.tilted) kind = 'tilted';
          const slab = { x0: a + i * w, x1: a + (i + 1) * w, side, kind, seed: rng.next(), variant: Math.floor(rng.next() * K.slabTexture.variants) };
          (side > 0 ? sec.north : sec.south).push(slab);
        }
      }
      this.slabSections.push(sec);
    }
  }

  // x 위치 side(+1 북 / -1 남) 비탈의 라이닝 판 (없으면 null)
  canalSlabAt(x, side, margin = 0) {
    if (!this.slabSections) return null;
    for (const sec of this.slabSections) {
      if (x < sec.a + margin || x > sec.b - margin) continue;
      const i = clamp(Math.floor((x - sec.a) / sec.w), 0, sec.n - 1);
      return (side > 0 ? sec.north : sec.south)[i];
    }
    return null;
  }

  // 라이닝 구간의 렌더 지면 보정 (renderDrop 에 더함). 렌더 메시는 이 구간에서 0.25m 로 촘촘하고,
  //  1) 0.5m 높이 격자의 쌍선형 보간 대신 해석적 단면을 따른다 — 둥근 위 모서리에서 흙이 판 끝보다 들쭉날쭉 낮아져
  //     판 끝 단면이 톱니처럼 드러나지 않게 (충돌·heightAt 은 격자 그대로)
  //  2) 판 아래는 내린다: 바닥 모서리 근처(정점 사이 직선이 비탈 평면보다 높아지는 곳)만 깊게, 판 가운데는 얕게(겹침 깜빡임 방지),
  //     위쪽 끝까지 내려 판 윗면의 곧은 위쪽 모서리가 흙과의 경계가 되게 한다 (판 끝 너머 흙은 비탈 평면 높이 — 판이 proud 만큼
  //     올라와 있어 흙에 묻힌 선이 격자 따라 톱니가 되지 않는다). 기울거나 금 가 내려앉은 판 아래는 깊게, 빠진 판 자리는 얕은 홈
  canalSlabDrop(x, z) {
    if (!this.slabBand || Math.abs(z - MAP.canal.z) > 4.2 || !this.isCanalLined(x)) return 0;
    const C = MAP.canal;
    const dn = this.canalZ(x) - z;
    const d = Math.abs(dn);
    if (d > C.topHalf + C.edgeRound + 0.4) return 0;
    const fit = this.gridHeight(x, z) - this.canalSurfaceY(x, z);
    if (d < this.slabBand[0] + 0.02 || d > this.slabBand[1] + 0.03) return fit;
    // 구간 양끝 정점은 내리지 않는다 (끝 판 옆면이 드러나지 않게, 대신 모서리에 흙이 조금 덮인다)
    const s = this.canalSlabAt(x, dn > 0 ? 1 : -1, 0.2);
    if (!s) return fit;
    const K = CONFIG.canal;
    if (s.kind === 'missing') return fit + K.holeDrop;
    if (s.kind === 'tilted' || s.kind === 'cracked') return fit + K.renderDrop;
    const w = smoothstep(this.slabBand[0] + 0.3, this.slabBand[0] + 0.5, d);
    return fit + K.renderDrop * (1 - w) + K.renderDropMid * w;
  }

  // 수로 바로 위(배수관 둑 제외)인지 — 길·궤도 자국을 여기서는 파지 않는다
  nearCanal(x, z, dist = 4) {
    const C = MAP.canal;
    return Math.abs(z - this.canalZ(x)) < dist && Math.abs(x - C.crossing.x) > C.crossing.halfWidth + 1;
  }

  // 식생 배치·효과용: 그 지점 지면 재질 비율 (0..1)과 밭 구획·길/궤도 자국 거리
  // { plowed, stubble, grass, mud, subsoil, gravel, parcel, road, track }
  groundAt(x, z, out = {}) {
    const m = this.buildGroundMask();
    const i = clamp(Math.floor((x + this.half) / m.mr), 0, m.N - 1);
    const j = clamp(Math.floor((z + this.half) / m.mr), 0, m.N - 1);
    const k = (j * m.N + i) * 4;
    out.plowed = m.A[k] / 255;
    out.stubble = m.A[k + 1] / 255;
    out.mud = m.A[k + 2] / 255;
    out.subsoil = m.A[k + 3] / 255;
    out.gravel = m.B[k] / 255;
    out.grass = Math.max(0, 1 - out.plowed - out.stubble - out.mud - out.subsoil - out.gravel);
    out.road = (m.B[k + 1] / 255) * ROAD_RANGE;
    out.track = (m.B[k + 2] / 255) * TRACK_RANGE;
    out.parcel = m.B[k + 3];
    return out;
  }

  // 밭 구획 번호 (0 = 밭 아님)
  parcelAt(x, z) {
    const m = this.buildGroundMask();
    const i = clamp(Math.floor((x + this.half) / m.mr), 0, m.N - 1);
    const j = clamp(Math.floor((z + this.half) / m.mr), 0, m.N - 1);
    return m.parcel[j * m.N + i];
  }

  // 고랑 방향: { dirX, dirZ (고랑 줄이 뻗은 단위 방향), spacing, depth, kind } 또는 null
  furrowAt(x, z) {
    const p = this.parcelAt(x, z);
    return p ? this.parcels[p] : null;
  }

  // 혼합 마스크 쌍선형 표본 (렌더 형상용): 흑토 비율, 길 중심·궤도 띠 거리, 밭 구획(가장 가까운 텍셀)
  maskSample(x, z, out) {
    const m = this.buildGroundMask();
    const N = m.N;
    const fx = clamp((x + this.half) / m.mr - 0.5, 0, N - 1.001);
    const fz = clamp((z + this.half) / m.mr - 0.5, 0, N - 1.001);
    const i = fx | 0;
    const j = fz | 0;
    const tx = fx - i;
    const tz = fz - j;
    const k00 = (j * N + i) * 4;
    const k01 = k00 + N * 4;
    const A = m.A;
    const B = m.B;
    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;
    out.plowed = (A[k00] * w00 + A[k00 + 4] * w10 + A[k01] * w01 + A[k01 + 4] * w11) / 255;
    out.road = ((B[k00 + 1] * w00 + B[k00 + 5] * w10 + B[k01 + 1] * w01 + B[k01 + 5] * w11) / 255) * ROAD_RANGE;
    out.track = ((B[k00 + 2] * w00 + B[k00 + 6] * w10 + B[k01 + 2] * w01 + B[k01 + 6] * w11) / 255) * TRACK_RANGE;
    out.parcel = m.parcel[Math.round(fz) * N + Math.round(fx)];
    return out;
  }

  // 고랑 형상 세기 0..1 (셰이더의 fDepth 와 같은 식): 갈아엎은 흑토 비율, 바퀴·궤도 자국 밖, 구획 깊이 비율
  furrowWeight(x, z) {
    const s = this.maskSample(x, z, this._ms || (this._ms = {}));
    const P = s.parcel ? this.parcels[s.parcel] : null;
    if (!P || !P.depth) return 0;
    const T = CONFIG.terrain;
    const R = T.road;
    const rut = 1 - smoothstep(R.rutFlat * 0.7, R.rutFlat + R.rutWall * 0.55, Math.abs(s.road - R.rutOffset));
    const band = 1 - smoothstep(T.tracks.bandHalf * 0.55, T.tracks.bandHalf, s.track);
    return smoothstep(0.3, 0.75, s.plowed) * (1 - rut) * (1 - band) * (P.depth / T.furrow.depth);
  }

  // 렌더 지면을 평균면보다 내리는 양 (밭: 고랑 바닥 높이). 충돌·heightAt 은 평균면 그대로
  renderDrop(x, z) {
    if (!this.mask) return 0;
    // + 수로 라이닝 판 아래 (판이 덮는 곳만, 충돌·heightAt 은 비탈 그대로)
    return CONFIG.terrain.furrow.ridge.geomDepth * 0.5 * this.furrowWeight(x, z) + this.canalSlabDrop(x, z);
  }

  // 지형과 선분 충돌. 맞으면 out 에 t, point, normal 기록
  raycast(ax, ay, az, bx, by, bz, out) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return false;
    let prevT = 0;
    let prevAbove = ay - this.heightAt(ax, az);
    if (prevAbove < 0) {
      out.t = 0;
      out.x = ax;
      out.y = ay;
      out.z = az;
      return true;
    }
    const step = CONFIG.ballistics.terrainStep;
    const steps = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + dx * t;
      const y = ay + dy * t;
      const z = az + dz * t;
      const above = y - this.heightAt(x, z);
      if (above < 0) {
        // 이분 탐색으로 정밀화
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) * 0.5;
          const my = ay + dy * m;
          if (my - this.heightAt(ax + dx * m, az + dz * m) < 0) hi = m;
          else lo = m;
        }
        out.t = hi;
        out.x = ax + dx * hi;
        out.y = ay + dy * hi;
        out.z = az + dz * hi;
        return true;
      }
      prevT = t;
      prevAbove = above;
    }
    return false;
  }

  // ------------------------------------------------------------------ 생성
  generate() {
    const n = this.n;
    const half = this.half;
    const res = this.res;
    for (let j = 0; j < n; j++) {
      const z = -half + j * res;
      for (let i = 0; i < n; i++) {
        this.h[j * n + i] = this.baseHeight(-half + i * res, z);
      }
    }
    this.applyPads();
    this.buildCraterList();
    for (const c of this.craters) this.applyCrater(c);
    this.applyCanal();
    this.applyTrenches();
    this.applyMounds();
    this.applyRoads();
    this.applyTracks();
    this.applyRainPuddles();
    this.buildPuddleList();
    this.buildSurfaces();
  }

  stamp(x0, z0, x1, z1, fn) {
    const n = this.n;
    const i0 = Math.max(0, Math.floor((x0 + this.half) / this.res));
    const i1 = Math.min(n - 1, Math.ceil((x1 + this.half) / this.res));
    const j0 = Math.max(0, Math.floor((z0 + this.half) / this.res));
    const j1 = Math.min(n - 1, Math.ceil((z1 + this.half) / this.res));
    for (let j = j0; j <= j1; j++) {
      const z = -this.half + j * this.res;
      for (let i = i0; i <= i1; i++) {
        fn(-this.half + i * this.res, z, j * n + i);
      }
    }
  }

  stampSurf(x0, z0, x1, z1, fn) {
    const n = this.sn;
    const i0 = Math.max(0, Math.floor((x0 + this.half) / this.sres));
    const i1 = Math.min(n - 1, Math.ceil((x1 + this.half) / this.sres));
    const j0 = Math.max(0, Math.floor((z0 + this.half) / this.sres));
    const j1 = Math.min(n - 1, Math.ceil((z1 + this.half) / this.sres));
    for (let j = j0; j <= j1; j++) {
      const z = -this.half + j * this.sres;
      for (let i = i0; i <= i1; i++) {
        fn(-this.half + i * this.sres, z, j * n + i);
      }
    }
  }

  // 렌더 메시 해상도 지정: 근거리 resX·resZ, 원거리 LOD farX·farZ (기본: 근거리의 2.5배, 최대 2.5m)
  addDetail(x0, z0, x1, z1, resX, resZ = resX, farX = Math.min(2.5, resX * 2.5), farZ = Math.min(2.5, resZ * 2.5)) {
    this.detailRegions.push({ x0, z0, x1, z1, resX, resZ, farX, farZ });
  }

  // 건물 바닥 평탄화
  buildingFootprints() {
    const list = [];
    for (const b of MAP.barns) {
      const along = b.rot === 0;
      list.push({
        x: b.x,
        z: b.z,
        hx: (along ? b.length : b.width) / 2,
        hz: (along ? b.width : b.length) / 2,
      });
    }
    const g = MAP.garage;
    list.push({ x: g.x, z: g.z, hx: g.w / 2, hz: g.d / 2 });
    const s = MAP.silo;
    list.push({ x: s.x, z: s.z, hx: s.r + 2, hz: s.r + 2 });
    return list;
  }

  applyPads() {
    for (const f of this.footprints) {
      const target = this.baseHeight(f.x, f.z);
      const m = 3;
      f.floorY = target;
      this.stamp(f.x - f.hx - m, f.z - f.hz - m, f.x + f.hx + m, f.z + f.hz + m, (x, z, k) => {
        const ox = Math.max(0, Math.abs(x - f.x) - f.hx);
        const oz = Math.max(0, Math.abs(z - f.z) - f.hz);
        const d = Math.hypot(ox, oz);
        const w = 1 - smoothstep(0, m, d);
        this.h[k] += (target - this.h[k]) * w;
      });
    }
    // 차량 아래: 차체가 기울어 뜨지 않게 고른다 (진흙에 약간 박힌 모습은 구조물 쪽에서)
    const m = CONFIG.terrain.vehiclePadMargin;
    for (const v of this.vehiclePads) {
      const target = this.baseHeight(v.x, v.z);
      const e = Math.hypot(v.hx, v.hz) + m;
      this.addDetail(v.x - e, v.z - e, v.x + e, v.z + e, 1.25, 1.25, 2.5, 2.5);
      this.stamp(v.x - e, v.z - e, v.x + e, v.z + e, (x, z, k) => {
        const dx = x - v.x;
        const dz = z - v.z;
        const lx = dx * v.c - dz * v.s;
        const lz = dx * v.s + dz * v.c;
        const d = Math.hypot(Math.max(0, Math.abs(lx) - v.hx), Math.max(0, Math.abs(lz) - v.hz));
        const w = 1 - smoothstep(0, m, d);
        this.h[k] += (target - this.h[k]) * w;
      });
    }
  }

  // ------------------------------------------------------------------ 포탄 구덩이
  craterZonePoint(zone, rng) {
    if (zone.kind === 'rect') return [rng.range(zone.x0, zone.x1), rng.range(zone.z0, zone.z1)];
    if (zone.kind === 'ring') {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(zone.dist[0], zone.dist[1]);
      return [zone.x + Math.cos(a) * d, zone.z + Math.sin(a) * d];
    }
    // 농로를 따라: 길 위 임의 점에서 옆으로 dist 만큼
    const pts = MAP.roads[zone.road].points;
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(rng.next() * (pts.length - 1));
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const t = rng.next();
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      if (pz < zone.z0 || pz > zone.z1) continue;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const side = rng.chance(0.5) ? 1 : -1;
      const d = rng.range(zone.dist[0], zone.dist[1]) * side;
      return [px - ((bz - az) / len) * d, pz + ((bx - ax) / len) * d];
    }
    return [rng.range(-200, 200), rng.range(-80, 80)];
  }

  buildCraterList() {
    const C = CONFIG.terrain.craters;
    const rng = this.rng;
    for (const c of MAP.craters) {
      const cr = { ...c, fresh: !!c.fresh, seed: (c.x * 13.1 + c.z * 7.7) % 100 };
      // AI 사격 위치가 쓰는 지정 구덩이(F1·F2)는 형상을 그대로 둔다
      cr.legacy = !!c.tag;
      cr.rimH = c.tag ? 0.12 * c.d + 0.06 : clamp(0.12 * c.d + (cr.fresh ? 0.2 : 0.1), 0.2, 0.42);
      this.craters.push(cr);
    }
    const excl = MAP.craterExclusions;
    const fps = this.footprints;
    const roads = MAP.roads;
    const solids = [MAP.apc, MAP.tractor, ...MAP.cars, ...MAP.dugouts];
    const points = [...MAP.pylons, ...MAP.trees];
    const zones = MAP.craterZones || [{ kind: 'rect', x0: -235, x1: 235, z0: -215, z1: 90, weight: 1 }];
    let wsum = 0;
    for (const z of zones) wsum += z.weight;
    let tries = 0;
    let made = 0;
    while (made < C.count && tries < 8000) {
      tries++;
      let pick = rng.next() * wsum;
      let zone = zones[0];
      for (const zn of zones) {
        pick -= zn.weight;
        if (pick <= 0) {
          zone = zn;
          break;
        }
      }
      const [x, z] = this.craterZonePoint(zone, rng);
      let r = rng.chance(C.bigChance) ? rng.range(C.bigRadius[0], C.bigRadius[1]) : C.radius[0] + (C.radius[1] - C.radius[0]) * Math.pow(rng.next(), 1.6);
      const fresh = rng.chance(C.freshChance);
      const d = clamp(r * rng.range(0.3, 0.48) * (fresh ? 1 : 0.8), 0.45, 1.9);
      if (Math.abs(x) > this.half - r - 4 || Math.abs(z) > this.half - r - 4) continue;
      let ok = true;
      for (const e of excl) if (x > e.x0 - r && x < e.x1 + r && z > e.z0 - r && z < e.z1 + r) ok = false;
      for (const f of fps) if (Math.abs(x - f.x) < f.hx + r + 2 && Math.abs(z - f.z) < f.hz + r + 2) ok = false;
      for (const s of solids) if (Math.hypot(x - s.x, z - s.z) < r + 7) ok = false;
      for (const p of points) if (Math.hypot(x - p.x, z - p.z) < r + 3) ok = false;
      for (const c of this.craters) if (Math.hypot(x - c.x, z - c.z) < r + c.r + 1.0) ok = false;
      if (ok) {
        for (const rd of roads) if (polylineDistance(rd.points, x, z) < rd.width / 2 + r * 0.8 + 0.6) ok = false;
      }
      let nearLine = !!zone.front;
      if (ok) {
        for (const line of MAP.trench.lines) {
          const dl = polylineDistance(line, x, z);
          if (dl < r + 10) ok = false;
          if (dl < r + 40) nearLine = true;
        }
        for (const line of MAP.trench.commLines) if (polylineDistance(line, x, z) < r + 4) ok = false;
      }
      if (!ok) continue;
      if (z > 60 && z < 140) nearLine = true;
      let rimH = fresh ? rng.range(C.rimFresh[0], C.rimFresh[1]) * Math.pow(Math.min(1, r / 2), 0.35) : rng.range(C.rimOld[0], C.rimOld[1]);
      rimH = Math.max(0.2, rimH);
      if (nearLine) rimH = Math.min(rimH, C.rimMaxNearLines);
      this.craters.push({ x, z, r, d, fresh, rimH, seed: rng.next() * 100 });
      made++;
    }
  }

  // 분출물 방사 줄기 (0..1). 각도에 대해 주기적
  craterRay(c, a) {
    const s = c.seed;
    const v = 0.5 + 0.28 * Math.sin(a * 7 + s) + 0.16 * Math.sin(a * 13 + s * 1.7) + 0.1 * Math.sin(a * 23 + s * 2.3);
    return smoothstep(0.42, 0.85, v);
  }

  applyCrater(c) {
    const R = c.r;
    const D = c.d;
    if (c.legacy) {
      // 지정 구덩이: 이전 형상 그대로 (적 엎드려쏴 위치의 눈높이가 테두리 마루에 맞춰져 있다)
      const rimW = 0.55 * R;
      const rimH = c.rimH;
      const ext = R + rimW * 1.7;
      this.addDetail(c.x - ext, c.z - ext, c.x + ext, c.z + ext, 0.5, 0.5, 1.25, 1.25);
      this.stamp(c.x - ext, c.z - ext, c.x + ext, c.z + ext, (x, z, k) => {
        const r = Math.hypot(x - c.x, z - c.z);
        if (r > ext) return;
        let dh = 0;
        if (r < R) {
          const t = r / R;
          dh -= D * Math.pow(1 - t * t, 1.15);
        }
        const rr = (r - R) / (rimW * 0.6);
        dh += rimH * Math.exp(-rr * rr);
        dh += this.noise.noise(x * 0.9, z * 0.9) * 0.05 * (1 - r / ext);
        this.h[k] += dh;
      });
      return;
    }
    const fresh = c.fresh;
    const rimH = c.rimH;
    // 최근 구덩이: 좁고 날카로운 테두리 / 오래된 구덩이: 무뎌진 넓은 테두리와 메워진 평평한 바닥
    const rimW = Math.max(0.55 * R, 0.85) * (fresh ? 0.8 : 1.25);
    const ext = R + rimW * 1.9 + (fresh ? 0.6 * R : 0);
    this.addDetail(c.x - ext, c.z - ext, c.x + ext, c.z + ext, 0.5, 0.5, 1.25, 1.25);
    this.stamp(c.x - ext, c.z - ext, c.x + ext, c.z + ext, (x, z, k) => {
      const dx = x - c.x;
      const dz = z - c.z;
      const r0 = Math.hypot(dx, dz);
      if (r0 > ext) return;
      const a = Math.atan2(dz, dx);
      // 둥글지 않은 윤곽
      const Rw = R * (1 + 0.07 * Math.sin(a * 3 + c.seed) + 0.04 * Math.sin(a * 5 + c.seed * 2.1));
      const t = r0 / Rw;
      let dh = 0;
      if (t < 1) dh -= fresh ? D * Math.pow(1 - t * t, 1.1) : D * 0.95 * (1 - Math.pow(t, 2.6));
      const rr = (r0 - Rw * (fresh ? 1.0 : 1.04)) / (rimW * 0.6);
      dh += rimH * Math.exp(-rr * rr);
      if (fresh) {
        // 분출물 덮개: 줄기 방향으로 조금 더 두껍다
        const out = (r0 - Rw) / (R * 1.2);
        if (out > 0) dh += rimH * 0.22 * Math.exp(-out * out) * (0.5 + this.craterRay(c, a));
      }
      dh += this.noise.noise(x * 0.9, z * 0.9) * (fresh ? 0.07 : 0.04) * (1 - r0 / ext);
      this.h[k] += dh;
    });
  }

  applyCanal() {
    const C = MAP.canal;
    const half = 8.5; // 단면이 닿는 범위 (굽이 포함)
    this.buildCanalSlabs();
    // 수로는 동서로 길어 횡단면(z)만 촘촘하면 된다. 라이닝 구간(판 가장자리)·사격 홈·모래주머니 틈은 x 도 0.5m,
    // 라이닝 구간 횡단면은 0.25m (렌더 지면이 해석적 단면을 따른다, canalSlabDrop)
    this.addDetail(C.xMin, C.z - half, C.xMax, C.z + half, 1.0, 0.5);
    for (const [a, b] of C.linedSections) this.addDetail(a - 1, C.z - 4.2, b + 1, C.z + 4.2, 0.5, 0.25, 1.0, 0.5);
    for (const nx of [...C.notches.list, ...C.sandbagPositions]) this.addDetail(nx - 1.6, C.z - half, nx + 1.6, C.z - 1, 0.5, 0.5);
    this.stamp(C.xMin, C.z - half, C.xMax, C.z + half, (x, z, k) => {
      this.h[k] += this.canalDh(x, z);
    });
    // 수로 물웅덩이 구간
    for (const [a, b] of C.waterSections) {
      this.puddles.push({ type: 'canal', x0: a, x1: b });
    }
  }

  trenchProfile(line, T, withParapet) {
    const { x0, x1, z0, z1 } = bbox(line);
    const ext = T.topHalf + (withParapet ? T.parapet.width : 1.6) + 0.6;
    // 참호는 플레이어에게서 항상 100m 이상 떨어져 있어 렌더 메시는 참호를 따라가는 방향 1m 격자면 충분
    // (충돌·높이 질의는 0.5m 격자 그대로). 동서로 뻗은 참호선은 흉벽 단면(남북)을 0.5m 로 잡아 원거리 LOD 에서도
    // 흉벽 마루가 깎이지 않게 한다 (200m 밖에서 흉벽 앞면이 밝은 띠로 읽히도록)
    if (withParapet) this.addDetail(x0 - ext, z0 - ext, x1 + ext, z1 + ext, 1.0, 0.5, 1.0, 0.5);
    else this.addDetail(x0 - ext, z0 - ext, x1 + ext, z1 + ext, 1.0, 1.0, 1.25, 1.25);
    const tmp = this._tmp;
    this.stamp(x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
      const d = polylineDistance(line, x, z, tmp);
      if (d > ext) return;
      const front = tmp.side * tmp.nz > 0;
      let dh = 0;
      if (d <= T.floorHalf) dh = -T.depth;
      else if (d < T.topHalf) dh = -T.depth * (1 - (d - T.floorHalf) / (T.topHalf - T.floorHalf));
      if (withParapet) {
        if (front) dh += T.parapet.height * bump((d - T.topHalf * 0.85) / T.parapet.width, 0.33);
        else dh += T.parados.height * bump((d - T.topHalf * 0.85) / T.parados.width, 0.35);
      } else {
        dh += 0.15 * bump((d - T.topHalf * 0.85) / 1.6, 0.4);
      }
      // 흉벽 흙덩이 요철
      dh += this.noise.noise(x * 1.3, z * 1.3) * 0.04 * (d > T.topHalf ? 1 : 0);
      if (dh < 0) this.h[k] = Math.min(this.h[k], this.h[k] + dh);
      else this.h[k] += dh;
    });
  }

  // 흉벽 앞 완만한 내리막 (CONFIG.enemyPosition.glacis, baseHeight 에 더함): 참호선 앞쪽(남쪽, 플레이어 쪽)만 자연 지면을 조금 낮춰
  // 참호가 낮은 둔덕 마루에 있는 꼴로 만든다 → 수로에서 낮은 시선으로 보아도 흉벽 앞면이 앞쪽 구덩이 테두리·기복 위로 드러난다.
  // 흉벽(참호 앞 3.3m 안)·뒤쪽은 그대로. 경계 상자로 먼저 거른다 (높이 격자 생성 때 모든 점에서 불림)
  trenchGlacis(x, z) {
    const G = CONFIG.enemyPosition.glacis;
    if (!G || !(G.depth > 0)) return 0;
    if (!this.glacisLines) {
      this.glacisLines = MAP.trench.lines.map((line) => ({ line, ...bbox(line) }));
      this._gTmp = {};
    }
    let g = 0;
    for (const b of this.glacisLines) {
      if (x < b.x0 - G.endFade || x > b.x1 + G.endFade || z < b.z0 || z > b.z1 + G.rise[1]) continue;
      const d = polylineDistance(b.line, x, z, this._gTmp);
      if (d >= G.rise[1] || d <= G.fall[0] || this._gTmp.side * this._gTmp.nz <= 0) continue;
      const ends = 1 - smoothstep(0, G.endFade, Math.max(b.x0 - x, x - b.x1, 0));
      const v = -G.depth * smoothstep(G.fall[0], G.fall[1], d) * (1 - smoothstep(G.rise[0], G.rise[1], d)) * ends;
      if (v < g) g = v;
    }
    return g;
  }

  // 흉벽 앞면·마루 정점색 몫 (0..1, vertexColor 가 CONFIG.enemyPosition.crestTint 로 곱한다): 참호 가장자리 ~ 앞면 끝
  trenchCrestWeight(x, z) {
    const T = MAP.trench;
    if (!this.crestLines) {
      const ext = T.topHalf + T.parapet.width;
      this.crestLines = T.lines.map((line) => {
        const b = bbox(line);
        return { line, x0: b.x0 - ext, x1: b.x1 + ext, z0: b.z0 - ext, z1: b.z1 + ext };
      });
      this._cTmp = {};
    }
    const toe = T.topHalf * 0.85 + T.parapet.width;
    let w = 0;
    for (const b of this.crestLines) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      const d = polylineDistance(b.line, x, z, this._cTmp);
      if (d > toe || d < T.topHalf - 0.15 || this._cTmp.side * this._cTmp.nz <= 0) continue;
      w = Math.max(w, smoothstep(T.topHalf - 0.15, T.topHalf + 0.1, d) * (1 - smoothstep(toe - 1.0, toe, d)));
    }
    return w;
  }

  applyTrenches() {
    const T = MAP.trench;
    for (const line of T.lines) this.trenchProfile(line, T, true);
    const comm = { depth: T.commDepth, floorHalf: 0.4, topHalf: 0.75 };
    for (const line of T.commLines) this.trenchProfile(line, comm, false);
    // 엄체호: 통나무 지붕 위로 덮은 흙 둔덕
    for (const dgt of MAP.dugouts) {
      const ext = Math.max(dgt.w, dgt.d) * 0.5 + 1.8;
      this.addDetail(dgt.x - ext, dgt.z - ext, dgt.x + ext, dgt.z + ext, 1.0);
      const c = Math.cos(dgt.rot);
      const s = Math.sin(dgt.rot);
      this.stamp(dgt.x - ext, dgt.z - ext, dgt.x + ext, dgt.z + ext, (x, z, k) => {
        const lx = (x - dgt.x) * c - (z - dgt.z) * s;
        const lz = (x - dgt.x) * s + (z - dgt.z) * c;
        const ox = Math.max(0, Math.abs(lx) - dgt.w * 0.5 + 0.6);
        const oz = Math.max(0, Math.abs(lz) - dgt.d * 0.5 + 0.6);
        const dd = Math.hypot(ox, oz);
        const w = 1 - smoothstep(0, 1.6, dd);
        if (w > 0) this.h[k] = Math.max(this.h[k], this.baseHeight(dgt.x, dgt.z) + 0.85 * w);
      });
    }
  }

  applyMounds() {
    const mounds = [...MAP.rubbleMounds.map((m) => ({ ...m })), ...MAP.ruins.map((r) => ({ x: r.x, z: r.z, r: r.moundR, h: r.moundH }))];
    this.rubbleMounds = mounds;
    for (const m of mounds) {
      const ext = m.r + 0.5;
      this.addDetail(m.x - ext, m.z - ext, m.x + ext, m.z + ext, 1.0);
      this.stamp(m.x - ext, m.z - ext, m.x + ext, m.z + ext, (x, z, k) => {
        const r = Math.hypot(x - m.x, z - m.z) / m.r;
        if (r >= 1) return;
        const lump = 1 + 0.35 * this.noise.noise(x * 0.8, z * 0.8);
        this.h[k] += m.h * Math.pow(1 - r * r, 1.3) * lump;
      });
    }
  }

  // 농로: 주변보다 조금 꺼진 길, 가운데 솟음, 깊게 팬 두 줄 바퀴 자국, 길가 흙 턱과 배수로
  applyRoads() {
    const R = CONFIG.terrain.road;
    for (const rd of MAP.roads) {
      const { x0, x1, z0, z1 } = bbox(rd.points);
      const hw = rd.width / 2;
      const ext = hw + R.ditchOffset + R.ditchHalf + 1.2;
      this.addRoadDetail(rd.points, ext);
      this.stamp(x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
        const d = polylineDistance(rd.points, x, z);
        if (d > ext) return;
        // 수로 바로 위는 건드리지 않는다 (배수관 둑 위는 길만, 배수로는 없음)
        if (this.nearCanal(x, z)) return;
        let dh = 0;
        if (d < hw + 0.3) {
          const inner = 1 - smoothstep(hw - 0.2, hw + 0.3, d);
          dh -= R.sink * inner;
          dh += R.crown * (1 - Math.min(1, (d / hw) ** 2)) * inner;
          dh -= R.rutDepth * flatProfile(Math.abs(d - R.rutOffset), R.rutFlat, R.rutWall);
        }
        dh += 0.05 * bump((d - hw) / 0.7, 0.4);
        if (Math.abs(z - this.canalZ(x)) > 6) {
          const dd = Math.abs(d - (hw + R.ditchOffset));
          dh -= R.ditchDepth * flatProfile(dd, R.ditchHalf * 0.35, R.ditchHalf * 0.65);
          dh += 0.07 * bump((d - hw - R.ditchOffset - R.ditchHalf) / 1.1, 0.35);
        }
        this.h[k] += dh;
      });
    }
  }

  // 길 방향에 맞춘 렌더 해상도 (길을 가로지르는 방향만 0.5m)
  addRoadDetail(points, ext) {
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const ux = Math.abs((bx - ax) / len);
      const uz = Math.abs((bz - az) / len);
      const rx = ux < 0.42 ? 0.5 : uz < 0.42 ? 1.25 : 0.5;
      const rz = ux < 0.42 ? 1.25 : 0.5;
      const steps = Math.ceil(len / 3);
      for (let s = 0; s <= steps; s++) {
        const px = ax + ((bx - ax) * s) / steps;
        const pz = az + ((bz - az) * s) / steps;
        this.addDetail(px - ext, pz - ext, px + ext, pz + ext, rx, rz, 2.5, 2.5);
      }
    }
  }

  // 궤도 차량 자국: 두 줄의 얕은 띠 (지면 재질은 혼합 마스크에서)
  applyTracks() {
    const T = CONFIG.terrain.tracks;
    for (const tr of MAP.vehicleTracks || []) {
      const { x0, x1, z0, z1 } = bbox(tr.points);
      const half = tr.gauge / 2;
      const ext = half + T.bandHalf + 0.6;
      this.stamp(x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
        const d = polylineDistance(tr.points, x, z);
        if (d > ext || this.nearCanal(x, z, 7)) return;
        this.h[k] -= T.depth * flatProfile(Math.abs(d - half), T.bandHalf * 0.55, T.bandHalf * 0.6);
      });
    }
  }

  // ------------------------------------------------------------------ 빗물 웅덩이 (개활지의 얕은 우묵한 곳)
  // 사격 회랑(zone)에 무작위로, 수로 앞 띠(focus)에 더 모아 판다. 밭에서는 고랑 방향으로 길쭉하다.
  // 깊이 5~9cm 의 평평한 바닥 + 노이즈로 흔든 타원 윤곽. 지형을 낮추기만 하므로 사선은 그대로다.
  // 무작위 구덩이 배치(this.rng)와 다른 난수열을 써서 다른 배치가 바뀌지 않게 한다.
  applyRainPuddles() {
    const RP = CONFIG.terrain.rainPuddles;
    const R = CONFIG.terrain.road;
    const TB = CONFIG.terrain.tracks;
    const rng = new Random(CONFIG.world.seed + 57);
    const nz = this.noise;
    const list = (this.rainPuddles = []);
    if (!RP) return;
    const solids = [MAP.apc, MAP.tractor, ...MAP.cars, ...MAP.dugouts, ...MAP.pylons, ...MAP.trees].filter(Boolean);
    // 구덩이 금지 구역 중 수로 띠(테두리가 시야를 가릴까 봐 비운 곳)는 우묵한 웅덩이와 무관 → 적 사격 위치 앞만 피한다
    const excl = (MAP.craterExclusions || []).filter((e) => !(e.z0 < MAP.canal.z && e.z1 > MAP.canal.z));
    const fieldDir = (x, z) => {
      for (let p = 1; p < this.parcels.length; p++) {
        const P = this.parcels[p];
        if (P.kind !== 'stubble' && x > P.x0 + 2 && x < P.x1 - 2 && z > P.z0 + 2 && z < P.z1 - 2) return P;
      }
      return null;
    };
    const place = (zone, n) => {
      let made = 0;
      for (let tries = 0; made < n && tries < n * 80; tries++) {
        const x = rng.range(zone.x0, zone.x1);
        const z = rng.range(zone.z0, zone.z1);
        const r = rng.range(RP.radius[0], RP.radius[1]);
        const depth = rng.range(RP.depth[0], RP.depth[1]);
        const P = fieldDir(x, z);
        let len = r * rng.range(RP.stretch[0], RP.stretch[1]);
        const a = rng.next() * Math.PI;
        let ux = Math.cos(a);
        let uz = Math.sin(a);
        if (P) {
          // 밭: 고랑을 따라 길쭉한 물 고인 고랑 묶음
          len = Math.min(len * 1.6, 4.6);
          ux = P.dirX;
          uz = P.dirZ;
        }
        const ext = len + 1;
        if (Math.abs(x) > this.half - ext - 4 || Math.abs(z) > this.half - ext - 4) continue;
        if (z > this.canalZ(x) - RP.canalClear - ext) continue;
        let ok = true;
        for (const e of excl) if (x > e.x0 - ext && x < e.x1 + ext && z > e.z0 - ext && z < e.z1 + ext) ok = false;
        for (const f of this.footprints) if (Math.abs(x - f.x) < f.hx + ext + 3 && Math.abs(z - f.z) < f.hz + ext + 3) ok = false;
        for (const o of solids) if (Math.hypot(x - o.x, z - o.z) < ext + 5) ok = false;
        for (const c of this.craters) if (Math.hypot(x - c.x, z - c.z) < c.r * 1.6 + ext + RP.gap * 0.5) ok = false;
        for (const q of list) if (Math.hypot(x - q.x, z - q.z) < q.len + ext + RP.gap) ok = false;
        if (ok) {
          for (const rd of MAP.roads) if (polylineDistance(rd.points, x, z) < rd.width / 2 + R.ditchOffset + R.ditchHalf + ext + 0.5) ok = false;
          for (const tr of MAP.vehicleTracks || []) if (polylineDistance(tr.points, x, z) < tr.gauge / 2 + TB.bandHalf + ext + 0.5) ok = false;
          for (const line of MAP.trench.lines) if (polylineDistance(line, x, z) < ext + 14) ok = false;
        }
        if (!ok) continue;
        const seed = rng.next() * 100;
        // 둘레(가장 낮은 가장자리) 높이 → 물 높이는 그 바로 아래, 바닥은 수평 (비탈진 곳에선 높은 쪽을 조금 더 파고,
        // 그래도 남는 높은 쪽 바닥은 물 밖으로 드러난다)
        let rim = Infinity;
        for (let i = 0; i < 24; i++) {
          const aa = (i / 24) * Math.PI * 2;
          const lu = Math.cos(aa) * len * 1.2;
          const lv = Math.sin(aa) * r * 1.2;
          rim = Math.min(rim, this.heightAt(x + lu * ux - lv * uz, z + lu * uz + lv * ux));
        }
        const floorY = rim - depth;
        this.addDetail(x - ext, z - ext, x + ext, z + ext, 0.5, 0.5, 1.25, 1.25);
        this.stamp(x - ext, z - ext, x + ext, z + ext, (px, pz, k) => {
          const dx = px - x;
          const dz = pz - z;
          const u = (dx * ux + dz * uz) / len;
          const v = (-dx * uz + dz * ux) / r;
          const rho = Math.hypot(u, v) * (1 + 0.2 * nz.noise(px / 1.3 + seed, pz / 1.3 - seed));
          if (rho >= 1.12) return;
          const w = 1 - smoothstep(0.5, 1.12, rho);
          this.h[k] += Math.max(-depth * 2.2, Math.min(0, w * (floorY - this.h[k])));
        });
        list.push({ x, z, r, len, ux, uz, depth, seed, level: rim - RP.brim });
        made++;
      }
    };
    for (const f of RP.focus || []) place(f, f.count);
    place(RP.zone, RP.count);
  }

  // 물웅덩이: 수로 물 구간, 구덩이 바닥, 빗물 웅덩이, 바퀴 자국·궤도 자국 (모두 평평한 수면).
  // 원판형(구덩이·빗물)은 중심에서 방사선마다 지형이 수면보다 높아지는 거리(rays)를 재 두고, 렌더 메시는
  // 그 윤곽 + 지형 속으로 들어가는 여유 테로 만든다 (물가 선 = 지형과 수면이 만나는 곳, 얕은 곳은 셰이더가 투명하게)
  buildPuddleList() {
    const C = CONFIG.terrain.craters;
    for (const c of this.craters) {
      const bottom = this.heightAt(c.x, c.z);
      // 수로 앞(적이 뛰어들지 않는 곳)의 오래된 구덩이: 물이 테두리 마루 바로 아래까지
      if (!c.fresh && !c.legacy && c.z > C.frontWaterZ && c.d >= C.frontWaterMinDepth) {
        let crest = Infinity;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          let best = -Infinity;
          for (let f = 0.85; f <= 1.6; f += 0.05) best = Math.max(best, this.heightAt(c.x + Math.cos(a) * c.r * f, c.z + Math.sin(a) * c.r * f));
          crest = Math.min(crest, best);
        }
        const level = Math.max(bottom + 0.12, crest - C.frontWaterBelowRim);
        c.water = true;
        this.puddles.push({ type: 'disc', x: c.x, z: c.z, level, rmax: c.r * 1.5, rays: null, crater: c });
        continue;
      }
      if (c.d < (c.fresh ? 1.25 : C.waterMinDepth)) continue;
      c.water = true;
      this.puddles.push({ type: 'disc', x: c.x, z: c.z, level: bottom + c.d * (c.fresh ? 0.12 : 0.2), rmax: c.r * 1.2, rays: null, crater: c });
    }
    for (const q of this.rainPuddles || []) {
      this.puddles.push({ type: 'disc', x: q.x, z: q.z, level: q.level, rmax: q.len * 1.6, rays: null, rain: q });
    }
    for (const p of this.puddles) if (p.type === 'disc') this.puddleRays(p, p.rain ? 20 : C.waterRays);
    const R = CONFIG.terrain.road;
    const rng = new Random(CONFIG.world.seed + 31);
    for (const rd of MAP.roads) {
      const pts = rd.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        for (let s = 1.5; s < len - 1.5; s += R.puddleEvery * rng.range(0.6, 1.4)) {
          if (!rng.chance(R.puddleChance)) continue;
          const L = rng.range(2.5, 9);
          const across = rng.chance(0.15);
          const sides = across ? [-1, 1] : [rng.chance(0.5) ? 1 : -1];
          for (const sd of sides) {
            const line = [];
            let minB = Infinity;
            let bad = false;
            for (let q = 0; q <= L; q += 0.5) {
              const px = ax + ux * Math.min(len, s + q) - uz * sd * R.rutOffset;
              const pz = az + uz * Math.min(len, s + q) + ux * sd * R.rutOffset;
              if (this.nearCanal(px, pz, 7) || Math.abs(px) > this.half - 2 || Math.abs(pz) > this.half - 2) bad = true;
              minB = Math.min(minB, this.heightAt(px, pz));
              line.push([px, pz]);
            }
            if (bad || line.length < 3) continue;
            this.puddles.push({ type: 'strip', pts: line, hw: R.rutFlat + R.rutWall * 0.75, level: minB + rng.range(0.05, 0.1) });
          }
        }
      }
    }
    // 궤도 차량 자국: 눌린 띠 바닥에 군데군데 고인 물 (자국이 개활지를 가로지르는 선으로 읽히게)
    const TB = CONFIG.terrain.tracks;
    const trng = new Random(CONFIG.world.seed + 43);
    for (const tr of MAP.vehicleTracks || []) {
      const pts = tr.points;
      const half = tr.gauge / 2;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        for (let s = 1; s < len - 1; s += TB.puddleEvery * trng.range(0.6, 1.4)) {
          if (!trng.chance(TB.puddleChance)) continue;
          const L = trng.range(2, 7);
          const sides = trng.chance(0.3) ? [-1, 1] : [trng.chance(0.5) ? 1 : -1];
          for (const sd of sides) {
            const line = [];
            let minB = Infinity;
            let bad = false;
            for (let q = 0; q <= L; q += 0.5) {
              const px = ax + ux * Math.min(len, s + q) - uz * sd * half;
              const pz = az + uz * Math.min(len, s + q) + ux * sd * half;
              if (this.nearCanal(px, pz, 8) || Math.abs(px) > this.half - 2 || Math.abs(pz) > this.half - 2) bad = true;
              minB = Math.min(minB, this.heightAt(px, pz));
              line.push([px, pz]);
            }
            if (bad || line.length < 3) continue;
            this.puddles.push({ type: 'strip', pts: line, hw: TB.bandHalf * 0.7, level: minB + trng.range(0.03, 0.06) });
          }
        }
      }
    }
  }

  // 원판형 물웅덩이 윤곽: 방사선 n 개마다 중심에서 지형이 수면보다 높아지는 거리 (m)
  puddleRays(p, n) {
    const rays = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let r = 0.1;
      while (r < p.rmax && this.heightAt(p.x + ca * r, p.z + sa * r) < p.level + 0.01) r += 0.1;
      rays[i] = r;
    }
    p.rays = rays;
  }

  // 원판형 물웅덩이 윤곽 반지름 (각도 a 에서 보간)
  puddleRadiusAt(p, a) {
    const n = p.rays.length;
    let f = ((a / (Math.PI * 2)) % 1) * n;
    if (f < 0) f += n;
    const i = Math.floor(f) % n;
    const t = f - Math.floor(f);
    return p.rays[i] * (1 - t) + p.rays[(i + 1) % n] * t;
  }

  // ------------------------------------------------------------------ 지면 종류 (발소리·탄착·이동)
  buildSurfaces() {
    const sn = this.sn;
    const half = this.half;
    const sres = this.sres;
    const nz = this.noise;
    const P = this.parcels;
    const fy = MAP.fields.farmYard;
    const kindSurf = { plowed: SID.plowed, sunflower: SID.sunflower, stubble: SID.grass };
    for (let j = 0; j < sn; j++) {
      const z = -half + j * sres;
      for (let i = 0; i < sn; i++) {
        const x = -half + i * sres;
        let s = SID.grass;
        const edge = nz.noise(x / 9, z / 9) * 2.5;
        for (let p = 1; p < P.length; p++) {
          const r = P[p];
          if (x > r.x0 + edge && x < r.x1 - edge && z > r.z0 + edge && z < r.z1 - edge) s = kindSurf[r.kind];
        }
        if (x > fy.x0 + edge && x < fy.x1 - edge && z > fy.z0 + edge && z < fy.z1 - edge) {
          const v = nz.noise(x / 17 + 5, z / 17 - 2);
          s = v > 0.55 ? SID.rubble : v < -0.12 ? SID.grass : SID.road;
        }
        this.surf[j * sn + i] = s;
      }
    }
    const tmp = this._tmp;
    const R = CONFIG.terrain.road;
    // 도로·배수로
    for (const rd of MAP.roads) {
      const hw = rd.width / 2 + 0.25;
      this.forPolylineSurf(rd.points, hw + R.ditchOffset + R.ditchHalf, (x, z, k, d) => {
        if (d < hw) this.surf[k] = SID.road;
        else if (Math.abs(d - (rd.width / 2 + R.ditchOffset)) < R.ditchHalf * 0.7 && Math.abs(z - this.canalZ(x)) > 6) this.surf[k] = SID.wetMud;
      });
    }
    // 수로: 바닥 = 진흙(물 구간은 물), 비탈 = 진흙, 라이닝 판 = 콘크리트, 북쪽 사격 발판 = 파낸 흙(참호), 둔덕 = 하층토
    // (식생은 이 지면 종류로 배치를 거른다: 진흙·물·콘크리트·참호 위에는 풀이 나지 않는다)
    const C = MAP.canal;
    const benchIn = this.canalBenchInner();
    this.stampSurf(C.xMin, C.z - 8, C.xMax, C.z + 8, (x, z, k) => {
      if (Math.abs(x - C.crossing.x) < C.crossing.halfWidth) return;
      const dn = this.canalZ(x) - z;
      const d = Math.abs(dn);
      const lined = this.isCanalLined(x);
      if (d <= C.floorHalf) {
        let wet = false;
        for (const [a, b] of C.waterSections) if (x >= a && x <= b) wet = true;
        this.surf[k] = wet && d < C.floorHalf * 0.9 ? SID.water : SID.wetMud;
      } else if (lined && d <= this.slabBand[1]) {
        const slab = this.canalSlabAt(x, dn > 0 ? 1 : -1);
        this.surf[k] = slab && slab.kind !== 'missing' ? SID.concrete : SID.wetMud;
      } else if (dn > 0 && !lined && d > benchIn - 0.1 && d <= C.bench.outer + 0.15) this.surf[k] = SID.trench;
      else if (d < C.topHalf) this.surf[k] = SID.wetMud;
      else if (dn > 0 && d > C.bench.outer && d < C.bench.outer + C.berm.face + 1.6) this.surf[k] = SID.subsoil; // 파낸 흙 둔덕
    });
    // 참호: 바닥·벽은 참호, 흉벽·후벽은 파낸 하층토
    const T = MAP.trench;
    for (const line of T.lines) {
      this.forPolylineSurf(line, T.topHalf + T.parapet.width, (x, z, k, d) => {
        polylineDistance(line, x, z, tmp);
        const front = tmp.side * tmp.nz > 0;
        if (d < T.topHalf + 0.2) this.surf[k] = SID.trench;
        else if (d < T.topHalf + (front ? T.parapet.width * 0.85 : 1.2)) this.surf[k] = SID.subsoil;
      });
    }
    for (const line of T.commLines) {
      this.forPolylineSurf(line, 2, (x, z, k, d) => {
        if (d < 0.95) this.surf[k] = SID.trench;
        else if (d < 1.8) this.surf[k] = SID.subsoil;
      });
    }
    // 구덩이: 안쪽 = 구덩이, 최근 구덩이 분출물 = 하층토, 깊은 바닥 = 물
    for (const c of this.craters) {
      const ext = c.r * (c.fresh ? 1.7 : 1.25);
      this.stampSurf(c.x - ext, c.z - ext, c.x + ext, c.z + ext, (x, z, k) => {
        const r = Math.hypot(x - c.x, z - c.z);
        if (r < c.r * (1.08 + nz.noise(x, z) * 0.12)) this.surf[k] = SID.crater;
        else if (c.fresh && r < c.r * 1.6 && this.craterRay(c, Math.atan2(z - c.z, x - c.x)) > 0.35) this.surf[k] = SID.subsoil;
      });
    }
    // 고인 물 (구덩이·빗물 웅덩이): 수심 4cm 넘는 곳 = 물 (발소리·탄착 물보라, 풀·잔해가 나지 않는다)
    for (const p of this.puddles) {
      if (p.type !== 'disc' || !p.rays) continue;
      const e = p.rmax;
      this.stampSurf(p.x - e, p.z - e, p.x + e, p.z + e, (x, z, k) => {
        const r = Math.hypot(x - p.x, z - p.z);
        if (r < this.puddleRadiusAt(p, Math.atan2(z - p.z, x - p.x)) - 0.15 && this.heightAt(x, z) < p.level - 0.04) this.surf[k] = SID.water;
      });
    }
    for (const m of this.rubbleMounds) {
      this.stampSurf(m.x - m.r, m.z - m.r, m.x + m.r, m.z + m.r, (x, z, k) => {
        if (Math.hypot(x - m.x, z - m.z) < m.r * 0.95) this.surf[k] = SID.rubble;
      });
    }
    for (const dgt of MAP.dugouts) {
      const e = Math.max(dgt.w, dgt.d) * 0.5 + 0.8;
      this.stampSurf(dgt.x - e, dgt.z - e, dgt.x + e, dgt.z + e, (x, z, k) => {
        this.surf[k] = SID.subsoil;
      });
    }
    for (const f of this.footprints) {
      this.stampSurf(f.x - f.hx + 0.6, f.z - f.hz + 0.6, f.x + f.hx - 0.6, f.z + f.hz - 0.6, (x, z, k) => {
        this.surf[k] = SID.concrete;
      });
    }
  }

  forPolylineSurf(points, ext, fn) {
    const { x0, x1, z0, z1 } = bbox(points);
    this.stampSurf(x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
      const d = polylineDistance(points, x, z);
      if (d <= ext) fn(x, z, k, d);
    });
  }

  // ------------------------------------------------------------------ 지면 재질 혼합 마스크 (렌더·식생용, 0.5m)
  // 채널 A = (흑토, 그루터기, 진흙, 하층토), B = (자갈길, 길 중심 거리, 궤도 띠 거리, 밭 구획 번호). 풀 = 나머지.
  buildGroundMask() {
    if (this.mask) return this.mask;
    const mr = CONFIG.ground.maskRes;
    const N = Math.round((2 * this.half) / mr);
    const m = {
      N,
      mr,
      W: new Float32Array(N * N * 5),
      road: new Float32Array(N * N).fill(ROAD_RANGE),
      track: new Float32Array(N * N).fill(TRACK_RANGE),
      parcel: new Uint8Array(N * N),
    };
    this.mask = m;
    this.paintBase(m);
    this.paintFields(m);
    this.paintRoads(m);
    this.paintTracks(m);
    this.paintCanal(m);
    this.paintTrenches(m);
    this.paintCraters(m);
    this.paintPuddles(m);
    this.paintObjects(m);
    // 8비트로 묶기
    const A = new Uint8Array(N * N * 4);
    const B = new Uint8Array(N * N * 4);
    const W = m.W;
    for (let k = 0; k < N * N; k++) {
      const b = k * 5;
      const o = k * 4;
      A[o] = clamp(W[b] * 255 + 0.5, 0, 255);
      A[o + 1] = clamp(W[b + 1] * 255 + 0.5, 0, 255);
      A[o + 2] = clamp(W[b + 2] * 255 + 0.5, 0, 255);
      A[o + 3] = clamp(W[b + 3] * 255 + 0.5, 0, 255);
      B[o] = clamp(W[b + 4] * 255 + 0.5, 0, 255);
      B[o + 1] = clamp((m.road[k] / ROAD_RANGE) * 255 + 0.5, 0, 255);
      B[o + 2] = clamp((m.track[k] / TRACK_RANGE) * 255 + 0.5, 0, 255);
      B[o + 3] = m.parcel[k];
    }
    m.A = A;
    m.B = B;
    m.W = null;
    return m;
  }

  // 재질 mat 을 불투명도 a 로 덧칠 (다른 재질은 (1-a) 배)
  paint(m, k, mat, a) {
    if (a <= 0.001) return;
    if (a > 1) a = 1;
    const W = m.W;
    const b = k * 5;
    const keep = 1 - a;
    W[b] *= keep;
    W[b + 1] *= keep;
    W[b + 2] *= keep;
    W[b + 3] *= keep;
    W[b + 4] *= keep;
    if (mat >= 0) W[b + mat] += a;
  }

  maskStamp(m, x0, z0, x1, z1, fn) {
    const { N, mr } = m;
    const half = this.half;
    const i0 = Math.max(0, Math.floor((x0 + half) / mr - 0.5));
    const i1 = Math.min(N - 1, Math.ceil((x1 + half) / mr - 0.5));
    const j0 = Math.max(0, Math.floor((z0 + half) / mr - 0.5));
    const j1 = Math.min(N - 1, Math.ceil((z1 + half) / mr - 0.5));
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * mr;
      for (let i = i0; i <= i1; i++) fn(-half + (i + 0.5) * mr, z, j * N + i);
    }
  }

  // 바탕: 마른 풀밭 + 드러난 흙 얼룩 + 낮은 곳 진흙
  paintBase(m) {
    const nz = this.noise;
    const U = CONFIG.terrain.undulation;
    this.maskStamp(m, -this.half, -this.half, this.half, this.half, (x, z, k) => {
      const n1 = nz.noise(x / 27 + 5, z / 27 - 8) + 0.35 * nz.noise(x / 6 - 3, z / 6 + 1);
      this.paint(m, k, GM.plowed, smoothstep(0.5, 0.85, n1) * 0.45);
      const low = nz.noise(x / U.large.size + 31.7, z / U.large.size - 12.3);
      this.paint(m, k, GM.mud, smoothstep(-0.35, -0.65, low + 0.2 * nz.noise(x / 9, z / 9)) * 0.3);
    });
  }

  paintFields(m) {
    const nz = this.noise;
    const U = CONFIG.terrain.undulation;
    for (let p = 1; p < this.parcels.length; p++) {
      const P = this.parcels[p];
      this.maskStamp(m, P.x0 - 4, P.z0 - 4, P.x1 + 4, P.z1 + 4, (x, z, k) => {
        const edge = nz.noise(x / 9 + p * 13.7, z / 9 - p * 3.1) * 2.5 + nz.noise(x / 2.3, z / 2.3) * 0.6;
        const inside = Math.min(x - P.x0, P.x1 - x, z - P.z0, P.z1 - z) + edge;
        const a = smoothstep(-0.6, 1.0, inside);
        if (a <= 0) return;
        if (a > 0.5) m.parcel[k] = p;
        if (P.kind === 'stubble') {
          this.paint(m, k, GM.stubble, a * 0.95);
          this.paint(m, k, GM.grass, a * smoothstep(0.35, 0.8, nz.noise(x / 11 + 3, z / 11 - 7)) * 0.55);
          this.paint(m, k, GM.plowed, a * smoothstep(0.55, 0.9, nz.noise(x / 7 - 9, z / 7 + 2)) * 0.35);
          return;
        }
        this.paint(m, k, GM.plowed, a);
        // 잡초 얼룩 (해바라기밭은 더 많이), 밭 가장자리(머리 땅)는 풀이 섞임
        const weeds = P.kind === 'sunflower' ? 0.3 : 0.12;
        this.paint(m, k, GM.grass, a * (weeds + smoothstep(0.5, 0.85, nz.noise(x / 6.5 + p, z / 6.5)) * 0.45));
        this.paint(m, k, GM.grass, a * (1 - smoothstep(1.5, 5, inside)) * 0.4);
        // 젖은 저지대: 고랑에 물이 고인다 (셰이더에서 진흙 비율이 높은 밭 = 물)
        const low = nz.noise(x / U.large.size + 31.7, z / U.large.size - 12.3) + 0.25 * nz.noise(x / 8 + 2, z / 8 - 6);
        this.paint(m, k, GM.mud, a * smoothstep(-0.25, -0.55, low) * 0.7);
      });
    }
    // 집단농장 마당: 자갈·벽돌 부스러기 / 짓밟힌 진흙 / 풀
    const fy = MAP.fields.farmYard;
    this.maskStamp(m, fy.x0 - 4, fy.z0 - 4, fy.x1 + 4, fy.z1 + 4, (x, z, k) => {
      const edge = nz.noise(x / 9, z / 9) * 2.5;
      const inside = Math.min(x - fy.x0, fy.x1 - x, z - fy.z0, fy.z1 - z) + edge;
      const a = smoothstep(-0.6, 1.2, inside);
      if (a <= 0) return;
      const v = nz.noise(x / 17 + 5, z / 17 - 2) + 0.2 * nz.noise(x / 4, z / 4);
      this.paint(m, k, GM.gravel, a * smoothstep(0.1, 0.55, v) * 0.85);
      this.paint(m, k, GM.mud, a * smoothstep(-0.25, 0.1, v) * (1 - smoothstep(0.1, 0.5, v)) * 0.55);
    });
    for (const f of this.footprints) {
      this.maskStamp(m, f.x - f.hx - 2, f.z - f.hz - 2, f.x + f.hx + 2, f.z + f.hz + 2, (x, z, k) => {
        const d = Math.hypot(Math.max(0, Math.abs(x - f.x) - f.hx), Math.max(0, Math.abs(z - f.z) - f.hz));
        this.paint(m, k, GM.gravel, (1 - smoothstep(0, 1.8, d + nz.noise(x / 2, z / 2) * 0.5)) * 0.9);
      });
    }
  }

  paintRoads(m) {
    const R = CONFIG.terrain.road;
    const nz = this.noise;
    for (const rd of MAP.roads) {
      const { x0, x1, z0, z1 } = bbox(rd.points);
      const hw = rd.width / 2;
      const ext = Math.min(ROAD_RANGE, hw + R.ditchOffset + R.ditchHalf + 1.6);
      this.maskStamp(m, x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
        const d = polylineDistance(rd.points, x, z);
        if (d > ext) return;
        const onCanal = this.nearCanal(x, z);
        if (!onCanal) m.road[k] = Math.min(m.road[k], d);
        const e = nz.noise(x / 1.7, z / 1.7) * 0.25;
        // 자갈 섞인 흙길 (바퀴 자국 진흙은 셰이더에서 길 중심 거리로 날카롭게)
        this.paint(m, k, GM.gravel, (1 - smoothstep(hw - 0.35, hw + 0.2, d + e)) * 0.92);
        this.paint(m, k, GM.mud, (1 - smoothstep(0.1, 0.45, Math.abs(d - R.rutOffset))) * 0.4);
        // 길가 풀 (밭이 길까지 갈려 있지 않게)
        const verge = smoothstep(hw, hw + 0.4, d) * (1 - smoothstep(hw + R.ditchOffset + R.ditchHalf + 0.4, ext, d));
        this.paint(m, k, GM.grass, verge * 0.75);
        if (!onCanal && Math.abs(z - this.canalZ(x)) > 6) {
          const dd = Math.abs(d - (hw + R.ditchOffset));
          this.paint(m, k, GM.mud, (1 - smoothstep(R.ditchHalf * 0.35, R.ditchHalf, dd + e)) * 0.85);
        }
      });
    }
  }

  paintTracks(m) {
    const T = CONFIG.terrain.tracks;
    for (const tr of MAP.vehicleTracks || []) {
      const { x0, x1, z0, z1 } = bbox(tr.points);
      const half = tr.gauge / 2;
      const ext = half + TRACK_RANGE;
      this.maskStamp(m, x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
        if (this.nearCanal(x, z, 7)) return;
        const d = polylineDistance(tr.points, x, z);
        const bd = Math.abs(d - half);
        if (bd < m.track[k]) m.track[k] = bd;
        // 눌린 띠 = 젖은 진흙 (셰이더가 띠 거리장으로 날카롭게 더 칠한다), 띠 사이·바깥으로 밀려난 흙은 옅게
        this.paint(m, k, GM.mud, (1 - smoothstep(T.bandHalf * 0.5, T.bandHalf * 1.7, bd)) * T.mud * 0.6);
        this.paint(m, k, GM.mud, (1 - smoothstep(0.3, 1.0, d / half)) * 0.18);
      });
    }
  }

  // 수로: 단면 구역별로 칠한다 — 바닥·아래 비탈 = 젖은 진흙, 위 비탈 = 마른 풀 + 흙, 사격 발판 = 짓밟힌 흙,
  // 둔덕 = 파낸 흙(어두운 흙덩이 + 밝은 하층토, 뒤쪽은 풀이 덮음), 사격 홈 = 새로 파낸 하층토, 빠진 판 자리 = 드러난 흙
  paintCanal(m) {
    const C = MAP.canal;
    const nz = this.noise;
    const benchIn = this.canalBenchInner();
    this.maskStamp(m, C.xMin, C.z - 9, C.xMax, C.z + 9, (x, z, k) => {
      if (Math.abs(x - C.crossing.x) < C.crossing.halfWidth + 1.2) {
        // 배수관 둑: 예전처럼 실제로 낮은 곳만 진흙
        const below = this.baseHeight(x, z) - this.heightAt(x, z);
        if (below > 0.15) this.paint(m, k, GM.mud, smoothstep(0.35, 0.9, below) * 0.8);
        return;
      }
      const dn = this.canalZ(x) - z;
      const d = Math.abs(dn);
      if (d > 7.6) return;
      const lined = this.isCanalLined(x);
      const n = nz.noise(x / 3, z / 3);
      const benchZone = dn > 0 && !lined && d > benchIn - 0.15;
      if (d < C.topHalf + 0.1 && !benchZone) {
        const wet = 1 - smoothstep(C.floorHalf - 0.1, C.floorHalf + 0.9 + 0.3 * n, d);
        this.paint(m, k, GM.grass, smoothstep(C.floorHalf + 0.4, C.topHalf, d + 0.3 * n) * 0.6);
        this.paint(m, k, GM.plowed, (1 - wet) * smoothstep(0.2, 0.75, nz.noise(x / 1.7 + 3, z / 1.7)) * 0.45);
        this.paint(m, k, GM.mud, wet * (0.82 + 0.15 * n));
        if (lined && d > this.slabBand[0] && d < this.slabBand[1]) {
          const slab = this.canalSlabAt(x, dn > 0 ? 1 : -1);
          if (slab && slab.kind === 'missing') {
            this.paint(m, k, GM.subsoil, 0.45 + 0.2 * n);
            this.paint(m, k, GM.mud, 0.35);
          }
        }
        return;
      }
      if (dn < 0) return; // 남쪽 둑 너머는 바탕 풀밭
      if (benchZone && d <= C.bench.outer + 0.1) {
        // 사격 발판: 짓밟힌 젖은 흙
        this.paint(m, k, GM.plowed, 0.55);
        this.paint(m, k, GM.mud, 0.45 + 0.2 * n);
        return;
      }
      // 둔덕 (발판 바깥 끝 → 뒤쪽 끝 t = 0..1). 파낸 흙 = 흑토 흙덩이와 하층토가 섞인 것: 두 재질을 비슷한 비율로 칠해
      // 셰이더의 높이 기반 혼합이 흙덩이 사이사이로 섞이게 한다 (하층토만 칠하면 밝은 얼룩 무늬가 시작 화면 아래쪽을 채운다).
      // 마루와 뒤쪽은 마른 풀이 군데군데 덮는다 (BP = CONFIG.canal.bermPaint). 가파른 앞면 중간에 재질 경계(예: 아래쪽 진흙 띠)를
      // 두지 않는다 — 0.5m 마스크 격자의 보간 경계가 가파른 면에서 세로로 늘어나 물결무늬 띠가 된다 (진흙은 발판에서 칠한다)
      const BP = CONFIG.canal.bermPaint;
      const t = (d - C.bench.outer) / (C.berm.face + C.berm.back);
      if (t > 1.15) return;
      const tc = C.berm.face / (C.berm.face + C.berm.back); // 마루
      const spoil = 1 - smoothstep(0.4, 1.0, t + n * 0.15);
      // 흙덩이·하층토 비율: 잘게(1m 안팎) 섞는다 — 큰 얼룩이면 둔덕 앞면에 그림자 같은 어두운 덩어리가 생긴다
      const nc = 0.65 * nz.noise(x / 0.85 + 7, z / 0.85) + 0.35 * nz.noise(x / 2.4 - 2, z / 2.4 + 5);
      this.paint(m, k, GM.plowed, spoil * BP.clods);
      this.paint(m, k, GM.subsoil, spoil * (BP.subsoil[0] + (BP.subsoil[1] - BP.subsoil[0]) * smoothstep(-0.35, 0.45, nc)));
      const ng = nz.noise(x / 2.6, z / 2.6 + 4) + 0.5 * nz.noise(x / 0.9 - 3, z / 0.9);
      this.paint(m, k, GM.grass, smoothstep(tc * 0.75, tc + 0.3, t + 0.12 * ng) * (BP.grass[0] + (BP.grass[1] - BP.grass[0]) * smoothstep(-0.3, 0.4, ng)));
      // 사격 홈: 새로 파낸 하층토
      const wN = this.canalNotchWeight(x);
      if (wN > 0 && t < 0.75) this.paint(m, k, GM.subsoil, wN * 0.65);
    });
  }

  paintTrenches(m) {
    const T = MAP.trench;
    const E = CONFIG.enemyPosition.spoil;
    const nz = this.noise;
    const tmp = {};
    for (const line of T.lines) {
      const { x0, x1, z0, z1 } = bbox(line);
      const ext = T.topHalf + T.parapet.width + E.apron + 1.5;
      this.maskStamp(m, x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
        const d = polylineDistance(line, x, z, tmp);
        if (d > ext) return;
        const front = tmp.side * tmp.nz > 0;
        const n = nz.noise(x / 3.1, z / 3.1);
        if (d < T.floorHalf + 0.1) {
          this.paint(m, k, GM.mud, 0.9);
          return;
        }
        const wallW = front ? T.parapet.width : T.parados.width * 0.9;
        const t = (d - T.topHalf * 0.85) / wallW;
        // 흉벽: 주변 흑토보다 밝은 황갈색 띠 (200m 에서 참호선이 읽히게). 앞면·마루는 갓 파낸 하층토,
        // 그 앞으로 흩뿌려진 흙이 얼룩덜룩하게 apron m 까지 옅어진다 (먼 곳에서 마스크 밉맵이 띠를 주변과 섞어도 밝게 남도록 넓게)
        let sub;
        if (d < T.topHalf) sub = 0.85;
        else if (front) {
          const wall = 1 - smoothstep(0.85, 1.25, t + n * 0.12);
          const out = d - (T.topHalf * 0.85 + wallW);
          const patch = smoothstep(-0.3, 0.35, nz.noise(x / E.patch + 11.3, z / E.patch - 5.1) + 0.3 * nz.noise(x / 0.9 + 2, z / 0.9 + 7));
          const apron = (1 - smoothstep(E.apron * 0.3, E.apron, out + n * 1.6)) * E.strength * (0.4 + 0.6 * patch);
          sub = Math.max(wall * E.crest, apron);
        } else sub = (1 - smoothstep(0.75, 1.15, t + n * 0.12)) * E.parados;
        this.paint(m, k, GM.subsoil, sub);
        // 풀 덩이: 후벽과 흉벽 앞 흙 얼룩 사이에만 (흉벽 앞면·마루는 갓 파낸 흙)
        if (d > T.topHalf && (!front || t > 0.95)) this.paint(m, k, GM.grass, smoothstep(0.55, 0.9, nz.noise(x / 1.6 + 3, z / 1.6)) * 0.45 * (1 - sub));
      });
    }
    for (const line of T.commLines) {
      const { x0, x1, z0, z1 } = bbox(line);
      this.maskStamp(m, x0 - 3, z0 - 3, x1 + 3, z1 + 3, (x, z, k) => {
        const d = polylineDistance(line, x, z);
        if (d < 0.5) this.paint(m, k, GM.mud, 0.85);
        else this.paint(m, k, GM.subsoil, (1 - smoothstep(1.3, 2.4, d)) * 0.7);
      });
    }
    for (const dgt of MAP.dugouts) {
      const e = Math.max(dgt.w, dgt.d) * 0.5 + 2;
      this.maskStamp(m, dgt.x - e, dgt.z - e, dgt.x + e, dgt.z + e, (x, z, k) => {
        const r = Math.hypot(x - dgt.x, z - dgt.z) / e;
        this.paint(m, k, GM.subsoil, (1 - smoothstep(0.6, 1.0, r)) * (0.45 + 0.25 * nz.noise(x / 2, z / 2)));
      });
    }
    for (const mo of this.rubbleMounds) {
      const e = mo.r + 1.5;
      this.maskStamp(m, mo.x - e, mo.z - e, mo.x + e, mo.z + e, (x, z, k) => {
        const r = Math.hypot(x - mo.x, z - mo.z);
        this.paint(m, k, GM.gravel, (1 - smoothstep(mo.r * 0.7, e, r)) * 0.85);
      });
    }
  }

  // 구덩이: 최근 = 밝은 하층토 테두리 + 방사형 분출물 + 젖은 진흙 바닥 / 오래된 = 풀 덮인 테두리, 물 고인 바닥
  paintCraters(m) {
    const nz = this.noise;
    const CC = CONFIG.terrain.craters;
    for (const c of this.craters) {
      const R = c.r;
      const ejR = c.fresh ? CC.ejecta[0] + (CC.ejecta[1] - CC.ejecta[0]) * ((c.seed * 0.37) % 1) : 1.5;
      const ext = R * ejR + 1;
      this.maskStamp(m, c.x - ext, c.z - ext, c.x + ext, c.z + ext, (x, z, k) => {
        const dx = x - c.x;
        const dz = z - c.z;
        const r = Math.hypot(dx, dz);
        if (r > ext) return;
        const t = r / R;
        const n = nz.noise(x / 1.3 + c.seed, z / 1.3);
        if (c.fresh) {
          const a = Math.atan2(dz, dx);
          const ray = this.craterRay(c, a);
          // 분출물: 줄기 방향으로 멀리, 바깥으로 갈수록 성기게 흩뿌려진 흙덩이 (한 덩어리 모래 더미처럼 보이지 않게)
          const clump = smoothstep(-0.35, 0.45, nz.noise(x / 0.9 + c.seed * 3.1, z / 0.9 - c.seed));
          const out = (1 - smoothstep(1.0, ejR, t + n * 0.3)) * (0.12 + 0.88 * ray) * (0.35 + 0.65 * clump);
          this.paint(m, k, GM.subsoil, Math.min(0.9, out * 1.2));
          if (t < 1.25) this.paint(m, k, GM.subsoil, (1 - smoothstep(0.8, 1.25, t)) * (0.5 + 0.35 * clump));
          if (t < 0.95) this.paint(m, k, GM.mud, (1 - smoothstep(0.35, 0.9, t)) * 0.75);
          // 바깥 젖은 흙 튄 자국
          this.paint(m, k, GM.mud, smoothstep(0.55, 0.9, n) * (1 - smoothstep(1.1, 1.8, t)) * 0.4);
        } else {
          // 오래된 구덩이: 테두리 마루는 풀이 성기고 마른 흙이 드러난 밝은 띠, 안쪽 벽은 어두운 흙·진흙
          // → 낮은 시선에서 밝은 마루 선 + 그 너머 어두운 안쪽 벽으로 윤곽이 읽힌다
          this.paint(m, k, GM.grass, (1 - smoothstep(1.1, 1.55, t)) * 0.6);
          const crest = 1 - smoothstep(0.07, 0.24, Math.abs(t - 1.03 - n * 0.06));
          this.paint(m, k, GM.subsoil, crest * (0.5 + 0.25 * n));
          const wall = smoothstep(0.3, 0.55, t) * (1 - smoothstep(0.84, 0.97, t));
          this.paint(m, k, GM.plowed, wall * (0.6 + 0.2 * n));
          this.paint(m, k, GM.mud, (1 - smoothstep(0.3, 0.65, t)) * 0.85);
        }
      });
    }
  }

  // 물웅덩이 둘레: 젖은 진흙 테 (물가가 칼같이 끊기지 않고 젖은 흙으로 번진다, 얕은 물 아래도 진흙)
  paintPuddles(m) {
    const nz = this.noise;
    const W = CONFIG.ground.puddle.wetRing;
    for (const p of this.puddles) {
      if (p.type === 'disc' && p.rays) {
        const e = p.rmax + 1.2;
        this.maskStamp(m, p.x - e, p.z - e, p.x + e, p.z + e, (x, z, k) => {
          const r = Math.hypot(x - p.x, z - p.z);
          const d = r - this.puddleRadiusAt(p, Math.atan2(z - p.z, x - p.x));
          const n = nz.noise(x / 0.9 + 3.1, z / 0.9 - 7.7);
          this.paint(m, k, GM.mud, (1 - smoothstep(-0.25, 0.75 + 0.45 * n, d)) * W);
        });
      } else if (p.type === 'strip') {
        const { x0, x1, z0, z1 } = bbox(p.pts);
        const e = p.hw + 1;
        this.maskStamp(m, x0 - e, z0 - e, x1 + e, z1 + e, (x, z, k) => {
          const d = polylineDistance(p.pts, x, z) - p.hw;
          this.paint(m, k, GM.mud, (1 - smoothstep(0, 0.55 + 0.3 * nz.noise(x / 0.8, z / 0.8), d)) * W * 0.8);
        });
      }
    }
  }

  // 차량 둘레: 짓이겨진 진흙
  paintObjects(m) {
    const nz = this.noise;
    for (const v of this.vehiclePads) {
      const e = Math.hypot(v.hx, v.hz) + 7;
      this.maskStamp(m, v.x - e, v.z - e, v.x + e, v.z + e, (x, z, k) => {
        const dx = x - v.x;
        const dz = z - v.z;
        const lx = dx * v.c - dz * v.s;
        const lz = dx * v.s + dz * v.c;
        const d = Math.hypot(Math.max(0, Math.abs(lx) - v.hx), Math.max(0, Math.abs(lz) - v.hz));
        this.paint(m, k, GM.mud, (1 - smoothstep(1.5, 6.5, d + nz.noise(x / 2.2, z / 2.2) * 1.5)) * 0.65);
      });
    }
  }

  // 셰이더용 혼합 마스크 텍스처 (렌더 때만 만든다)
  groundMaskTextures() {
    const m = this.buildGroundMask();
    if (!m.texA) {
      const mk = (data) => {
        const t = new THREE.DataTexture(data, m.N, m.N, THREE.RGBAFormat, THREE.UnsignedByteType);
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.generateMipmaps = true;
        t.colorSpace = THREE.NoColorSpace;
        t.needsUpdate = true;
        return t;
      };
      m.texA = mk(m.A);
      m.texB = mk(m.B);
    }
    return { a: m.texA, b: m.texB, N: m.N };
  }

  // ------------------------------------------------------------------ 굽는 앰비언트 오클루전 + 정점색
  // 지형 높이장의 수평선 각(8방향)으로 하늘이 보이는 정도 → 구덩이 안·참호·수로 바닥이 어둡다.
  aoAt(x, z, h, fine) {
    const A = CONFIG.ground.ao;
    const dists = fine ? A.fineDists : A.coarseDists;
    let vis = 0;
    for (let q = 0; q < 8; q++) {
      const dx = AO_DIRS[q * 2];
      const dz = AO_DIRS[q * 2 + 1];
      let mt = 0;
      for (let i = 0; i < dists.length; i++) {
        const d = dists[i];
        const t = (this.heightAt(x + dx * d, z + dz * d) - h) / d;
        if (t > mt) mt = t;
      }
      vis += 1 / (1 + mt * mt);
    }
    let ao = Math.pow(vis / 8, A.power);
    // 건물·차량·엄체호 둘레 접지 음영
    for (const b of this.aoBoxes) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (Math.abs(dx) > b.r || Math.abs(dz) > b.r) continue;
      const lx = dx * b.c - dz * b.s;
      const lz = dx * b.s + dz * b.c;
      const d = Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz));
      ao *= 1 - b.k * (1 - smoothstep(0, b.fall, d));
    }
    return Math.max(A.min, ao);
  }

  vertexColor(x, z, h, fine, out) {
    const V = CONFIG.ground.variation;
    const nz = this.noise;
    const p = this.parcelAt(x, z);
    const tint = p ? this.parcels[p].tint : WHITE;
    const v = 1 + V.amp[0] * nz.noise(x / V.size[0] + 17, z / V.size[0] - 4) + V.amp[1] * nz.noise(x / V.size[1] - 21, z / V.size[1] + 9);
    const k = v * this.aoAt(x, z, h, fine);
    // 적 참호 흉벽 앞면·마루: 밝은 하층토 띠를 조금 더 밝게 (CONFIG.enemyPosition.crestTint)
    const cw = this.trenchCrestWeight(x, z);
    if (cw > 0) {
      const ct = CONFIG.enemyPosition.crestTint;
      out.push(tint[0] * k * (1 + (ct[0] - 1) * cw), tint[1] * k * (1 + (ct[1] - 1) * cw), tint[2] * k * (1 + (ct[2] - 1) * cw));
      return;
    }
    out.push(tint[0] * k, tint[1] * k, tint[2] * k);
  }

  // ------------------------------------------------------------------ 메시
  gridHeight(x, z) {
    // 격자점 정확 높이 (경계 밖은 기본 함수)
    const fi = (x + this.half) / this.res;
    const fj = (z + this.half) / this.res;
    const i = Math.round(fi);
    const j = Math.round(fj);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n || Math.abs(fi - i) > 1e-3 || Math.abs(fj - j) > 1e-3) {
      return this.heightAt(x, z);
    }
    return this.h[j * this.n + i];
  }

  // 청크별 해상도 표 [근거리 x, z, 원거리 x, z]
  chunkResolutions() {
    const M = CONFIG.terrain.mesh;
    const cs = M.chunk;
    const nc = Math.round((2 * this.half) / cs);
    const res = new Float32Array(nc * nc * 4);
    for (let k = 0; k < nc * nc; k++) {
      res[k * 4] = res[k * 4 + 1] = snapRes(M.baseRes, cs);
      res[k * 4 + 2] = res[k * 4 + 3] = snapRes(M.farBaseRes, cs);
    }
    for (const r of this.detailRegions) {
      const ci0 = clamp(Math.floor((r.x0 + this.half) / cs), 0, nc - 1);
      const ci1 = clamp(Math.floor((r.x1 + this.half) / cs), 0, nc - 1);
      const cj0 = clamp(Math.floor((r.z0 + this.half) / cs), 0, nc - 1);
      const cj1 = clamp(Math.floor((r.z1 + this.half) / cs), 0, nc - 1);
      const v = [snapRes(r.resX, cs), snapRes(r.resZ, cs), snapRes(r.farX, cs), snapRes(r.farZ, cs)];
      for (let cj = cj0; cj <= cj1; cj++) {
        for (let ci = ci0; ci <= ci1; ci++) {
          const k = (cj * nc + ci) * 4;
          for (let q = 0; q < 4; q++) if (v[q] < res[k + q]) res[k + q] = v[q];
        }
      }
    }
    return { res, nc, cs };
  }

  // material.userData.farMaterial (원거리 LOD·원경, 가벼운 변형)·ridgeMaterial (고랑 형상) 이 있으면 쓴다
  buildMesh(material) {
    this.buildGroundMask();
    const M = CONFIG.terrain.mesh;
    const farMat = material.userData.farMaterial || material;
    const half = this.half;
    const { res, nc, cs } = this.chunkResolutions();
    const gc = Math.max(1, Math.round(M.group / cs));
    const ng = Math.ceil(nc / gc);
    const root = new THREE.Group();
    root.name = 'terrain';
    let tris = 0;
    let farTris = 0;
    this.lods = [];
    for (let gj = 0; gj < ng; gj++) {
      for (let gi = 0; gi < ng; gi++) {
        const near = { pos: [], nor: [], colr: [], idx: [] };
        const far = { pos: [], nor: [], colr: [], idx: [] };
        const g = { ci0: gi * gc, cj0: gj * gc, ci1: Math.min(nc, (gi + 1) * gc) - 1, cj1: Math.min(nc, (gj + 1) * gc) - 1 };
        for (let cj = g.cj0; cj <= g.cj1; cj++) {
          for (let ci = g.ci0; ci <= g.ci1; ci++) {
            tris += this.buildChunk(near, ci, cj, res, nc, cs, 0, g);
            farTris += this.buildChunk(far, ci, cj, res, nc, cs, 2, g);
          }
        }
        const cx = -half + (g.ci0 + g.ci1 + 1) * cs * 0.5;
        const cz = -half + (g.cj0 + g.cj1 + 1) * cs * 0.5;
        const lod = new THREE.LOD();
        lod.name = 'terrainGroup';
        lod.position.set(cx, this.heightAt(cx, cz), cz);
        lod.updateMatrix();
        lod.matrixAutoUpdate = false;
        lod.addLevel(this.makeMesh(near, material, lod.position), 0, 0);
        lod.addLevel(this.makeMesh(far, farMat, lod.position), M.lodDistance, M.lodHysteresis);
        this.lods.push(lod);
        root.add(lod);
      }
    }
    // 원경 지형 (맵 밖 3~5km, 낮은 해상도 — buildFar)
    const ringTris = this.buildFar(root, material, farMat);
    // 밭 고랑 형상 (근거리 골판)
    this.ridgeTriangleCount = 0;
    if (material.userData.ridgeMaterial) root.add(this.buildRidges(material.userData.ridgeMaterial));
    this.triangleCount = tris + ringTris;
    this.farLodTriangleCount = farTris;
    return root;
  }

  // 그래픽 품질 프리셋용: 근거리 → 원거리 LOD 전환 거리 (m)
  setLodDistance(d) {
    for (const lod of this.lods) if (lod.levels[1]) lod.levels[1].distance = d;
  }

  // ------------------------------------------------------------------ 밭 고랑 실제 형상 (근거리 골판 메시, 렌더 전용)
  // 고랑 하나 = 바닥 → 마루 → 바닥의 두 비탈(평평한 음영). 정점 위치는 내린 밭 지면(바닥) + lift 이고,
  // 마루 높이(aRidge.x)는 정점 셰이더가 카메라 거리·화면 고랑 간격에 맞춰 줄인다 (먼 곳·낮은 시선은 셰이더 노멀만).
  // 플레이어가 갈 수 있는 구역 근처의 밭만, chunk 크기 묶음마다 LOD(가까울 때만 그림)로 만든다.
  buildRidges(material) {
    const RG = CONFIG.terrain.furrow.ridge;
    const PA = CONFIG.world.playArea;
    const C = RG.chunk;
    const reach = RG.fadeDistance[1] + 2;
    const half = this.half;
    const root = new THREE.Group();
    root.name = 'furrowRidges';
    const chunks = new Map();
    for (let p = 1; p < this.parcels.length; p++) {
      const P = this.parcels[p];
      if (!P.depth) continue;
      const x0 = Math.max(P.x0, PA.minX - reach, -half + 1);
      const x1 = Math.min(P.x1, PA.maxX + reach, half - 1);
      const z0 = Math.max(P.z0, PA.minZ - reach, -half + 1);
      const z1 = Math.min(P.z1, PA.maxZ + reach, half - 1);
      if (x0 >= x1 || z0 >= z1) continue;
      for (let ci = Math.floor((x0 + half) / C); ci * C - half < x1; ci++) {
        for (let cj = Math.floor((z0 + half) / C); cj * C - half < z1; cj++) {
          const key = ci * 1000 + cj;
          if (!chunks.has(key)) chunks.set(key, { ci, cj, pos: [], nor: [], colr: [], rid: [], rg: [], idx: [] });
          const g = chunks.get(key);
          const bx0 = Math.max(x0, ci * C - half);
          const bx1 = Math.min(x1, (ci + 1) * C - half);
          const bz0 = Math.max(z0, cj * C - half);
          const bz1 = Math.min(z1, (cj + 1) * C - half);
          if (bx0 < bx1 && bz0 < bz1) this.buildRidgePatch(g, P, bx0, bz0, bx1, bz1);
        }
      }
    }
    const visDist = RG.fadeDistance[1] + C * 0.71;
    let tris = 0;
    for (const g of chunks.values()) {
      if (!g.idx.length) continue;
      tris += g.idx.length / 3;
      const cx = -half + (g.ci + 0.5) * C;
      const cz = -half + (g.cj + 0.5) * C;
      const lod = new THREE.LOD();
      lod.name = 'furrowChunk';
      lod.position.set(cx, this.heightAt(cx, cz), cz);
      lod.updateMatrix();
      lod.matrixAutoUpdate = false;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.colr, 3));
      geo.setAttribute('aRidge', new THREE.Float32BufferAttribute(g.rid, 4));
      geo.setAttribute('aRidgeG', new THREE.Float32BufferAttribute(g.rg, 2));
      const vcount = g.pos.length / 3;
      geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
      geo.computeBoundingSphere();
      // 마루가 솟을 자리까지 경계 구를 넓힌다 (절두체 컬링)
      geo.boundingSphere.radius += RG.geomDepth;
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      // 지형보다 먼저 그려 그 아래 지형 픽셀은 깊이 검사에서 바로 버려지게
      mesh.renderOrder = -1;
      mesh.position.set(-lod.position.x, -lod.position.y, -lod.position.z);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      if (material.userData.onTerrainRender) mesh.onBeforeRender = material.userData.onTerrainRender;
      lod.addLevel(mesh, 0, 0);
      lod.addLevel(new THREE.Object3D(), visDist, 0.05);
      root.add(lod);
    }
    this.ridgeTriangleCount = tris;
    return root;
  }

  // 칸 안 지형이 평평한지 (구덩이 테두리·바퀴 자국·배수로 위에는 골판을 얹지 않는다)
  ridgeSmooth(x, z, ax, az, bx, bz) {
    const h = (s, t) => this.heightAt(x + ax * s + bx * t, z + az * s + bz * t);
    const c00 = h(-1, -1);
    const c10 = h(1, -1);
    const c01 = h(-1, 1);
    const c11 = h(1, 1);
    const tol = CONFIG.terrain.furrow.ridge.lift * 1.25;
    if (Math.abs(h(0, 0) - (c00 + c10 + c01 + c11) * 0.25) > tol) return false;
    if (Math.abs(h(0, -1) - (c00 + c10) * 0.5) > tol) return false;
    if (Math.abs(h(0, 1) - (c01 + c11) * 0.5) > tol) return false;
    if (Math.abs(h(-1, 0) - (c00 + c01) * 0.5) > tol) return false;
    return Math.abs(h(1, 0) - (c10 + c11) * 0.5) <= tol;
  }

  // 구획 P 의 고랑 골판 중 칸 중심이 상자 [x0,x1)×[z0,z1) 안인 것을 g 에 더한다.
  // u = 고랑 가로 좌표 (바닥 = 간격의 정수배, 셰이더 해석적 고랑과 같은 위상), v = 고랑 방향 좌표
  buildRidgePatch(g, P, x0, z0, x1, z1) {
    const RG = CONFIG.terrain.furrow.ridge;
    const sp = P.spacing;
    const L = RG.alongStep;
    const px = P.dirZ;
    const pz = -P.dirX;
    const dx = P.dirX;
    const dz = P.dirZ;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      const u = x * px + z * pz;
      const v = x * dx + z * dz;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    // 이웃 칸까지 (끝 마루를 낮추는 판정용)
    const k0 = Math.floor(u0 / sp) - 1;
    const k1 = Math.ceil(u1 / sp) + 1;
    const j0 = Math.floor(v0 / L) - 1;
    const j1 = Math.ceil(v1 / L) + 1;
    const nK = k1 - k0;
    const nJ = j1 - j0;
    const at = (u, v) => [u * px + v * dx, u * pz + v * dz];
    // 칸 유효성 (상자와 무관하게 위치만으로 정해 묶음 경계에서 이어진다)
    const valid = new Uint8Array(nK * nJ);
    const inBox = new Uint8Array(nK * nJ);
    let any = false;
    for (let k = k0; k < k1; k++) {
      for (let j = j0; j < j1; j++) {
        const [x, z] = at((k + 0.5) * sp, (j + 0.5) * L);
        const c = (k - k0) * nJ + (j - j0);
        if (this.furrowWeight(x, z) < 0.08) continue;
        if (!this.ridgeSmooth(x, z, px * sp * 0.5, pz * sp * 0.5, dx * L * 0.5, dz * L * 0.5)) continue;
        valid[c] = 1;
        if (x >= x0 && x < x1 && z >= z0 && z < z1) {
          inBox[c] = 1;
          any = true;
        }
      }
    }
    if (!any) return;
    const isValid = (k, j) => k >= k0 && k < k1 && j >= j0 && j < j1 && valid[(k - k0) * nJ + (j - j0)] === 1;
    const half = RG.geomDepth * 0.5;
    const gx = px / sp;
    const gz = pz / sp;
    // 정점 하나: 위치 = 내린 지면(평균면 - half * 고랑 세기) + lift, 법선 = 지형 법선.
    // 비탈 기울기(마루 높이 / 반 간격, sgn = 오르막 +1 / 내리막 -1)는 aRidge.zw 로 셰이더에서 더한다 (비탈마다 평평한 음영)
    const vert = (u, v, rise, slopeRise, shade, w, sgn) => {
      const [x, z] = at(u, v);
      const hm = this.heightAt(x, z);
      g.pos.push(x, hm - half * w + RG.lift, z);
      const n = this.normalAt(x, z);
      g.nor.push(n.x, n.y, n.z);
      this.vertexColor(x, z, hm, false, g.colr);
      const slope = (slopeRise / (sp * 0.5)) * sgn;
      g.rid.push(rise, shade, px * slope, pz * slope);
      g.rg.push(gx, gz);
      return g.pos.length / 3 - 1;
    };
    // 한 행(v): 오르막 비탈(바닥, 마루), 내리막 비탈(마루, 바닥) 정점 4개
    const row = (k, j) => {
      const v = j * L;
      const uT = k * sp;
      const uC = uT + sp * 0.5;
      const [cx, cz] = at(uC, v);
      const wc = this.furrowWeight(cx, cz);
      // 이 마루에 닿는 칸(앞·뒤)이 모두 유효할 때만 솟는다 → 골판 끝은 바닥 높이로 닫힘
      const taper = isValid(k, j - 1) && isValid(k, j) ? 1 : 0;
      const rise = Math.max(0, RG.geomDepth * wc - RG.lift) * taper;
      const [tx0, tz0] = at(uT, v);
      const [tx1, tz1] = at(uT + sp, v);
      const wt0 = this.furrowWeight(tx0, tz0);
      const wt1 = this.furrowWeight(tx1, tz1);
      const crestShade = 1 + (RG.crestShade - 1) * wc * taper;
      return [
        vert(uT, v, 0, rise, 1 + (RG.troughShade - 1) * wt0, wt0, 1),
        vert(uC, v, rise, rise, crestShade, wc, 1),
        vert(uC, v, rise, rise, crestShade, wc, -1),
        vert(uT + sp, v, 0, rise, 1 + (RG.troughShade - 1) * wt1, wt1, -1),
      ];
    };
    const idx = g.idx;
    for (let k = k0 + 1; k < k1 - 1; k++) {
      let prev = null;
      for (let j = j0 + 1; j < j1 - 1; j++) {
        const c = (k - k0) * nJ + (j - j0);
        if (!valid[c] || !inBox[c]) {
          prev = null;
          continue;
        }
        const a = prev || row(k, j);
        const b = row(k, j + 1);
        // 위에서 볼 때 반시계 (u, v 좌표계는 x, z 와 같은 방향)
        idx.push(a[0], b[0], a[1], a[1], b[0], b[1]);
        idx.push(a[2], b[2], a[3], a[3], b[2], b[3]);
        prev = b;
      }
    }
  }

  makeMesh(g, material, offset = null) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.colr, 3));
    const vcount = g.pos.length / 3;
    geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    // 정점은 월드 좌표 그대로: LOD 묶음의 위치만큼 되돌린다
    if (offset) mesh.position.set(-offset.x, -offset.y, -offset.z);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    if (material.userData.onTerrainRender) mesh.onBeforeRender = material.userData.onTerrainRender;
    return mesh;
  }

  // 청크 하나 (lvl 0 = 근거리, 2 = 원거리). 이웃과 해상도가 다르거나 묶음 경계면 스커트로 틈을 가린다.
  buildChunk(g, ci, cj, res, nc, cs, lvl, grp) {
    const k = (cj * nc + ci) * 4;
    const rx = res[k + lvl];
    const rz = res[k + lvl + 1];
    const x0 = -this.half + ci * cs;
    const z0 = -this.half + cj * cs;
    const nvx = Math.round(cs / rx) + 1;
    const nvz = Math.round(cs / rz) + 1;
    const fine = Math.min(rx, rz) <= 1.25;
    const base = g.pos.length / 3;
    for (let j = 0; j < nvz; j++) {
      const z = z0 + j * rz;
      for (let i = 0; i < nvx; i++) {
        const x = x0 + i * rx;
        const h = this.gridHeight(x, z);
        // 밭은 고랑 바닥 높이로 내려 그린다 (고랑 형상 메시가 그 위에 얹힌다)
        g.pos.push(x, h - this.renderDrop(x, z), z);
        // 법선 (청크 해상도 간격의 중앙차분)
        const sx = (this.gridHeight(x + rx, z) - this.gridHeight(x - rx, z)) / (2 * rx);
        const sz = (this.gridHeight(x, z + rz) - this.gridHeight(x, z - rz)) / (2 * rz);
        const nl = Math.hypot(sx, 1, sz);
        g.nor.push(-sx / nl, 1 / nl, -sz / nl);
        this.vertexColor(x, z, h, fine, g.colr);
      }
    }
    for (let j = 0; j < nvz - 1; j++) {
      for (let i = 0; i < nvx - 1; i++) {
        const a = base + j * nvx + i;
        const b = a + 1;
        const c = a + nvx;
        const d = c + 1;
        // 대각선 방향을 번갈아 가며
        if ((i + j) % 2 === 0) g.idx.push(a, c, b, b, c, d);
        else g.idx.push(a, c, d, a, d, b);
      }
    }
    let tris = (nvx - 1) * (nvz - 1) * 2;
    // 스커트: 이웃 청크와 변 방향 해상도가 다르거나, 묶음(LOD) 경계, 맵 가장자리
    const nres = (ni, nj, axis) => {
      if (ni < 0 || nj < 0 || ni >= nc || nj >= nc) return -1;
      return res[(nj * nc + ni) * 4 + lvl + axis];
    };
    const outer = (ni, nj) => ni < grp.ci0 || ni > grp.ci1 || nj < grp.cj0 || nj > grp.cj1;
    const edges = [];
    if (outer(ci, cj - 1) || nres(ci, cj - 1, 0) !== rx) edges.push([...Array(nvx).keys()]);
    if (outer(ci, cj + 1) || nres(ci, cj + 1, 0) !== rx) edges.push([...Array(nvx).keys()].map((i) => (nvz - 1) * nvx + i));
    if (outer(ci - 1, cj) || nres(ci - 1, cj, 1) !== rz) edges.push([...Array(nvz).keys()].map((j) => j * nvx));
    if (outer(ci + 1, cj) || nres(ci + 1, cj, 1) !== rz) edges.push([...Array(nvz).keys()].map((j) => j * nvx + nvx - 1));
    const sd = CONFIG.world.skirtDepth;
    for (const list of edges) {
      const start = g.pos.length / 3;
      for (const local of list) {
        const vi = base + local;
        g.pos.push(g.pos[vi * 3], g.pos[vi * 3 + 1] - sd, g.pos[vi * 3 + 2]);
        g.nor.push(g.nor[vi * 3], g.nor[vi * 3 + 1], g.nor[vi * 3 + 2]);
        g.colr.push(g.colr[vi * 3] * 0.8, g.colr[vi * 3 + 1] * 0.8, g.colr[vi * 3 + 2] * 0.8);
      }
      for (let q = 0; q < list.length - 1; q++) {
        const a = base + list[q];
        const b = base + list[q + 1];
        const c = start + q;
        const d = start + q + 1;
        // 양면처럼 보이게 두 방향 모두
        g.idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
        tris += 4;
      }
    }
    return tris;
  }

  // ------------------------------------------------------------------ 원경 지형 (맵 밖, CONFIG.distant.terrain)
  // 맵 가장자리에 맞춘 격자: 맵 둘레는 edgeStep 간격, 바깥으로 갈수록 growth 배씩 넓어진다 (distant.maxRange 원 밖 칸은 버림).
  // 수로·농로가 맵 밖으로 이어지는 곳은 단면이 꺾이는 자리에 격자선을 더 넣고 (수로 굽이는 정점을 옮겨 따라감),
  // 맵 가장자리 정점은 맵 높이 격자에서 읽어 맵 지형과 맞물린다 (조금 낮춰 맵 지형 가장자리 스커트 뒤로 숨김).
  // 근거리 띠(nearBand)는 근거리 지면 셰이더, 나머지는 원거리 셰이더 — 두 메시가 정점을 함께 써 틈이 없다.
  // 바깥 메시는 칸을 맵 중심에서 가까운 순으로 쌓아 setFarRange 가 drawRange 만 줄인다.
  farAxis(groups) {
    const T = CONFIG.distant.terrain;
    const half = this.half;
    const n = Math.round((2 * half) / T.edgeStep);
    let lines = [];
    for (let i = 0; i <= n; i++) lines.push({ v: -half + (2 * half * i) / n, edge: i === 0 || i === n });
    let o = 0;
    let s = T.edgeStep;
    while (half + o < CONFIG.distant.maxRange) {
      s = Math.min(T.maxStep, s * T.growth);
      o += s;
      lines.push({ v: half + o }, { v: -(half + o) });
    }
    for (const g of groups) {
      lines = lines.filter((l) => l.edge || Math.abs(l.v - g.c) > g.clear);
      for (const d of g.offs) lines.push({ v: g.c + d, canal: !!g.canal });
    }
    return lines.sort((a, b) => a.v - b.v);
  }

  buildFar(root, nearMat, farMat) {
    const D = CONFIG.distant;
    const T = D.terrain;
    const V = CONFIG.ground.variation;
    const half = this.half;
    const C = MAP.canal;
    const nz = this.noise;
    // 수로 단면이 꺾이는 자리 (수로 중심에서 북쪽 +): 남쪽 둑·비탈·바닥·북쪽 사격 발판·흙 둔덕
    const canalRows = [-6.2, -5.0, -3.9, -3.05, -2.7, -2.4, -1.65, -0.9, 0, 0.9, 1.5, 2.05, 2.45, 2.8, 3.15, 3.55, 4.3, 5.2, 6.25];
    // 농로 단면 (길 중심에서): 바퀴 자국·길 가장자리·배수로
    const roadCols = [-5.6, -4.55, -3.95, -3.35, -2.75, -2.3, -1.28, -0.85, -0.42, 0, 0.42, 0.85, 1.28, 2.3, 2.75, 3.35, 3.95, 4.55, 5.6];
    const carves = this.farRoadCarves();
    const xs = this.farAxis(carves.filter((c) => Math.abs(c.ux) < 1e-3).map((c) => ({ c: c.ax, offs: roadCols, clear: 6.4 })));
    const zs = this.farAxis([{ c: C.z, offs: canalRows.map((o) => -o), clear: 7.2, canal: true }]);
    const NX = xs.length;
    const NZ = zs.length;
    // 격자 정점 (맵 안쪽 정점도 법선 계산용으로 만든 뒤 쓰는 것만 남긴다)
    const P = new Float32Array(NX * NZ * 3);
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const x = xs[i].v;
        let z = zs[j].v;
        if (zs[j].canal) z += this.canalZ(x) - C.z;
        const inside = Math.abs(x) <= half + 1e-6 && Math.abs(z) <= half + 1e-6;
        const k = (j * NX + i) * 3;
        P[k] = x;
        P[k + 1] = (inside ? this.gridSample(x, z) : this.farHeight(x, z)) - T.drop;
        P[k + 2] = z;
      }
    }
    // 칸 → 삼각형 (높이차가 작은 대각선으로 나눔). 근거리 띠 / 바깥 (맵 중심 거리순)
    const nearIdx = [];
    const farCells = [];
    const used = new Uint8Array(NX * NZ);
    for (let j = 0; j < NZ - 1; j++) {
      for (let i = 0; i < NX - 1; i++) {
        const cx = (xs[i].v + xs[i + 1].v) * 0.5;
        const cz = (zs[j].v + zs[j + 1].v) * 0.5;
        if (Math.abs(cx) < half && Math.abs(cz) < half) continue; // 맵 안쪽은 맵 지형
        const dist = Math.hypot(cx, cz);
        if (dist > D.maxRange) continue;
        const a = j * NX + i;
        const b = a + 1;
        const c = a + NX;
        const d = c + 1;
        const t = Math.abs(P[a * 3 + 1] - P[d * 3 + 1]) <= Math.abs(P[b * 3 + 1] - P[c * 3 + 1]) ? [a, c, d, a, d, b] : [a, c, b, b, c, d];
        used[a] = used[b] = used[c] = used[d] = 1;
        if (Math.max(Math.abs(cx), Math.abs(cz)) - half < T.nearBand) nearIdx.push(...t);
        else farCells.push({ dist, t });
      }
    }
    // 쓰는 정점만: 위치·법선(격자 이웃 차분)·정점색 (큰 규모 밝기 변화 + 수로·농로 둘레 굽은 AO)
    const remap = new Int32Array(NX * NZ).fill(-1);
    const pos = [];
    const nor = [];
    const colr = [];
    const at = (i, j) => (j * NX + i) * 3;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const v = j * NX + i;
        if (!used[v]) continue;
        remap[v] = pos.length / 3;
        const k = v * 3;
        const x = P[k];
        const y = P[k + 1];
        const z = P[k + 2];
        pos.push(x, y, z);
        const i0 = at(Math.max(0, i - 1), j);
        const i1 = at(Math.min(NX - 1, i + 1), j);
        const j0 = at(i, Math.max(0, j - 1));
        const j1 = at(i, Math.min(NZ - 1, j + 1));
        // 법선 = (z 방향 접선) x (x 방향 접선)
        const ax = P[i1] - P[i0];
        const ay = P[i1 + 1] - P[i0 + 1];
        const az = P[i1 + 2] - P[i0 + 2];
        const bx = P[j1] - P[j0];
        const by = P[j1 + 1] - P[j0 + 1];
        const bz = P[j1 + 2] - P[j0 + 2];
        let nx = by * az - bz * ay;
        let ny = bz * ax - bx * az;
        let nzv = bx * ay - by * ax;
        const nl = Math.hypot(nx, ny, nzv) || 1;
        nx /= nl;
        ny /= nl;
        nzv /= nl;
        nor.push(nx, ny, nzv);
        let c = 1 + V.amp[0] * nz.noise(x / V.size[0] + 17, z / V.size[0] - 4) + V.amp[1] * nz.noise(x / V.size[1] - 21, z / V.size[1] + 9);
        const nearLine = zs[j].canal || carves.some((cv) => Math.abs(cv.ux) < 1e-3 && Math.abs(x - cv.ax) < 6.4);
        if (nearLine && Math.hypot(x, z) < 1500) c *= this.aoAt(x, z, y + T.drop, true);
        colr.push(c, c, c);
      }
    }
    farCells.sort((p, q) => p.dist - q.dist);
    const farIdx = [];
    this.farEnds = [];
    for (const cell of farCells) {
      for (const v of cell.t) farIdx.push(remap[v]);
      this.farEnds.push([cell.dist, farIdx.length]);
    }
    for (let q = 0; q < nearIdx.length; q++) nearIdx[q] = remap[nearIdx[q]];
    // 두 메시가 정점 속성을 함께 쓴다
    const vcount = pos.length / 3;
    const attrs = {
      position: new THREE.Float32BufferAttribute(pos, 3),
      normal: new THREE.Float32BufferAttribute(nor, 3),
      color: new THREE.Float32BufferAttribute(colr, 3),
    };
    const make = (idx, mat, name, shadow) => {
      const geo = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(attrs)) geo.setAttribute(k, a);
      geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      // 근거리 띠는 맵 안 근거리 지형처럼 그림자를 받는다 (이동 가능 구역 경계에서 그림자가 맵 가장자리에서 끊기지 않게)
      mesh.receiveShadow = shadow;
      mesh.matrixAutoUpdate = false;
      if (mat.userData.onTerrainRender) mesh.onBeforeRender = mat.userData.onTerrainRender;
      root.add(mesh);
      return mesh;
    };
    this.farNearMesh = make(nearIdx, farRingMaterial(nearMat, 'near'), 'terrainFarNear', true);
    this.farMesh = make(farIdx, farRingMaterial(farMat, 'far'), 'terrainFar', false);
    this.setFarRange(D.range);
    // 맵 밖으로 이어지는 수로의 물 고인 구간 (World.buildPuddles 가 그린다)
    for (const [a, b] of (MAP.distant && MAP.distant.canalWater) || []) this.puddles.push({ type: 'canal', x0: a, x1: b });
    this.farVertexCount = vcount;
    return (nearIdx.length + farIdx.length) / 3;
  }

  // 원경 지형을 그리는 거리 (맵 중심에서 m) — 그래픽 품질 프리셋 (World.setDistantRange)
  setFarRange(r) {
    if (!this.farMesh) return;
    let count = 0;
    for (const [d, e] of this.farEnds) {
      if (d > r) break;
      count = e;
    }
    this.farMesh.geometry.setDrawRange(0, count);
  }
}

// 원경 지형 재질: 근거리/원거리 지형 재질(createTerrainMaterial)을 감싸 같은 유니폼·텍스처를 쓰고,
// 혼합 마스크 밖(맵 밖) 지면을 맵 배치 데이터로 칠한다 — 맵 가장자리에 맞춘 큰 밭 구획(갈아엎은 밭·그루터기·묵은 풀밭,
// 경계의 풀 둑과 흙길, 맵 둘레 흙길), 맵 밖 농로·마을 길 (MAP.distant, 바퀴 자국은 셰이더의 길 거리장 식 그대로),
// 맵 밖으로 이어지는 수로 (바닥 진흙·비탈 풀·북쪽 발판·파낸 흙 둔덕). 거칠기 하한(roughnessMin)으로 원경 흙이 해 쪽에서 번들거리지 않게
function farRingMaterial(base, variant) {
  const D = CONFIG.distant;
  const T = D.terrain;
  const F = T.fields;
  const C = MAP.canal;
  const segs = farRoadSegments().slice(0, 32);
  const nR = Math.max(1, segs.length);
  const roads = [];
  for (let i = 0; i < nR; i++) roads.push(segs[i] ? new THREE.Vector4(...segs[i]) : new THREE.Vector4(1e5, 1e5, 1e5, 1e5));
  const f = (v) => {
    const s = Number(v).toFixed(5);
    return s.includes('.') ? s : s + '.0';
  };
  const R = CONFIG.terrain.road;
  const benchIn = C.floorHalf + ((C.depth - C.bench.depth) * (C.topHalf - C.floorHalf)) / C.depth;
  const pars = `
#define TF_NROADS ${nR}
uniform vec4 uFarRoad[TF_NROADS];
const vec2 TF_FIELD = vec2(${f(F.size[0])}, ${f(F.size[1])});
float tfHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// 재질 m 을 a 만큼 덧칠 (나머지는 1-a 배). m: 0 흑토 1 그루터기 2 진흙 3 하층토 4 자갈길, 그 밖 = 풀
void tfPaint(inout vec4 A, inout vec4 B, int m, float a) {
  a = clamp(a, 0.0, 1.0);
  A *= 1.0 - a;
  B.r *= 1.0 - a;
  if (m == 0) A.r += a;
  else if (m == 1) A.g += a;
  else if (m == 2) A.b += a;
  else if (m == 3) A.a += a;
  else if (m == 4) B.r += a;
}
float tfSeg(vec2 p, vec4 s) {
  vec2 ab = s.zw - s.xy;
  float t = clamp(dot(p - s.xy, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
  return length(p - s.xy - ab * t);
}
// 맵 밖 지면 재질 비율 (A = 흑토·그루터기·진흙·하층토, B = 자갈길·길 거리·궤도 거리·구획)
void tFarGround(vec2 wp, out vec4 A, out vec4 B) {
  A = vec4(0.0);
  B = vec4(0.0, 1.0, 1.0, 0.0);
  float mac = texture(tMacro, wp / 97.0 + vec2(0.31, 0.77)).g;
  float macF = texture(tMacro, wp / T_MAC_FAR).r;
  // ---- 밭 구획: 맵 가장자리(±T_HALF)가 경계가 되는 격자, 칸마다 반으로 나누기도 한다
  vec2 q = (wp + vec2(T_HALF)) / TF_FIELD;
  vec2 qc = floor(q);
  vec2 lo = qc;
  vec2 hi = qc + 1.0;
  vec2 id = qc;
  if (tfHash(qc + 17.0) < ${f(F.split[0])}) {
    float s = step(qc.x + 0.5, q.x);
    lo.x += 0.5 * s;
    hi.x -= 0.5 * (1.0 - s);
    id.x += 0.5 * s;
  }
  if (tfHash(qc + 41.0) < ${f(F.split[1])}) {
    float s = step(qc.y + 0.5, q.y);
    lo.y += 0.5 * s;
    hi.y -= 0.5 * (1.0 - s);
    id.y += 0.5 * s;
  }
  float kind = tfHash(id * 1.37 + 5.1);
  if (kind < ${f(F.plowed)}) {
    tfPaint(A, B, 0, 1.0);
    tfPaint(A, B, 2, smoothstep(0.6, 0.8, mac) * 0.55);
    tfPaint(A, B, 5, smoothstep(0.7, 0.9, macF) * 0.3);
  } else if (kind < ${f(F.plowed + F.stubble)}) {
    tfPaint(A, B, 1, 0.95);
    tfPaint(A, B, 5, smoothstep(0.45, 0.8, mac) * 0.5);
    tfPaint(A, B, 0, smoothstep(0.72, 0.9, macF) * 0.3);
  } else {
    tfPaint(A, B, 0, smoothstep(0.66, 0.86, mac) * 0.35);
    tfPaint(A, B, 2, smoothstep(0.75, 0.9, macF) * 0.3);
  }
  // 경계까지 거리 (m) — 풀 둑, 일부 경계는 흙길 (경계선마다 같은 값이 나오게 선 좌표로 정한다)
  vec2 d0 = (q - lo) * TF_FIELD;
  vec2 d1 = (hi - q) * TF_FIELD;
  float e = min(min(d0.x, d1.x), min(d0.y, d1.y));
  float trk = 1e4;
  if (tfHash(vec2(lo.x * 3.1, qc.y) + 2.3) < ${f(F.trackChance)}) trk = min(trk, d0.x);
  if (tfHash(vec2(hi.x * 3.1, qc.y) + 2.3) < ${f(F.trackChance)}) trk = min(trk, d1.x);
  if (tfHash(vec2(qc.x, lo.y * 3.1) + 7.9) < ${f(F.trackChance)}) trk = min(trk, d0.y);
  if (tfHash(vec2(qc.x, hi.y * 3.1) + 7.9) < ${f(F.trackChance)}) trk = min(trk, d1.y);
  // 맵 둘레는 항상 흙길 (맵 가장자리 바로 밖, 맵 안 지면과의 경계를 길로 나눈다)
  float outM = max(abs(wp.x), abs(wp.y)) - T_HALF;
  trk = min(trk, abs(outM - ${f(F.track + 0.4)}));
  e = min(e, outM);
  float fwE = fwidth(e) + 0.02;
  tfPaint(A, B, 5, (1.0 - smoothstep(${f(F.verge)} - fwE, ${f(F.verge)} + fwE, e)) * 0.8);
  float fwT = fwidth(trk) + 0.02;
  float tw = (1.0 - smoothstep(${f(F.track)} - fwT, ${f(F.track)} + fwT, trk)) * min(1.0, ${f(F.track)} / fwT);
  // 밭 사이 흙길: 짓밟힌 흙 + 바퀴 자국 진흙 (자갈은 조금만 — 큰 농로보다 어둡게)
  tfPaint(A, B, 0, tw * 0.45);
  tfPaint(A, B, 4, tw * 0.25);
  tfPaint(A, B, 2, tw * (1.0 - smoothstep(0.15, 0.6, abs(trk - ${f(R.rutOffset)}))) * 0.6);
  // ---- 맵 밖 농로·마을 길 (바퀴 자국·배수로는 셰이더의 길 거리장 식이 그린다)
  float dr = 1e4;
  for (int i = 0; i < TF_NROADS; i++) dr = min(dr, tfSeg(wp, uFarRoad[i]));
  if (dr < T_ROAD_RANGE) {
    B.g = dr / T_ROAD_RANGE;
    float hw = ${f(T.roadHalf)};
    float fwR = fwidth(dr) + 0.02;
    float gw = (1.0 - smoothstep(hw - 0.35 - fwR, hw + 0.2 + fwR, dr)) * min(1.0, hw / fwR);
    tfPaint(A, B, 4, gw * 0.92);
    tfPaint(A, B, 5, smoothstep(hw, hw + 0.4, dr) * (1.0 - smoothstep(hw + ${f(R.ditchOffset + R.ditchHalf)}, T_ROAD_RANGE, dr)) * 0.75);
    tfPaint(A, B, 2, (1.0 - smoothstep(${f(R.ditchHalf * 0.35)}, ${f(R.ditchHalf)} + fwR, abs(dr - hw - ${f(R.ditchOffset)}))) * 0.85);
  }
  // ---- 맵 밖으로 이어지는 수로 (북쪽 +)
  float dn = ${f(C.z)} + ${f(C.wiggleAmp)} * sin(wp.x / ${f(C.wiggleLen)}) - wp.y;
  float dc = abs(dn);
  if (dc < 16.0) {
    float n = texture(tMacro, wp / 7.0).b - 0.5;
    tfPaint(A, B, 5, (1.0 - smoothstep(8.0, 16.0, dc)) * 0.85);
    bool bench = dn > 0.0 && dc > ${f(benchIn - 0.15)};
    if (dc < ${f(C.topHalf + 0.1)} && !bench) {
      float wet = 1.0 - smoothstep(${f(C.floorHalf - 0.1)}, ${f(C.floorHalf + 0.9)} + 0.3 * n, dc);
      tfPaint(A, B, 5, smoothstep(${f(C.floorHalf + 0.4)}, ${f(C.topHalf)}, dc + 0.3 * n) * 0.6);
      tfPaint(A, B, 2, wet * (0.85 + 0.15 * n));
    } else if (dn > 0.0) {
      if (dc <= ${f(C.bench.outer + 0.1)}) {
        tfPaint(A, B, 0, 0.55);
        tfPaint(A, B, 2, 0.45);
      } else {
        float t = (dc - ${f(C.bench.outer)}) / ${f(C.berm.face + C.berm.back)};
        float spoil = 1.0 - smoothstep(0.4, 1.0, t + n * 0.3);
        tfPaint(A, B, 2, spoil * 0.55);
        tfPaint(A, B, 3, spoil * (0.45 + 0.3 * n));
        tfPaint(A, B, 5, smoothstep(0.3, 0.75, t + 0.5 * n) * 0.75);
      }
    }
  }
}
`;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mat.name = 'terrain_ring_' + variant;
  mat.userData.terrainUniforms = base.userData.terrainUniforms;
  mat.userData.onTerrainRender = base.userData.onTerrainRender;
  const uFarRoad = { value: roads };
  mat.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile(shader, renderer);
    shader.uniforms.uFarRoad = uFarRoad;
    const fs = shader.fragmentShader;
    const out = fs
      .replace('void terrainSurface(', `${pars}\nvoid terrainSurface(`)
      .replace('parcel = clamp(parcel, 0, T_MAX_PARCELS - 1);', 'if (suv != suvC) tFarGround(wp, sA, sB);\n  parcel = clamp(parcel, 0, T_MAX_PARCELS - 1);')
      .replace('float roughnessFactor = tRough;', `float roughnessFactor = max(tRough, ${f(T.roughnessMin)});`);
    if (out.split('tFarGround').length < 3 || !out.includes(`max(tRough, ${f(T.roughnessMin)})`)) {
      console.warn('[Terrain] 원경 지형 셰이더 끼워 넣기 실패 — 지형 셰이더가 바뀌었습니다 (맵 밖 지면은 기본 얼룩으로 그립니다)');
    }
    shader.fragmentShader = out;
    // 지평선 위로 솟은 먼 언덕 마루·비탈은 희미한 실루엣으로 남긴다 (먼 마을·탑과 같은 식, Distant.applySilhouetteFog)
    applySilhouetteFog(shader);
  };
  mat.customProgramCacheKey = () => 'terrainSplat_ring_' + variant;
  return mat;
}

// 지형 재질: 표준(PBR) 재질 + 혼합 셰이더. 조명·그림자·안개·톤매핑은 Three.js 표준 경로 그대로.
// 근거리(기본) / 원거리 LOD·원경(userData.farMaterial, 가벼운 변형) / 고랑 형상(userData.ridgeMaterial) 세 변형이
// 같은 유니폼·텍스처를 함께 쓴다.
export function createTerrainMaterial(terrain) {
  const G = CONFIG.ground;
  const tex = groundTextures(G.textureSize, [...G.layerTile, G.detailTile]);
  const macro = groundMacroTexture();
  const mask = terrain.groundMaskTextures();
  const parcels = [];
  for (let i = 0; i < MAX_PARCELS; i++) {
    const p = terrain.parcels[i];
    parcels.push(p ? new THREE.Vector4(p.dirX, p.dirZ, p.spacing, p.depth) : new THREE.Vector4(0, 1, 1, 0));
  }
  // 궤도 자국 선분: 좌우 궤도 띠는 중심선과 평행하므로 중심선 방향·좌표로 궤도판 무늬를 그린다
  const trackSegs = [];
  for (const tr of MAP.vehicleTracks || []) {
    for (let i = 0; i < tr.points.length - 1 && trackSegs.length < MAX_TRACK_SEGS; i++) {
      trackSegs.push(new THREE.Vector4(tr.points[i][0], tr.points[i][1], tr.points[i + 1][0], tr.points[i + 1][1]));
    }
  }
  while (trackSegs.length < MAX_TRACK_SEGS) trackSegs.push(new THREE.Vector4(1e5, 1e5, 1e5 + 1, 1e5));
  const uniforms = {
    tSplatA: { value: mask.a },
    tSplatB: { value: mask.b },
    tGAlb: { value: tex.albedo },
    tGAlbLo: { value: tex.albedoLow },
    tGNrm: { value: tex.normal },
    tMacro: { value: macro },
    uParcel: { value: parcels },
    uTrackSeg: { value: trackSegs },
    // 물·젖은 흙에 비치는 흐린 하늘 (지평선 색). 대기 쪽에서 바꾸면 여기 값을 갱신하면 된다
    uSkyRefl: { value: new THREE.Color(CONFIG.atmosphere.skyHorizon) },
    // 화면 높이의 절반 (px) — 고랑 형상이 화면 간격에 맞춰 납작해지는 계산용, 매 프레임 갱신
    uHalfH: { value: 360 },
  };
  // 렌더 직전에 이방성 필터 설정: 알베도는 항상 GPU 최대값 (밉맵 + 이방성: 먼 바닥이 길게 번지지 않게).
  // 노멀·두 번째 층·혼합 마스크는 그래픽 품질 '높음'(지형 LOD 거리 >= ground.fullAnisotropyLod)이면 GPU 최대값,
  // 보통·낮음은 normalAnisotropy·maskAnisotropy (비용 절약, 낮은 각도에선 어차피 평평해짐). 큰 규모 노이즈는 1.
  // 품질 프리셋을 바꾸면(지형 LOD 거리가 바뀌면) 다음 렌더에서 다시 맞춘다
  let anisoKey = -1;
  const size = new THREE.Vector2();
  const onTerrainRender = (renderer) => {
    uniforms.uHalfH.value = renderer.getDrawingBufferSize(size).y * 0.5;
    const lod = CONFIG.terrain.mesh.lodDistance;
    if (anisoKey === lod) return;
    anisoKey = lod;
    const a = renderer.capabilities.getMaxAnisotropy();
    const full = lod >= G.fullAnisotropyLod;
    const want = [
      [tex.albedo, a],
      [tex.albedoLow, full ? a : Math.min(a, G.normalAnisotropy)],
      [tex.normal, full ? a : Math.min(a, G.normalAnisotropy)],
      [mask.a, full ? a : Math.min(a, G.maskAnisotropy)],
      [mask.b, full ? a : Math.min(a, G.maskAnisotropy)],
      [macro, 1],
    ];
    for (const [t, v] of want) {
      if (t.anisotropy !== v) {
        t.anisotropy = v;
        t.needsUpdate = true;
      }
    }
  };
  const make = (variant) => {
    const parts = terrainShaderParts({ maskN: mask.N, half: terrain.half, variant });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    mat.name = variant === 'near' ? 'terrain' : 'terrain_' + variant;
    mat.userData.terrainUniforms = uniforms;
    mat.userData.onTerrainRender = onTerrainRender;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${parts.vertPars}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${parts.vertNormal}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${parts.vertBegin}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${parts.vertProject}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${parts.fragPars}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${parts.fragMain}`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tN, 0.0)).xyz);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tEmis;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${parts.fragLights}`);
    };
    mat.customProgramCacheKey = () => 'terrainSplat_' + variant;
    return mat;
  };
  const mat = make('near');
  mat.userData.farMaterial = make('far');
  const ridge = make('ridge');
  // 고랑 바닥이 내린 지면과 거의 겹치므로 앞으로 당겨 그린다
  ridge.polygonOffset = true;
  ridge.polygonOffsetFactor = -1;
  ridge.polygonOffsetUnits = -1;
  mat.userData.ridgeMaterial = ridge;
  return mat;
}

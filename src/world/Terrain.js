// =============================================================================
// Terrain — 높이장(0.5m 격자)에 수로·참호·포탄 구덩이 등을 실제로 파낸 지형.
// 충돌·높이 질의는 이 격자를 쓰고, 렌더 메시는 구역별 해상도로 따로 만든다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG, SURFACES } from '../config.js';
import { MAP } from './mapData.js';
import { Random } from '../core/Random.js';
import { Noise2D } from './noise.js';
import { clamp, smoothstep, polylineDistance } from '../core/mathUtils.js';

const SID = Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, v.id]));

// 지면 기본 색 (sRGB)
const SURFACE_COLORS = {
  [SID.plowed]: 0x2f2721,
  [SID.grass]: 0x6c6550,
  [SID.road]: 0x43392f,
  [SID.wetMud]: 0x302a24,
  [SID.rubble]: 0x6c6760,
  [SID.sunflower]: 0x2e2620,
  [SID.trench]: 0x41352a,
  [SID.crater]: 0x3d3229,
  [SID.water]: 0x2b2a27,
  [SID.concrete]: 0x6f6d68,
};
// 디테일 텍스처 선택 가중치 (soil, grass, mud)
const SURFACE_MASK = {
  [SID.plowed]: [1, 0, 0.15],
  [SID.grass]: [0.25, 1, 0],
  [SID.road]: [0.1, 0, 1],
  [SID.wetMud]: [0.1, 0, 1],
  [SID.rubble]: [1, 0, 0],
  [SID.sunflower]: [1, 0.15, 0.1],
  [SID.trench]: [1, 0, 0.35],
  [SID.crater]: [1, 0, 0.3],
  [SID.water]: [0, 0, 1],
  [SID.concrete]: [0.6, 0, 0.4],
};

// 0..1 구간 비대칭 혹 (peak 위치에서 최대 1)
function bump(t, peak = 0.5) {
  if (t <= 0 || t >= 1) return 0;
  if (t < peak) return Math.sin((Math.PI / 2) * (t / peak));
  return Math.cos((Math.PI / 2) * ((t - peak) / (1 - peak)));
}

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
    this._tmp = {};
    this._n = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ 질의
  baseHeight(x, z) {
    const W = CONFIG.world;
    const slope = clamp((MAP.canal.z - z) * W.northRiseSlope, -1.6, 3.2);
    return slope + 0.55 * this.noise.fbm(x / 170, z / 170, 3) + 0.13 * this.noise.fbm(x / 33 + 11, z / 33 - 5, 2);
  }

  heightAt(x, z) {
    const fx = (x + this.half) / this.res;
    const fz = (z + this.half) / this.res;
    const n = this.n;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return this.baseHeight(x, z);
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

  isCanalLined(x) {
    for (const [a, b] of MAP.canal.linedSections) if (x >= a && x <= b) return true;
    return false;
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

  addDetail(x0, z0, x1, z1, resX, resZ = resX) {
    this.detailRegions.push({ x0, z0, x1, z1, resX, resZ });
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
    this.footprints = this.buildingFootprints();
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
  }

  buildCraterList() {
    const rng = this.rng;
    for (const c of MAP.craters) this.craters.push({ ...c });
    const excl = MAP.craterExclusions;
    const fps = this.footprints;
    const roads = MAP.roads;
    const solids = [MAP.apc, MAP.tractor, ...MAP.cars, ...MAP.dugouts];
    const want = CONFIG.world.craterCount;
    let tries = 0;
    let made = 0;
    while (made < want && tries < 4000) {
      tries++;
      const south = made < 9;
      const x = south ? rng.range(-220, 220) : rng.range(-235, 235);
      // 북쪽(참호·건물 근처)일수록 밀도가 높다
      const z = south ? rng.range(128, 250) : -215 + Math.pow(rng.next(), 1.35) * 305;
      let r = rng.range(1.0, 3.7);
      if (rng.chance(0.1)) r = rng.range(3.7, 4.1);
      const d = clamp(r * rng.range(0.3, 0.5), 0.5, 2.0);
      let ok = true;
      for (const e of excl) if (x > e.x0 - r && x < e.x1 + r && z > e.z0 - r && z < e.z1 + r) ok = false;
      for (const f of fps) if (Math.abs(x - f.x) < f.hx + r + 2 && Math.abs(z - f.z) < f.hz + r + 2) ok = false;
      for (const s of solids) if (Math.hypot(x - s.x, z - s.z) < r + 6) ok = false;
      for (const c of this.craters) if (Math.hypot(x - c.x, z - c.z) < r + c.r + 1.5) ok = false;
      if (ok) {
        for (const rd of roads) if (polylineDistance(rd.points, x, z) < rd.width / 2 + r + 0.5) ok = false;
      }
      if (ok) {
        for (const line of MAP.trench.lines) if (polylineDistance(line, x, z) < r + 4) ok = false;
      }
      if (!ok) continue;
      this.craters.push({ x, z, r, d });
      made++;
    }
  }

  applyCrater(c) {
    const R = c.r;
    const D = c.d;
    const rimW = 0.55 * R;
    const rimH = 0.12 * D + 0.06;
    const ext = R + rimW * 1.7;
    this.addDetail(c.x - ext, c.z - ext, c.x + ext, c.z + ext, 1.0);
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
    if (D >= 1.15) {
      this.puddles.push({ type: 'disc', x: c.x, z: c.z, r: R * 0.42, y: null, crater: c });
    }
  }

  applyCanal() {
    const C = MAP.canal;
    // 수로는 동서로 길어 횡단면(z)만 촘촘하면 된다
    this.addDetail(C.xMin, C.z - 7, C.xMax, C.z + 7, 1.0, 0.5);
    this.stamp(C.xMin, C.z - 7.5, C.xMax, C.z + 7.5, (x, z, k) => {
      const zc = this.canalZ(x);
      const dz = z - zc;
      const d = Math.abs(dz);
      if (d > 7) return;
      const north = dz < 0;
      const lined = this.isCanalLined(x);
      const fh = lined ? C.linedFloorHalf : C.floorHalf;
      const th = lined ? C.linedTopHalf : C.topHalf;
      const cross = smoothstep(C.crossing.halfWidth * 0.5, C.crossing.halfWidth + 1.4, Math.abs(x - C.crossing.x));
      const depth = C.depth * cross;
      let dh = 0;
      if (d <= fh) dh = -depth;
      else if (d < th) {
        const t = (d - fh) / (th - fh);
        dh = -depth * (1 - t * t * (3 - 2 * t));
      }
      if (north) {
        // 북쪽 둔덕: 수로 가장자리 가까이에 쌓인 흙 (총을 걸칠 수 있다)
        let bh = C.berm.height + C.berm.heightVar * this.noise.noise(x / 23, 3.3);
        if (this.noise.noise(x / 41, 7.7) < -0.42) bh *= 0.25;
        for (const m of C.mounds) {
          const t = Math.abs(x - m.x) / (m.len * 0.5);
          if (t < 1.4) bh = Math.max(bh, m.h * (1 - smoothstep(0.55, 1.4, t)));
        }
        dh += Math.max(0, bh) * bump((d - th * 0.92) / C.berm.width, 0.28) * cross;
      } else {
        dh += C.southBank.height * bump((d - th) / C.southBank.width, 0.4) * cross;
      }
      if (cross < 1) dh += (1 - cross) * 0.18 * (d < 5 ? 1 - d / 5 : 0);
      this.h[k] += dh;
    });
    // 수로 물웅덩이 구간
    for (const [a, b] of C.waterSections) {
      this.puddles.push({ type: 'canal', x0: a, x1: b });
    }
  }

  trenchProfile(line, T, withParapet) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of line) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const ext = T.topHalf + (withParapet ? T.parapet.width : 1.6) + 0.6;
    this.addDetail(x0 - ext, z0 - ext, x1 + ext, z1 + ext, 0.5);
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

  applyTrenches() {
    const T = MAP.trench;
    for (const line of T.lines) this.trenchProfile(line, T, true);
    const comm = { depth: T.commDepth, floorHalf: 0.4, topHalf: 0.75 };
    for (const line of T.commLines) this.trenchProfile(line, comm, false);
    // 엄체호: 통나무 지붕 위로 덮은 흙 둔덕
    for (const dgt of MAP.dugouts) {
      const ext = Math.max(dgt.w, dgt.d) * 0.5 + 1.8;
      this.addDetail(dgt.x - ext, dgt.z - ext, dgt.x + ext, dgt.z + ext, 0.5);
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

  applyRoads() {
    const tmp = this._tmp;
    for (const rd of MAP.roads) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const [x, z] of rd.points) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      const hw = rd.width / 2;
      const ext = hw + 1.6;
      this.stamp(x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
        const d = polylineDistance(rd.points, x, z, tmp);
        if (d > ext) return;
        // 수로 바로 위는 건드리지 않는다
        if (Math.abs(z - this.canalZ(x)) < 4 && Math.abs(x - MAP.canal.crossing.x) > MAP.canal.crossing.halfWidth + 1) return;
        let dh = 0;
        if (d < hw) {
          dh = -0.07;
          const rd2 = Math.abs(d - 0.85);
          if (rd2 < 0.3) dh -= 0.1 * (1 - rd2 / 0.3);
        } else if (d < hw + 1.2) dh = 0.05 * Math.sin((Math.PI * (d - hw)) / 1.2);
        this.h[k] += dh;
      });
      // 바퀴 자국 웅덩이
      for (let i = 1; i < rd.points.length - 1; i++) {
        const [ax, az] = rd.points[i];
        const [bx, bz] = rd.points[i + 1];
        const segs = Math.floor(Math.hypot(bx - ax, bz - az) / 11);
        for (let s = 0; s < segs; s++) {
          if (!this.rng.chance(0.42)) continue;
          const t = (s + this.rng.next()) / Math.max(1, segs);
          const px = ax + (bx - ax) * t;
          const pz = az + (bz - az) * t;
          if (Math.abs(pz - this.canalZ(px)) < 6) continue;
          const len = Math.hypot(bx - ax, bz - az);
          const nx = -(bz - az) / len;
          const nz = (bx - ax) / len;
          const side = this.rng.chance(0.5) ? 0.85 : -0.85;
          this.puddles.push({
            type: 'disc',
            x: px + nx * side,
            z: pz + nz * side,
            r: this.rng.range(0.5, 1.3),
            stretch: [(bx - ax) / len, (bz - az) / len, this.rng.range(1.6, 3.2)],
          });
        }
      }
    }
  }

  // ------------------------------------------------------------------ 지면 종류
  buildSurfaces() {
    const sn = this.sn;
    const half = this.half;
    const sres = this.sres;
    const F = MAP.fields;
    const nz = this.noise;
    for (let j = 0; j < sn; j++) {
      const z = -half + j * sres;
      for (let i = 0; i < sn; i++) {
        const x = -half + i * sres;
        let s = SID.grass;
        const edge = nz.noise(x / 9, z / 9) * 4;
        for (const r of F.plowed) if (x > r.x0 + edge && x < r.x1 - edge && z > r.z0 + edge && z < r.z1 - edge) s = SID.plowed;
        for (const r of F.sunflower) if (x > r.x0 + edge && x < r.x1 - edge && z > r.z0 + edge && z < r.z1 - edge) s = SID.sunflower;
        const fy = F.farmYard;
        if (x > fy.x0 + edge && x < fy.x1 - edge && z > fy.z0 + edge && z < fy.z1 - edge) {
          const v = nz.noise(x / 17 + 5, z / 17 - 2);
          s = v > 0.55 ? SID.rubble : v < -0.12 ? SID.grass : SID.road;
        }
        this.surf[j * sn + i] = s;
      }
    }
    const tmp = this._tmp;
    // 도로
    for (const rd of MAP.roads) {
      const hw = rd.width / 2 + 0.25;
      this.forPolylineSurf(rd.points, hw + 1, (x, z, k, d) => {
        if (d < hw) this.surf[k] = SID.road;
      });
    }
    // 수로
    const C = MAP.canal;
    this.stampSurf(C.xMin, C.z - 4, C.xMax, C.z + 4, (x, z, k) => {
      const d = Math.abs(z - this.canalZ(x));
      const cross = Math.abs(x - C.crossing.x) < C.crossing.halfWidth;
      if (cross) return;
      const th = this.isCanalLined(x) ? C.linedTopHalf : C.topHalf;
      if (d < th) {
        let wet = false;
        for (const [a, b] of C.waterSections) if (x >= a && x <= b) wet = true;
        this.surf[k] = wet && d < C.floorHalf * 0.9 ? SID.water : SID.wetMud;
      } else if (d < th + 1.2 && z < this.canalZ(x)) this.surf[k] = SID.crater; // 파낸 흙
    });
    // 참호
    const T = MAP.trench;
    for (const line of T.lines) {
      this.forPolylineSurf(line, T.topHalf + T.parapet.width, (x, z, k, d) => {
        polylineDistance(line, x, z, tmp);
        const front = tmp.side * tmp.nz > 0;
        if (d < T.topHalf + 0.2) this.surf[k] = SID.trench;
        else if (d < T.topHalf + (front ? T.parapet.width * 0.85 : 1.2)) this.surf[k] = SID.crater;
      });
    }
    for (const line of T.commLines) {
      this.forPolylineSurf(line, 2, (x, z, k, d) => {
        if (d < 0.95) this.surf[k] = SID.trench;
        else if (d < 1.8) this.surf[k] = SID.crater;
      });
    }
    // 구덩이
    for (const c of this.craters) {
      const ext = c.r * 1.25;
      this.stampSurf(c.x - ext, c.z - ext, c.x + ext, c.z + ext, (x, z, k) => {
        const r = Math.hypot(x - c.x, z - c.z);
        if (r < c.r * (1.1 + nz.noise(x, z) * 0.15)) this.surf[k] = SID.crater;
        if (c.d >= 1.15 && r < c.r * 0.4) this.surf[k] = SID.water;
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
        this.surf[k] = SID.crater;
      });
    }
    for (const f of this.footprints) {
      this.stampSurf(f.x - f.hx + 0.6, f.z - f.hz + 0.6, f.x + f.hx - 0.6, f.z + f.hz - 0.6, (x, z, k) => {
        this.surf[k] = SID.concrete;
      });
    }
  }

  forPolylineSurf(points, ext, fn) {
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
    this.stampSurf(x0 - ext, z0 - ext, x1 + ext, z1 + ext, (x, z, k) => {
      const d = polylineDistance(points, x, z);
      if (d <= ext) fn(x, z, k, d);
    });
  }

  // ------------------------------------------------------------------ 메시
  chunkResolution(x0, z0, x1, z1) {
    let rx = 2.5;
    let rz = 2.5;
    for (const r of this.detailRegions) {
      if (r.x1 < x0 || r.x0 > x1 || r.z1 < z0 || r.z0 > z1) continue;
      rx = Math.min(rx, r.resX);
      rz = Math.min(rz, r.resZ);
    }
    for (const rd of MAP.roads) {
      for (let i = 0; i < rd.points.length - 1; i++) {
        const [ax, az] = rd.points[i];
        const [bx, bz] = rd.points[i + 1];
        if (Math.max(ax, bx) + 4 < x0 || Math.min(ax, bx) - 4 > x1 || Math.max(az, bz) + 4 < z0 || Math.min(az, bz) - 4 > z1) continue;
        // 선분이 실제로 청크를 지나는지 (대략: 몇 점 샘플)
        let hit = false;
        for (let k = 0; k <= 20 && !hit; k++) {
          const px = ax + ((bx - ax) * k) / 20;
          const pz = az + ((bz - az) * k) / 20;
          if (px > x0 - 4 && px < x1 + 4 && pz > z0 - 4 && pz < z1 + 4) hit = true;
        }
        if (hit) {
          rx = Math.min(rx, 1.25);
          rz = Math.min(rz, 1.25);
        }
      }
    }
    return [rx, rz];
  }

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

  buildMesh(material) {
    const W = CONFIG.world;
    const half = this.half;
    const cs = W.chunkSize;
    const gs = W.groupSize;
    const groups = new Map();
    const col = new THREE.Color();
    const nchunk = Math.round((2 * half) / cs);
    let triCount = 0;
    for (let cj = 0; cj < nchunk; cj++) {
      for (let ci = 0; ci < nchunk; ci++) {
        const x0 = -half + ci * cs;
        const z0 = -half + cj * cs;
        const [rx, rz] = this.chunkResolution(x0 - 0.5, z0 - 0.5, x0 + cs + 0.5, z0 + cs + 0.5);
        const key = `${Math.floor((x0 + half) / gs)}_${Math.floor((z0 + half) / gs)}`;
        if (!groups.has(key)) groups.set(key, { pos: [], nor: [], colr: [], mask: [], idx: [] });
        triCount += this.buildChunk(groups.get(key), x0, z0, cs, rx, rz, col);
      }
    }
    const meshGroup = new THREE.Group();
    meshGroup.name = 'terrain';
    for (const g of groups.values()) meshGroup.add(this.makeMesh(g, material));
    // 원경 지형
    const far = { pos: [], nor: [], colr: [], mask: [], idx: [] };
    triCount += this.buildFar(far, col);
    const farMesh = this.makeMesh(far, material);
    farMesh.receiveShadow = false;
    meshGroup.add(farMesh);
    this.triangleCount = triCount;
    return meshGroup;
  }

  makeMesh(g, material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.colr, 3));
    geo.setAttribute('aMask', new THREE.Float32BufferAttribute(g.mask, 3));
    const vcount = g.pos.length / 3;
    geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(g.idx, 1) : new THREE.Uint16BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  vertexAttribs(x, z, h, rx, rz, g, col) {
    // 법선 (청크 해상도 간격의 중앙차분)
    const sx = (this.gridHeight(x + rx, z) - this.gridHeight(x - rx, z)) / (2 * rx);
    const sz = (this.gridHeight(x, z + rz) - this.gridHeight(x, z - rz)) / (2 * rz);
    let nx = -sx;
    let ny = 1;
    let nzz = -sz;
    const nl = Math.hypot(nx, ny, nzz);
    nx /= nl;
    ny /= nl;
    nzz /= nl;
    g.nor.push(nx, ny, nzz);
    // 색: 지면 종류 + 변화 + 오목한 곳 어둡게
    const s = this.surfaceAt(x, z);
    col.setHex(SURFACE_COLORS[s] ?? 0x5a5040);
    const v1 = this.noise.noise(x / 7.3, z / 7.3);
    const v2 = this.noise.noise(x / 1.9 + 3, z / 1.9 - 7);
    let k = 1 + 0.13 * v1 + 0.05 * v2;
    const r2 = 2.0;
    const avg = (this.heightAt(x + r2, z) + this.heightAt(x - r2, z) + this.heightAt(x, z + r2) + this.heightAt(x, z - r2)) * 0.25;
    const ao = clamp(1 + (h - avg) * 0.45, 0.55, 1.1);
    k *= ao;
    // 풀밭은 노랑-회색 사이 변화
    if (s === SID.grass) {
      const t = 0.5 + 0.5 * this.noise.noise(x / 18 + 40, z / 18);
      col.r *= 0.9 + t * 0.2;
      col.b *= 1.05 - t * 0.2;
    }
    g.colr.push(col.r * k, col.g * k, col.b * k);
    const m = SURFACE_MASK[s] ?? [1, 0, 0];
    g.mask.push(m[0], m[1], m[2]);
  }

  buildChunk(g, x0, z0, size, rx, rz, col) {
    const nvx = Math.round(size / rx) + 1;
    const nvz = Math.round(size / rz) + 1;
    const base = g.pos.length / 3;
    for (let j = 0; j < nvz; j++) {
      const z = z0 + j * rz;
      for (let i = 0; i < nvx; i++) {
        const x = x0 + i * rx;
        const h = this.gridHeight(x, z);
        g.pos.push(x, h, z);
        this.vertexAttribs(x, z, h, rx, rz, g, col);
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
    // 스커트 (해상도가 다른 청크 사이 틈 가림)
    const sd = CONFIG.world.skirtDepth;
    const edges = [
      { list: [...Array(nvx).keys()].map((i) => i) },
      { list: [...Array(nvx).keys()].map((i) => (nvz - 1) * nvx + i) },
      { list: [...Array(nvz).keys()].map((j) => j * nvx) },
      { list: [...Array(nvz).keys()].map((j) => j * nvx + nvx - 1) },
    ];
    for (const e of edges) {
      const start = g.pos.length / 3;
      for (const local of e.list) {
        const vi = base + local;
        g.pos.push(g.pos[vi * 3], g.pos[vi * 3 + 1] - sd, g.pos[vi * 3 + 2]);
        g.nor.push(g.nor[vi * 3], g.nor[vi * 3 + 1], g.nor[vi * 3 + 2]);
        g.colr.push(g.colr[vi * 3] * 0.8, g.colr[vi * 3 + 1] * 0.8, g.colr[vi * 3 + 2] * 0.8);
        g.mask.push(g.mask[vi * 3], g.mask[vi * 3 + 1], g.mask[vi * 3 + 2]);
      }
      for (let k = 0; k < e.list.length - 1; k++) {
        const a = base + e.list[k];
        const b = base + e.list[k + 1];
        const c = start + k;
        const d = start + k + 1;
        // 양면처럼 보이게 두 방향 모두
        g.idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
        tris += 4;
      }
    }
    return tris;
  }

  buildFar(g, col) {
    const W = CONFIG.world;
    const ext = W.farExtent;
    const step = W.farRes;
    const half = this.half;
    const nv = Math.round((2 * ext) / step) + 1;
    const base = g.pos.length / 3;
    const fieldNoise = (x, z) => this.noise.noise(x / 260 + 50, z / 260 - 20);
    for (let j = 0; j < nv; j++) {
      const z = -ext + j * step;
      for (let i = 0; i < nv; i++) {
        const x = -ext + i * step;
        const inside = Math.abs(x) <= half && Math.abs(z) <= half;
        const h = inside ? this.gridHeight(x, z) - 0.05 : this.baseHeight(x, z) - 0.05;
        g.pos.push(x, h, z);
        g.nor.push(0, 1, 0);
        const f = fieldNoise(x, z);
        col.setHex(f > 0.15 ? 0x3a3128 : f < -0.25 ? 0x6e6650 : 0x5c5541);
        g.colr.push(col.r, col.g, col.b);
        g.mask.push(0.5, 0.5, 0);
      }
    }
    let tris = 0;
    for (let j = 0; j < nv - 1; j++) {
      for (let i = 0; i < nv - 1; i++) {
        const cx = -ext + (i + 0.5) * step;
        const cz = -ext + (j + 0.5) * step;
        if (Math.abs(cx) < half && Math.abs(cz) < half) continue; // 맵 안쪽은 비움
        const a = base + j * nv + i;
        const b = a + 1;
        const c = a + nv;
        const d = c + 1;
        g.idx.push(a, c, b, b, c, d);
        tris += 2;
      }
    }
    return tris;
  }
}

// 지형 재질: 정점색 × 지면별 디테일 텍스처
export function createTerrainMaterial(textures) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tSoil = { value: textures.soil };
    shader.uniforms.tGrass = { value: textures.grass };
    shader.uniforms.tMud = { value: textures.mud };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aMask;\nvarying vec3 vMask;\nvarying vec3 vWPos;\nvarying float vViewDist;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMask = aMask;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\nvViewDist = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tSoil;\nuniform sampler2D tGrass;\nuniform sampler2D tMud;\nvarying vec3 vMask;\nvarying vec3 vWPos;\nvarying float vViewDist;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 wp = vWPos.xz;
          float s1 = texture2D(tSoil, wp * 0.31).r;
          float s2 = texture2D(tSoil, wp * 0.047 + 0.31).r;
          float dSoil = s1 * s2 * 2.0;
          float dGrass = texture2D(tGrass, wp * 0.43).r * (0.75 + 0.5 * s2);
          float dMud = texture2D(tMud, wp * 0.19).r * (0.8 + 0.4 * s2);
          vec3 m = vMask / max(vMask.x + vMask.y + vMask.z, 0.001);
          float detail = (dSoil * m.x + dGrass * m.y + dMud * m.z) * 2.0;
          float fade = smoothstep(70.0, 260.0, vViewDist);
          detail = mix(detail, 1.0, fade * 0.7);
          diffuseColor.rgb *= detail;
        }`,
      );
  };
  return mat;
}

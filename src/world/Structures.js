// =============================================================================
// Structures — 축사·저장탑·창고·잔해·장갑차·트랙터·차량·송전탑·나무 등.
// 보이는 기하는 재질별로 병합하고, 충돌은 단순 상자/원기둥(재질 태그)으로 따로 등록한다.
// =============================================================================
import * as THREE from 'three';
import { MAP } from './mapData.js';
import { boxGeo, cylGeo, gableGeo, wedgeGeo, place } from './geom.js';
import { clamp } from '../core/mathUtils.js';

const _v = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// 물체 좌표계 (yaw 회전)
function frame(x, z, rot, y = 0) {
  return { x, y, z, rot, cos: Math.cos(rot), sin: Math.sin(rot) };
}
function toW(o, lx, lz) {
  return [o.x + lx * o.cos + lz * o.sin, o.z - lx * o.sin + lz * o.cos];
}

function offsetUV(g, du, dv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  return g;
}

function subtractInterval(list, a, b) {
  const out = [];
  for (const [x, y] of list) {
    if (b <= x || a >= y) out.push([x, y]);
    else {
      if (a > x) out.push([x, a]);
      if (b < y) out.push([b, y]);
    }
  }
  return out;
}

// 해시 기반 0..1 (결정적 들쭉날쭉)
function hash1(v) {
  const s = Math.sin(v * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// 인스턴스(잔해 조각·모래주머니 등) 모음
export class InstanceCollector {
  constructor() {
    this.sets = new Map();
  }

  add(key, x, y, z, rx, ry, rz, sx, sy, sz, color = 0xffffff) {
    if (!this.sets.has(key)) this.sets.set(key, []);
    this.sets.get(key).push({ x, y, z, rx, ry, rz, sx, sy, sz, color });
  }
}

export class StructureBuilder {
  constructor({ batch, col, terrain, rng, inst }) {
    this.batch = batch;
    this.col = col;
    this.terrain = terrain;
    this.rng = rng;
    this.inst = inst;
    this.wires = []; // [x,y,z,x,y,z,...] 선분들
    this.extras = []; // 별도 메시
  }

  buildAll(materials) {
    for (const b of MAP.barns) this.barn(b);
    this.silo(MAP.silo);
    this.garage(MAP.garage);
    for (const r of MAP.ruins) this.ruin(r);
    for (const m of this.terrain.rubbleMounds) this.rubblePile(m.x, m.z, m.r * 0.85, Math.round(m.r * 22));
    for (const d of MAP.dugouts) this.dugout(d);
    this.trenchDetails();
    this.barricade(MAP.barricade);
    for (const n of MAP.camoNets) this.camoNet(n, materials);
    this.apc(MAP.apc);
    this.tractor(MAP.tractor);
    for (const c of MAP.cars) this.car(c);
    this.pylons();
    for (const t of MAP.trees) this.tree(t);
    for (const [x, z] of MAP.stumps) this.stump(x, z);
    this.canalWalls();
    this.culvert();
    this.fieldDebris();
  }

  // ------------------------------------------------------------------ 벽
  // w: {ox, oz, ux, uz, len, thick, y0, height, openings, collapses, matKey, colMat, tag, color}
  wall(w) {
    const bps = new Set([0, w.len]);
    for (const o of w.openings) {
      bps.add(clamp(o.s0, 0, w.len));
      bps.add(clamp(o.s1, 0, w.len));
    }
    for (const c of w.collapses) {
      for (let s = c.s0; s < c.s1; s += 0.55) bps.add(clamp(s, 0, w.len));
      bps.add(clamp(c.s1, 0, w.len));
    }
    const arr = [...bps].sort((a, b) => a - b);
    const yaw = Math.atan2(-w.uz, w.ux);
    const uvs = w.uvScale || 2;
    for (let i = 0; i < arr.length - 1; i++) {
      const sa = arr[i];
      const sb = arr[i + 1];
      if (sb - sa < 0.02) continue;
      const mid = (sa + sb) * 0.5;
      let top = w.height;
      let broken = false;
      for (const c of w.collapses) {
        if (mid > c.s0 && mid < c.s1) {
          top = Math.min(top, c.h + (hash1(mid + w.ox) - 0.5) * 0.7);
          broken = true;
        }
      }
      let intervals = [[0, top]];
      let nearHole = false;
      for (const o of w.openings) {
        if (o.s0 <= sa + 1e-3 && o.s1 >= sb - 1e-3) intervals = subtractInterval(intervals, o.y0, o.y1);
        if (o.hole && sb > o.s0 - 0.8 && sa < o.s1 + 0.8) nearHole = true;
      }
      for (const [ya, yb] of intervals) {
        if (yb - ya < 0.03) continue;
        const cx = w.ox + w.ux * mid;
        const cz = w.oz + w.uz * mid;
        const cy = w.y0 + (ya + yb) * 0.5;
        const g = boxGeo(sb - sa, yb - ya, w.thick, uvs);
        offsetUV(g, sa / uvs, ya / uvs);
        place(g, cx, cy, cz, yaw);
        const dark = nearHole || broken ? 0.62 : 1;
        const c = new THREE.Color(w.color || 0xffffff).multiplyScalar(dark);
        this.batch.add(w.matKey, g, c, 0.18);
        if (w.colMat) this.col.addBox(cx, cy, cz, (sb - sa) / 2, (yb - ya) / 2, w.thick / 2, yaw, w.colMat, w.tag);
      }
    }
  }

  // ------------------------------------------------------------------ 축사
  barn(b) {
    const rng = this.rng;
    const floorY = this.terrain.heightAt(b.x, b.z);
    const o = frame(b.x, b.z, b.rot, floorY);
    const L = b.length;
    const W = b.width;
    const H = b.height;
    const t = 0.38;
    const matKey = b.brick === 'red' ? 'brickRed' : 'brickWhite';
    const sides = {
      south: { a: [-L / 2, W / 2 - t / 2], b: [L / 2, W / 2 - t / 2] },
      north: { a: [-L / 2, -(W / 2 - t / 2)], b: [L / 2, -(W / 2 - t / 2)] },
      east: { a: [L / 2 - t / 2, -W / 2 + t], b: [L / 2 - t / 2, W / 2 - t] },
      west: { a: [-(L / 2 - t / 2), -W / 2 + t], b: [-(L / 2 - t / 2), W / 2 - t] },
    };
    for (const [side, sd] of Object.entries(sides)) {
      const [ax, az] = toW(o, sd.a[0], sd.a[1]);
      const [bx, bz] = toW(o, sd.b[0], sd.b[1]);
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const openings = [];
      const centerS = (s) => s + len / 2;
      for (const h of b.holes.filter((h) => h.side === side)) {
        openings.push({ s0: centerS(h.s - h.w / 2), s1: centerS(h.s + h.w / 2), y0: h.y0, y1: h.y1, hole: true });
        // 구멍 아래 벽돌 잔해
        const [hx, hz] = toW(o, ...this.wallLocal(side, h.s, L, W, t, 0));
        this.rubblePile(hx, hz, 1.1 + h.w * 0.25, Math.round(14 + h.w * 8), b.brick);
      }
      for (const h of b.loopholes.filter((h) => h.side === side)) {
        openings.push({ s0: centerS(h.s - h.w / 2), s1: centerS(h.s + h.w / 2), y0: h.y0, y1: h.y1 });
      }
      for (const d of b.doors.filter((d) => d.side === side)) {
        openings.push({ s0: centerS(d.s - d.w / 2), s1: centerS(d.s + d.w / 2), y0: 0, y1: d.h, door: d });
      }
      // 창문
      const long = side === 'south' || side === 'north';
      if (long) {
        for (let s = -L / 2 + 3; s <= L / 2 - 3; s += b.windowSpacing) {
          const s0 = centerS(s - 0.55);
          const s1 = centerS(s + 0.55);
          if (openings.some((op) => s1 > op.s0 - 0.4 && s0 < op.s1 + 0.4)) continue;
          openings.push({ s0, s1, y0: 1.05, y1: 1.85 });
        }
      } else {
        for (const s of [-W / 2 + 2.6, W / 2 - 2.6]) {
          const s0 = centerS(s - 0.5);
          const s1 = centerS(s + 0.5);
          if (openings.some((op) => s1 > op.s0 - 0.4 && s0 < op.s1 + 0.4)) continue;
          openings.push({ s0, s1, y0: 1.05, y1: 1.85 });
        }
      }
      const collapses = b.collapse.filter((c) => c.side === side).map((c) => ({ s0: centerS(c.s0), s1: centerS(c.s1), h: c.h }));
      for (const c of collapses) {
        const sm = (c.s0 + c.s1) / 2 - len / 2;
        const [px, pz] = toW(o, ...this.wallLocal(side, sm, L, W, t, 0));
        this.rubblePile(px, pz, 2.2, 60, b.brick);
      }
      this.wall({ ox: ax, oz: az, ux, uz, len, thick: t, y0: floorY, height: H, openings, collapses, matKey, colMat: 'brick', tag: b.id });
      // 창틀 위 콘크리트 인방 (밋밋함 방지): 생략
      // 문
      for (const op of openings.filter((p) => p.door && p.door.wood)) {
        const sMid = (op.s0 + op.s1) / 2;
        const cx = ax + ux * sMid;
        const cz = az + uz * sMid;
        const yaw = Math.atan2(-uz, ux);
        const leafW = (op.s1 - op.s0) / 2;
        // 닫힌 문짝 하나 (나무 — 관통 가능)
        const lx = cx - ux * leafW * 0.5;
        const lz = cz - uz * leafW * 0.5;
        this.batch.add('wood', place(boxGeo(leafW, op.y1, 0.06, 1.5), lx, floorY + op.y1 / 2, lz, yaw), 0xb8a890);
        this.col.addBox(lx, floorY + op.y1 / 2, lz, leafW / 2, op.y1 / 2, 0.04, yaw, 'wood', b.id + '_door');
        // 열린 문짝
        const hx = cx + ux * leafW;
        const hz = cz + uz * leafW;
        const openYaw = yaw + 1.9;
        const ox2 = hx + Math.cos(openYaw) * leafW * -0.5;
        const oz2 = hz - Math.sin(openYaw) * leafW * -0.5;
        this.batch.add('wood', place(boxGeo(leafW, op.y1 * 0.95, 0.06, 1.5), ox2, floorY + op.y1 * 0.48, oz2, openYaw), 0xa89880);
        this.col.addBox(ox2, floorY + op.y1 * 0.48, oz2, leafW / 2, op.y1 * 0.47, 0.04, openYaw, 'wood', b.id + '_door');
      }
      // 박공 (짧은 벽)
      if (!long && !collapses.length) {
        const [gx, gz] = toW(o, (sd.a[0] + sd.b[0]) / 2, 0);
        const g = gableGeo(W, 1.8, t, 2);
        place(g, gx, floorY + H, gz, Math.atan2(-uz, ux));
        this.batch.add(matKey, g, 0xdddddd);
        this.col.addBox(gx, floorY + H + 0.6, gz, W * 0.25, 0.6, t / 2, Math.atan2(-uz, ux), 'brick', b.id);
      }
    }
    // 바닥 콘크리트
    const [fx, fz] = toW(o, 0, 0);
    this.batch.add('concrete', place(boxGeo(L - 2 * t, 0.1, W - 2 * t, 3), fx, floorY + 0.04, fz, b.rot), 0x8a8780);
    // 칸막이벽 (얇은 벽: 관통 가능)
    for (const p of b.partitions) {
      const segs = [
        [-W / 2 + t, -1.0],
        [1.0, W / 2 - t],
      ];
      for (const [z0, z1] of segs) {
        const [px, pz] = toW(o, p.s, (z0 + z1) / 2);
        const len = z1 - z0;
        const g = boxGeo(0.12, 2.3, len, 2);
        place(g, px, floorY + 1.15, pz, b.rot);
        this.batch.add(matKey, g, 0xcfcfcf, 0.2);
        this.col.addBox(px, floorY + 1.15, pz, 0.06, 1.15, len / 2, b.rot, 'thinWall', b.id + '_part');
      }
    }
    // 지붕 트러스와 슬레이트
    const ridge = 1.8;
    const rafterLen = Math.hypot(W / 2, ridge);
    const slope = Math.atan2(ridge, W / 2);
    const kept = [];
    for (let s = -L / 2 + 1.5; s <= L / 2 - 1.4; s += 3) {
      const keep = rng.next() < b.roofKeep || (Math.abs(s) > L / 2 - 3 && rng.next() < 0.7);
      kept.push(keep);
      for (const sgn of [1, -1]) {
        if (!keep && rng.next() < 0.75) continue;
        const [rx, rz] = toW(o, s, (sgn * W) / 4);
        if (keep) {
          const g = boxGeo(0.12, 0.18, rafterLen, 1);
          place(g, rx, floorY + H + ridge / 2, rz, [sgn * slope, b.rot, 0, 'YXZ']);
          this.batch.add('wood', g, 0x6b5a48);
        } else {
          // 부러져 축사 안으로 늘어진 서까래
          const g = boxGeo(0.12, 0.18, rafterLen * 0.8, 1);
          const [rx2, rz2] = toW(o, s, (sgn * W) / 3.2);
          place(g, rx2, floorY + H * 0.62, rz2, [sgn * -0.75, b.rot, 0.2, 'YXZ']);
          this.batch.add('wood', g, 0x50443a);
        }
      }
      if (keep) {
        const [tx, tz] = toW(o, s, 0);
        const g = boxGeo(0.12, 0.16, W - 2 * t, 1);
        place(g, tx, floorY + H - 0.1, tz, b.rot);
        this.batch.add('wood', g, 0x6b5a48);
      }
    }
    // 슬레이트 지붕판 (관통 가능)
    let bayIndex = 0;
    for (let s = -L / 2 + 1.5; s < L / 2 - 4.4; s += 3, bayIndex++) {
      if (!kept[bayIndex] || !kept[bayIndex + 1]) continue;
      for (const sgn of [1, -1]) {
        if (rng.next() > 0.62) continue;
        const sm = s + 1.5;
        const [rx, rz] = toW(o, sm, (sgn * W) / 4);
        const rot = { x: sgn * slope, y: b.rot, z: 0, order: 'YXZ' };
        const g = boxGeo(3.05, 0.03, rafterLen + 0.3, 1.2);
        place(g, rx, floorY + H + ridge / 2 + 0.12, rz, [rot.x, rot.y, 0, 'YXZ']);
        this.batch.add('slate', g, 0xd0d0cc);
        this.col.addBox(rx, floorY + H + ridge / 2 + 0.12, rz, 1.52, 0.02, (rafterLen + 0.3) / 2, rot, 'slate', b.id + '_roof', { walkable: false, blocksMove: false });
      }
    }
    // 바닥에 떨어진 슬레이트·잔해
    for (let k = 0; k < Math.round(L / 6); k++) {
      const s = (rng.next() - 0.5) * (L - 4);
      const lz = (rng.next() - 0.5) * (W - 4);
      const [px, pz] = toW(o, s, lz);
      const g = boxGeo(rng.range(1.2, 2.6), 0.03, rng.range(0.9, 1.6), 1.2);
      place(g, px, floorY + 0.2 + rng.next() * 0.25, pz, [rng.range(-0.35, 0.35), rng.next() * Math.PI, rng.range(-0.3, 0.3)]);
      this.batch.add('slate', g, 0xb8b8b2);
      if (rng.next() < 0.5) this.rubblePile(px + rng.range(-1, 1), pz + rng.range(-1, 1), 0.9, 16, b.brick);
    }
    // 북쪽 벽 바깥 쓰레기더미
    for (let k = 0; k < 3; k++) {
      const [px, pz] = toW(o, rng.range(-L / 2, L / 2), -W / 2 - rng.range(1, 4));
      this.rubblePile(px, pz, 1.2, 20, b.brick);
    }
  }

  wallLocal(side, s, L, W, t, off) {
    switch (side) {
      case 'south':
        return [s, W / 2 + 0.6 + off];
      case 'north':
        return [s, -W / 2 - 0.6 - off];
      case 'east':
        return [L / 2 + 0.6 + off, s];
      default:
        return [-L / 2 - 0.6 - off, s];
    }
  }

  // ------------------------------------------------------------------ 곡물 저장탑
  silo(s) {
    const y = this.terrain.heightAt(s.x, s.z);
    this.batch.add('concrete', place(cylGeo(s.r, s.r * 1.02, s.h, 28, 3), s.x, y + s.h / 2, s.z), 0xc4c1b8, 0.35);
    const dome = new THREE.SphereGeometry(s.r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.batch.add('concrete', place(dome, s.x, y + s.h, s.z, 0, [1, 0.35, 1]), 0xb6b3aa);
    // 꼭대기 기계실 (포탄에 뚫림)
    this.batch.add('concrete', place(boxGeo(2.8, 2.4, 3.0, 3), s.x + 0.8, y + s.h + 1.8, s.z, 0.2), 0xaaa79e);
    this.batch.add('interior', place(boxGeo(1.2, 1.0, 0.1), s.x + 1.1, y + s.h + 1.9, s.z + 1.55, 0.2));
    // 포탄 구멍 (어두운 부분)
    for (const [ang, hy, sz] of [
      [2.6, 0.72, 1.6],
      [0.9, 0.45, 1.0],
      [3.9, 0.85, 0.9],
    ]) {
      const px = s.x + Math.sin(ang) * (s.r - 0.05);
      const pz = s.z + Math.cos(ang) * (s.r - 0.05);
      this.batch.add('interior', place(boxGeo(sz, sz * 0.8, 0.2), px, y + s.h * hy, pz, ang));
    }
    // 컨베이어 관 (기울어진 녹슨 통)
    // 아래 끝 (s.x+16, 지면) → 위 끝 (s.x+2, 꼭대기)
    const cl = 26;
    const g = boxGeo(0.9, 0.9, cl, 2);
    place(g, s.x + 9, y + 11, s.z + 1.2, [-1.0, -Math.PI / 2, 0, 'YXZ']);
    this.batch.add('rust', g, 0x9a8a7a);
    this.batch.add('rust', place(boxGeo(1.6, 2.2, 1.6, 2), s.x + 16.2, y + 1.1, s.z + 1.2), 0x8a7a6a);
    // 사다리 보호틀
    for (let k = 0; k < 2; k++) {
      const px = s.x + Math.sin(-0.5) * (s.r + 0.35) + k * 0.5;
      const pz = s.z + Math.cos(-0.5) * (s.r + 0.35);
      this.batch.add('darkSteel', place(boxGeo(0.06, s.h, 0.06), px, y + s.h / 2, pz));
    }
    this.col.addCylinder(s.x, y + s.h / 2, s.z, s.r, s.h / 2, 'concrete', 'SILO');
    // 주변 기초 콘크리트
    this.batch.add('concrete', place(boxGeo(9, 0.35, 9, 3), s.x, y + 0.1, s.z), 0x8d8a82);
  }

  // ------------------------------------------------------------------ 정비 창고
  garage(gd) {
    const floorY = this.terrain.heightAt(gd.x, gd.z);
    const o = frame(gd.x, gd.z, 0, floorY);
    const t = 0.3;
    const W = gd.w;
    const D = gd.d;
    const H = gd.h;
    const doorW = 7;
    const walls = [
      { a: [-W / 2, D / 2 - t / 2], b: [W / 2, D / 2 - t / 2], door: true },
      { a: [-W / 2, -D / 2 + t / 2], b: [W / 2, -D / 2 + t / 2] },
      { a: [W / 2 - t / 2, -D / 2 + t], b: [W / 2 - t / 2, D / 2 - t] },
      { a: [-W / 2 + t / 2, -D / 2 + t], b: [-W / 2 + t / 2, D / 2 - t] },
    ];
    for (const w of walls) {
      const [ax, az] = toW(o, w.a[0], w.a[1]);
      const [bx, bz] = toW(o, w.b[0], w.b[1]);
      const len = Math.hypot(bx - ax, bz - az);
      const openings = [];
      if (w.door) openings.push({ s0: len / 2 - doorW / 2, s1: len / 2 + doorW / 2, y0: 0, y1: 4.2 });
      else openings.push({ s0: len / 2 - 0.8, s1: len / 2 + 0.8, y0: 2.6, y1: 3.4 });
      const collapses = w.door ? [{ s0: len - 4, s1: len, h: 3.0 }] : [];
      this.wall({
        ox: ax,
        oz: az,
        ux: (bx - ax) / len,
        uz: (bz - az) / len,
        len,
        thick: t,
        y0: floorY,
        height: H,
        openings,
        collapses,
        matKey: 'concrete',
        colMat: 'concrete',
        tag: 'GARAGE',
        uvScale: 3,
        color: 0xb4b0a6,
      });
    }
    // 골함석 지붕 (일부 없음, 관통 가능)
    for (let i = 0; i < 6; i++) {
      if (i === 2 || i === 4) continue;
      const lx = -W / 2 + (i + 0.5) * (W / 6);
      const [px, pz] = toW(o, lx, 0);
      const g = boxGeo(W / 6 + 0.05, 0.03, D + 0.4, 1.5);
      const tilt = i === 3 ? 0.25 : 0.05;
      place(g, px, floorY + H + 0.05 - (i === 3 ? 0.8 : 0), pz, [tilt, 0, 0]);
      this.batch.add('rustDouble', g, 0xb0a090);
      this.col.addBox(px, floorY + H + 0.05 - (i === 3 ? 0.8 : 0), pz, W / 12, 0.02, D / 2 + 0.2, { x: tilt, y: 0, z: 0 }, 'sheetMetal', 'GARAGE_roof', { walkable: false, blocksMove: false });
    }
    // 매달린 철문 (관통 가능)
    const [dx, dz] = toW(o, -1.5, D / 2 + 0.3);
    this.batch.add('rustDouble', place(boxGeo(3.4, 4.0, 0.05, 1.5), dx, floorY + 2.0, dz, [0.0, 0.35, 0.12]), 0x8a7f72);
    this.col.addBox(dx, floorY + 2.0, dz, 1.7, 2.0, 0.03, { x: 0, y: 0.35, z: 0.12 }, 'sheetMetal', 'GARAGE_door');
    const [dx2, dz2] = toW(o, 3.2, D / 2 + 2.2);
    this.batch.add('rustDouble', place(boxGeo(3.4, 0.05, 4.0, 1.5), dx2, floorY + 0.18, dz2, [0.1, -0.3, 0.05]), 0x7d7266);
    // 내부 차량 골조
    const [cx, cz] = toW(o, 2, -1.5);
    this.batch.add('burnt', place(boxGeo(5.5, 0.6, 2.0, 2), cx, floorY + 0.7, cz, 0.1));
    this.col.addBox(cx, floorY + 0.7, cz, 2.75, 0.3, 1.0, 0.1, 'steel', 'GARAGE');
    this.batch.add('concrete', place(boxGeo(W - 0.6, 0.1, D - 0.6, 3), gd.x, floorY + 0.04, gd.z), 0x7e7b74);
  }

  // ------------------------------------------------------------------ 무너진 소건물
  ruin(r) {
    const y = this.terrain.heightAt(r.x, r.z - 3.8);
    // 남쪽 벽 (가운데가 낮게 무너짐), 서쪽 벽
    this.wall({
      ox: r.x - 4.2,
      oz: r.z + 3.8,
      ux: 1,
      uz: 0,
      len: 6.0,
      thick: 0.38,
      y0: y - 0.2,
      height: 2.4,
      openings: [],
      collapses: [
        { s0: 1.6, s1: 3.6, h: 0.95 },
        { s0: 5.0, s1: 6.0, h: 1.8 },
      ],
      matKey: 'brickRed',
      colMat: 'brick',
      tag: r.id,
    });
    this.wall({
      ox: r.x - 4.4,
      oz: r.z + 3.6,
      ux: 0,
      uz: -1,
      len: 4.5,
      thick: 0.38,
      y0: y - 0.2,
      height: 2.0,
      openings: [],
      collapses: [{ s0: 2.5, s1: 4.5, h: 0.9 }],
      matKey: 'brickRed',
      colMat: 'brick',
      tag: r.id,
    });
    // 쓰러진 콘크리트 지붕판
    const rng = this.rng;
    for (let k = 0; k < 3; k++) {
      const px = r.x + rng.range(-2.5, 2.5);
      const pz = r.z + rng.range(-2.5, 1.5);
      const py = this.terrain.heightAt(px, pz);
      const g = boxGeo(rng.range(2, 3.2), 0.18, rng.range(1.0, 1.5), 3);
      place(g, px, py + 0.25, pz, [rng.range(-0.4, 0.4), rng.next() * 3, rng.range(-0.3, 0.3)]);
      this.batch.add('concrete', g, 0x9a968e);
    }
    this.rubblePile(r.x, r.z, r.moundR * 0.9, 120, 'red');
  }

  // 잔해 더미 (인스턴스 벽돌·콘크리트 조각)
  rubblePile(cx, cz, radius, count, brick = 'mixed') {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = this.terrain.heightAt(x, z);
      const concrete = brick === 'mixed' ? rng.next() < 0.5 : rng.next() < 0.15;
      if (concrete) {
        const s = rng.range(0.12, 0.45);
        this.inst.add('chunk', x, y + s * 0.3, z, rng.next() * 3, rng.next() * 3, rng.next() * 3, s * rng.range(0.8, 1.6), s * rng.range(0.4, 0.8), s, 0x9a978f);
      } else {
        const col = brick === 'red' ? (rng.next() < 0.5 ? 0x7c4a3a : 0x6a4034) : rng.next() < 0.5 ? 0xb8b4aa : 0xa29e94;
        this.inst.add('brick', x, y + 0.04, z, rng.range(-0.4, 0.4), rng.next() * 3, rng.range(-0.4, 0.4), 1, 1, 1, col);
      }
    }
  }

  // ------------------------------------------------------------------ 엄체호
  dugout(d) {
    const rng = this.rng;
    const baseY = this.terrain.baseHeight(d.x, d.z);
    const o = frame(d.x, d.z, d.rot, baseY);
    // 남쪽(참호 쪽) 통나무 전면과 입구
    const front = d.d / 2;
    for (let k = 0; k < 4; k++) {
      const [lx, lz] = toW(o, 0, front - 0.1);
      const g = cylGeo(0.13, 0.14, d.w + 0.6, 8, 1.2);
      place(g, lx, baseY + 0.18 + k * 0.24, lz, [0, d.rot, Math.PI / 2, 'YXZ']);
      this.batch.add('bark', g, 0xffffff);
    }
    // 위쪽으로 튀어나온 통나무 끝
    for (let k = -2; k <= 2; k++) {
      const [lx, lz] = toW(o, k * (d.w / 5), front - 0.6);
      const g = cylGeo(0.12, 0.12, 1.4, 7, 1.2);
      place(g, lx, baseY + 0.86, lz, [Math.PI / 2, d.rot, 0, 'YXZ']);
      this.batch.add('bark', g, 0xcfc4b8);
    }
    // 입구 (어둠)
    const [ex, ez] = toW(o, -d.w * 0.22, front + 0.02);
    this.batch.add('interior', place(boxGeo(0.9, 0.95, 0.12), ex, baseY - 0.35, ez, d.rot));
    // 사격 구멍 (가로 틈)
    const [sx, sz] = toW(o, d.w * 0.2, front + 0.02);
    this.batch.add('interior', place(boxGeo(1.2, 0.18, 0.12), sx, baseY + 0.12, sz, d.rot));
    const [cx, cz] = toW(o, 0, front - 0.35);
    this.col.addBox(cx, baseY + 0.45, cz, d.w / 2 + 0.3, 0.45, 0.4, d.rot, 'log', 'DUGOUT');
    // 흙 위에 풀
    for (let k = 0; k < 6; k++) {
      const [gx, gz] = toW(o, rng.range(-d.w / 2, d.w / 2), rng.range(-d.d / 2, d.d / 2));
      this.inst.add('chunk', gx, this.terrain.heightAt(gx, gz), gz, 0, rng.next() * 3, 0, 0.3, 0.1, 0.25, 0x4a4032);
    }
  }

  // 참호 내 디테일: 사격 발판은 AI 준비 단계에서 addFireStep 으로 추가
  trenchDetails() {
    const rng = this.rng;
    // 참호 벽 일부에 판자 보강
    const tmpPts = MAP.trench.lines;
    for (const line of tmpPts) {
      for (let i = 0; i < line.length - 1; i++) {
        if (rng.next() < 0.45) continue;
        const [ax, az] = line[i];
        const [bx, bz] = line[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        let nx = -uz;
        let nz = ux;
        if (nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        const s0 = len * 0.2;
        const s1 = len * 0.8;
        const mx = ax + ux * ((s0 + s1) / 2) + nx * 0.5;
        const mz = az + uz * ((s0 + s1) / 2) + nz * 0.5;
        const floor = this.terrain.heightAt(ax + ux * len * 0.5, az + uz * len * 0.5);
        const yaw = Math.atan2(-uz, ux);
        const g = boxGeo(s1 - s0, 1.2, 0.05, 1.4);
        place(g, mx, floor + 0.62, mz, [0.28, yaw, 0, 'YXZ']);
        this.batch.add('wood', g, 0x9c8c78);
      }
    }
  }

  // 참호 사격 발판 + 양옆 모래주머니
  addFireStep(x, z, floorY, height, yaw, parapetY) {
    if (height > 0.08) {
      const g = boxGeo(0.9, height, 0.55, 1);
      place(g, x, floorY + height / 2, z, yaw);
      this.batch.add('wood', g, 0x8a7a62);
      this.col.addBox(x, floorY + height / 2, z, 0.45, height / 2, 0.28, yaw, 'wood', null);
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const px = x + fx * 1.25 + rx * side * (0.55 + k * 0.48);
        const pz = z + fz * 1.25 + rz * side * (0.55 + k * 0.48);
        const py = this.terrain.heightAt(px, pz);
        for (let lv = 0; lv < 2; lv++) {
          this.inst.add('sandbag', px, py + 0.08 + lv * 0.15, pz, 0, yaw + (lv ? 0.08 : -0.05), 0, 1, 1, 1, 0xffffff);
        }
      }
      const cx = x + fx * 1.25 + rx * side * 0.79;
      const cz = z + fz * 1.25 + rz * side * 0.79;
      const cy = this.terrain.heightAt(cx, cz) + 0.16;
      this.col.addBox(cx, cy, cz, 0.5, 0.16, 0.2, yaw, 'sandbag', null);
    }
  }

  barricade(b) {
    const y = this.terrain.heightAt(b.x, b.z);
    for (let k = -1; k <= 1; k++) {
      const x = b.x + k * 1.6;
      const z = b.z + (k === 0 ? 0.6 : 0);
      const g = boxGeo(1.4, 0.8, 0.7, 1.5);
      place(g, x, y + 0.4, z, b.rot + k * 0.12);
      this.batch.add('concrete', g, 0x9d9a92, 0.2);
      this.col.addBox(x, y + 0.4, z, 0.7, 0.4, 0.35, b.rot + k * 0.12, 'concrete', 'BARRICADE');
    }
    for (let k = 0; k < 8; k++) {
      this.inst.add('sandbag', b.x - 2.4 + k * 0.5, y + 0.08, b.z - 0.9, 0, b.rot, 0, 1, 1, 1, 0xffffff);
    }
  }

  camoNet(n, materials) {
    const y = this.terrain.baseHeight(n.x, n.z);
    const g = new THREE.PlaneGeometry(n.w, n.d, 10, 6);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) / (n.w / 2);
      const pz = pos.getZ(i) / (n.d / 2);
      const sag = (1 - px * px) * 0.35 + (1 - pz * pz) * 0.2;
      pos.setY(i, n.h - (1 - Math.max(Math.abs(px), Math.abs(pz))) * 0.1 - sag * 0.6 - (Math.abs(px) > 0.9 ? 1.1 : 0));
    }
    g.computeVertexNormals();
    place(g, n.x, y, n.z, 0.05);
    this.batch.add('camoNet', g, 0xffffff);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const px = n.x + (sx * n.w) / 2.2;
      const pz = n.z + (sz * n.d) / 2.2;
      const py = this.terrain.heightAt(px, pz);
      this.batch.add('wood', place(cylGeo(0.04, 0.05, n.h + 0.4, 6), px, py + (n.h + 0.4) / 2 - 0.3, pz), 0x7a6a56);
    }
    this.col.addConcealer(n.x, y + n.h * 0.5, n.z, n.w / 2, n.h * 0.6, n.d / 2, 0.05, 'camoNet');
  }

  // ------------------------------------------------------------------ 파괴된 장갑차 (BMP 계열)
  apc(a) {
    const y = this.terrain.heightAt(a.x, a.z) - 0.12; // 진흙에 약간 박힘
    const o = frame(a.x, a.z, a.rot, y);
    const add = (key, g, lx, ly, lz, rot, color) => {
      const [wx, wz] = toW(o, lx, lz);
      if (Array.isArray(rot)) place(g, wx, y + ly, wz, [rot[0], rot[1] + a.rot, rot[2], 'YXZ']);
      else place(g, wx, y + ly, wz, (rot || 0) + a.rot);
      this.batch.add(key, g, color || 0xffffff, 0.25);
    };
    const colBox = (lx, ly, lz, hx, hy, hz) => {
      const [wx, wz] = toW(o, lx, lz);
      this.col.addBox(wx, y + ly, wz, hx, hy, hz, a.rot, 'armor', a.tag);
    };
    // 차체 (길이 방향 = 로컬 x)
    add('burnt', boxGeo(5.6, 0.95, 2.6, 2), -0.3, 0.88, 0);
    colBox(-0.3, 0.88, 0, 2.8, 0.48, 1.3);
    add('burnt', boxGeo(3.4, 0.42, 2.7, 2), -1.2, 1.56, 0);
    colBox(-1.2, 1.56, 0, 1.7, 0.21, 1.35);
    // 앞쪽 경사 장갑
    const wedge = wedgeGeo(1.6, 0.95, 2.6);
    add('burnt', wedge, 3.2, 0.4, 0, [0, 0, 0]);
    colBox(3.1, 0.75, 0, 0.6, 0.35, 1.3);
    // 궤도와 바퀴
    for (const side of [-1, 1]) {
      add('darkSteel', boxGeo(6.7, 0.18, 0.5, 1), 0, 0.92, side * 1.48, 0, 0x5a554e);
      add('darkSteel', boxGeo(6.4, 0.12, 0.48, 1), 0, 0.07, side * 1.48, 0, 0x3a3632);
      for (let k = 0; k < 6; k++) {
        const g = cylGeo(0.36, 0.36, 0.4, 10, 1);
        add('burnt', g, -2.4 + k * 0.95, 0.42, side * 1.48, [Math.PI / 2, 0, 0], 0x8a8078);
      }
      const spr = cylGeo(0.32, 0.32, 0.42, 10, 1);
      add('darkSteel', spr, 3.05, 0.6, side * 1.48, [Math.PI / 2, 0, 0]);
      colBox(0, 0.5, side * 1.48, 3.3, 0.45, 0.26);
    }
    // 끊어진 궤도 한쪽 (땅에 늘어짐)
    add('darkSteel', boxGeo(3.4, 0.06, 0.48, 1), -4.6, 0.06, 1.48, [0, 0, 0.05], 0x3a3632);
    // 열린 해치
    add('burnt', boxGeo(0.7, 0.05, 0.7, 1), -2.6, 1.95, 0.6, [0, 0, 1.2]);
    add('burnt', boxGeo(0.7, 0.05, 0.7, 1), -2.6, 1.95, -0.6, [0, 0, -1.0]);
    // 날아간 포탑 (옆에 뒤집힌 채)
    const tx = 1.2;
    const tz = 3.4;
    const tg = cylGeo(0.85, 1.0, 0.55, 12, 2);
    add('burnt', tg, tx, 0.35, tz, [0.25, 0, 2.8]);
    const barrel = cylGeo(0.05, 0.06, 2.3, 8, 1);
    add('darkSteel', barrel, tx + 1.0, 0.25, tz + 0.9, [Math.PI / 2, 0.6, 0.15]);
    const [twx, twz] = toW(o, tx, tz);
    this.col.addCylinder(twx, this.terrain.heightAt(twx, twz) + 0.35, twz, 0.95, 0.35, 'armor', a.tag);
    // 주변 그을린 잔해
    this.rubblePile(...toW(o, -3.5, -2.2), 1.6, 24, 'mixed');
  }

  // ------------------------------------------------------------------ 트랙터 잔해 (MTZ 계열)
  tractor(t) {
    const y = this.terrain.heightAt(t.x, t.z) - 0.08;
    const o = frame(t.x, t.z, t.rot, y);
    const add = (key, g, lx, ly, lz, rot, color) => {
      const [wx, wz] = toW(o, lx, lz);
      if (Array.isArray(rot)) place(g, wx, y + ly, wz, [rot[0], rot[1] + t.rot, rot[2], 'YXZ']);
      else place(g, wx, y + ly, wz, (rot || 0) + t.rot);
      this.batch.add(key, g, color || 0xffffff, 0.2);
    };
    const colBox = (lx, ly, lz, hx, hy, hz, mat) => {
      const [wx, wz] = toW(o, lx, lz);
      this.col.addBox(wx, y + ly, wz, hx, hy, hz, t.rot, mat, t.tag);
    };
    // 엔진 후드 (로컬 +x 가 앞)
    add('rust', boxGeo(1.9, 0.75, 0.8, 1.5), 0.9, 1.25, 0, 0, 0xc09080);
    colBox(0.9, 1.25, 0, 0.95, 0.38, 0.4, 'steel');
    add('darkSteel', boxGeo(0.12, 0.7, 0.75, 1), 1.9, 1.22, 0);
    // 변속기·몸체
    add('rust', boxGeo(1.4, 0.7, 0.9, 1.5), -0.6, 0.95, 0, 0, 0xb08070);
    colBox(-0.6, 0.95, 0, 0.7, 0.35, 0.45, 'steel');
    // 캐빈 골조 (뼈대만)
    for (const [lx, lz] of [
      [-0.05, 0.6],
      [-0.05, -0.6],
      [-1.2, 0.6],
      [-1.2, -0.6],
    ]) {
      add('darkSteel', boxGeo(0.06, 1.35, 0.06, 1), lx, 1.95, lz);
    }
    add('rust', boxGeo(1.35, 0.05, 1.35, 1), -0.62, 2.65, 0, [0.12, 0, 0.08], 0x9a7a6a);
    add('rust', boxGeo(0.05, 0.9, 1.2, 1), -1.22, 1.75, 0, 0, 0x8a6a5a);
    colBox(-0.62, 1.95, 0, 0.62, 0.7, 0.62, 'sheetMetal');
    // 뒷바퀴 (큰 것) — 하나는 타서 림만
    for (const side of [-1, 1]) {
      const g = cylGeo(0.78, 0.78, 0.45, 16, 1);
      add(side > 0 ? 'rubber' : 'burnt', g, -0.7, 0.78, side * 0.95, [Math.PI / 2, 0, 0]);
      colBox(-0.7, 0.78, side * 0.95, 0.78, 0.78, 0.23, 'carBody');
      const fg = cylGeo(0.45, 0.45, 0.25, 12, 1);
      add('rubber', fg, 1.35, 0.45, side * 0.72, [Math.PI / 2, 0.15, 0]);
    }
    this.rubblePile(...toW(o, 0, 2.2), 1.2, 14, 'mixed');
  }

  // ------------------------------------------------------------------ 민간 차량 잔해
  car(c) {
    const y = this.terrain.heightAt(c.x, c.z) - 0.05;
    const o = frame(c.x, c.z, c.rot, y);
    const tag = 'CAR';
    const add = (key, g, lx, ly, lz, rot, color) => {
      const [wx, wz] = toW(o, lx, lz);
      if (Array.isArray(rot)) place(g, wx, y + ly, wz, [rot[0], rot[1] + c.rot, rot[2], 'YXZ']);
      else place(g, wx, y + ly, wz, (rot || 0) + c.rot);
      this.batch.add(key, g, color || 0xffffff, 0.2);
    };
    const colBox = (lx, ly, lz, hx, hy, hz, mat) => {
      const [wx, wz] = toW(o, lx, lz);
      this.col.addBox(wx, y + ly, wz, hx, hy, hz, c.rot, mat, tag);
    };
    if (c.kind === 'sedan') {
      add('burnt', boxGeo(4.1, 0.62, 1.62, 2), 0, 0.58, 0, [0, 0, 0.03]);
      add('burnt', boxGeo(2.0, 0.5, 1.45, 2), -0.3, 1.13, 0);
      add('interior', boxGeo(1.95, 0.36, 1.47), -0.3, 1.14, 0);
      colBox(0, 0.75, 0, 2.05, 0.6, 0.81, 'carBody');
      colBox(1.5, 0.6, 0, 0.4, 0.25, 0.5, 'steel');
      for (const [lx, lz] of [
        [1.3, 0.75],
        [1.3, -0.75],
        [-1.3, 0.75],
        [-1.3, -0.75],
      ]) {
        add('darkSteel', cylGeo(0.3, 0.3, 0.18, 10), lx, 0.22, lz, [Math.PI / 2, 0, 0]);
      }
    } else if (c.kind === 'van') {
      add('rust', boxGeo(4.4, 1.55, 1.95, 2), 0, 1.25, 0, 0, 0x9a9a7a);
      add('interior', boxGeo(0.9, 0.45, 1.97), 1.55, 1.65, 0);
      colBox(0, 1.25, 0, 2.2, 0.78, 0.98, 'carBody');
      colBox(1.7, 0.85, 0, 0.45, 0.3, 0.55, 'steel');
      for (const [lx, lz] of [
        [1.4, 0.85],
        [1.4, -0.85],
        [-1.4, 0.85],
        [-1.4, -0.85],
      ]) {
        add('rubber', cylGeo(0.38, 0.38, 0.22, 10), lx, 0.38, lz, [Math.PI / 2, 0, 0]);
      }
    } else {
      // 트럭: 캐빈 + 짐칸 (나무 판자)
      add('burnt', boxGeo(1.6, 1.4, 2.1, 2), 2.2, 1.55, 0);
      add('burnt', boxGeo(1.2, 0.8, 1.9, 2), 3.4, 1.15, 0);
      colBox(2.6, 1.4, 0, 1.4, 0.75, 1.05, 'carBody');
      colBox(3.4, 1.1, 0, 0.5, 0.35, 0.6, 'steel');
      add('wood', boxGeo(4.0, 0.08, 2.2, 1.5), -0.6, 1.15, 0, 0, 0x8a7a66);
      add('wood', boxGeo(4.0, 0.6, 0.06, 1.5), -0.6, 1.45, 1.08, [0.2, 0, 0], 0x7a6a56);
      colBox(-0.6, 1.4, 1.08, 2.0, 0.3, 0.06, 'wood');
      add('darkSteel', boxGeo(6.2, 0.3, 0.9, 2), 0.2, 0.7, 0);
      for (const lx of [2.4, -1.4]) {
        for (const lz of [1.0, -1.0]) add('rubber', cylGeo(0.48, 0.48, 0.3, 10), lx, 0.48, lz, [Math.PI / 2, 0, 0]);
      }
    }
  }

  // ------------------------------------------------------------------ 송전탑과 전선
  pylonGeometry() {
    const parts = [];
    const H = 24;
    const baseHalf = 2.6;
    const topHalf = 0.75;
    const bodyH = 19;
    const at = (h) => baseHalf + (topHalf - baseHalf) * (h / bodyH);
    const beam = (x0, y0, z0, x1, y1, z1, th = 0.09) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dy, dz);
      const g = boxGeo(th, len, th, 2);
      _v.set(dx, dy, dz).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
      _m4.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(_m4);
      parts.push(g);
    };
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ];
    for (const [sx, sz] of corners) beam(sx * baseHalf, 0, sz * baseHalf, sx * topHalf, bodyH, sz * topHalf, 0.16);
    const levels = [0, 3.5, 7, 10.5, 13.5, 16.5, 19];
    for (let l = 0; l < levels.length - 1; l++) {
      const h0 = levels[l];
      const h1 = levels[l + 1];
      const a0 = at(h0);
      const a1 = at(h1);
      for (let c = 0; c < 4; c++) {
        const [sx0, sz0] = corners[c];
        const [sx1, sz1] = corners[(c + 1) % 4];
        beam(sx0 * a1, h1, sz0 * a1, sx1 * a1, h1, sz1 * a1);
        beam(sx0 * a0, h0, sz0 * a0, sx1 * a1, h1, sz1 * a1, 0.07);
        beam(sx1 * a0, h0, sz1 * a0, sx0 * a1, h1, sz0 * a1, 0.07);
      }
    }
    // 꼭대기
    for (const [sx, sz] of corners) beam(sx * topHalf, bodyH, sz * topHalf, 0, H, 0, 0.1);
    // 팔 (전선 방향과 수직 = 로컬 z)
    const arms = [
      [15.5, 5.2],
      [19, 4.0],
    ];
    for (const [h, span] of arms) {
      beam(-topHalf * 1.3, h, -span, -topHalf * 1.3, h, span, 0.12);
      beam(topHalf * 1.3, h, -span, topHalf * 1.3, h, span, 0.12);
      beam(-topHalf * 1.3, h - 1.2, -topHalf, -topHalf * 1.3, h, -span, 0.08);
      beam(-topHalf * 1.3, h - 1.2, topHalf, -topHalf * 1.3, h, span, 0.08);
    }
    // 애자 (아래로 매달림)
    const attach = [];
    for (const [h, span] of arms) {
      for (const s of [-1, 1]) {
        const g = cylGeo(0.08, 0.08, 1.2, 6, 1);
        place(g, 0, h - 0.6, s * span * 0.92);
        parts.push(g);
        attach.push([0, h - 1.2, s * span * 0.92]);
      }
    }
    attach.push([0, H, 0]);
    return { parts, attach, legs: corners.map(([sx, sz]) => [sx * baseHalf, sz * baseHalf]) };
  }

  pylons() {
    const list = MAP.pylons;
    const tpl = this.pylonGeometry();
    const attachWorld = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const y = this.terrain.heightAt(p.x, p.z);
      // 선로 방향 (이웃 송전탑 쪽)
      const n = list[Math.min(i + 1, list.length - 1)];
      const pv = list[Math.max(i - 1, 0)];
      const yaw = Math.atan2(-(n.z - pv.z), n.x - pv.x); // 로컬 x 가 선로 방향
      let rot;
      let pos = new THREE.Vector3(p.x, y - 0.2, p.z);
      if (p.state === 'fallen') {
        rot = new THREE.Euler(0, yaw, -1.66, 'YXZ');
        pos.y += 2.4;
      }
      else if (p.state === 'tilted') rot = new THREE.Euler(0.31, yaw, -0.12, 'YXZ');
      else rot = new THREE.Euler(0, yaw, 0, 'YXZ');
      _q.setFromEuler(rot);
      _m4.compose(pos, _q, new THREE.Vector3(1, 1, 1));
      for (const g of tpl.parts) {
        const gc = g.clone();
        gc.applyMatrix4(_m4);
        // 쓰러진 탑은 땅에 파묻히지 않게 살짝 올림
        this.batch.add(p.state === 'fallen' ? 'darkSteel' : 'steel', gc, p.state === 'fallen' ? 0x8a8478 : 0xffffff);
      }
      const att = tpl.attach.map(([ax, ay, az]) => new THREE.Vector3(ax, ay, az).applyMatrix4(_m4));
      attachWorld.push(att);
      // 다리 충돌체 (강철, 가늘다)
      if (p.state !== 'fallen') {
        for (const [lx, lz] of tpl.legs) {
          const v = new THREE.Vector3(lx * 0.8, 4, lz * 0.8).applyMatrix4(_m4);
          this.col.addBox(v.x, v.y, v.z, 0.12, 4, 0.12, yaw, 'steel', 'PYLON', { blocksMove: true });
        }
      } else {
        const a = new THREE.Vector3(0, 9, 0).applyMatrix4(_m4);
        this.col.addBox(a.x, Math.max(a.y, y + 1.2), a.z, 9, 1.0, 1.8, { x: 0, y: yaw, z: 0 }, 'sheetMetal', 'PYLON', { walkable: false });
      }
    }
    // 전선: 처진 곡선, 지면 아래로는 내려가지 않게
    for (let i = 0; i < list.length - 1; i++) {
      const A = attachWorld[i];
      const B = attachWorld[i + 1];
      const broken = list[i].state === 'fallen' || list[i + 1].state === 'fallen';
      for (let w = 0; w < A.length; w++) {
        const a = A[w];
        const b = B[w];
        const segs = 24;
        const sag = broken ? 9 : 3.2 + w * 0.15;
        let prev = null;
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          let yy = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
          const gy = this.terrain.heightAt(x, z) + 0.04;
          if (yy < gy) yy = gy;
          if (broken && w === 2 && t > 0.45 && t < 0.55) {
            prev = null; // 끊어진 선
            continue;
          }
          const cur = [x, yy, z];
          if (prev) this.wires.push(...prev, ...cur);
          prev = cur;
        }
      }
    }
  }

  // ------------------------------------------------------------------ 나무·그루터기
  tree(t) {
    const rng = this.rng;
    const y = this.terrain.heightAt(t.x, t.z);
    const lean = [rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)];
    const r0 = 0.24 + rng.next() * 0.08;
    const trunk = cylGeo(r0 * 0.62, r0, t.h, 9, 1.5);
    place(trunk, t.x, y + t.h / 2 - 0.1, t.z, lean);
    this.batch.add('bark', trunk, 0xd0c8be, 0.3);
    // 부러진 윗부분 (쪼개진 조각)
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.ConeGeometry(r0 * 0.25, rng.range(0.4, 0.9), 4);
      place(sp, t.x + lean[2] * t.h * -0.5 + rng.range(-0.08, 0.08), y + t.h + 0.1, t.z + lean[0] * t.h * 0.5 + rng.range(-0.08, 0.08), [rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)]);
      this.batch.add('wood', sp, 0xd8c8a8);
    }
    // 잎 없는 가지
    for (let k = 0; k < 4; k++) {
      const hy = t.h * rng.range(0.4, 0.85);
      const len = rng.range(1.0, 2.6);
      const ang = rng.next() * Math.PI * 2;
      const br = cylGeo(0.025, 0.06, len, 5, 1);
      br.translate(0, len / 2, 0);
      place(br, t.x, y + hy, t.z, [Math.cos(ang) * 0.9, ang, Math.sin(ang) * 0.9]);
      this.batch.add('bark', br, 0xb8b0a6);
    }
    // 쓰러진 윗동
    const fl = rng.range(3, 5);
    const fallen = cylGeo(r0 * 0.4, r0 * 0.6, fl, 8, 1.5);
    const fa = rng.next() * Math.PI * 2;
    const fx = t.x + Math.cos(fa) * (fl / 2 + 0.8);
    const fz = t.z + Math.sin(fa) * (fl / 2 + 0.8);
    place(fallen, fx, this.terrain.heightAt(fx, fz) + r0 * 0.5, fz, [0, -fa, Math.PI / 2, 'YXZ']);
    this.batch.add('bark', fallen, 0xb0a89c);
    this.col.addCylinder(t.x, y + t.h / 2, t.z, r0 * 0.85, t.h / 2, 'log', 'TREE');
  }

  stump(x, z) {
    const rng = this.rng;
    const y = this.terrain.heightAt(x, z);
    const h = rng.range(0.35, 1.0);
    const r = rng.range(0.16, 0.3);
    this.batch.add('bark', place(cylGeo(r * 0.9, r, h, 8, 1.2), x, y + h / 2 - 0.05, z), 0xc8c0b6);
    for (let k = 0; k < 2; k++) {
      const sp = new THREE.ConeGeometry(r * 0.35, rng.range(0.2, 0.45), 4);
      place(sp, x + rng.range(-r, r) * 0.5, y + h + 0.1, z + rng.range(-r, r) * 0.5, [rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)]);
      this.batch.add('wood', sp, 0xd0c0a0);
    }
    this.col.addCylinder(x, y + h / 2, z, r, h / 2, 'log', 'STUMP');
  }

  // ------------------------------------------------------------------ 수로 콘크리트 측벽
  canalWalls() {
    const C = MAP.canal;
    const rng = this.rng;
    for (const [a, b] of C.linedSections) {
      for (let x = a + 0.1; x < b - 0.2; x += 3.05) {
        for (const side of [-1, 1]) {
          if (rng.next() < 0.08) continue; // 빠진 판
          const cx = x + 1.5;
          const zc = this.terrain.canalZ(cx);
          const d = C.linedFloorHalf + 0.09;
          const cz = zc + side * d;
          const ground = this.terrain.baseHeight(cx, zc + side * 1.6);
          const floor = this.terrain.heightAt(cx, zc);
          const top = ground + 0.08;
          const hgt = top - floor + 0.1;
          const cy = floor - 0.1 + hgt / 2;
          const broken = rng.next() < 0.1;
          const rot = broken ? [side * rng.range(0.1, 0.25), 0, rng.range(-0.06, 0.06)] : [0, 0, 0];
          const g = boxGeo(3.0, hgt, 0.16, 2);
          place(g, cx, cy, cz, rot);
          this.batch.add('concrete', g, 0xa8a59d, 0.3);
          if (!broken) this.col.addBox(cx, cy, cz, 1.5, hgt / 2, 0.08, 0, 'concrete', 'CANAL');
        }
      }
    }
  }

  culvert() {
    const C = MAP.canal;
    const x = C.crossing.x;
    for (const side of [-1, 1]) {
      const zc = this.terrain.canalZ(x + side * (C.crossing.halfWidth - 0.4));
      const px = x + side * (C.crossing.halfWidth - 0.2);
      const floor = this.terrain.heightAt(px + side * 1.5, zc);
      const g = cylGeo(0.55, 0.55, 1.4, 14, 1.5, true);
      place(g, px, floor + 0.5, zc, [0, 0, Math.PI / 2]);
      this.batch.add('concrete', g, 0x9a978f);
      this.batch.add('interior', place(new THREE.CircleGeometry(0.5, 12), px + side * 0.05, floor + 0.5, zc, [0, (side * Math.PI) / 2, 0]));
    }
  }

  // 밭 여기저기 잔해 (탄피 상자, 깨진 판자, 버려진 장비)
  fieldDebris() {
    const rng = this.rng;
    for (let k = 0; k < 40; k++) {
      const x = rng.range(-200, 200);
      const z = rng.range(-90, 100);
      if (Math.abs(z - MAP.canal.z) < 8) continue;
      const y = this.terrain.heightAt(x, z);
      if (rng.next() < 0.5) {
        this.inst.add('chunk', x, y + 0.05, z, rng.next(), rng.next() * 3, rng.next(), rng.range(0.4, 1.0), 0.06, rng.range(0.2, 0.4), 0x6a5f50);
      } else {
        this.inst.add('crate', x, y + 0.12, z, rng.range(-0.3, 0.3), rng.next() * 3, rng.range(-0.3, 0.3), 1, 1, 1, 0x6a6a4a);
      }
    }
  }

  // ------------------------------------------------------------------ 마무리: 인스턴스·전선 메시
  buildInstances(materials) {
    const group = new THREE.Group();
    group.name = 'instances';
    const geos = {
      brick: boxGeo(0.25, 0.07, 0.12, 0.5),
      chunk: new THREE.DodecahedronGeometry(0.5, 0),
      sandbag: this.sandbagGeometry(),
      crate: boxGeo(0.6, 0.24, 0.32, 0.6),
    };
    const mats = {
      brick: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      chunk: new THREE.MeshLambertMaterial({ color: 0xffffff, map: materials.concrete.map }),
      sandbag: new THREE.MeshLambertMaterial({ color: 0xffffff, map: materials.sandbag.map }),
      crate: new THREE.MeshLambertMaterial({ color: 0xffffff, map: materials.wood.map }),
    };
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    for (const [key, list] of this.inst.sets) {
      if (!list.length || !geos[key]) continue;
      // 공간 분할 (프러스텀 컬링 효율): 100m 칸
      const cells = new Map();
      for (const it of list) {
        const k = `${Math.floor(it.x / 100)}_${Math.floor(it.z / 100)}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(it);
      }
      for (const items of cells.values()) {
        const im = new THREE.InstancedMesh(geos[key], mats[key], items.length);
        items.forEach((it, i) => {
          dummy.position.set(it.x, it.y, it.z);
          dummy.rotation.set(it.rx, it.ry, it.rz);
          dummy.scale.set(it.sx, it.sy, it.sz);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          im.setColorAt(i, col.set(it.color));
        });
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = key === 'sandbag' || key === 'chunk';
        im.receiveShadow = true;
        group.add(im);
      }
    }
    return group;
  }

  sandbagGeometry() {
    const g = new THREE.SphereGeometry(0.5, 8, 5);
    g.scale(0.56, 0.17, 0.34);
    return g;
  }

  buildWires() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.wires, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x2a2a2a });
    const lines = new THREE.LineSegments(geo, mat);
    lines.name = 'wires';
    return lines;
  }
}

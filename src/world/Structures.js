// =============================================================================
// Structures — 축사·저장탑·창고·잔해·장갑차·트랙터·차량·송전탑·나무 등.
// 보이는 기하는 재질별로 병합하고, 충돌은 단순 상자/원기둥(재질 태그)으로 따로 등록한다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MAP, AI_MAP } from './mapData.js';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeo, cylGeo, gableGeo, place, tint } from './geom.js';
import { clamp } from '../core/mathUtils.js';
import { Random } from '../core/Random.js';

const _v = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _one = new THREE.Vector3(1, 1, 1);

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
    this.windows = []; // 축사 창문 중앙 (AI 사격 위치 정렬용)
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
    this.poles();
    for (const t of MAP.trees) this.tree(t);
    for (const [x, z] of MAP.stumps) this.stump(x, z);
    this.canalWalls();
    this.canalSandbags();
    this.canalJunk();
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
      for (const op of openings) {
        if (op.hole || op.door || op.y0 < 1.0) continue;
        const sm = (op.s0 + op.s1) / 2;
        this.windows.push({ barn: b.id, side, x: ax + ux * sm, z: az + uz * sm, y0: floorY + op.y0, y1: floorY + op.y1 });
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
      { a: [-W / 2, -D / 2 + t / 2], b: [W / 2, -D / 2 + t / 2], backDoor: 3 },
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
      // 뒷문 (뒤편에서 들어오는 증원용)
      if (w.backDoor !== undefined) openings.push({ s0: len / 2 + w.backDoor - 0.6, s1: len / 2 + w.backDoor + 0.6, y0: 0, y1: 2.1 });
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
    // 모래주머니는 사수 양옆 앞쪽에 쌓아 사격 구획을 만든다 (정면 ±40° 정도는 트여 있다)
    const fwd = 0.95;
    const inner = 0.68;
    for (const side of [-1, 1]) {
      const bags = [];
      for (let k = 0; k < 2; k++) {
        const px = x + fx * fwd + rx * side * (inner + 0.24 + k * 0.48);
        const pz = z + fz * fwd + rz * side * (inner + 0.24 + k * 0.48);
        bags.push([px, this.terrain.heightAt(px, pz), pz]);
      }
      // 지그재그 참호의 꺾인 부분에서는 한쪽 자리가 참호 안이 된다 → 그쪽은 쌓지 않는다
      if (bags.some((b) => b[1] < floorY + 0.9)) continue;
      for (const [px, py, pz] of bags) {
        for (let lv = 0; lv < 2; lv++) {
          this.inst.add('sandbag', px, py + 0.08 + lv * 0.15, pz, 0, yaw + (lv ? 0.08 : -0.05), 0, 1, 1, 1, 0xffffff);
        }
      }
      const cx = x + fx * fwd + rx * side * (inner + 0.48);
      const cz = z + fz * fwd + rz * side * (inner + 0.48);
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

  // ------------------------------------------------------------------ 중간 지대 차량 잔해 공용
  // 로컬 좌표(x = 앞, y = 위, z = 오른쪽) 부품을 차량 행렬로 옮겨 배치·충돌체에 넣는 도구.
  // pitch(앞뒤)·roll(좌우) 기울임은 pivot(로컬) 둘레로 (타이어가 녹아 앞이 내려앉은 트랙터 등).
  // 중간 지대 잔해는 공용 난수(this.rng)를 쓰지 않는다 (keepRngStream 참고).
  wreckKit(x, y, z, rot, opts = {}) {
    const pitch = opts.pitch || 0;
    const roll = opts.roll || 0;
    const pv = opts.pivot || [0, 0, 0];
    const M = new THREE.Matrix4().makeTranslation(x, y, z);
    M.multiply(new THREE.Matrix4().makeRotationY(rot));
    if (pitch || roll) {
      M.multiply(new THREE.Matrix4().makeTranslation(pv[0], pv[1], pv[2]));
      M.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(roll, 0, pitch, 'XYZ')));
      M.multiply(new THREE.Matrix4().makeTranslation(-pv[0], -pv[1], -pv[2]));
    }
    return {
      M,
      // 로컬 기하 g 를 (lx, ly, lz) 에 r(yaw 숫자 또는 [x, y, z, order]) 로 놓은 뒤 차량 행렬 적용 → 재질별 배치
      put: (key, g, lx, ly, lz, r = 0, color = 0xffffff, dark = 0.2) => {
        place(g, lx, ly, lz, r);
        g.applyMatrix4(M);
        this.batch.add(key, g, color, dark);
        return g;
      },
      // 이미 로컬 좌표에 놓인 기하 (stickGeo·profileGeo 등)
      putRaw: (key, g, color = 0xffffff, dark = 0.2) => {
        g.applyMatrix4(M);
        this.batch.add(key, g, color, dark);
        return g;
      },
      // 로컬 상자 충돌체. o.yaw = 차량 기준 추가 회전(기울임 없는 차량만), o.tilt = 로컬 z 축 기울임, o.col = 충돌체 옵션
      box: (lx, ly, lz, hx, hy, hz, mat, tag, o = {}) => {
        _v.set(lx, ly, lz).applyMatrix4(M);
        const r = { x: roll, y: rot + (o.yaw || 0), z: pitch + (o.tilt || 0), order: 'YXZ' };
        return this.col.addBox(_v.x, _v.y, _v.z, hx, hy, hz, r, mat, tag, o.col);
      },
      world: (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(M),
      // 로컬 (lx, lz) 아래 지면 높이 → 차량 기준 로컬 y (기울임 없는 차량용)
      groundY: (lx, lz) => {
        _v.set(lx, 0, lz).applyMatrix4(M);
        return this.terrain.heightAt(_v.x, _v.z) - y;
      },
    };
  }

  // 이전 판의 장갑차·트랙터 잔해 더미(rubblePile 'mixed')·밭 잔해가 공용 난수(this.rng)를 쓰던 만큼만 똑같이 소비한다.
  // 뒤에 오는 나무·그루터기와 World 식생 배치가 같은 난수 흐름을 이어받으므로 이 판에서도 배치가 그대로다.
  keepRngStream(kind, count) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      if (kind === 'rubble') {
        rng.next();
        rng.next();
        const n = rng.next() < 0.5 ? 6 : 4; // 콘크리트 조각 6회 / 벽돌 4회
        for (let k = 0; k < n; k++) rng.next();
      } else {
        rng.next();
        rng.next();
        const n = rng.next() < 0.5 ? 5 : 3; // 이전 밭 잔해: 조각 5회 / 상자 3회
        for (let k = 0; k < n; k++) rng.next();
      }
    }
  }

  // ------------------------------------------------------------------ 파괴된 장갑차 (BMP-1 계열)
  // 낮은 차체: 긴 골판 위 경사판·안쪽으로 기운 옆면·흙받기·옆 사격구. 포탑은 날아가 옆에 거의 뒤집혀 누웠고
  // 차체엔 포탑 링(속이 시커먼 구멍)만 남았다. 지붕 해치는 열리거나 날아갔고, 뒷문 한 짝은 떨어져 뒤쪽 땅에 누웠다.
  // 왼쪽(-z) 궤도는 걸려 있고, 오른쪽(+z, 수로 쪽) 궤도는 끊어져 벗겨진 채 뒤쪽 진흙 위에 늘어져 있다 (바퀴가 드러남).
  // 그을음·녹은 wreckArmor 텍스처, 주변엔 떨어져 나간 바퀴·흙받기·해치·궤도 링크와 그을린 땅.
  // 충돌: 차체·궤도 상자(장갑, 관통 불가). 진출선 사격 위치(AI_MAP L1: 로컬 -z 쪽 차체 양 끝)와 그 사선 쪽엔
  // 잔해를 두지 않고, 떨어진 잔해는 모두 0.35m 이하로 낮다.
  apc(a) {
    const A = CONFIG.midfield.apc;
    const base = this.terrain.heightAt(a.x, a.z) - A.sink;
    const k = this.wreckKit(a.x, base, a.z, a.rot);
    const rng = new Random(CONFIG.world.seed + 911);
    const W = 'wreckArmor';
    const tag = a.tag;
    const HALF = Math.PI / 2;
    // --- 차체: 아래(궤도 사이, 아래 앞 경사판) + 위(흙받기 위로 넓고 옆면이 안쪽으로 기움:
    //     긴 위 경사판 → 엔진 덮개 → 지붕 → 뒤 경사)
    k.putRaw(W, profileGeo([[-3.06, 0.42], [3.0, 0.42], [3.5, 0.66], [3.44, 0.78], [3.04, 0.97], [-3.06, 0.97]], 2.24, 1, 0, 1, 2), 0xa8a096, 0.35);
    k.putRaw(W, profileGeo([[-3.12, 0.95], [3.04, 0.95], [2.0, 1.3], [0.85, 1.33], [0.55, 1.64], [-2.85, 1.64], [-3.12, 1.3]], 3.0, 0.74, 0.95, 1.64, 2), 0xffffff, 0.12);
    // 충돌 상자: 진출선 사격 위치(차체 양 끝 모서리)에서 넘겨 쏠 수 있게 앞 엔진 덮개·뒤 경사는 이전 판처럼 낮다
    k.box(-1.15, 1.03, 0, 1.7, 0.61, 1.15, 'armor', tag); // 병력실·포탑 자리 (지붕 1.64)
    k.box(-1.285, 1.125, 0, 1.835, 0.175, 1.38, 'armor', tag); // 흙받기 위 넓은 차체 (뒤 경사 아래까지)
    k.box(0.195, 0.7, 0, 3.255, 0.28, 1.12, 'armor', tag); // 아래 차체·아래 앞 경사판
    k.box(1.275, 1.14, 0, 0.725, 0.19, 1.3, 'armor', tag); // 엔진 덮개
    k.box(2.472, 0.983, 0, 0.549, 0.15, 1.3, 'armor', tag, { tilt: -0.3245 }); // 위 경사판
    // 위 경사판의 가로 골 (BMP-1 특유의 골판)
    for (let i = 0; i < 6; i++) {
      const t = 0.1 + i * 0.155;
      k.put(W, boxGeo(0.06, 0.05, 2.3, 1), 2.0 + 1.04 * t, 1.32 - 0.35 * t, 0, [0, 0, -0.3245], 0xc8c0b6, 0);
    }
    // 전조등·견인 고리 (앞)
    for (const s of [-1, 1]) {
      k.put('darkSteel', boxGeo(0.12, 0.1, 0.16), 2.35, 1.2, s * 0.9, [0, 0, -0.3245]);
      k.put('darkSteel', boxGeo(0.14, 0.08, 0.06), 3.5, 0.6, s * 0.75);
    }
    // --- 포탑 링: 포탑이 날아가 링만 남고 속(포탑 바구니 자리)은 시커멓게 탔다
    const ringX = -0.45;
    k.put('darkSteel', cylGeo(0.9, 0.94, 0.12, 20, 1), ringX, 1.68, 0, 0, 0x6a625a, 0);
    k.put('interior', new THREE.CircleGeometry(0.72, 20), ringX, 1.745, 0, [-HALF, 0, 0]);
    for (let i = 0; i < 5; i++) {
      // 링 가장자리에 찢겨 들린 철판 조각
      const ang = i * 1.31 + 0.3;
      const g = boxGeo(0.22, 0.03, 0.12, 1);
      k.put(W, g, ringX + Math.cos(ang) * 0.8, 1.76, Math.sin(ang) * 0.8, [rng.range(-0.5, 0.5), -ang, rng.range(0.3, 0.8), 'YXZ'], 0x9a9086, 0);
    }
    // --- 병력실 지붕 해치 4개: 세워 열림 / 끝까지 젖혀짐 / 닫힘 / 날아가 구멍만 (뚜껑은 땅에)
    const hatch = (hx, side, state) => {
      const hz = side * 0.47;
      if (state === 'closed') {
        k.put(W, boxGeo(0.62, 0.04, 0.48, 1), hx, 1.66, hz);
        return;
      }
      k.put('interior', boxGeo(0.56, 0.012, 0.42), hx, 1.643, hz);
      if (state === 'gone') return;
      const g = boxGeo(0.62, 0.04, 0.48, 1);
      g.translate(0, 0.02, -side * 0.24); // 바깥 모서리 경첩이 원점
      k.put(W, g, hx, 1.645, side * 0.71, [side * (state === 'flat' ? 2.9 : 1.85), 0, 0]);
    };
    hatch(-1.35, 1, 'open');
    hatch(-2.3, 1, 'flat');
    hatch(-1.35, -1, 'closed');
    hatch(-2.3, -1, 'gone');
    // 조종수 해치(앞 왼쪽, 둥근 뚜껑이 세워져 열림)와 그 뒤 차장 큐폴라 (뚜껑이 옆으로 열림)
    k.put('interior', cylGeo(0.27, 0.27, 0.012, 12), 1.72, 1.318, -0.55, [0, 0, -0.026]);
    k.put(W, cylGeo(0.29, 0.29, 0.05, 12, 1), 2.02, 1.58, -0.55, [0, 0, HALF - 0.25]);
    k.put(W, cylGeo(0.34, 0.36, 0.14, 12, 1), 0.95, 1.39, -0.55);
    k.put('interior', cylGeo(0.25, 0.25, 0.012, 12), 0.95, 1.464, -0.55);
    k.put(W, cylGeo(0.27, 0.27, 0.05, 12, 1), 0.95, 1.73, -0.86, [HALF - 0.2, 0, 0]);
    // 옆 사격구 (기운 옆면에 둥근 마개)
    for (const side of [-1, 1]) {
      for (const px of [-0.9, -1.65, -2.4]) k.put('darkSteel', cylGeo(0.075, 0.075, 0.07, 8), px, 1.3, side * 1.31, [side * 1.06, 0, 0]);
    }
    // --- 뒷문 두 짝 (연료 탱크를 품은 두툼한 문): 왼쪽은 닫힘, 오른쪽은 떨어져 나가 뒤쪽 땅에 누움 (어두운 출입구)
    k.put(W, boxGeo(0.14, 0.8, 0.6, 1), -3.16, 0.9, -0.38, 0, 0xb8b0a6, 0);
    k.put('interior', boxGeo(0.01, 0.76, 0.56), -3.135, 0.9, 0.38);
    const dX = -4.7;
    const dZ = 1.75;
    const dY = k.groundY(dX, dZ) + 0.06;
    k.put(W, boxGeo(0.8, 0.14, 0.6, 1), dX, dY, dZ, [0.05, 0.5, 0.08, 'YXZ'], 0xa8a096, 0);
    k.box(dX, dY, dZ, 0.4, 0.07, 0.3, 'armor', 'DEBRIS', { yaw: 0.5 });
    // --- 바퀴·궤도: 도로바퀴 6쌍, 앞 기동륜(톱니), 뒤 유도륜, 상부 롤러 3개
    const wheelX = [-2.2, -1.34, -0.48, 0.38, 1.24, 2.1];
    const TZ = 1.36;
    const trk = (pts, z) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        k.putRaw('track', stickGeo(x0, y0, z, x1, y1, z, 0.34, 0.05, 0.6), 0xffffff, 0);
      }
    };
    for (const side of [-1, 1]) {
      const zc = side * TZ;
      const thrown = side > 0;
      for (const wx of wheelX) {
        const wy = 0.42 - (thrown && wx < -0.4 ? 0.05 : 0); // 궤도가 빠진 바퀴는 진흙에 내려앉음
        for (const dz of [-0.085, 0.085]) k.put(W, cylGeo(0.37, 0.37, 0.12, 14, 1), wx, wy, zc + dz, [HALF, 0, 0], 0x9a9088, 0);
        k.put('darkSteel', cylGeo(0.09, 0.11, 0.36, 8), wx, wy, zc, [HALF, 0, 0]);
      }
      k.put('darkSteel', cylGeo(0.25, 0.25, 0.26, 12), 2.98, 0.6, zc, [HALF, 0, 0], 0x8a8278);
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        k.put('darkSteel', boxGeo(0.08, 0.08, 0.08), 2.98 + Math.cos(ang) * 0.28, 0.6 + Math.sin(ang) * 0.28, zc, [0, 0, ang], 0x8a8278);
      }
      k.put(W, cylGeo(0.27, 0.27, 0.14, 12, 1), -2.86, 0.48, zc, [HALF, 0, 0], 0x9a9088, 0);
      for (const [rx, ry] of [[1.45, 0.8], [-0.1, 0.757], [-1.6, 0.715]]) k.put('darkSteel', cylGeo(0.075, 0.075, 0.16, 8), rx, ry, zc, [HALF, 0, 0]);
      k.box(0.08, 0.48, zc, 3.23, 0.46, 0.17, 'armor', tag);
    }
    // 걸려 있는 왼쪽 궤도 (아래 → 기동륜 → 위 → 유도륜)
    trk([[-2.58, 0.025], [2.55, 0.025], [3.15, 0.3], [3.3, 0.48], [3.3, 0.72], [3.15, 0.9], [2.98, 0.945], [-2.86, 0.775], [-3.07, 0.69], [-3.15, 0.48], [-3.04, 0.28], [-2.58, 0.025]], -TZ);
    // 오른쪽 궤도: 앞바퀴 아래에만 남고 나머지는 벗겨져 뒤쪽 진흙 위에 늘어짐. 앞쪽 끊어진 끝은 기동륜에서 흘러내림
    trk([[3.3, 0.48], [3.15, 0.3], [2.55, 0.025], [-0.5, 0.025]], TZ);
    const slack = new THREE.CatmullRomCurve3(
      [[-0.5, TZ], [-1.8, 1.58], [-3.3, 2.08], [-4.6, 2.6], [-5.9, 2.52], [-6.7, 1.98], [-6.9, 1.2]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    );
    const sp = slack.getSpacedPoints(Math.round(slack.getLength() / A.trackLink));
    for (let i = 0; i < sp.length - 1; i++) {
      const p = sp[i];
      const q = sp[i + 1];
      const y0 = k.groundY(p.x, p.z) + 0.02 - rng.range(0, 0.012);
      const y1 = k.groundY(q.x, q.z) + 0.02 - rng.range(0, 0.012);
      k.putRaw('track', stickGeo(p.x, y0, p.z, q.x, y1, q.z, 0.34, 0.05, 0.6), 0xe0dcd8, 0);
      // 벗겨져 뒤집힌 궤도: 안쪽 안내 돌기가 위로 (링크마다 하나)
      const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
      for (const f of [0.25, 0.75]) {
        k.put('track', boxGeo(0.05, 0.07, 0.07, 0.6), p.x + (q.x - p.x) * f, y0 + (y1 - y0) * f + 0.055, p.z + (q.z - p.z) * f, yaw, 0xc8c4c0, 0);
      }
    }
    for (let i = 0; i < sp.length - 1; i += 5) {
      const p = sp[i];
      const q = sp[Math.min(sp.length - 1, i + 5)];
      const cx = (p.x + q.x) / 2;
      const cz = (p.z + q.z) / 2;
      k.box(cx, k.groundY(cx, cz) + 0.03, cz, Math.hypot(q.x - p.x, q.z - p.z) / 2, 0.035, 0.17, 'steel', 'DEBRIS', { yaw: Math.atan2(-(q.z - p.z), q.x - p.x) });
    }
    trk([[3.3, 0.72], [3.42, 0.42], [3.62, 0.12], [3.82, k.groundY(3.82, TZ) + 0.02], [4.6, k.groundY(4.6, TZ + 0.1) + 0.02]], TZ);
    // 찢겨 늘어진 오른쪽 흙받기 조각 (바퀴 바깥으로 처짐)
    const fg = boxGeo(1.3, 0.035, 0.42, 1);
    fg.translate(0, 0, 0.21);
    k.put(W, fg, -0.9, 0.95, 1.5, [1.35, 0, 0], 0xb0a89e, 0);
    // --- 날아간 포탑
    this.apcTurret(k, a, 1.2, 3.4);
    // --- 주변 잔해 (모두 낮다): 떨어져 나간 도로바퀴, 흙받기 판, 지붕 해치 뚜껑, 흩어진 궤도 링크
    const wX = 2.7;
    const wZ = 4.7;
    const wY = k.groundY(wX, wZ);
    k.put(W, cylGeo(0.37, 0.37, 0.12, 14, 1), wX, wY + 0.05, wZ, [0.06, 0, 0.04], 0x9a9088, 0);
    k.put('darkSteel', cylGeo(0.09, 0.11, 0.2, 8), wX, wY + 0.1, wZ);
    _v.set(wX, 0, wZ).applyMatrix4(k.M);
    this.col.addCylinder(_v.x, base + wY + 0.06, _v.z, 0.37, 0.07, 'steel', 'DEBRIS');
    const pX = -2.1;
    const pZ = 3.9;
    k.put(W, boxGeo(1.25, 0.03, 0.4, 1), pX, k.groundY(pX, pZ) + 0.05, pZ, [0.12, 0.7, 0.05, 'YXZ'], 0xa8a096, 0);
    const hX = -1.0;
    const hZ = 4.6;
    k.put(W, boxGeo(0.62, 0.04, 0.48, 1), hX, k.groundY(hX, hZ) + 0.04, hZ, [-0.08, 1.9, 0.1, 'YXZ'], 0xb0a89e, 0);
    for (let i = 0; i < A.looseLinks; i++) {
      const lx = rng.range(-6.5, 4.5);
      const lz = rng.range(2.2, 5.5);
      if (Math.hypot(lx - 1.2, lz - 3.4) < 1.4 || Math.hypot(lx - wX, lz - wZ) < 0.6) continue;
      const len = A.trackLink * (rng.next() < 0.5 ? 1 : 2);
      const yaw = rng.next() * Math.PI;
      const y = k.groundY(lx, lz) + 0.02;
      k.putRaw('track', stickGeo(lx - Math.cos(yaw) * len * 0.5, y, lz + Math.sin(yaw) * len * 0.5, lx + Math.cos(yaw) * len * 0.5, y, lz - Math.sin(yaw) * len * 0.5, 0.34, 0.05, 0.6), 0xd8d4d0, 0);
      if (rng.next() < 0.6) k.put('track', boxGeo(0.05, 0.07, 0.07, 0.6), lx, y + 0.055, lz, yaw, 0xc8c4c0, 0);
    }
    // 그을린 땅 (차체보다 넓게 부드럽게 번진 접지 데칼)
    const S = A.scorch;
    this.contactShadows?.add({ x: a.x, z: a.z, hx: S.hx, hz: S.hz, rot: a.rot, preset: 'small', soft: S.soft, strength: S.strength });
    this.keepRngStream('rubble', 24);
  }

  // 날아간 포탑 (BMP-1): 원뿔대 몸통·포방패·73mm 포·대전차 미사일 레일·탐조등·잠망경, 찢긴 포탑 바구니 (속이 시커먼 링).
  // 포탑 로컬 좌표로 만든 뒤 CONFIG.midfield.apc.turret 자세로 돌려 가장 낮은 점이 땅에 박히도록 내려놓는다.
  apcTurret(k, a, lx, lz) {
    const T = CONFIG.midfield.apc.turret;
    const HALF = Math.PI / 2;
    const parts = [];
    const add = (key, g, x, y, z, r = 0, color = 0xffffff) => {
      place(g, x, y, z, r);
      parts.push([key, g, color]);
    };
    add('wreckArmor', cylGeo(0.66, 0.98, 0.56, 10, 2), 0, 0.28, 0);
    add('darkSteel', cylGeo(0.74, 0.74, 0.16, 16), 0, -0.08, 0, 0, 0x7a7068);
    add('interior', new THREE.CircleGeometry(0.62, 16), 0, -0.165, 0, [HALF, 0, 0]);
    add('wreckArmor', boxGeo(0.4, 0.34, 0.52, 1), 0.86, 0.3, 0);
    add('darkSteel', cylGeo(0.05, 0.062, 2.0, 8), 2.05, 0.32, 0, [0, 0, -HALF]);
    add('darkSteel', cylGeo(0.068, 0.068, 0.14, 8), 3.05, 0.32, 0, [0, 0, -HALF]);
    add('darkSteel', boxGeo(1.05, 0.05, 0.08), 0.85, 0.66, 0);
    add('interior', cylGeo(0.24, 0.24, 0.012, 12), -0.25, 0.565, 0.28);
    add('darkSteel', boxGeo(0.14, 0.09, 0.22), 0.3, 0.6, -0.32);
    add('darkSteel', cylGeo(0.1, 0.1, 0.18, 8), 0.62, 0.52, 0.5, [0, 0, -HALF]);
    for (let i = 0; i < 4; i++) {
      // 찢겨 나온 포탑 바구니 받침대
      const ang = i * 1.7 + 0.4;
      add('darkSteel', stickGeo(Math.cos(ang) * 0.58, -0.15, Math.sin(ang) * 0.58, Math.cos(ang) * 0.42, -0.6, Math.sin(ang) * 0.46, 0.04, 0.04), 0, 0, 0);
    }
    const R = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(T.roll, a.rot + T.yaw, T.pitch, 'YZX'));
    let minY = Infinity;
    for (const [, g] of parts) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) minY = Math.min(minY, _v.fromBufferAttribute(p, i).applyMatrix4(R).y);
    }
    const w = k.world(lx, 0, lz);
    const gy = this.terrain.heightAt(w.x, w.z);
    const M = new THREE.Matrix4().makeTranslation(w.x, gy - minY - T.sink, w.z).multiply(R);
    for (const [key, g, color] of parts) {
      g.applyMatrix4(M);
      this.batch.add(key, g, color, 0.15);
    }
    this.col.addCylinder(w.x, gy + 0.42, w.z, 0.95, 0.42, 'armor', a.tag);
  }

  // ------------------------------------------------------------------ 트랙터 잔해 (MTZ-80 계열)
  // 좁은 엔진 덮개(옆이 트여 엔진이 보임)·앞 무게추·세운 배기관, 유리가 다 깨져 골조만 남은 캐빈(지붕이 내려앉음)·좌석·핸들,
  // 뒷바퀴 흙받기, 뒤 연결 장치. 불에 타 녹슬고 빨간 도장이 조금 남았다. 앞 타이어는 다 타서 림만 남아 앞이 내려앉았고,
  // 뒷바퀴는 한쪽(-z)이 타서 림이 진흙에 박혀 기울고, 다른 쪽은 아래쪽 고무만 녹아 처진 채 남았다 (철심 고리 노출).
  // 충돌: 엔진·몸체·앞축 강철, 캐빈 아래 판·지붕 양철, 기둥 강철, 뒷바퀴 차체 판정.
  // 진출선 사격 위치(AI_MAP L2)가 쓰는 뒤쪽 윤곽(뒷바퀴·몸체)은 이전과 같다.
  tractor(t) {
    const T = CONFIG.midfield.tractor;
    const base = this.terrain.heightAt(t.x, t.z) - 0.08;
    const k = this.wreckKit(t.x, base, t.z, t.rot, {
      pitch: -Math.atan2(T.noseDrop, 2.35),
      roll: -Math.atan2(T.rimSink, 1.9),
      pivot: [-0.7, 0, 0.95],
    });
    const tag = t.tag;
    const HALF = Math.PI / 2;
    const C = 'wreckCar';
    const red = T.paintTint;
    // --- 뒷바퀴: 림·바퀴 판·허브, 타이어 잔해, 철심 고리
    for (const side of [-1, 1]) {
      const z = side * 0.95;
      const burnt = side < 0;
      k.put(C, cylGeo(0.5, 0.5, 0.42, 18, 1, true), -0.7, 0.8, z, [HALF, 0, 0], 0x9a8a80, 0);
      k.put('darkSteel', cylGeo(0.47, 0.47, 0.03, 18), -0.7, 0.8, z - side * 0.06, [HALF, 0, 0], 0x7a7068);
      k.put('darkSteel', cylGeo(0.15, 0.17, 0.5, 10), -0.7, 0.8, z - side * 0.08, [HALF, 0, 0]);
      // 철심 고리 (고무가 타 버린 위쪽)
      for (const dz of [-0.13, 0.13]) {
        const hoop = new THREE.TorusGeometry(burnt ? 0.64 : 0.66, 0.012, 4, 28, Math.PI * (burnt ? 1.3 : 0.9));
        hoop.rotateZ(HALF - Math.PI * (burnt ? 0.65 : 0.45));
        if (burnt) hoop.scale(1, 0.82, 1);
        k.put('darkSteel', hoop, -0.7, 0.8 - (burnt ? 0.08 : 0), z + dz, 0, 0x6a5a50, 0);
      }
      // 타이어 잔해: 아래쪽 고무가 녹아 처짐 (탄 쪽은 납작한 고무 웅덩이만)
      const arc = burnt ? 0.55 : 1.15;
      const tyre = new THREE.TorusGeometry(0.66, burnt ? 0.16 : 0.18, 8, 20, Math.PI * arc);
      tyre.rotateZ(-HALF - (Math.PI * arc) / 2);
      tyre.scale(burnt ? 1.15 : 1, burnt ? 0.3 : 0.9, burnt ? 1.6 : 1.2);
      k.put('rubber', tyre, -0.7, burnt ? T.rimSink + 0.2 : 0.76, z, 0, 0xffffff, 0);
      k.box(-0.7, 0.78, z, 0.78, 0.78, 0.23, 'carBody', tag);
      // 뒷바퀴 흙받기 (위쪽 반원, 빨간 도장 조금)
      const arcPts = [];
      for (let i = 0; i <= 4; i++) {
        const ang = 0.25 + (i / 4) * (Math.PI - 0.5);
        arcPts.push([-0.7 + Math.cos(ang) * 0.9, 0.8 + Math.sin(ang) * 0.9]);
      }
      for (let i = 0; i < arcPts.length - 1; i++) {
        k.putRaw(C, stickGeo(arcPts[i][0], arcPts[i][1], z, arcPts[i + 1][0], arcPts[i + 1][1], z, 0.5, 0.03, 1.5), red, 0);
      }
      // 연료 탱크 (캐빈 아래 양옆)
      k.put(C, boxGeo(0.5, 0.3, 0.2, 1), 0.3, 1.02, side * 0.5, 0, 0x8a7a70);
    }
    // --- 몸체(변속기)·엔진·덮개·라디에이터·앞 무게추·앞축
    k.put(C, boxGeo(1.4, 0.7, 0.9, 1.5), -0.6, 0.95, 0, 0, 0x8a7a70, 0.3);
    k.box(-0.6, 0.95, 0, 0.7, 0.35, 0.45, 'steel', tag);
    k.put('darkSteel', boxGeo(1.45, 0.5, 0.5, 1), 0.9, 1.05, 0, 0, 0x6a625a, 0.3);
    k.put('darkSteel', cylGeo(0.06, 0.06, 1.2, 8), 0.75, 1.2, 0.27, [0, 0, HALF], 0x5a524a); // 배기 다기관
    k.put(C, boxGeo(1.9, 0.05, 0.66, 1.5), 0.95, 1.47, 0, [0, 0, 0.02], red, 0);
    k.put(C, boxGeo(1.6, 0.32, 0.025, 1.5), 0.95, 1.29, 0.33, 0, red, 0); // 한쪽 옆판만 남음
    k.put('darkSteel', boxGeo(0.1, 0.62, 0.64), 1.95, 1.13, 0, 0, 0x5a5650);
    k.put('interior', boxGeo(0.02, 0.48, 0.5), 2.005, 1.15, 0);
    for (let i = 0; i < 5; i++) k.put('darkSteel', boxGeo(0.03, 0.48, 0.02), 2.02, 1.15, -0.2 + i * 0.1, 0, 0x6a6258);
    k.box(0.92, 1.18, 0, 1.0, 0.32, 0.36, 'steel', tag);
    k.put('darkSteel', boxGeo(0.3, 0.24, 0.92), 2.2, 0.66, 0, 0, 0x5e5850);
    for (let i = 0; i < 4; i++) k.put(C, boxGeo(0.07, 0.36, 0.86, 1), 2.4 + i * 0.075, 0.78, 0, 0, 0x6a5a50, 0);
    k.box(2.25, 0.75, 0, 0.32, 0.3, 0.46, 'steel', tag);
    k.put('darkSteel', boxGeo(0.14, 0.14, 1.4), 1.65, 0.5, 0, 0, 0x5a524a);
    k.box(1.65, 0.45, 0, 0.3, 0.3, 0.86, 'steel', tag);
    // 앞바퀴: 타이어가 다 타 림과 철심 고리만 (앞이 내려앉음)
    for (const side of [-1, 1]) {
      k.put(C, cylGeo(0.26, 0.26, 0.22, 14, 1, true), 1.65, 0.5, side * 0.75, [HALF, 0, 0], 0x9a8a80, 0);
      k.put('darkSteel', cylGeo(0.24, 0.24, 0.02, 14), 1.65, 0.5, side * 0.72, [HALF, 0, 0], 0x6a625a);
      const hoop = new THREE.TorusGeometry(0.42, 0.01, 4, 20);
      hoop.scale(1, 0.62, 1);
      k.put('darkSteel', hoop, 1.65, 0.38, side * 0.75, 0, 0x6a5a50, 0);
      const puddle = new THREE.TorusGeometry(0.34, 0.1, 6, 12, Math.PI * 0.6);
      puddle.rotateZ(-HALF - Math.PI * 0.3);
      puddle.scale(1.3, 0.35, 1.5);
      k.put('rubber', puddle, 1.65, 0.36, side * 0.75, 0, 0xffffff, 0);
    }
    // 세운 배기관·공기 흡입관
    k.putRaw('darkSteel', stickGeo(0.5, 1.45, 0.22, 0.5, 2.5, 0.22, 0.09, 0.09), 0x4a4440, 0);
    k.putRaw('darkSteel', stickGeo(0.5, 2.5, 0.22, 0.62, 2.58, 0.22, 0.08, 0.08), 0x4a4440, 0);
    k.put('darkSteel', cylGeo(0.08, 0.08, 0.7, 8), 0.3, 1.82, -0.22, 0, 0x5a524a);
    // --- 캐빈: 바닥·기둥 4개·내려앉은 지붕·앞뒤 아래 판 (유리는 모두 깨져 없음), 좌석 뼈대·핸들
    k.put('darkSteel', boxGeo(1.3, 0.05, 1.3), -0.62, 1.25, 0, 0, 0x5a524a);
    const posts = [
      [-0.02, 0.62, -0.08, 0.6],
      [-0.02, -0.62, -0.08, -0.6],
      [-1.22, 0.62, -1.2, 0.6],
      [-1.22, -0.62, -1.2, -0.6],
    ];
    for (const [x0, z0, x1, z1] of posts) {
      k.putRaw('darkSteel', stickGeo(x0, 1.27, z0, x1, 2.62, z1, 0.05, 0.05), 0x4a4440, 0);
      k.box((x0 + x1) / 2, 1.95, (z0 + z1) / 2, 0.03, 0.68, 0.03, 'steel', tag);
    }
    k.put(C, boxGeo(1.4, 0.05, 1.36, 1.5), -0.64, 2.63, 0, [0.07, 0, -0.06], red, 0);
    k.put(C, boxGeo(0.9, 0.04, 0.5, 1.5), -0.3, 2.6, 0.35, [0.22, 0, -0.1], 0x9a8478, 0); // 찌그러져 처진 지붕 조각
    k.box(-0.64, 2.63, 0, 0.7, 0.03, 0.68, 'sheetMetal', tag);
    k.put(C, boxGeo(0.04, 0.32, 1.24, 1.5), -0.03, 1.43, 0, 0, red, 0);
    k.put(C, boxGeo(0.04, 0.36, 1.24, 1.5), -1.23, 1.45, 0, 0, red, 0);
    k.box(-0.62, 1.44, 0, 0.62, 0.2, 0.62, 'sheetMetal', tag);
    k.put('darkSteel', boxGeo(0.42, 0.05, 0.42), -0.85, 1.6, 0, 0, 0x5a4a40);
    k.put('darkSteel', boxGeo(0.05, 0.4, 0.4), -1.06, 1.82, 0, [0, 0, 0.18], 0x5a4a40);
    k.putRaw('darkSteel', stickGeo(-0.85, 1.27, 0, -0.85, 1.58, 0, 0.05, 0.05), 0x4a4440, 0);
    const wheel = new THREE.TorusGeometry(0.19, 0.014, 4, 16);
    k.put('darkSteel', wheel, -0.24, 1.95, 0, [0.9, HALF, 0, 'YXZ'], 0x3a3634, 0);
    k.putRaw('darkSteel', stickGeo(0.0, 1.5, 0, -0.22, 1.92, 0, 0.04, 0.04), 0x3a3634, 0);
    // --- 뒤 연결 장치 (아래 링크 두 개 + 위 링크)
    for (const s of [-1, 1]) k.putRaw('darkSteel', stickGeo(-1.05, 0.55, s * 0.3, -1.45, 0.45, s * 0.38, 0.06, 0.06), 0x5a524a, 0);
    k.putRaw('darkSteel', stickGeo(-1.2, 1.1, 0, -1.45, 0.92, 0, 0.06, 0.06), 0x5a524a, 0);
    // 그을린 땅
    const S = T.scorch;
    this.contactShadows?.add({ x: t.x, z: t.z, hx: S.hx, hz: S.hz, rot: t.rot, preset: 'small', soft: S.soft, strength: S.strength });
    this.keepRngStream('rubble', 14);
  }

  // ------------------------------------------------------------------ 민간 차량 잔해
  // 불에 타 녹슨 차체(wreckCar), 유리는 모두 깨져 없음(승용차는 창틀 너머로 탄 실내·반대편이 보이고,
  // 승합차·트럭은 어두운 빈 창 구멍), 타이어는 녹아 없어져 림이 땅에 닿고 차체가 내려앉음(철심 고리·녹은 고무).
  // 충돌: 차체 = carBody (관통 가능), 엔진 = steel, 트럭 짐칸 판 = wood. 트럭(집단농장 쪽, 증원 경로 옆)의 충돌 윤곽은 이전과 같다.
  car(c) {
    const Cc = CONFIG.midfield.car;
    const y = this.terrain.heightAt(c.x, c.z) - 0.05;
    const k = this.wreckKit(c.x, y, c.z, c.rot);
    const tag = 'CAR';
    if (c.kind === 'sedan') this.sedanWreck(k, tag);
    else if (c.kind === 'van') this.vanWreck(k, tag);
    else this.truckWreck(k, tag);
    const pad = Cc.scorch;
    const half = { sedan: [2.1, 0.85], van: [2.25, 1.0], truck: [3.4, 1.1] }[c.kind] || [2.2, 1.0];
    this.contactShadows?.add({ x: c.x, z: c.z, hx: half[0] + pad.grow, hz: half[1] + pad.grow, rot: c.rot, preset: 'small', soft: pad.soft, strength: pad.strength });
  }

  // 타이어가 녹아 없어진 바퀴: 림(+ 바퀴 판)이 땅에 닿고, 늘어진 철심 고리와 납작한 고무 웅덩이
  meltedWheel(k, x, z, r, w, side, key = 'wreckCar') {
    const HALF = Math.PI / 2;
    k.put(key, cylGeo(r, r, w, 12, 1, true), x, r, z, [HALF, 0, 0], 0x8a7a70, 0);
    k.put('darkSteel', cylGeo(r * 0.92, r * 0.92, 0.02, 12), x, r, z + side * w * 0.3, [HALF, 0, 0], 0x5a524a);
    k.put('interior', cylGeo(r * 0.92, r * 0.92, 0.01, 12), x, r, z - side * w * 0.45, [HALF, 0, 0]);
    const hoop = new THREE.TorusGeometry(r * 1.5, 0.008, 3, 18);
    hoop.scale(1, 0.55, 1);
    k.put('darkSteel', hoop, x, r * 0.8, z + side * 0.02, [0, 0, 0.1], 0x5a4a40, 0);
    const puddle = new THREE.TorusGeometry(r * 1.2, r * 0.32, 5, 10, Math.PI * 0.7);
    puddle.rotateZ(-HALF - Math.PI * 0.35);
    puddle.scale(1.25, 0.32, 1.6);
    k.put('rubber', puddle, x, r * 0.62, z, 0, 0xffffff, 0);
  }

  // 승용차 (VAZ-2107 계열 4도어 세단): 바퀴 아치가 뚫린 아래 차체, 살짝 들린 보닛, A·B·C 필러와 내려앉은 지붕 (창은 비어 있음),
  // 탄 실내(좌석 뼈대·대시보드·핸들), 범퍼·빈 전조등 구멍·문 틈.
  sedanWreck(k, tag) {
    const C = 'wreckCar';
    const b = 0.2; // 림이 땅에 닿아 내려앉은 차체 밑면
    const belt = 0.8;
    // 아래 차체 (아치 위만 남긴 조각들)
    const seg = (x0, x1, y0) => k.put(C, boxGeo(x1 - x0, belt - y0, 1.62, 2), (x0 + x1) / 2, (y0 + belt) / 2, 0, 0, 0xffffff, 0.3);
    seg(1.6, 2.06, b + 0.08);
    seg(0.85, 1.6, 0.58);
    seg(-0.85, 0.85, b);
    seg(-1.6, -0.85, 0.58);
    seg(-2.06, -1.6, b + 0.1);
    k.put('interior', boxGeo(3.9, 0.22, 1.5), 0, 0.34, 0);
    for (const sx of [1.22, -1.22]) k.put('interior', boxGeo(0.76, 0.4, 1.5), sx, 0.4, 0);
    k.box(0, 0.5, 0, 2.06, 0.3, 0.81, 'carBody', tag);
    k.box(1.45, 0.5, 0, 0.45, 0.24, 0.5, 'steel', tag);
    // 보닛 (앞쪽이 살짝 들림)·트렁크 뚜껑
    k.put(C, boxGeo(1.12, 0.03, 1.5, 2), 1.47, belt + 0.03, 0, [0, 0, 0.05], 0xd0c0b0, 0);
    k.put(C, boxGeo(0.72, 0.03, 1.5, 2), -1.68, belt + 0.03, 0, 0, 0xd0c0b0, 0);
    // 범퍼·전조등·후미등 구멍·그릴
    for (const sx of [-1, 1]) {
      k.put('darkSteel', boxGeo(0.08, 0.12, 1.6), sx * 2.09, b + 0.2, 0, 0, 0x5a5048);
      for (const sz of [-1, 1]) k.put('interior', boxGeo(0.012, 0.13, 0.3), sx * 2.064, belt - 0.16, sz * 0.52);
    }
    k.put('interior', boxGeo(0.012, 0.12, 0.62), 2.064, belt - 0.16, 0);
    // 문 틈 (세로 어두운 선)
    for (const sz of [-1, 1]) for (const sx of [0.85, -0.17, -1.0]) k.put('interior', boxGeo(0.012, 0.55, 0.006), sx, b + 0.32, sz * 0.813);
    // 창틀: A·B·C 필러와 지붕 (유리 없음)
    const roofY = 1.27;
    for (const sz of [-1, 1]) {
      k.putRaw(C, stickGeo(0.92, belt, sz * 0.69, 0.42, roofY, sz * 0.62, 0.05, 0.06, 2), 0xb8a898, 0);
      k.putRaw(C, stickGeo(-0.17, belt, sz * 0.7, -0.2, roofY, sz * 0.63, 0.06, 0.07, 2), 0xb8a898, 0);
      k.putRaw(C, stickGeo(-1.3, belt, sz * 0.68, -0.86, roofY, sz * 0.62, 0.07, 0.12, 2), 0xb8a898, 0);
    }
    k.put(C, boxGeo(1.34, 0.04, 1.28, 2), -0.22, roofY + 0.01, 0, [0, 0, 0.015], 0xa89888, 0);
    k.box(-0.22, roofY, 0, 0.67, 0.03, 0.64, 'carBody', tag);
    // 탄 실내: 앞좌석 둘·뒷좌석 뼈대, 대시보드, 핸들
    for (const sz of [-1, 1]) {
      k.put('darkSteel', boxGeo(0.48, 0.1, 0.46), 0.05, 0.5, sz * 0.36, 0, 0x4a3e36);
      k.put('darkSteel', boxGeo(0.07, 0.5, 0.44), -0.24, 0.78, sz * 0.36, [0, 0, 0.25], 0x4a3e36);
    }
    k.put('darkSteel', boxGeo(0.5, 0.1, 1.2), -0.98, 0.5, 0, 0, 0x4a3e36);
    k.put('darkSteel', boxGeo(0.07, 0.48, 1.2), -1.22, 0.76, 0, [0, 0, 0.3], 0x4a3e36);
    k.put('darkSteel', boxGeo(0.28, 0.16, 1.32), 0.78, 0.86, 0, 0, 0x3a3430);
    k.put('darkSteel', new THREE.TorusGeometry(0.18, 0.012, 4, 14), 0.5, 0.96, -0.36, [0.5, Math.PI / 2, 0, 'YXZ'], 0x3a3430, 0);
    // 림 (타이어 없음)
    for (const sx of [1.22, -1.22]) for (const sz of [-1, 1]) this.meltedWheel(k, sx, sz * 0.68, 0.19, 0.13, sz);
  }

  // 승합차 (UAZ-452 계열 '빵 덩어리'): 둥근 앞모양 상자 차체 + 어두운 빈 창 구멍들, 바퀴 아치, 범퍼, 녹아 없어진 타이어
  vanWreck(k, tag) {
    const C = 'wreckCar';
    const b = 0.3;
    const top = 1.92;
    const prof = [[-2.18, b], [1.95, b], [2.18, b + 0.2], [2.2, 0.95], [2.1, 1.25], [1.75, 1.85], [1.55, top], [-2.05, top], [-2.18, top - 0.12]];
    k.putRaw(C, profileGeo(prof, 1.94, 0.94, 1.1, top, 2), 0xd8ccbc, 0.25);
    k.box(0, 1.1, 0, 2.2, 0.8, 0.97, 'carBody', tag);
    k.box(1.75, 0.65, 0, 0.42, 0.3, 0.55, 'steel', tag);
    const halfAt = (yy) => 0.97 * (1 - 0.06 * clamp((yy - 1.1) / (top - 1.1), 0, 1));
    // 옆 창 (어두운 빈 구멍)·바퀴 아치·문 틈
    for (const sz of [-1, 1]) {
      for (const [x0, x1] of [[0.95, 1.55], [-0.35, 0.6], [-1.75, -0.65]]) {
        k.put('interior', boxGeo(x1 - x0, 0.42, 0.012), (x0 + x1) / 2, 1.5, sz * (halfAt(1.5) + 0.004));
      }
      for (const sx of [1.15, -1.15]) k.put('interior', boxGeo(0.78, 0.36, 0.012), sx, b + 0.16, sz * 0.975);
      for (const sx of [0.88, -0.45]) k.put('interior', boxGeo(0.014, 0.7, 0.006), sx, 0.75, sz * 0.976);
    }
    // 앞 유리 두 장 (기운 앞면)·전조등·뒷문 창
    for (const sz of [-1, 1]) {
      k.put('interior', boxGeo(0.012, 0.6, 0.74), 1.93 + 0.012, 1.55, sz * 0.42, [0, 0, 0.528]);
      k.put('interior', cylGeo(0.09, 0.09, 0.012, 10), 2.206, 0.8, sz * 0.66, [0, 0, Math.PI / 2]);
      k.put('interior', boxGeo(0.012, 0.36, 0.5), -2.186, 1.48, sz * 0.42);
    }
    for (const sx of [-1, 1]) k.put('darkSteel', boxGeo(0.1, 0.14, 1.9), sx * 2.24, b + 0.12, 0, 0, 0x5a5048);
    for (const sx of [1.15, -1.15]) for (const sz of [-1, 1]) this.meltedWheel(k, sx, sz * 0.8, 0.2, 0.18, sz);
  }

  // 트럭 (GAZ-53 계열): 캐빈(어두운 빈 창)·둥근 엔진 덮개·앞 흙받기, 탄 나무 짐칸(바닥 판자 일부 빠짐, 한쪽 옆판은 타 버려
  // 판자 몇 장만 땅에), 뒷문 열려 늘어짐, 차대, 녹아 없어진 타이어 (뒤는 쌍바퀴). 충돌 상자는 이전 판과 같은 윤곽.
  truckWreck(k, tag) {
    const C = 'wreckCar';
    const rng = new Random(CONFIG.world.seed + 917);
    const d = CONFIG.midfield.car.truckDrop;
    // 차대
    for (const sz of [-1, 1]) k.putRaw('darkSteel', stickGeo(-2.9, 0.62, sz * 0.42, 3.4, 0.62, sz * 0.42, 0.08, 0.16), 0x4a4440, 0);
    for (const sx of [-2.6, -0.9, 0.8, 2.4]) k.put('darkSteel', boxGeo(0.08, 0.1, 0.84), sx, 0.6, 0, 0, 0x4a4440);
    // 캐빈
    const cab = [[1.45, 0.98], [2.95, 0.98], [2.95, 1.62], [2.86, 1.97], [1.5, 2.0], [1.45, 1.9]];
    k.putRaw(C, profileGeo(cab, 2.0, 0.95, 1.5, 2.0, 2), 0xd0c4b4, 0.2);
    for (const sz of [-1, 1]) {
      k.put('interior', boxGeo(0.95, 0.38, 0.012), 2.2, 1.68, sz * 0.985);
      k.put('interior', boxGeo(0.012, 0.32, 0.8), 2.917, 1.8, sz * 0.47, [0, 0, 0.25]);
      k.put('interior', boxGeo(0.012, 0.6, 0.008), 2.0, 1.28, sz * 1.004);
    }
    k.put('interior', boxGeo(0.012, 0.22, 0.9), 1.444, 1.7, 0);
    // 엔진 덮개 (둥근 앞)·그릴·앞 흙받기
    const hood = [[2.95, 0.9], [4.0, 0.9], [4.1, 1.05], [4.05, 1.38], [3.9, 1.48], [2.95, 1.55]];
    k.putRaw(C, profileGeo(hood, 1.0, 0.85, 1.0, 1.55, 2), 0xd0c4b4, 0.2);
    k.put('interior', boxGeo(0.012, 0.3, 0.7), 4.097, 1.12, 0);
    for (let i = 0; i < 6; i++) k.put('darkSteel', boxGeo(0.02, 0.3, 0.02), 4.105, 1.12, -0.3 + i * 0.12, 0, 0x4a4440);
    for (const sz of [-1, 1]) {
      const pts = [[2.45, 0.95], [2.6, 1.25], [3.0, 1.4], [3.4, 1.25], [3.6, 0.95]];
      for (let i = 0; i < pts.length - 1; i++) {
        k.putRaw(C, stickGeo(pts[i][0], pts[i][1], sz * 0.85, pts[i + 1][0], pts[i + 1][1], sz * 0.85, 0.34, 0.03, 2), 0xc0b4a4, 0);
      }
      k.put('interior', cylGeo(0.1, 0.1, 0.012, 10), 3.63, 1.08, sz * 0.85, [0, 0, Math.PI / 2]);
    }
    k.box(2.6, 1.4 - d, 0, 1.4, 0.75, 1.05, 'carBody', tag);
    k.box(3.4, 1.1 - d, 0, 0.5, 0.35, 0.6, 'steel', tag);
    // 짐칸: 바닥 판자 (일부 빠지고 일부 타서 짧음), 앞판, 오른쪽 옆판(조금 벌어짐), 뒷문은 열려 늘어짐
    const plankC = CONFIG.midfield.car.plankTint;
    for (let i = 0; i < 8; i++) {
      if (i === 2 || i === 5) continue;
      const pz = -0.95 + i * 0.27;
      const burnt = rng.next() < 0.4;
      const len = burnt ? rng.range(1.6, 3.0) : 3.95;
      k.put('wood', boxGeo(len, 0.03, 0.25, 1.5), -0.62 + (3.95 - len) * (rng.next() < 0.5 ? 0.5 : -0.5), 1.12, pz, 0, burnt ? 0x5a4c40 : plankC, 0);
    }
    k.put('wood', boxGeo(0.05, 0.6, 2.2, 1.5), 1.35, 1.42, 0, 0, plankC, 0);
    k.put('wood', boxGeo(3.95, 0.6, 0.05, 1.5), -0.62, 1.45, 1.08, [0.2, 0, 0], plankC, 0);
    k.box(-0.6, 1.42, 1.08, 2.0, 0.3, 0.06, 'wood', tag);
    const gate = boxGeo(0.05, 0.6, 2.2, 1.5);
    gate.translate(0, -0.3, 0);
    k.put('wood', gate, -2.62, 1.12, 0, [0, 0, -0.35], plankC, 0);
    // 타 버린 왼쪽 옆판의 판자 몇 장 (땅 위)
    for (let i = 0; i < 3; i++) {
      const px = rng.range(-2.4, 1.0);
      const pz = -1.4 - rng.range(0, 0.6);
      k.put('wood', boxGeo(rng.range(1.2, 2.4), 0.03, 0.2, 1.5), px, k.groundY(px, pz) + 0.02, pz, [0, rng.range(-0.3, 0.3), 0], 0x4a3e34, 0);
    }
    // 바퀴 (림만): 앞 하나, 뒤 쌍바퀴
    for (const sz of [-1, 1]) {
      this.meltedWheel(k, 3.0, sz * 0.85, 0.26, 0.18, sz);
      this.meltedWheel(k, -0.7, sz * 0.82, 0.26, 0.18, sz);
      this.meltedWheel(k, -0.7, sz * 1.05, 0.26, 0.18, sz);
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
    // 충돌용 주 부재: 네 다리 + 팔 (로컬 선분)
    const members = corners.map(([sx, sz]) => [sx * baseHalf, 0, sz * baseHalf, sx * topHalf, bodyH, sz * topHalf]);
    for (const [h, span] of arms) members.push([0, h, -span, 0, h, span]);
    return { parts, attach, members, legs: corners.map(([sx, sz]) => [sx * baseHalf, sz * baseHalf]) };
  }

  // 송전탑: 서 있음 / 기울어짐 / 쓰러짐. 충돌은 격자 탑의 주 부재(다리 4개, 쓰러진 탑은 팔까지)를 가는 강철 막대로 —
  // 격자 사이로는 탄과 시야가 지나간다 (예전처럼 쓰러진 탑 전체를 꽉 찬 상자로 막지 않는다).
  // 전선: 서 있는 탑 사이는 처진 곡선, 쓰러진 탑에 걸린 경간은 크게 처져 땅까지 늘어져 눕는다. 쓰러진 탑 쪽 경간의
  // 선 두 가닥과 기운 탑 다음 경간의 선 하나는 끊어져, 서 있는 탑 걸이에서 땅으로 늘어진 뒤 땅 위에 구불구불 눕는다.
  pylons() {
    const list = MAP.pylons;
    const Wc = CONFIG.midfield.wires;
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
      // 주 부재 충돌체 (강철, 가는 막대). 서 있는 탑은 다리만
      const members = p.state === 'fallen' ? tpl.members : tpl.members.slice(0, 4);
      for (const [ax, ay, az, bx, by, bz] of members) {
        const A = new THREE.Vector3(ax, ay, az).applyMatrix4(_m4);
        const B = new THREE.Vector3(bx, by, bz).applyMatrix4(_m4);
        this.beamCollider(A, B, Wc.memberHalf, 'steel', 'PYLON');
      }
    }
    // 전선
    const rng = new Random(CONFIG.world.seed + 919);
    for (let i = 0; i < list.length - 1; i++) {
      const A = attachWorld[i];
      const B = attachWorld[i + 1];
      const fa = list[i].state === 'fallen';
      const fb = list[i + 1].state === 'fallen';
      const tilted = list[i].state === 'tilted';
      const span = Math.hypot(list[i + 1].x - list[i].x, list[i + 1].z - list[i].z);
      const dx = (list[i + 1].x - list[i].x) / span;
      const dz = (list[i + 1].z - list[i].z) / span;
      for (let w = 0; w < A.length; w++) {
        const a = A[w];
        const b = B[w];
        const seed = rng.range(0, 100);
        if ((fa || fb) && (w === 1 || w === 3)) {
          // 끊어진 선: 서 있는 탑 쪽은 걸이에서 늘어져 땅에 눕고, 쓰러진 탑 쪽 끝은 땅 위에 짧게 눕는다
          const [up, low, s] = fa ? [b, a, -1] : [a, b, 1];
          this.danglingWire(up, dx * s, dz * s, span * Wc.snappedLength, seed);
          this.danglingWire(low, -dx * s, -dz * s, span * 0.18, seed + 7);
          continue;
        }
        if (tilted && w === 0) {
          // 기운 탑 다음 경간: 가운데서 끊겨 양쪽 탑에서 늘어짐
          this.danglingWire(a, dx, dz, span * 0.42, seed);
          this.danglingWire(b, -dx, -dz, span * 0.4, seed + 3);
          continue;
        }
        const sag = fa || fb ? Wc.brokenSag : tilted || list[i + 1].state === 'tilted' ? Wc.sag * 1.5 : Wc.sag + w * 0.15;
        this.wireSpan(a, b, sag, seed);
      }
    }
  }

  // 막대 충돌체 (두 점 사이, 단면 반폭 half)
  beamCollider(A, B, half, mat, tag, opts) {
    const len = A.distanceTo(B);
    if (len < 1e-3) return null;
    _v.subVectors(B, A).divideScalar(len);
    _q.setFromUnitVectors(_mfY, _v);
    _mfE.setFromQuaternion(_q, 'XYZ');
    return this.col.addBox((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2, half, len / 2, half, { x: _mfE.x, y: _mfE.y, z: _mfE.z, order: 'XYZ' }, mat, tag, opts);
  }

  // 처진 전선 한 경간 (a → b, 포물선 근사). 땅에 닿으면 지면을 따라 눕고, 누운 부분은 좌우로 조금씩 구불거린다
  wireSpan(a, b, sag, seed) {
    const Wc = CONFIG.midfield.wires;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const segs = Math.max(6, Math.ceil(len / Wc.segment));
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    let prev = null;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      let x = a.x + (b.x - a.x) * t;
      let z = a.z + (b.z - a.z) * t;
      const yLine = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      let y = yLine;
      const gy = this.terrain.heightAt(x, z) + Wc.lift;
      if (yLine < gy + Wc.wanderBlend) {
        // 땅에 닿은 정도 (양 끝 걸이 근처는 구불거리지 않음)
        const f = clamp((gy + Wc.wanderBlend - yLine) / Wc.wanderBlend, 0, 1) * Math.min(1, (t * len) / 4, ((1 - t) * len) / 4);
        const wob = Math.sin(t * len * 0.21 + seed) * 0.6 + Math.sin(t * len * 0.53 + seed * 2.3) * 0.4;
        x += nx * wob * Wc.groundWander * f;
        z += nz * wob * Wc.groundWander * f;
        y = Math.max(yLine, this.terrain.heightAt(x, z) + Wc.lift);
      }
      const cur = [x, y, z];
      if (prev) this.wires.push(...prev, ...cur);
      prev = cur;
    }
  }

  // 끊어진 전선: 걸이 점 p 에서 거의 수직으로 떨어지다 (dx, dz) 쪽으로 휘어 땅에 닿은 뒤, 땅 위에 구불구불 눕는다 (총 길이 len)
  danglingWire(p, dx, dz, len, seed) {
    const Wc = CONFIG.midfield.wires;
    const g0 = this.terrain.heightAt(p.x, p.z);
    const h = Math.max(0.1, p.y - g0);
    const reach = Math.min(len * 0.5, h * Wc.hangReach);
    const gx = p.x + dx * reach;
    const gz = p.z + dz * reach;
    const gG = this.terrain.heightAt(gx, gz) + Wc.lift;
    const pts = [];
    const nHang = Math.max(3, Math.ceil(h / 1.5));
    for (let i = 0; i <= nHang; i++) {
      const t = i / nHang;
      const d = reach * t * t;
      const x = p.x + dx * d;
      const z = p.z + dz * d;
      pts.push([x, Math.max(this.terrain.heightAt(x, z) + Wc.lift, gG + (p.y - gG) * Math.pow(1 - t, 1.5)), z]);
    }
    const rest = Math.max(1, len - h - reach * 0.5);
    const steps = Math.max(3, Math.ceil(rest / Wc.segment));
    const nx = -dz;
    const nz = dx;
    for (let i = 1; i <= steps; i++) {
      const s = (i / steps) * rest;
      // 끝으로 갈수록 크게 구불거리고, 마지막은 옆으로 말려 끝난다
      const wob = (Math.sin(s * 0.23 + seed) * 0.7 + Math.sin(s * 0.61 + seed * 1.7) * 0.3) * Wc.groundWander * 2.2 * Math.min(1, s / 4);
      const curl = Math.max(0, (s - rest + 4) / 4) ** 2 * 2.5;
      const x = gx + dx * (s - curl * 0.6) + nx * (wob + curl);
      const z = gz + dz * (s - curl * 0.6) + nz * (wob + curl);
      pts.push([x, this.terrain.heightAt(x, z) + Wc.lift, z]);
    }
    for (let i = 1; i < pts.length; i++) this.wires.push(...pts[i - 1], ...pts[i]);
  }

  // ------------------------------------------------------------------ 콘크리트 전신주 (농로를 따라가는 10kV 배전선)
  // 소련식 사각 단면 철근콘크리트 기둥(위로 가늘어짐, 밑동은 흙탕물에 젖어 어두움) + 강철 완목·버팀대 + 사기 애자 3개.
  // lean = 기울어짐, fallen = 기초째 뽑혀 누움(묻혀 있던 밑동까지 드러남, 완목은 땅에 납작), broken = 밑동만 서고 윗동이
  // 부러져 옆에 누움 (부러진 양 끝에 철근). 전선은 서 있는 기둥 사이에 처지고, 쓰러진 기둥 쪽으론 땅까지 늘어져 눕는다.
  // 충돌: 콘크리트 막대 (관통 불가).
  poles() {
    const P = CONFIG.midfield.poles;
    const list = MAP.poles || [];
    const rng = new Random(CONFIG.world.seed + 923);
    const L = P.height + P.buried;
    const attach = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const gy = this.terrain.heightAt(p.x, p.z);
      // 선로 방향 → 완목 방향(수평, 선로에 수직)
      const n = list[Math.min(i + 1, list.length - 1)];
      const pv = list[Math.max(i - 1, 0)];
      const yawLine = Math.atan2(-(n.z - pv.z), n.x - pv.x);
      const fb = ((p.fall ?? 0) * Math.PI) / 180;
      const fx = Math.sin(fb);
      const fz = -Math.cos(fb);
      const axis = new THREE.Vector3(fz, 0, -fx);
      const parts = []; // [key, geo(기둥 로컬: 밑동 원점, y = 기둥 축), color, dark]
      // 기둥의 y0 ~ y1 구간 (밑동 기준 높이) → 밑면이 원점인 가늘어지는 사각 기둥
      const wAt = (yy, j) => P.base[j] + (P.top[j] - P.base[j]) * (yy / L);
      const shaft = (y0, y1) => parts.push(['concrete', taperBoxGeo(wAt(y0, 0), wAt(y0, 1), wAt(y1, 0), wAt(y1, 1), y1 - y0, 2), P.color, 0.35]);
      const head = (yTop) => {
        parts.push(['darkSteel', place(boxGeo(0.07, 0.07, 1.7), 0, yTop - 0.45, 0), 0x6a625a, 0]);
        for (const s of [-1, 1]) parts.push(['darkSteel', stickGeo(0, yTop - 1.05, 0, 0, yTop - 0.47, s * 0.62, 0.04, 0.04), 0x6a625a, 0]);
        for (const [ix, iy, iz] of [[0, yTop - 0.33, -0.76], [0, yTop - 0.33, 0.76], [0, yTop + 0.1, 0]]) {
          parts.push(['plain', place(cylGeo(0.045, 0.07, 0.16, 8), ix, iy, iz), 0xbcbeb8, 0]);
        }
        return [[0, yTop - 0.24, -0.76], [0, yTop - 0.24, 0.76], [0, yTop + 0.19, 0]];
      };
      const rebar = (y0, dir) => {
        for (let r = 0; r < 4; r++) {
          const ox = (r % 2 ? 1 : -1) * 0.05;
          const oz = (r < 2 ? 1 : -1) * 0.05;
          const len = rng.range(0.12, 0.32);
          parts.push(['rust', stickGeo(ox, y0, oz, ox + rng.range(-0.06, 0.06), y0 + dir * len, oz + rng.range(-0.06, 0.06), 0.012, 0.012), 0x8a6a58, 0]);
        }
      };
      const commit = (M) => {
        for (const [key, g, color, dark] of parts) {
          g.applyMatrix4(M);
          this.batch.add(key, g, color, dark);
        }
        parts.length = 0;
      };
      const Ryaw = (yw) => new THREE.Matrix4().makeRotationY(yw);
      if (p.state === 'stand' || p.state === 'lean') {
        shaft(0, L);
        const att = head(L);
        const tilt = p.state === 'lean' ? (p.lean ?? P.leanDeg) * (Math.PI / 180) : 0;
        const M = new THREE.Matrix4().makeTranslation(p.x, gy - P.buried, p.z);
        // 땅 위 밑동 둘레를 기준으로 기울임
        M.multiply(new THREE.Matrix4().makeTranslation(0, P.buried, 0));
        M.multiply(new THREE.Matrix4().makeRotationAxis(axis, tilt));
        M.multiply(new THREE.Matrix4().makeTranslation(0, -P.buried, 0));
        M.multiply(Ryaw(yawLine));
        commit(M);
        attach.push(att.map(([x, y2, z]) => new THREE.Vector3(x, y2, z).applyMatrix4(M)));
        const A = new THREE.Vector3(0, P.buried, 0).applyMatrix4(M);
        const B = new THREE.Vector3(0, L, 0).applyMatrix4(M);
        this.beamCollider(A, B, P.colliderHalf, 'concrete', 'POLE');
      } else if (p.state === 'fallen') {
        // 기초째 뽑혀 fall 방향으로 누움 (완목이 땅에 납작해지도록 완목 = 넘어지는 축 방향)
        shaft(0, L);
        const att = head(L);
        const tipX = p.x + fx * L;
        const tipZ = p.z + fz * L;
        const slope = Math.atan2(this.terrain.heightAt(tipX, tipZ) - gy, L);
        const M = new THREE.Matrix4().makeTranslation(p.x, gy + P.base[1] * 0.5, p.z);
        M.multiply(new THREE.Matrix4().makeRotationAxis(axis, Math.PI / 2 - slope));
        M.multiply(Ryaw(Math.atan2(fz, -fx)));
        commit(M);
        attach.push(att.map(([x, y2, z]) => new THREE.Vector3(x, y2, z).applyMatrix4(M)));
        this.beamCollider(new THREE.Vector3(0, 0, 0).applyMatrix4(M), new THREE.Vector3(0, L, 0).applyMatrix4(M), P.colliderHalf, 'concrete', 'POLE');
      } else {
        // broken: 밑동 stub m 만 서고, 윗동은 부러진 끝이 밑동 옆에 닿은 채 fall 방향으로 누움
        const stub = p.stub ?? 1.2;
        const rest = L - P.buried - stub;
        shaft(0, P.buried + stub);
        rebar(P.buried + stub, 1);
        const M0 = new THREE.Matrix4().makeTranslation(p.x, gy - P.buried, p.z).multiply(Ryaw(yawLine));
        commit(M0);
        this.beamCollider(new THREE.Vector3(p.x, gy, p.z), new THREE.Vector3(p.x, gy + stub, p.z), P.colliderHalf, 'concrete', 'POLE');
        shaft(P.buried + stub, L);
        const att = head(rest);
        rebar(0, -1);
        const bx = p.x + fx * 0.35;
        const bz = p.z + fz * 0.35;
        const by = this.terrain.heightAt(bx, bz);
        const tipX = bx + fx * rest;
        const tipZ = bz + fz * rest;
        const slope = Math.atan2(this.terrain.heightAt(tipX, tipZ) - by, rest);
        const M = new THREE.Matrix4().makeTranslation(bx, by + P.base[1] * 0.5, bz);
        M.multiply(new THREE.Matrix4().makeRotationAxis(axis, Math.PI / 2 - slope));
        M.multiply(Ryaw(Math.atan2(fz, -fx)));
        commit(M);
        attach.push(att.map(([x, y2, z]) => new THREE.Vector3(x, y2, z).applyMatrix4(M)));
        this.beamCollider(new THREE.Vector3(0, 0, 0).applyMatrix4(M), new THREE.Vector3(0, rest, 0).applyMatrix4(M), P.colliderHalf, 'concrete', 'POLE');
      }
    }
    // 전선 (기둥마다 3가닥)
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i];
      const b = list[i + 1];
      const span = Math.hypot(b.x - a.x, b.z - a.z);
      const down = a.state === 'fallen' || a.state === 'broken' || b.state === 'fallen' || b.state === 'broken';
      for (let w = 0; w < 3; w++) {
        const seed = rng.range(0, 100);
        if (down && w === 1) {
          // 끊어진 선: 서 있는 쪽 걸이에서 늘어져 땅에 눕는다 (양쪽 다 쓰러졌으면 땅 위에만)
          const upA = a.state === 'stand' || a.state === 'lean';
          const [p0, s] = upA ? [attach[i][w], 1] : [attach[i + 1][w], -1];
          this.danglingWire(p0, ((b.x - a.x) / span) * s, ((b.z - a.z) / span) * s, span * 0.45, seed);
          continue;
        }
        this.wireSpan(attach[i][w], attach[i + 1][w], down ? P.sag * 6 : P.sag, seed);
      }
    }
  }

  // ------------------------------------------------------------------ 나무·그루터기
  // 포격에 부러진 고립 나무: 밑동이 퍼진 굵은 몸통(껍질 골·굴곡), 찢어진 윗부분(들쭉날쭉한 끝 + 드러난 속살 + 쪼개진 가닥,
  // 늘어진 껍질 조각), 몇 개 남은 짧고 굵은 가지(부러진 끝), 옆에 쓰러진 윗동. 수치는 CONFIG.vegetation.trees.
  // 충돌: 몸통 원기둥·쓰러진 윗동 상자 = 통나무(관통 불가, 나무 탄착). 기하는 'bark'·'wood' 병합 메시 (드로우콜 추가 없음)
  tree(t) {
    // 공용 난수열(this.rng)은 이전과 같은 개수만 넘겨, 뒤에 만드는 구조물 배치를 그대로 둔다
    for (let i = 0; i < 32; i++) this.rng.next();
    const T = CONFIG.vegetation.trees;
    const rng = new Random(CONFIG.world.seed + Math.round(t.x * 73 + t.z * 19) + 5000);
    const ter = this.terrain;
    const y = ter.heightAt(t.x, t.z);
    const r0 = rng.range(T.trunkRadius[0], T.trunkRadius[1]);
    const la = rng.next() * Math.PI * 2;
    const lean = rng.range(0.025, 0.08);
    const ph = rng.next() * 6;
    const burnSide = rng.next() * Math.PI * 2;
    const ss = (a, b, v) => {
      const k = clamp((v - a) / (b - a), 0, 1);
      return k * k * (3 - 2 * k);
    };
    // 몸통 중심선 (약하게 기울고 휜다)
    const axis = (h) => [
      t.x + Math.cos(la) * lean * h + 0.07 * Math.sin(h * 1.1 + ph),
      y - 0.15 + h,
      t.z + Math.sin(la) * lean * h + 0.07 * Math.cos(h * 0.9 + ph),
    ];
    const radius = (h) => r0 * (1 - 0.3 * (h / t.h)) * (1 + (T.flare - 1) * Math.exp(-h / 0.32));
    const hs = [0, 0.15, 0.42, 0.85];
    for (let h = 1.5; h < t.h - 0.4; h += 0.85) hs.push(h);
    hs.push(t.h);
    // 껍질색: 밑동·흙 튄 아래쪽 어둡게, 윗부분 한쪽은 그을림
    const shade = (u, a) => {
      const burn = Math.max(0, Math.cos(a - burnSide)) * ss(0.55, 1, u) * 0.4;
      return (0.62 + 0.28 * ss(0, 0.25, u)) * (1 - burn) * (0.92 + 0.08 * Math.sin(a * 5 + ph));
    };
    const trunk = this.treeTube(
      hs.map(axis),
      hs.map(radius),
      11,
      rng,
      { jag: 0.65 * Math.min(1.2, r0 / 0.3), bumps: 0.075, shade, color: 0xc4bdb2 },
    );
    this.batch.add('bark', trunk.geo);
    this.treeBreak(trunk, rng, T, r0);
    // 남은 가지: 짧고 굵게, 끝은 부러짐 (가끔 잔가지 하나)
    const nb = rng.int(T.branches[0], T.branches[1]);
    for (let k = 0; k < nb; k++) {
      const h = t.h * rng.range(0.35, 0.86);
      const az = k * 2.4 + rng.range(-0.5, 0.5);
      const el = k === 0 ? rng.range(0.6, 1.0) : rng.range(0.3, 1.0); // 수평에서 올라간 각
      const limb = k === 0 ? T.limb : [1, 1];
      const len = rng.range(T.branchLen[0], T.branchLen[1]) * (1 - 0.35 * (h / t.h)) * limb[1];
      const br = radius(h) * rng.range(0.24, 0.34) * limb[0];
      const c = axis(h);
      const d = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
      const s0 = radius(h) * 0.55;
      const p0 = [c[0] + d[0] * s0, c[1], c[2] + d[2] * s0];
      const sag = len * 0.12;
      const path = [
        p0,
        [p0[0] + d[0] * len * 0.5, p0[1] + d[1] * len * 0.5 + sag * 0.4, p0[2] + d[2] * len * 0.5],
        [p0[0] + d[0] * len, p0[1] + d[1] * len - sag * 0.2, p0[2] + d[2] * len],
      ];
      const b = this.treeTube(path, [br, br * 0.72, br * 0.45], 6, rng, { jag: br * 1.6, bumps: 0.05, shade: () => 0.78, color: 0xbab3a8 });
      this.batch.add('bark', b.geo);
      this.treeCap(b, 0x9c917c);
      if (k === 0 || rng.next() < 0.5) {
        const m = path[1];
        const az2 = az + rng.range(-1.2, 1.2);
        const tl = len * rng.range(0.3, 0.5);
        const tw = this.treeTube(
          [m, [m[0] + Math.cos(az2) * tl * 0.7, m[1] + tl * 0.7, m[2] + Math.sin(az2) * tl * 0.7]],
          [br * 0.42, br * 0.2],
          5,
          rng,
          { jag: br * 0.6, bumps: 0, shade: () => 0.8, color: 0xbab3a8 },
        );
        this.batch.add('bark', tw.geo);
      }
    }
    // 쓰러진 윗동: 부러진 끝이 몸통 쪽, 지면을 따라 놓이고 가지 그루터기 두어 개
    const fl = rng.range(T.fallenLen[0], T.fallenLen[1]) * Math.min(1, t.h / 5);
    const fa = rng.next() * Math.PI * 2;
    const rt = radius(t.h) * 0.9;
    const s = r0 * 1.6 + 0.4;
    const fpath = [];
    const fr = [];
    for (let k = 0; k <= 3; k++) {
      const u = k / 3;
      const px = t.x + Math.cos(fa) * (s + u * fl);
      const pz = t.z + Math.sin(fa) * (s + u * fl);
      const rr = rt * (1 - 0.45 * u);
      fpath.push([px, ter.heightAt(px, pz) + rr * 0.75, pz]);
      fr.push(rr);
    }
    // 부러진 끝이 시작점 쪽에 오도록 거꾸로 만든다 (관의 끝 고리가 들쭉날쭉)
    const fallen = this.treeTube([...fpath].reverse(), [...fr].reverse(), 9, rng, { jag: rt * 1.5, bumps: 0.07, shade: (u) => 0.66 + 0.1 * u, color: 0xbcb5aa });
    this.batch.add('bark', fallen.geo);
    this.treeCap(fallen, 0xa89c84);
    for (let k = 0; k < 2; k++) {
      const u = rng.range(0.35, 0.85);
      const p = fpath[Math.min(3, Math.round(u * 3))];
      const a2 = fa + (rng.next() < 0.5 ? 1 : -1) * rng.range(0.6, 1.4);
      const bl = rng.range(0.3, 0.7);
      const st = this.treeTube(
        [p, [p[0] + Math.cos(a2) * bl * 0.6, p[1] + bl * 0.7, p[2] + Math.sin(a2) * bl * 0.6]],
        [rt * 0.32, rt * 0.18],
        5,
        rng,
        { jag: 0.05, bumps: 0, shade: () => 0.7, color: 0xbab3a8 },
      );
      this.batch.add('bark', st.geo);
    }
    const end = fpath[3];
    const fcx = (fpath[0][0] + end[0]) / 2;
    const fcz = (fpath[0][2] + end[2]) / 2;
    this.col.addBox(fcx, (fpath[0][1] + end[1]) / 2, fcz, fl / 2, rt * 0.8, rt * 0.8, -fa, 'log', 'TREE', { walkable: true });
    this.col.addCylinder(t.x, y + t.h / 2, t.z, r0 * 0.9, t.h / 2, 'log', 'TREE');
  }

  stump(x, z) {
    for (let i = 0; i < 12; i++) this.rng.next();
    const rng = new Random(CONFIG.world.seed + Math.round(x * 61 + z * 29) + 7000);
    const y = this.terrain.heightAt(x, z);
    const h = rng.range(0.35, 1.0);
    const r = rng.range(0.16, 0.3);
    const ph = rng.next() * 6;
    const hs = [0, 0.12, 0.3, h + 0.1];
    const tube = this.treeTube(
      hs.map((hh) => [x + 0.03 * Math.sin(hh * 2 + ph), y - 0.12 + hh, z + 0.03 * Math.cos(hh * 2 + ph)]),
      hs.map((hh) => r * (0.95 + 0.6 * Math.exp(-hh / 0.18))),
      9,
      rng,
      { jag: 0.18 + h * 0.3, bumps: 0.08, shade: (u) => 0.6 + 0.22 * u, color: 0xc4bdb2 },
    );
    this.batch.add('bark', tube.geo);
    this.treeBreak(tube, rng, { splinters: [2, 4], splinterLen: [0.12, 0.4] }, r);
    this.col.addCylinder(x, y + h / 2, z, r, h / 2, 'log', 'STUMP');
  }

  // 부러진 끝 마무리: 드러난 속살(들쭉날쭉한 고리 안쪽), 쪼개진 섬유 가닥, (몸통이면) 늘어진 껍질 조각
  treeBreak(tube, rng, T, r0) {
    this.treeCap(tube, 0xb0a48a);
    const top = tube.top;
    const dir = tube.dir;
    const ns = rng.int(T.splinters[0], T.splinters[1]);
    for (let k = 0; k < ns; k++) {
      const j = Math.floor(rng.next() * top.length);
      const b = top[j].clone().lerp(tube.end, rng.range(0.1, 0.45));
      const out = b.clone().sub(tube.end).setY(0);
      if (out.lengthSq() > 1e-6) out.normalize();
      const len = rng.range(T.splinterLen[0], T.splinterLen[1]) * Math.min(1.3, r0 / 0.28);
      const tip = b.clone().addScaledVector(dir, len).addScaledVector(out, len * rng.range(0.05, 0.35));
      this.treeShard(b, tip, rng.range(0.03, 0.08) * Math.min(1.3, r0 / 0.25), rng, rng.next() < 0.35 ? 0x8c8478 : 0xb9ad94);
    }
    // 늘어진 껍질·나무 조각 (몸통만)
    if (T.fallenLen && rng.next() < 0.8) {
      const j = Math.floor(rng.next() * top.length);
      const p = top[j];
      const out = p.clone().sub(tube.end).setY(0).normalize();
      const L = rng.range(0.6, 1.1);
      const path = [
        [p.x, p.y - 0.05, p.z],
        [p.x + out.x * 0.12, p.y + 0.12, p.z + out.z * 0.12],
        [p.x + out.x * 0.24, p.y - L * 0.45, p.z + out.z * 0.24],
        [p.x + out.x * 0.3, p.y - L, p.z + out.z * 0.3],
      ];
      const strip = this.treeTube(path, [0.035, 0.03, 0.025, 0.012], 4, rng, { bumps: 0, shade: () => 0.85, color: 0xa69a82 });
      this.batch.add('wood', strip.geo);
    }
  }

  // 나무 관 기하 (몸통·가지·쓰러진 윗동·늘어진 조각). path = [[x,y,z]...], radii, seg = 둘레 분할.
  // 껍질 골·굴곡(bumps), 끝 고리 들쭉날쭉(jag m: 쪼개진 섬유처럼 몇 가닥은 길게), 정점색 = color × shade(길이 비율, 둘레 각)
  // 반환 { geo, top: 끝 고리 점들, end: 끝 중심, dir: 끝 방향 }
  treeTube(path, radii, seg, rng, { jag = 0, bumps = 0.07, shade = () => 1, color = 0xffffff, uvScale = 1.2 } = {}) {
    const n = path.length;
    const P = path.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const Ts = P.map((p, i) => P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize());
    // 비틀림 없는 틀 (평행 이동)
    let N1 = Math.abs(Ts[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = Ts[i];
      N1 = N1.clone().addScaledVector(t, -N1.dot(t)).normalize();
      frames.push([N1, new THREE.Vector3().crossVectors(t, N1)]);
    }
    const base = new THREE.Color(color);
    const pos = [];
    const nor = [];
    const uv = [];
    const col = [];
    const idx = [];
    const ph = rng.next() * 10;
    const jags = [];
    for (let j = 0; j < seg; j++) jags.push(rng.next());
    const top = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) len += P[i].distanceTo(P[i - 1]);
      const [a1, a2] = frames[i];
      for (let j = 0; j <= seg; j++) {
        const jj = j % seg;
        const a = (jj / seg) * Math.PI * 2;
        const rr = radii[i] * (1 + bumps * (0.6 * Math.sin(a * 3 + ph + i * 0.9) + 0.4 * Math.sin(a * 7 + ph * 2.3 + i * 1.7)));
        const d = a1.clone().multiplyScalar(Math.cos(a)).addScaledVector(a2, Math.sin(a));
        const q = P[i].clone().addScaledVector(d, rr);
        if (i === n - 1 && jag > 0) {
          const s = jags[jj];
          q.addScaledVector(Ts[i], jag * (s * s * 0.9 + 0.12 * Math.sin(a * 2 + ph)) - jag * 0.2);
        }
        if (i === n - 1 && j < seg) top.push(q.clone());
        pos.push(q.x, q.y, q.z);
        nor.push(d.x, d.y, d.z);
        uv.push(((j / seg) * Math.PI * 2 * Math.max(0.05, radii[i])) / uvScale, len / uvScale);
        const k = shade(i / Math.max(1, n - 1), a);
        col.push(base.r * k, base.g * k, base.b * k);
      }
    }
    const R = seg + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const A = i * R + j;
        idx.push(A, A + 1, A + R, A + 1, A + R + 1, A + R);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return { geo, top, end: P[n - 1], dir: Ts[n - 1] };
  }

  // 관 끝 속살: 끝 중심 조금 안쪽에서 들쭉날쭉한 고리로 부채꼴 (밝은 나무색, 'wood')
  treeCap(tube, color) {
    const c = tube.end.clone().addScaledVector(tube.dir, -0.04);
    const tris = [];
    for (let j = 0; j < tube.top.length; j++) tris.push([c, tube.top[j], tube.top[(j + 1) % tube.top.length]]);
    this.treeSoup(tris, tube.end.clone().addScaledVector(tube.dir, -1), color);
  }

  // 쪼개진 가닥: 밑면 세모 → 끝 한 점 (세 옆면)
  treeShard(b, tip, w, rng, color) {
    const ax = tip.clone().sub(b).normalize();
    const u = new THREE.Vector3(0, 1, 0).cross(ax);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    const v = new THREE.Vector3().crossVectors(ax, u);
    const tw = rng.next() * Math.PI * 2;
    const base = [0, 1, 2].map((k) => {
      const a = tw + (k / 3) * Math.PI * 2;
      return b.clone().addScaledVector(u, Math.cos(a) * w * 0.6).addScaledVector(v, Math.sin(a) * w * 0.35);
    });
    const tris = [];
    for (let k = 0; k < 3; k++) tris.push([base[k], base[(k + 1) % 3], tip]);
    this.treeSoup(tris, b.clone().lerp(tip, 0.3), color);
  }

  // 삼각형 묶음 → 'wood' 병합 (각 면 법선이 inside 점 반대쪽을 보게 감김을 맞춤, 평면 음영)
  treeSoup(tris, inside, color) {
    const pos = [];
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (const [a, b, c] of tris) {
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      const nrm = e1.cross(e2);
      const cen = a.clone().add(b).add(c).multiplyScalar(1 / 3).sub(inside);
      if (nrm.dot(cen) >= 0) pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      else pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    this.batch.add('wood', g, color);
  }

  // ------------------------------------------------------------------ 수로 콘크리트 라이닝 (비탈에 붙인 프리캐스트 판)
  // 판 배치·상태는 Terrain.buildCanalSlabs. 판은 비탈과 같은 기울기로 흙에 밀착하고(윗면 = 비탈 + proud),
  // 두께 대부분이 흙 속에 묻혀 판과 흙 사이에 틈이 보이지 않는다. 판 아래 렌더 지면은 Terrain.canalSlabDrop 으로 내려
  // 흙·풀이 판 윗면을 뚫고 나오지 않는다. 충돌은 지형 높이장(비탈 평면)이 맡고, 판 자리 지면 종류가 콘크리트라
  // 탄착 효과·도탄·탄흔이 콘크리트로 난다 (관통 불가).
  canalWalls() {
    const t = this.terrain;
    if (!t.slabSections) return;
    const K = CONFIG.canal;
    const rng = new Random(CONFIG.world.seed + 223);
    for (const sec of t.slabSections) {
      for (const list of [sec.north, sec.south]) {
        list.forEach((slab, i) => {
          if (slab.kind !== 'missing') {
            this.canalSlab(slab, rng);
            return;
          }
          // 빠진 판: 양옆 판의 깨진 가장자리에서 철근 몇 가닥이 드러난 흙 쪽으로 삐져나온다
          const F = this.slabFrame((slab.x0 + slab.x1) / 2, slab.side);
          const tw = F.t.x > 0 ? F.t.clone() : F.t.clone().negate(); // 월드 +x 쪽 수로 방향
          for (const [nb, sgn] of [
            [list[i - 1], -1],
            [list[i + 1], 1],
          ]) {
            if (!nb || nb.kind === 'missing') continue;
            const n = rng.int(K.rebar.perEdge[0], K.rebar.perEdge[1]);
            for (let r = 0; r < n; r++) {
              const s = rng.range(0.25, K.slab.length - K.slab.toe - 0.3);
              const P = F.O.clone()
                .addScaledVector(tw, sgn * (K.slab.width / 2 + 0.03))
                .addScaledVector(F.u, s)
                .addScaledVector(F.n, K.slab.proud - rng.range(0.04, 0.07));
              const dir = tw.clone().multiplyScalar(-sgn).addScaledVector(F.n, rng.range(-0.15, 0.3)).addScaledVector(F.u, rng.range(-0.25, 0.25)).normalize();
              this.rebarRod(P, dir, rng.range(K.rebar.length[0], K.rebar.length[1]) + 0.03);
            }
          }
        });
      }
    }
  }

  // 비탈 판 좌표계: O = 판 가운데 줄이 수로 바닥과 만나는 점(비탈 평면 위), t = 수로 방향(판 폭), n = 비탈 법선(위), u = 비탈 위쪽
  // (t, n, u 는 오른손 좌표계라 북쪽 비탈의 t 는 월드 -x 쪽이다)
  slabFrame(xm, side) {
    const t = this.terrain;
    const C = MAP.canal;
    const k = t.canalDzDx(xm);
    const nl = Math.hypot(1, k);
    const hx = (side * k) / nl;
    const hz = -side / nl;
    const pt = (d, ox = 0) => {
      const x = xm + ox + hx * d;
      const z = t.canalZ(xm + ox) + hz * d;
      return new THREE.Vector3(x, t.canalSurfaceY(x, z), z);
    };
    // 비탈 평면 위 두 점 (위 모서리의 둥근 부분·판 끝에 쌓인 흙보다 아래)
    const A = pt(C.floorHalf + 0.3);
    const u = pt(C.topHalf - 0.4).sub(A).normalize();
    const O = A.clone().addScaledVector(u, -0.3 / Math.hypot(u.x, u.z));
    // 수로 방향 기울기(바닥이 x 를 따라 오르내림)도 따른다 — 판마다 수평이면 이웃 판 끝이 톱니처럼 어긋나 보인다
    const dMid = (C.floorHalf + C.topHalf) / 2;
    const tx = pt(dMid, 0.5).sub(pt(dMid, -0.5));
    if (side > 0) tx.negate();
    tx.normalize();
    const n = new THREE.Vector3().crossVectors(u, tx).normalize();
    tx.crossVectors(n, u).normalize();
    return { O, t: tx, n, u };
  }

  // 판 좌표계 (ox, oy, oz) 위치의 변환 행렬
  slabMatrix(F, ox, oy, oz) {
    const m = new THREE.Matrix4().makeBasis(F.t, F.n, F.u);
    m.setPosition(F.O.x + F.t.x * ox + F.n.x * oy + F.u.x * oz, F.O.y + F.t.y * ox + F.n.y * oy + F.u.y * oz, F.O.z + F.t.z * ox + F.n.z * oy + F.u.z * oz);
    return m;
  }

  canalSlab(slab, rng) {
    const K = CONFIG.canal;
    const S = K.slab;
    const F = this.slabFrame((slab.x0 + slab.x1) / 2, slab.side);
    const w = S.width - S.joint;
    const s0 = -S.toe;
    const s1 = S.length - S.toe;
    const tint = rng.range(K.slabTint[0], K.slabTint[1]);
    const jitter = () => [rng.range(-0.004, 0.004), 0, rng.range(-0.004, 0.004)];
    if (slab.kind === 'tilted') {
      // 한쪽 가장자리가 들리고, 절반은 아래로 미끄러진 판
      const slide = rng.chance(0.5) ? -rng.range(0.03, 0.07) : 0;
      const roll = (rng.chance(0.5) ? 1 : -1) * rng.range(0.02, 0.045);
      this.slabPart(F, slab, w, 0, s0 + slide, s1 + slide, tint, [rng.range(-0.01, 0.01), 0, roll], 0.004);
    } else if (slab.kind === 'cracked') {
      // 가로로 금이 가서 위쪽 조각이 내려앉고 기울었다
      const sc = rng.range(0.6, 1.3);
      this.slabPart(F, slab, w, 0, s0, sc - 0.004, tint, jitter());
      this.slabPart(F, slab, w, 0, sc + 0.004, s1, tint * 0.97, [rng.range(0.015, 0.03), 0, rng.range(-0.02, 0.02)], -rng.range(0.02, 0.035));
    } else if (slab.kind === 'corner') {
      // 위쪽 모서리 한쪽이 깨져 나가 흙과 철근이 드러남 (두 반쪽은 같은 평면이라 이음매가 보이지 않는다)
      const side = rng.chance(0.5) ? 1 : -1;
      const cut = rng.range(0.25, 0.5);
      this.slabPart(F, slab, w / 2, -side * (w / 4), s0, s1, tint, null);
      this.slabPart(F, slab, w / 2, side * (w / 4), s0, s1 - cut, tint, null);
      // 깨진 가장자리의 떨어져 나가다 만 조각
      for (let c = 0; c < 2; c++) {
        const cw = rng.range(0.12, 0.2);
        const cx = side * (w / 4) + rng.range(-w / 6, w / 6);
        const c0 = s1 - cut - 0.02;
        const c1 = s1 - cut + rng.range(0.06, 0.12);
        const g = this.slabPartGeometry(slab, cw, cx, c0, c1, tint * 0.95);
        g.translate(0, 0, -(c0 + c1) / 2);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(rng.range(-0.5, 0.5)));
        g.applyMatrix4(this.slabMatrix(F, cx, S.proud - S.thick / 2 - rng.range(0.005, 0.02), (c0 + c1) / 2));
        this.batch.add('canalSlab', g);
      }
      const n = rng.int(K.rebar.perEdge[0], K.rebar.perEdge[1]);
      for (let r = 0; r < n; r++) {
        const lx = side * (w / 4) + rng.range(-w / 5, w / 5);
        const P = F.O.clone()
          .addScaledVector(F.t, lx)
          .addScaledVector(F.u, s1 - cut - 0.03)
          .addScaledVector(F.n, S.proud - rng.range(0.04, 0.07));
        const dir = F.u.clone().addScaledVector(F.n, rng.range(-0.1, 0.35)).addScaledVector(F.t, rng.range(-0.3, 0.3)).normalize();
        this.rebarRod(P, dir, rng.range(K.rebar.length[0], K.rebar.length[1]) + 0.03);
      }
    } else {
      this.slabPart(F, slab, w, 0, s0, s1, tint, jitter());
    }
  }

  // 판 조각 기하 (판 좌표계 원점 기준, 아직 비탈에 놓기 전). UV 는 판 텍스처 아틀라스의 칸(variant) 안에서
  // 판 전체 기준 위치 (가장자리 = 이음매의 어두운 선, 아래쪽 = 습기 띠), 정점색은 판 밝기 × 아래쪽 어둡게
  slabPartGeometry(slab, w, ox, s0, s1, tint) {
    const K = CONFIG.canal;
    const S = K.slab;
    const g = new THREE.BoxGeometry(w, S.thick, s1 - s0);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    const nv = K.slabTexture.variants;
    const mid = (s0 + s1) / 2;
    for (let i = 0; i < pos.count; i++) {
      const fu = clamp((pos.getX(i) + ox) / S.width + 0.5, 0.004, 0.996);
      const ls = pos.getZ(i) + mid;
      uv.setXY(i, (slab.variant + fu) / nv, clamp((ls + S.toe) / S.length, 0.002, 0.998));
      const k = tint * (K.slabBottomShade + (1 - K.slabBottomShade) * clamp(ls / (S.length - S.toe), 0, 1));
      col[i * 3] = k;
      col[i * 3 + 1] = k;
      col[i * 3 + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(0, 0, mid);
    return g;
  }

  // 판 조각 하나: 폭 w, 판 가운데 줄에서 ox, 비탈 방향 s0~s1 (rot = 조각 중심 기준 기울임 [x, y, z], lift = 법선 방향 이동)
  slabPart(F, slab, w, ox, s0, s1, tint, rot, lift = 0) {
    const S = CONFIG.canal.slab;
    const g = this.slabPartGeometry(slab, w, ox, s0, s1, tint);
    const mid = (s0 + s1) / 2;
    if (rot) {
      g.translate(0, 0, -mid);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
      g.translate(0, 0, mid);
    }
    g.applyMatrix4(this.slabMatrix(F, ox, S.proud - S.thick / 2 + lift, 0));
    this.batch.add('canalSlab', g);
  }

  // 철근 한 가닥: P 에서 dir 방향으로 len
  rebarRod(P, dir, len) {
    const R = CONFIG.canal.rebar;
    const g = new THREE.BoxGeometry(R.size, R.size, len);
    _q.setFromUnitVectors(_zAxis, dir);
    _m4.compose(_v.copy(P).addScaledVector(dir, len / 2), _q, _one);
    g.applyMatrix4(_m4);
    this.batch.add('rust', g, R.color);
  }

  // 북쪽 둔덕 마루의 수로 중심 거리 (x 에서 둔덕이 가장 높은 곳)
  bermCrestDist(x) {
    const t = this.terrain;
    const C = MAP.canal;
    const zc = t.canalZ(x);
    let best = C.bench.outer + C.berm.face;
    let bh = -Infinity;
    for (let d = C.bench.outer; d <= C.bench.outer + C.berm.face + 0.8; d += 0.05) {
      const h = t.canalSurfaceY(x, zc - d);
      if (h > bh) {
        bh = h;
        best = d;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ 북쪽 둔덕 모래주머니 사격 위치
  // 마루 가운데 사격 홈(지형을 낮춤) 양옆에 모래주머니를 3단으로 쌓고, 더미 바깥 끝을 사수 쪽으로 굽혀(말굽 모양) 정면 사계를 튼다.
  // 앉은 사수는 홈으로 고개만 내밀고, 양옆은 머리 높이까지 가린다. 충돌: 더미마다 모래주머니 상자 (관통 불가)
  canalSandbags() {
    const t = this.terrain;
    const C = MAP.canal;
    const SB = CONFIG.canal.sandbag;
    const rng = new Random(CONFIG.world.seed + 227);
    const bagLen = 0.52;
    const layerH = 0.15;
    const ca = Math.cos(SB.wrap);
    const sa = -Math.sin(SB.wrap);
    const bag = this.canalBagGeometry();
    for (const sx of C.sandbagPositions) {
      const crest = this.bermCrestDist(sx);
      const yaw0 = -Math.atan(t.canalDzDx(sx));
      for (const side of [-1, 1]) {
        // 더미 좌표: s = 더미 축(안쪽 끝 0 → 바깥 끝), r = 축에 수직(북쪽 +). 수로 방향 ax, 수로 중심에서 북쪽 거리 dd 로 바꾼다
        const at = (s, r) => {
          const ax = side * (SB.gap / 2 + s * ca) - side * sa * r;
          const dd = crest - 0.05 + s * sa + ca * r;
          const x = sx + ax;
          return [x, t.canalZ(x) - dd];
        };
        const nAlong = Math.max(1, Math.round(SB.stackLen / bagLen));
        for (let lv = 0; lv < SB.layers; lv++) {
          // 아래 단은 두 줄(앞·뒤), 맨 위는 한 줄. 마루 바로 뒤(완만한 뒤쪽)에 쌓고, 단마다 반 포대씩 엇갈린다
          const rows = lv < SB.layers - 1 ? [0.06, 0.38] : [0.22];
          for (const r of rows) {
            for (let a = 0; a < nAlong; a++) {
              const s = (a + 0.5) * bagLen + (lv % 2) * 0.12 - 0.06;
              const [bx, bz] = at(s, r);
              const by = t.canalSurfaceY(bx, bz) + 0.07 + lv * layerH;
              const v = rng.range(0.86, 1.02);
              const c = new THREE.Color(v, v * 0.98, v * 0.94);
              const g = place(bag.clone(), bx, by, bz, [rng.range(-0.06, 0.06), yaw0 - side * SB.wrap + rng.range(-0.1, 0.1), rng.range(-0.05, 0.05), 'YXZ']);
              this.batch.add('sandbag', g, c.getHex());
            }
          }
        }
        const [cx, cz] = at(SB.stackLen / 2, 0.22);
        const top = t.canalSurfaceY(cx, cz);
        const hh = (SB.layers * layerH + 0.06) / 2;
        this.col.addBox(cx, top + hh - 0.02, cz, SB.stackLen / 2, hh, 0.26, yaw0 - side * SB.wrap, 'sandbag', 'CANAL_SANDBAG');
      }
    }
  }

  // 가까이서 보는 모래주머니: 둥근 베개 모양(초타원체), 묶은 양끝이 좁고 바닥은 눌려 평평 (병합 기하, 참호의 먼 모래주머니는 인스턴스)
  canalBagGeometry() {
    if (this._bagGeo) return this._bagGeo;
    const hx = 0.28;
    const hy = 0.085;
    const hz = 0.17;
    let g = new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz, 4, 2, 2);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const nx = pos.getX(i) / hx;
      const ny = pos.getY(i) / hy;
      const nz = pos.getZ(i) / hz;
      const k = Math.pow(nx ** 4 + ny ** 4 + nz ** 4, -0.25);
      const end = 1 - 0.3 * Math.pow(Math.abs(nx), 6);
      let y = ny * k * hy * end;
      if (y < 0) y *= 0.55;
      pos.setXYZ(i, nx * k * hx, y, nz * k * hz * end);
      uv[i * 2] = nx * 0.5 + 0.5;
      uv[i * 2 + 1] = nz * 0.35 + ny * 0.25 + 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this._bagGeo = g;
    return g;
  }

  // ------------------------------------------------------------------ 수로 바닥 잡동사니 (타이어·양동이·탄약 상자)
  // 병합 기하 + 재질 태그 충돌체: 타이어 = 고무(관통·검은 부스러기), 양동이 = 얇은 철판, 탄약 상자 = 나무
  canalJunk() {
    const t = this.terrain;
    const C = MAP.canal;
    const J = CONFIG.canal.junk;
    const rng = new Random(CONFIG.world.seed + 229);
    const spawnX = MAP.playerSpawn.x;
    const used = [];
    const pick = () => {
      for (let i = 0; i < 40; i++) {
        const x = rng.range(J.xRange[0], J.xRange[1]);
        if (Math.abs(x - spawnX) < J.spawnClear) continue;
        if (Math.abs(x - C.crossing.x) < C.crossing.halfWidth + 3) continue;
        if (C.reeds.some((r) => Math.abs(x - r.x) < r.len / 2 + 1.5)) continue;
        if (used.some((u) => Math.abs(u - x) < 1.8)) continue;
        used.push(x);
        return x;
      }
      return null;
    };
    const floorPoint = (x) => {
      const z = t.canalZ(x) + rng.range(-C.floorHalf, C.floorHalf) * 0.6;
      return [x, t.heightAt(x, z), z];
    };
    const tag = 'CANAL_JUNK';
    for (let k = 0; k < J.tyres; k++) {
      const x0 = pick();
      if (x0 === null) continue;
      const [x, y, z] = floorPoint(x0);
      const yaw = rng.next() * Math.PI * 2;
      const g = new THREE.TorusGeometry(0.31, 0.11, 6, 12);
      if (rng.chance(0.7)) {
        // 진흙에 반쯤 묻혀 누운 타이어
        place(g, x, y + 0.06, z, [Math.PI / 2 + rng.range(-0.12, 0.12), yaw, 0, 'YXZ']);
        this.col.addCylinder(x, y + 0.08, z, 0.42, 0.1, 'rubber', tag);
      } else {
        // 바닥에 박혀 선 타이어
        place(g, x, y + 0.26, z, [rng.range(-0.25, 0.25), yaw, 0, 'YXZ']);
        this.col.addBox(x, y + 0.22, z, 0.42, 0.22, 0.12, yaw, 'rubber', tag);
      }
      this.batch.add('rubber', g, 0xffffff);
    }
    for (let k = 0; k < J.buckets; k++) {
      const x0 = pick();
      if (x0 === null) continue;
      const [x, y, z] = floorPoint(x0);
      const yaw = rng.next() * Math.PI * 2;
      const tint = rng.chance(0.5) ? 0xb8b4ac : 0xd8c8b8;
      const body = cylGeo(0.15, 0.12, 0.28, 10, 0.6, true);
      const bottom = new THREE.CircleGeometry(0.12, 10);
      bottom.rotateX(Math.PI / 2);
      bottom.translate(0, -0.14, 0);
      if (rng.chance(0.55)) {
        // 옆으로 쓰러진 양동이
        for (const g of [body, bottom]) this.batch.add('rustDouble', place(g, x, y + 0.13, z, [Math.PI / 2, yaw, 0, 'YXZ']), tint);
        this.col.addBox(x, y + 0.13, z, 0.14, 0.13, 0.15, yaw, 'sheetMetal', tag);
      } else {
        for (const g of [body, bottom]) this.batch.add('rustDouble', place(g, x, y + 0.12, z, [rng.range(-0.1, 0.1), yaw, 0, 'YXZ']), tint);
        this.col.addCylinder(x, y + 0.13, z, 0.15, 0.14, 'sheetMetal', tag);
      }
    }
    // 탄약 상자: 바닥 몇 개 + 사격 발판 위 (시작 위치 옆) 하나
    const crate = (x, y, z, yaw, open) => {
      const body = boxGeo(0.62, 0.22, 0.34, 0.6);
      this.batch.add('wood', place(body, x, y + 0.1, z, yaw), 0x7a8060, 0.25);
      const lid = boxGeo(0.64, 0.035, 0.36, 0.6);
      if (open) {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        place(lid, x + s * 0.3, y + 0.04, z + c * 0.3, [0, yaw, rng.range(-0.15, 0.15)]);
      } else place(lid, x, y + 0.228, z, yaw + rng.range(-0.06, 0.06));
      this.batch.add('wood', lid, 0x737a5a);
      this.col.addBox(x, y + 0.11, z, 0.31, 0.12, 0.17, yaw, 'wood', tag);
    };
    for (let k = 0; k < J.crates; k++) {
      const x0 = pick();
      if (x0 === null) continue;
      const [x, y, z] = floorPoint(x0);
      crate(x, y - 0.03, z, rng.next() * Math.PI, rng.chance(0.4));
    }
    const bx = spawnX + 2.3;
    const bz = t.canalZ(bx) - (t.canalBenchInner() + C.bench.outer) / 2;
    crate(bx, t.canalSurfaceY(bx, bz), bz, -Math.atan(t.canalDzDx(bx)) + 0.1, true);
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

  // 중간 지대 작은 잔해 (인스턴싱): 포탄 파편, 빈 탄약 상자(뚜껑 열림), 찢어진 위장망 조각, 버려진 헬멧·배낭.
  // 구역(MAP.debrisZones)의 종류별 가중치로 몰리게 흩뿌린다 (장갑차·차량 둘레, 농로 옆, 포탄 구덩이 둘레, 밭 전체).
  // 지면 기울기에 맞춰 눕히고, 물·콘크리트·차량 위·수로 쪽(z > maxZ)에는 놓지 않는다.
  // 충돌: 탄약 상자만 나무 상자(관통 가능, 낮아서 밟고 넘음). 파편·헬멧·배낭·위장망 조각은 너무 작거나 얇아 충돌체가 없다.
  // 적 사격 위치·이동 경유점 둘레(clearFp)에는 충돌체 있는 상자를 두지 않는다. 인스턴스 메시는 buildDebrisInstances.
  fieldDebris() {
    this.keepRngStream('field', 40);
    const D = CONFIG.midfield.debris;
    const rng = new Random(CONFIG.world.seed + 929);
    const t = this.terrain;
    const S = CONFIG.surfaces;
    const blockedSurf = new Set([S.water.id, S.concrete.id]);
    const aiPts = aiClearPoints();
    const zones = MAP.debrisZones || [];
    const sets = (this.debrisSets = {});
    const up = new THREE.Vector3(0, 1, 0);
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const pickPoint = (zone) => {
      if (zone.kind === 'ring') {
        const a = rng.next() * Math.PI * 2;
        const d = rng.range(zone.dist[0], zone.dist[1]);
        return [zone.x + Math.cos(a) * d, zone.z + Math.sin(a) * d];
      }
      if (zone.kind === 'craters') {
        const cands = t.craters.filter((c) => c.z > zone.z0 && c.z < zone.z1);
        if (!cands.length) return null;
        const c = cands[Math.floor(rng.next() * cands.length)];
        const a = rng.next() * Math.PI * 2;
        const d = c.r * rng.range(zone.dist[0], zone.dist[1]);
        return [c.x + Math.cos(a) * d, c.z + Math.sin(a) * d];
      }
      if (zone.kind === 'road') {
        const pts = MAP.roads[zone.road].points;
        for (let tries = 0; tries < 12; tries++) {
          const i = Math.floor(rng.next() * (pts.length - 1));
          const [ax, az] = pts[i];
          const [bx, bz] = pts[i + 1];
          const f = rng.next();
          const px = ax + (bx - ax) * f;
          const pz = az + (bz - az) * f;
          if (pz < zone.z0 || pz > zone.z1) continue;
          const len = Math.hypot(bx - ax, bz - az) || 1;
          const d = rng.range(zone.dist[0], zone.dist[1]) * (rng.next() < 0.5 ? -1 : 1);
          return [px - ((bz - az) / len) * d, pz + ((bx - ax) / len) * d];
        }
        return null;
      }
      return [rng.range(zone.x0, zone.x1), rng.range(zone.z0, zone.z1)];
    };
    const onVehicle = (x, z) =>
      t.vehiclePads.some((v) => {
        const dx = x - v.x;
        const dz = z - v.z;
        return Math.abs(dx * v.c - dz * v.s) < v.hx + 0.2 && Math.abs(dx * v.s + dz * v.c) < v.hz + 0.2;
      });
    for (const [type, count] of Object.entries(D.counts)) {
      const T = D.types[type];
      const ws = zones.map((z) => z.w[type] || 0);
      const wsum = ws.reduce((a, b) => a + b, 0);
      if (!wsum) continue;
      const list = (sets[type] = []);
      let tries = 0;
      while (list.length < count && tries++ < count * 30) {
        let pick = rng.next() * wsum;
        let zi = 0;
        while (zi < zones.length - 1 && pick > ws[zi]) pick -= ws[zi++];
        const p = pickPoint(zones[zi]);
        if (!p) continue;
        const [x, z] = p;
        if (z > D.maxZ || Math.abs(x) > D.maxX || onVehicle(x, z)) continue;
        if (blockedSurf.has(t.surfaceAt(x, z))) continue;
        if (T.collider && aiPts.some(([ax, az]) => Math.hypot(x - ax, z - az) < D.clearFp)) continue;
        const y = t.heightAt(x, z);
        const n = t.normalAt(x, z);
        const s = rng.range(T.scale[0], T.scale[1]);
        const yaw = rng.next() * Math.PI * 2;
        // 놓인 자세 (종류별): 뒤집힘·옆으로 누움 등. lift = 인스턴스 원점을 땅 위로 올리는 높이 (스케일 1 기준)
        let rx = 0;
        let rz = 0;
        let lift = T.lift;
        if (type === 'helmet') {
          const r = rng.next();
          if (r < 0.4) {
            rx = Math.PI;
            lift = 0.115;
          } else if (r < 0.75) {
            rx = rng.range(1.25, 1.45) * (rng.next() < 0.5 ? -1 : 1);
            lift = 0.1;
          }
        } else if (type === 'crate' && rng.next() < 0.25) {
          rx = -Math.PI / 2;
          lift = 0.165;
        } else if (type === 'shard') {
          rx = rng.range(-0.4, 0.4);
          rz = rng.range(-0.4, 0.4);
        } else if (type === 'pack' && rng.next() < 0.3) {
          rz = Math.PI / 2;
          lift = 0.2;
        }
        qa.setFromUnitVectors(up, n);
        qb.setFromEuler(e.set(rx, yaw, rz, 'YXZ'));
        qa.multiply(qb);
        lift *= s;
        pos.set(x, y + lift, z);
        const sy = type === 'shard' ? s * rng.range(0.6, 1.0) : s;
        scl.set(s * (type === 'shard' ? rng.range(0.7, 1.4) : 1), sy, s);
        const m = new THREE.Matrix4().compose(pos, qa, scl);
        list.push({ m, color: T.colors[Math.floor(rng.next() * T.colors.length)] });
        if (T.collider) {
          const [hx, hy, hz] = T.collider;
          const h = rx ? [hx, hz, hy] : [hx, hy, hz];
          this.col.addBox(x, y + h[1] * s, z, h[0] * s, h[1] * s, h[2] * s, yaw, 'wood', 'DEBRIS');
        }
      }
    }
  }

  // 중간 지대 작은 잔해 인스턴스 메시 (종류마다 InstancedMesh 하나 = 드로우콜 하나, 그림자는 받기만)
  buildDebrisInstances(group, materials) {
    const sets = this.debrisSets;
    if (!sets) return;
    const T = debrisTemplates(materials);
    const col = new THREE.Color();
    for (const [key, list] of Object.entries(sets)) {
      if (!list.length || !T[key]) continue;
      const im = new THREE.InstancedMesh(T[key].geo, T[key].mat, list.length);
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, col.set(it.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.receiveShadow = true;
      im.name = `debris:${key}`;
      group.add(im);
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
    this.buildDebrisInstances(group, materials);
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

// =============================================================================
// 중간 지대 잔해용 기하 보조 (차량 잔해·전신주·작은 잔해)
// =============================================================================
const _mfY = new THREE.Vector3(0, 1, 0);
const _mfE = new THREE.Euler();

// 두 점 사이 막대: 길이 방향 = 상자 로컬 x (UV u 가 길이를 따라감), 단면 = 폭 w(수평 유지) x 두께 h
function stickGeo(ax, ay, az, bx, by, bz, w, h = w, uvScale = 1) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.max(1e-3, Math.hypot(dx, dy, dz));
  const g = boxGeo(len, h, w, uvScale);
  return place(g, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, [0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)), 'YXZ']);
}

// 옆모습 윤곽(로컬 x-y)을 폭 w 로 밀어낸 차체 (z = ±w/2). y0 → y1 사이에서 폭이 1 → taper 배로 줄어 옆면이 안쪽으로 기운다
// (윤곽 면은 기울어진 평면으로 남는다). UV 는 미터 / uvScale.
function profileGeo(pts, w, taper = 1, y0 = 0, y1 = 1, uvScale = 1) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  if (taper !== 1) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
      p.setZ(i, p.getZ(i) * (1 + (taper - 1) * t));
    }
  }
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / uvScale, uv.getY(i) / uvScale);
  g.computeVertexNormals();
  return g;
}

// 위로 가늘어지는 사각 기둥 (밑면 w0 x d0 → 윗면 w1 x d1, 높이 h, 밑면 가운데가 원점)
function taperBoxGeo(w0, d0, w1, d1, h, uvScale = 1) {
  const g = boxGeo(w0, h, d0, uvScale);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * (w1 / w0));
      p.setZ(i, p.getZ(i) * (d1 / d0));
    }
  }
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}

// 적 사격 위치·이동 경유점·전방 구덩이 (충돌체 있는 잔해를 두지 않을 곳). 차량 기준 사격 위치는 월드로 바꾼다
function aiClearPoints() {
  const pts = [];
  for (const node of Object.values(AI_MAP.nodes)) {
    const veh = node.vehicle ? MAP[node.vehicle] : null;
    for (const fp of node.fps || []) {
      if (fp.x !== undefined && fp.z !== undefined) pts.push([fp.x, fp.z]);
      if (veh) {
        for (const l of [fp.local, fp.fireLocal]) {
          if (!l) continue;
          const c = Math.cos(veh.rot);
          const s = Math.sin(veh.rot);
          pts.push([veh.x + l[0] * c + l[1] * s, veh.z - l[0] * s + l[1] * c]);
        }
      }
    }
    for (const p of [...(node.exit || []), ...(node.approach || [])]) pts.push(p);
  }
  for (const list of Object.values(AI_MAP.edges)) for (const p of list) pts.push(p);
  for (const c of MAP.craters) if (c.tag) pts.push([c.x, c.z]);
  return pts;
}

// 작은 잔해 인스턴스 기하·재질 (렌더 때만, World.finalize → buildInstances). 크기는 인스턴스 스케일 1 기준 (m)
function debrisTemplates(materials) {
  const out = {};
  const rng = new Random(931);
  // 포탄 파편: 찌그러지고 들쭉날쭉한 쇳조각 (납작한 다면체)
  {
    const g = new THREE.IcosahedronGeometry(0.5, 0);
    const p = g.attributes.position;
    const jit = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!jit.has(key)) jit.set(key, rng.range(0.45, 1.25));
      const k = jit.get(key);
      p.setXYZ(i, p.getX(i) * k * 1.4, p.getY(i) * k * 0.35, p.getZ(i) * k * 0.7);
    }
    g.computeVertexNormals();
    out.shard = { geo: g, mat: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }) };
  }
  // 빈 탄약 상자 (나무, 바랜 국방색 도장): 바닥·네 벽 (안쪽이 보이는 열린 상자) + 뒤로 젖혀진 뚜껑 + 양 끝 손잡이 끈
  {
    const parts = [];
    const L = 0.56;
    const H = 0.19;
    const Wd = 0.34;
    const th = 0.018;
    const push = (g, c) => parts.push(tint(g, c));
    push(place(boxGeo(L, th, Wd, 0.6), 0, th / 2, 0), 0x6a6650);
    push(place(boxGeo(L, H, th, 0.6), 0, H / 2, Wd / 2 - th / 2), 0xffffff);
    push(place(boxGeo(L, H, th, 0.6), 0, H / 2, -Wd / 2 + th / 2), 0xffffff);
    push(place(boxGeo(th, H, Wd - th * 2, 0.6), L / 2 - th / 2, H / 2, 0), 0xffffff);
    push(place(boxGeo(th, H, Wd - th * 2, 0.6), -L / 2 + th / 2, H / 2, 0), 0xffffff);
    const lid = boxGeo(L, th, Wd, 0.6);
    lid.translate(0, th / 2, Wd / 2);
    push(place(lid, 0, H, -Wd / 2, [-2.05, 0, 0]), 0xe8e4d8);
    for (const s of [-1, 1]) push(place(boxGeo(0.02, 0.025, 0.12), s * (L / 2 + 0.01), H * 0.7, 0), 0x3a3428);
    const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
    out.crate = { geo: g, mat: new THREE.MeshLambertMaterial({ color: 0xffffff, map: materials.wood.map, vertexColors: true }) };
  }
  // 찢어진 위장망 조각: 땅에 걸쳐 주름진 그물 (가장자리가 뜯겨 불규칙 — 알파 텍스처)
  {
    const g = new THREE.PlaneGeometry(1, 1, 6, 6);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const edge = Math.max(Math.abs(x), Math.abs(z)) * 2;
      p.setY(i, 0.012 + Math.max(0, Math.sin(x * 9.1 + z * 4.3) * 0.035 + Math.sin(z * 11.7) * 0.02) * (1 - edge * 0.7));
      p.setX(i, x * (1 + (rng.next() - 0.5) * 0.35 * edge));
      p.setZ(i, z * (1 + (rng.next() - 0.5) * 0.35 * edge));
    }
    g.computeVertexNormals();
    out.camo = {
      geo: g,
      mat: new THREE.MeshLambertMaterial({ color: 0xffffff, map: materials.camoNet.map, alphaTest: 0.45, side: THREE.DoubleSide }),
    };
  }
  // 버려진 헬멧 (SSh-68 계열): 둥근 바가지 + 살짝 벌어진 챙, 안쪽은 어둡게 (뒤집혀 있으면 안이 보임)
  {
    const shell = new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    shell.scale(1, 0.92, 1.08);
    const inner = new THREE.SphereGeometry(0.128, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    inner.scale(1, 0.88, 1.06);
    const brim = new THREE.CylinderGeometry(0.137, 0.152, 0.03, 12, 1, true);
    brim.translate(0, -0.012, 0);
    brim.scale(1, 1, 1.08);
    const g = mergeGeometries([tint(shell, 0xffffff), tint(inner, 0x3a3a30), tint(brim, 0xd8d8d0)].map((q) => q.toNonIndexed()));
    out.helmet = { geo: g, mat: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }) };
  }
  // 버려진 배낭: 등을 대고 누운 몸통 + 덮개 + 옆 주머니 + 어깨끈 (끈은 어둡게)
  {
    const parts = [];
    parts.push(tint(place(boxGeo(0.32, 0.16, 0.42), 0, 0.08, 0), 0xffffff));
    parts.push(tint(place(boxGeo(0.33, 0.05, 0.2), 0, 0.17, -0.12, [0.15, 0, 0]), 0xe0dcd0));
    for (const s of [-1, 1]) parts.push(tint(place(boxGeo(0.06, 0.12, 0.2), s * 0.19, 0.07, 0.05), 0xd0ccc0));
    for (const s of [-1, 1]) parts.push(tint(place(boxGeo(0.05, 0.015, 0.46), s * 0.09, 0.005, 0.02), 0x2e2c24));
    parts.push(tint(place(boxGeo(0.05, 0.02, 0.36), 0.0, 0.165, 0.1, [0, 0.9, 0]), 0x2e2c24));
    const g = mergeGeometries(parts.map((q) => q.toNonIndexed()));
    out.pack = { geo: g, mat: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }) };
  }
  for (const o of Object.values(out)) o.geo.computeBoundingSphere();
  return out;
}

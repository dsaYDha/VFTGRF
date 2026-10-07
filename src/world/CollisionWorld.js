// =============================================================================
// CollisionWorld — 보이는 메시와 분리된 단순 충돌체 (상자/원기둥) + 지형.
// 충돌체마다 재질 태그(config.materials)가 붙고, 은폐 전용 볼륨(식생·위장망)은
// 탄을 막지 않고 시야 판정에만 쓰인다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG, MATERIALS } from '../config.js';
import { segBoxLocal } from '../core/mathUtils.js';

const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _box = {};

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.colliders = [];
    this.concealers = [];
    this.half = CONFIG.world.halfSize + 50;
    this.cell = 8;
    this.dim = Math.ceil((2 * this.half) / this.cell);
    this.grid = new Array(this.dim * this.dim);
    this.stamp = 0;
    this.byTag = new Map();
  }

  // 회전: rotY 숫자 또는 {x,y,z} 오일러
  addBox(cx, cy, cz, hx, hy, hz, rot, material, tag = null, opts = {}) {
    const R = new Float32Array(9);
    if (typeof rot === 'number' || rot == null) _e.set(0, rot || 0, 0);
    else _e.set(rot.x || 0, rot.y || 0, rot.z || 0, rot.order || 'XYZ');
    _m.makeRotationFromEuler(_e);
    const el = _m.elements;
    // 열 = 로컬 축의 월드 방향
    R[0] = el[0];
    R[1] = el[1];
    R[2] = el[2];
    R[3] = el[4];
    R[4] = el[5];
    R[5] = el[6];
    R[6] = el[8];
    R[7] = el[9];
    R[8] = el[10];
    // 월드 AABB
    const ex = Math.abs(R[0]) * hx + Math.abs(R[3]) * hy + Math.abs(R[6]) * hz;
    const ey = Math.abs(R[1]) * hx + Math.abs(R[4]) * hy + Math.abs(R[7]) * hz;
    const ez = Math.abs(R[2]) * hx + Math.abs(R[5]) * hy + Math.abs(R[8]) * hz;
    const c = {
      id: this.colliders.length,
      type: 'box',
      cx,
      cy,
      cz,
      hx,
      hy,
      hz,
      R,
      min: [cx - ex, cy - ey, cz - ez],
      max: [cx + ex, cy + ey, cz + ez],
      material,
      mat: MATERIALS[material],
      tag,
      walkable: opts.walkable !== false,
      blocksMove: opts.blocksMove !== false,
      stamp: 0,
    };
    if (!c.mat) throw new Error('unknown material ' + material);
    this.insert(c);
    return c;
  }

  addCylinder(cx, cy, cz, r, hh, material, tag = null, opts = {}) {
    const c = {
      id: this.colliders.length,
      type: 'cyl',
      cx,
      cy,
      cz,
      r,
      hh,
      min: [cx - r, cy - hh, cz - r],
      max: [cx + r, cy + hh, cz + r],
      material,
      mat: MATERIALS[material],
      tag,
      walkable: opts.walkable !== false,
      blocksMove: opts.blocksMove !== false,
      stamp: 0,
    };
    this.insert(c);
    return c;
  }

  // 은폐 볼륨 (축 정렬 상자, 회전 Y)
  addConcealer(cx, cy, cz, hx, hy, hz, rotY, kind) {
    const def = CONFIG.concealment[kind];
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    this.concealers.push({ cx, cy, cz, hx, hy, hz, cos, sin, density: def.density, kind });
  }

  // 이동만 막는 볼륨 (철조망 등, Y 회전 상자 + 높이 y0..y1): 탄·시야 판정(castColliders·lineBlocked)에는 없고
  // 플레이어 이동(resolveCylinder)만 막는다. 탄은 그대로 통과하고 시야는 은폐 볼륨(addConcealer)이 따로 맡는다.
  addMoveBlocker(cx, cz, hx, hz, rotY, y0, y1, tag = null) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const ex = Math.abs(cos) * hx + Math.abs(sin) * hz;
    const ez = Math.abs(sin) * hx + Math.abs(cos) * hz;
    if (!this.moveBlockers) this.moveBlockers = [];
    this.moveBlockers.push({ cx, cz, hx, hz, cos, sin, y0, y1, tag, min: [cx - ex, cz - ez], max: [cx + ex, cz + ez] });
  }

  // 이동 차단 볼륨에서 밀어내기 (resolveCylinder 안에서). 밀었으면 true
  pushOutOfBlockers(pos, radius, height) {
    let any = false;
    for (const b of this.moveBlockers) {
      if (pos.x < b.min[0] - radius || pos.x > b.max[0] + radius || pos.z < b.min[1] - radius || pos.z > b.max[1] + radius) continue;
      if (b.y1 < pos.y || b.y0 > pos.y + height) continue;
      const px = pos.x - b.cx;
      const pz = pos.z - b.cz;
      const lx = b.cos * px - b.sin * pz;
      const lz = b.sin * px + b.cos * pz;
      const qx = Math.max(-b.hx, Math.min(b.hx, lx));
      const qz = Math.max(-b.hz, Math.min(b.hz, lz));
      const ox = lx - qx;
      const oz = lz - qz;
      const d = Math.hypot(ox, oz);
      if (d >= radius) continue;
      if (d < 1e-6) {
        // 중심이 안: 가장 얕은 축으로
        const alongX = b.hx - Math.abs(lx) < b.hz - Math.abs(lz);
        const nlx = alongX ? (b.hx + radius) * (Math.sign(lx) || 1) - lx : 0;
        const nlz = alongX ? 0 : (b.hz + radius) * (Math.sign(lz) || 1) - lz;
        pos.x += b.cos * nlx + b.sin * nlz;
        pos.z += -b.sin * nlx + b.cos * nlz;
      } else {
        const push = radius - d;
        const nlx = (ox / d) * push;
        const nlz = (oz / d) * push;
        pos.x += b.cos * nlx + b.sin * nlz;
        pos.z += -b.sin * nlx + b.cos * nlz;
      }
      any = true;
    }
    return any;
  }

  insert(c) {
    this.colliders.push(c);
    if (c.tag) {
      if (!this.byTag.has(c.tag)) this.byTag.set(c.tag, []);
      this.byTag.get(c.tag).push(c);
    }
    const i0 = this.cellIndex(c.min[0]);
    const i1 = this.cellIndex(c.max[0]);
    const j0 = this.cellIndex(c.min[2]);
    const j1 = this.cellIndex(c.max[2]);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.dim + i;
        if (!this.grid[k]) this.grid[k] = [];
        this.grid[k].push(c);
      }
    }
  }

  // 충돌체 빼기 / 다시 넣기 — 임무에 따라 생기고 없어지는 물체용 (2단계 탄약 상자: AmmoCrate.setActive).
  // 뺀 충돌체는 탄도·시야·이동 판정에서 모두 빠진다. 이미 빠져 있거나 들어 있으면 아무것도 하지 않고 false
  removeCollider(c) {
    const i = this.colliders.indexOf(c);
    if (i < 0) return false;
    this.colliders.splice(i, 1);
    if (c.tag && this.byTag.has(c.tag)) {
      const list = this.byTag.get(c.tag);
      const k = list.indexOf(c);
      if (k >= 0) list.splice(k, 1);
    }
    const i0 = this.cellIndex(c.min[0]);
    const i1 = this.cellIndex(c.max[0]);
    const j0 = this.cellIndex(c.min[2]);
    const j1 = this.cellIndex(c.max[2]);
    for (let j = j0; j <= j1; j++) {
      for (let n = i0; n <= i1; n++) {
        const cell = this.grid[j * this.dim + n];
        const k = cell ? cell.indexOf(c) : -1;
        if (k >= 0) cell.splice(k, 1);
      }
    }
    return true;
  }

  restoreCollider(c) {
    if (this.colliders.includes(c)) return false;
    this.insert(c);
    return true;
  }

  cellIndex(v) {
    return Math.max(0, Math.min(this.dim - 1, Math.floor((v + this.half) / this.cell)));
  }

  // 선분과 충돌체 교차 (가장 가까운 것). out: {t, nx, ny, nz, collider, tExit}
  // solidOnly: 관통되는 재질(나무판·함석·건초 등)은 건너뛴다 (2단계: 약진 경로에 적 사선이 닿는지)
  castColliders(ax, ay, az, bx, by, bz, out, ignore = null, solidOnly = false) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);
    const minZ = Math.min(az, bz);
    const maxZ = Math.max(az, bz);
    const i0 = this.cellIndex(minX);
    const i1 = this.cellIndex(maxX);
    const j0 = this.cellIndex(minZ);
    const j1 = this.cellIndex(maxZ);
    const stamp = ++this.stamp;
    let bestT = Infinity;
    let best = null;
    let bnx = 0;
    let bny = 0;
    let bnz = 0;
    let bExit = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.grid[j * this.dim + i];
        if (!list) continue;
        for (let n = 0; n < list.length; n++) {
          const c = list[n];
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (c === ignore) continue;
          if (solidOnly && c.mat.penetrable) continue;
          if (c.max[0] < minX || c.min[0] > maxX || c.max[1] < minY || c.min[1] > maxY || c.max[2] < minZ || c.min[2] > maxZ) continue;
          if (c.type === 'box') {
            const R = c.R;
            const px = ax - c.cx;
            const py = ay - c.cy;
            const pz = az - c.cz;
            // 로컬 = R^T * v
            const lpx = R[0] * px + R[1] * py + R[2] * pz;
            const lpy = R[3] * px + R[4] * py + R[5] * pz;
            const lpz = R[6] * px + R[7] * py + R[8] * pz;
            const ldx = R[0] * dx + R[1] * dy + R[2] * dz;
            const ldy = R[3] * dx + R[4] * dy + R[5] * dz;
            const ldz = R[6] * dx + R[7] * dy + R[8] * dz;
            if (segBoxLocal(lpx, lpy, lpz, ldx, ldy, ldz, c.hx, c.hy, c.hz, _box) && _box.t < bestT) {
              bestT = _box.t;
              best = c;
              bExit = _box.tExit;
              const ax3 = _box.axis * 3;
              bnx = R[ax3] * _box.sign;
              bny = R[ax3 + 1] * _box.sign;
              bnz = R[ax3 + 2] * _box.sign;
            }
          } else {
            const t = this.segCylinder(ax, ay, az, dx, dy, dz, c, _box);
            if (t >= 0 && t < bestT) {
              bestT = t;
              best = c;
              bExit = _box.tExit;
              bnx = _box.nx;
              bny = _box.ny;
              bnz = _box.nz;
            }
          }
        }
      }
    }
    if (!best) return false;
    out.t = bestT;
    out.tExit = bExit;
    out.nx = bnx;
    out.ny = bny;
    out.nz = bnz;
    out.collider = best;
    return true;
  }

  segCylinder(ax, ay, az, dx, dy, dz, c, out) {
    const px = ax - c.cx;
    const pz = az - c.cz;
    const y0 = c.cy - c.hh;
    const y1 = c.cy + c.hh;
    let best = -1;
    const a = dx * dx + dz * dz;
    if (a > 1e-12) {
      const b = 2 * (px * dx + pz * dz);
      const cc = px * px + pz * pz - c.r * c.r;
      if (cc > 0) {
        const disc = b * b - 4 * a * cc;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          const t = (-b - sq) / (2 * a);
          if (t >= 0 && t <= 1) {
            const y = ay + dy * t;
            if (y >= y0 && y <= y1) {
              best = t;
              out.nx = (px + dx * t) / c.r;
              out.ny = 0;
              out.nz = (pz + dz * t) / c.r;
              out.tExit = (-b + sq) / (2 * a);
            }
          }
        }
      }
    }
    // 윗면
    if (Math.abs(dy) > 1e-9 && ay > y1) {
      const t = (y1 - ay) / dy;
      if (t >= 0 && t <= 1 && (best < 0 || t < best)) {
        const x = px + dx * t;
        const z = pz + dz * t;
        if (x * x + z * z <= c.r * c.r) {
          best = t;
          out.nx = 0;
          out.ny = 1;
          out.nz = 0;
          out.tExit = t + 0.05;
        }
      }
    }
    return best;
  }

  // 지형 + 충돌체 종합. out: {t, x,y,z, nx,ny,nz, collider (null=지형), material}
  segmentCast(ax, ay, az, bx, by, bz, out, opts = {}) {
    let hit = false;
    let bestT = Infinity;
    const tr = this._tr || (this._tr = {});
    if (!opts.noTerrain && this.terrain.raycast(ax, ay, az, bx, by, bz, tr)) {
      bestT = tr.t;
      hit = true;
      out.collider = null;
      const n = this.terrain.normalAt(tr.x, tr.z);
      out.nx = n.x;
      out.ny = n.y;
      out.nz = n.z;
      out.tExit = tr.t;
    }
    const cr = this._cr || (this._cr = {});
    if (!opts.noColliders && this.castColliders(ax, ay, az, bx, by, bz, cr, opts.ignore) && cr.t < bestT) {
      bestT = cr.t;
      hit = true;
      out.collider = cr.collider;
      out.nx = cr.nx;
      out.ny = cr.ny;
      out.nz = cr.nz;
      out.tExit = cr.tExit;
    }
    if (!hit) return false;
    out.t = bestT;
    out.x = ax + (bx - ax) * bestT;
    out.y = ay + (by - ay) * bestT;
    out.z = az + (bz - az) * bestT;
    if (out.collider) out.material = out.collider.material;
    else {
      const sid = this.terrain.surfaceAt(out.x, out.z);
      out.material = this.surfaceMaterial(sid);
    }
    return true;
  }

  surfaceMaterial(sid) {
    for (const def of Object.values(CONFIG.surfaces)) if (def.id === sid) return def.material;
    return 'earth';
  }

  // 시야선이 막혔는지 (은폐 볼륨은 무시)
  lineBlocked(ax, ay, az, bx, by, bz) {
    const tr = this._tr2 || (this._tr2 = {});
    if (this.terrain.raycast(ax, ay, az, bx, by, bz, tr) && tr.t < 0.995) return true;
    const cr = this._cr2 || (this._cr2 = {});
    if (this.castColliders(ax, ay, az, bx, by, bz, cr) && cr.t < 0.995) return true;
    return false;
  }

  // 관통 불가 엄폐물(지형·흙·벽돌·장갑 등)만 막는 사선: 은폐·관통 재질 너머로는 탄이 온다고 본다
  solidLineBlocked(ax, ay, az, bx, by, bz) {
    const tr = this._tr3 || (this._tr3 = {});
    if (this.terrain.raycast(ax, ay, az, bx, by, bz, tr) && tr.t < 0.995) return true;
    const cr = this._cr3 || (this._cr3 = {});
    if (this.castColliders(ax, ay, az, bx, by, bz, cr, null, true) && cr.t < 0.995) return true;
    return false;
  }

  // 시야선이 은폐 볼륨을 지나는 정도 → 보이는 비율 (0..1)
  concealment(ax, ay, az, bx, by, bz) {
    let sum = 0;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    for (const v of this.concealers) {
      const px = ax - v.cx;
      const pz = az - v.cz;
      const lpx = v.cos * px - v.sin * pz;
      const lpz = v.sin * px + v.cos * pz;
      const ldx = v.cos * dx - v.sin * dz;
      const ldz = v.sin * dx + v.cos * dz;
      const lpy = ay - v.cy;
      // 시작점이 안에 있어도 처리하기 위해 직접 슬랩
      let t0 = 0;
      let t1 = 1;
      const axes = [
        [lpx, ldx, v.hx],
        [lpy, dy, v.hy],
        [lpz, ldz, v.hz],
      ];
      let ok = true;
      for (const [p, d, h] of axes) {
        if (Math.abs(d) < 1e-9) {
          if (p < -h || p > h) {
            ok = false;
            break;
          }
        } else {
          let ta = (-h - p) / d;
          let tb = (h - p) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) {
            ok = false;
            break;
          }
        }
      }
      if (ok) sum += (t1 - t0) * len * v.density;
    }
    return Math.exp(-sum);
  }

  // 점이 은폐 볼륨 안에 있는지 → 종류
  concealerAt(x, y, z) {
    for (const v of this.concealers) {
      const px = x - v.cx;
      const pz = z - v.cz;
      const lx = v.cos * px - v.sin * pz;
      const lz = v.sin * px + v.cos * pz;
      if (Math.abs(lx) <= v.hx && Math.abs(lz) <= v.hz && Math.abs(y - v.cy) <= v.hy) return v;
    }
    return null;
  }

  // (x,z) 위의 서 있을 수 있는 높이: 지형과 발 아래 낮은 충돌체 윗면 중 최대
  groundHeight(x, z, maxY) {
    let h = this.terrain.heightAt(x, z);
    const list = this.grid[this.cellIndex(z) * this.dim + this.cellIndex(x)];
    if (list) {
      for (const c of list) {
        if (!c.walkable) continue;
        const top = this.topAt(c, x, z);
        if (top !== null && top <= maxY && top > h) h = top;
      }
    }
    return h;
  }

  // 충돌체 윗면 높이 (x,z 가 발자국 안이면)
  topAt(c, x, z) {
    if (c.type === 'cyl') {
      const dx = x - c.cx;
      const dz = z - c.cz;
      return dx * dx + dz * dz <= c.r * c.r ? c.cy + c.hh : null;
    }
    const R = c.R;
    // 기울지 않은 상자만 정확 (기운 것은 AABB 윗면 근사)
    const px = x - c.cx;
    const pz = z - c.cz;
    const lx = R[0] * px + R[2] * pz;
    const lz = R[6] * px + R[8] * pz;
    if (Math.abs(R[4]) > 0.98) {
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return c.cy + c.hy * Math.abs(R[4]);
      return null;
    }
    if (x >= c.min[0] && x <= c.max[0] && z >= c.min[2] && z <= c.max[2]) return c.max[1];
    return null;
  }

  // 수평 원기둥(플레이어)과 겹치는 충돌체를 밀어내는 벡터 계산
  // pos: {x,y,z} 발 위치. 결과는 pos 를 직접 수정
  resolveCylinder(pos, radius, height, stepHeight) {
    const list = this.gatherNear(pos.x, pos.z, radius + 1);
    let pushed = false;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const c of list) {
        if (!c.blocksMove) continue;
        if (c.max[1] < pos.y + stepHeight || c.min[1] > pos.y + height) continue;
        if (c.type === 'cyl') {
          const dx = pos.x - c.cx;
          const dz = pos.z - c.cz;
          const d = Math.hypot(dx, dz);
          const minD = c.r + radius;
          if (d < minD && d > 1e-6) {
            pos.x = c.cx + (dx / d) * minD;
            pos.z = c.cz + (dz / d) * minD;
            any = true;
          }
          continue;
        }
        const R = c.R;
        // 대부분 수직 상자: 로컬 xz 평면에서 처리
        if (Math.abs(R[4]) < 0.9) {
          // 기울어진 상자: 로컬 y 가 수평에 가깝다 → AABB 로 근사하지 않고 건너뜀 (지나갈 수 있는 잔해)
          continue;
        }
        const px = pos.x - c.cx;
        const pz = pos.z - c.cz;
        const lx = R[0] * px + R[2] * pz;
        const lz = R[6] * px + R[8] * pz;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx));
        const qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ox = lx - qx;
        let oz = lz - qz;
        let d = Math.hypot(ox, oz);
        if (d >= radius) continue;
        if (d < 1e-6) {
          // 중심이 상자 안: 가장 얕은 축으로 밀어냄
          const px1 = c.hx - Math.abs(lx);
          const pz1 = c.hz - Math.abs(lz);
          if (px1 < pz1) {
            ox = Math.sign(lx) || 1;
            oz = 0;
            d = 0;
            const nlx = (c.hx + radius) * ox;
            const wx = R[0] * nlx + R[6] * lz;
            const wz = R[2] * nlx + R[8] * lz;
            pos.x = c.cx + wx;
            pos.z = c.cz + wz;
          } else {
            oz = Math.sign(lz) || 1;
            const nlz = (c.hz + radius) * oz;
            const wx = R[0] * lx + R[6] * nlz;
            const wz = R[2] * lx + R[8] * nlz;
            pos.x = c.cx + wx;
            pos.z = c.cz + wz;
          }
          any = true;
          continue;
        }
        const push = radius - d;
        const nlx = (ox / d) * push;
        const nlz = (oz / d) * push;
        pos.x += R[0] * nlx + R[6] * nlz;
        pos.z += R[2] * nlx + R[8] * nlz;
        any = true;
      }
      if (this.moveBlockers && this.pushOutOfBlockers(pos, radius, height)) any = true;
      if (!any) break;
      pushed = true;
    }
    return pushed;
  }

  gatherNear(x, z, r) {
    const out = this._near || (this._near = []);
    out.length = 0;
    const stamp = ++this.stamp;
    const i0 = this.cellIndex(x - r);
    const i1 = this.cellIndex(x + r);
    const j0 = this.cellIndex(z - r);
    const j1 = this.cellIndex(z + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.grid[j * this.dim + i];
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === stamp) continue;
          c.stamp = stamp;
          if (c.max[0] < x - r || c.min[0] > x + r || c.max[2] < z - r || c.min[2] > z + r) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  // 점 근처에서 위쪽을 향한 엄폐면의 최고 높이 (총 거치 판정용)
  surfaceTopNear(x, z, yMin, yMax) {
    let best = -Infinity;
    const th = this.terrain.heightAt(x, z);
    if (th >= yMin && th <= yMax) best = th;
    const list = this.grid[this.cellIndex(z) * this.dim + this.cellIndex(x)];
    if (list) {
      for (const c of list) {
        const top = this.topAt(c, x, z);
        if (top !== null && top >= yMin && top <= yMax && top > best) best = top;
      }
    }
    return best;
  }
}

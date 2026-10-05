// =============================================================================
// Ballistics — 모든 탄은 히트스캔이 아닌 발사체.
//  중력 + 이차 공기저항, 수명 3초, 매 프레임 이전→현재 위치 선분으로 충돌 검사.
//  관통 가능 재질은 속도가 깎이며 통과, 낮은 각도로 맞으면 도탄.
//  매 프레임 BULLET_SEGMENT 이벤트를 내보내 제압 시스템이 근접 통과를 판정한다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';

const DEG = Math.PI / 180;
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

class Bullet {
  constructor() {
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3();
    this.trail = [];
    this.records = new Map(); // 제압 판정 기록 (대상별)
    this.active = false;
  }
}

export class Ballistics {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.col = game.world.collision;
    this.pool = [];
    this.active = [];
    this.nextId = 1;
    this.recordTrails = false;
    this.seg = { bullet: null, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, impact: null, terminated: false };
    this.wh = {};
    this.uh = {};
    this.stats = { spawned: 0 };
  }

  spawn({ origin, dir, speed, ammo, shooter, team, isTracer }) {
    let b = this.pool.pop();
    if (!b) b = new Bullet();
    b.id = this.nextId++;
    b.active = true;
    b.pos.copy(origin);
    b.prev.copy(origin);
    b.origin.copy(origin);
    b.dir.copy(dir).normalize();
    b.vel.copy(b.dir).multiplyScalar(speed);
    b.speed = speed;
    b.ammo = ammo;
    b.shooter = shooter;
    b.team = team;
    b.isTracer = isTracer;
    b.age = 0;
    b.penetrations = 0;
    b.ricochets = 0;
    b.lastIgnore = null;
    b.nearCounted = false;
    b.records.clear();
    b.trail.length = 0;
    if (this.recordTrails) b.trail.push(origin.x, origin.y, origin.z);
    if (this.active.length >= CONFIG.ballistics.maxBullets) this.kill(this.active[0]);
    this.active.push(b);
    this.stats.spawned++;
    return b;
  }

  update(dt) {
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.active) this.step(b, dt);
    }
    // 비활성 정리
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.active) list[w++] = b;
      else this.pool.push(b);
    }
    list.length = w;
  }

  step(b, dt) {
    const B = CONFIG.ballistics;
    const v = b.vel;
    const k = b.ammo.dragK;
    b.prev.copy(b.pos);
    // 프레임 길이와 무관하게 같은 궤적이 되도록 고정 간격으로 쪼개 적분 (영점 표와 동일)
    const n = Math.max(1, Math.ceil(dt * B.integrationHz - 1e-6));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const sp = v.length();
      v.x += -k * sp * v.x * h;
      v.y += (-B.gravity - k * sp * v.y) * h;
      v.z += -k * sp * v.z * h;
      b.pos.addScaledVector(v, h);
    }
    b.age += dt;
    b.speed = v.length();

    const ax = b.prev.x;
    const ay = b.prev.y;
    const az = b.prev.z;
    let bx = b.pos.x;
    let by = b.pos.y;
    let bz = b.pos.z;

    // 지형·구조물
    const wh = this.wh;
    let worldT = Infinity;
    if (this.col.segmentCast(ax, ay, az, bx, by, bz, wh, { ignore: b.lastIgnore })) worldT = wh.t;
    // 병사
    let unitT = Infinity;
    let unit = null;
    const uh = this.uh;
    const units = this.game.units;
    const ff = CONFIG.ballistics.friendlyFire;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === b.shooter || !u.alive) continue;
      // 같은 편 오사는 끔 (앞쪽 아군 머리 위로 쏘는 사격 규율을 단순화)
      if (!ff && u.team === b.team) continue;
      if (u.testBulletHit(ax, ay, az, bx, by, bz, uh) && uh.t < unitT && uh.t < worldT) {
        unitT = uh.t;
        unit = u;
        this.uhBest = { ...uh };
      }
    }
    let impact = null;
    let terminated = false;
    if (unit) {
      const h = this.uhBest;
      bx = h.x;
      by = h.y;
      bz = h.z;
      b.pos.set(bx, by, bz);
      impact = {
        bullet: b,
        x: bx,
        y: by,
        z: bz,
        nx: -b.dir.x,
        ny: -b.dir.y,
        nz: -b.dir.z,
        material: 'flesh',
        effect: h.plate ? 'plate' : 'flesh',
        collider: null,
        unit,
        isTerrain: false,
        penetrated: false,
        ricochet: false,
      };
      unit.receiveHit(h, b);
      terminated = true;
    } else if (worldT < Infinity) {
      bx = wh.x;
      by = wh.y;
      bz = wh.z;
      const mat = CONFIG.materials[wh.material] || CONFIG.materials.earth;
      _n.set(wh.nx, wh.ny, wh.nz);
      const dirN = _a.copy(v).normalize();
      let cosI = -dirN.dot(_n);
      if (cosI < 0) {
        // 안쪽에서 맞음: 법선 뒤집기
        _n.negate();
        cosI = -cosI;
      }
      const grazeDeg = Math.asin(Math.min(1, cosI)) / DEG;
      impact = {
        bullet: b,
        x: bx,
        y: by,
        z: bz,
        nx: _n.x,
        ny: _n.y,
        nz: _n.z,
        material: wh.material,
        effect: mat.impact,
        collider: wh.collider,
        unit: null,
        isTerrain: !wh.collider,
        penetrated: false,
        ricochet: false,
        speed: b.speed,
      };
      if (mat.ricochet && grazeDeg < mat.ricochet.maxAngleDeg && Math.random() < mat.ricochet.chance && b.ricochets < 2) {
        // 도탄: 반사 + 속도 감소 + 흩어짐
        impact.ricochet = true;
        const keep = B.ricochetSpeedKeep[0] + Math.random() * (B.ricochetSpeedKeep[1] - B.ricochetSpeedKeep[0]);
        v.reflect(_n).multiplyScalar(keep);
        const sc = B.ricochetScatterDeg * DEG;
        _b.set((Math.random() - 0.5) * 2 * sc, Math.random() * sc, (Math.random() - 0.5) * 2 * sc);
        const s = v.length();
        v.normalize().add(_b).normalize().multiplyScalar(s);
        b.pos.set(bx + _n.x * 0.02, by + _n.y * 0.02, bz + _n.z * 0.02);
        b.dir.copy(v).normalize();
        b.ricochets++;
        b.lastIgnore = null;
      } else if (mat.penetrable && wh.collider) {
        const ns = b.speed * (1 - mat.speedLoss);
        if (ns < B.penetrationMinSpeed) {
          terminated = true;
        } else {
          impact.penetrated = true;
          v.normalize();
          const dd = (mat.deflectDeg || 0) * DEG;
          _b.set((Math.random() - 0.5) * 2 * dd, (Math.random() - 0.5) * 2 * dd, (Math.random() - 0.5) * 2 * dd);
          v.add(_b).normalize();
          // 반대편으로 빠져나감
          const tExit = Math.max(wh.tExit, wh.t);
          const segX = b.pos.x - ax;
          const segY = b.pos.y - ay;
          const segZ = b.pos.z - az;
          b.pos.set(ax + segX * tExit + v.x * 0.03, ay + segY * tExit + v.y * 0.03, az + segZ * tExit + v.z * 0.03);
          v.multiplyScalar(ns);
          b.dir.copy(v).normalize();
          b.penetrations++;
          b.lastIgnore = wh.collider;
        }
      } else {
        terminated = true;
      }
      if (terminated) b.pos.set(bx, by, bz);
    } else {
      b.lastIgnore = null;
    }

    if (!terminated && (b.age > B.maxLifetime || b.speed < B.minSpeed)) terminated = true;
    if (this.recordTrails) b.trail.push(bx, by, bz);

    // 제압 판정용 선분
    const seg = this.seg;
    seg.bullet = b;
    seg.ax = ax;
    seg.ay = ay;
    seg.az = az;
    seg.bx = bx;
    seg.by = by;
    seg.bz = bz;
    seg.impact = impact;
    seg.terminated = terminated;
    this.events.emit(EV.BULLET_SEGMENT, seg);
    if (impact) this.events.emit(EV.BULLET_IMPACT, impact);
    if (terminated) this.kill(b);
  }

  kill(b) {
    if (!b.active) return;
    b.active = false;
    this.events.emit(EV.BULLET_EXPIRED, { bullet: b });
  }

  reset() {
    for (const b of this.active) {
      b.active = false;
      this.pool.push(b);
    }
    this.active.length = 0;
  }
}

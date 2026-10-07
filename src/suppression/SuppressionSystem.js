// =============================================================================
// SuppressionSystem — 1단계의 핵심.
//  탄이 적이 '실제로 있는 곳' 근처를 지나거나 떨어지면 제압 수치가 오른다.
//  플레이어가 적을 보지 못해도 동작하며, 적이 없는 곳에 쏜 탄은 아무 효과가 없다.
//
//  증가: 근접 통과(탄 비행 선분 ↔ 머리·가슴 기준점 최단거리) 또는 근접 탄착 중 큰 값 1회
//        × 예광탄 1.2 × 병사별 내성 계수 × 연속 입력 감소(0.5초 안 2번째 70%, 3번째~ 40%)
//  감소: 마지막 입력 후 2초 유지, 이후 초당 8
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { segPointDistSq } from '../core/mathUtils.js';

const _head = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _out = { t: 0 };

export class SuppressionSystem {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.events.on(EV.BULLET_SEGMENT, (s) => this.onSegment(s));
  }

  passValue(d) {
    for (const step of CONFIG.suppression.nearPass) if (d <= step.dist) return step.value;
    return 0;
  }

  impactValue(d, maxD) {
    const N = CONFIG.suppression.nearImpact;
    if (d > maxD) return 0;
    return N.valueAtZero + (N.valueAtMax - N.valueAtZero) * (d / maxD);
  }

  // 탄착 지점이 이 병사가 숨은 바로 그 엄폐물인가 (흉벽 흙이 머리 위로 튀는 상황)
  isCoverHit(u, imp) {
    const refs = u.coverRef;
    if (!refs || !u.inCover) return false;
    const list = Array.isArray(refs) ? refs : [refs];
    for (const r of list) {
      if (r === 'terrain') {
        if (!imp.isTerrain) continue;
        const dx = imp.x - _head.x;
        const dz = imp.z - _head.z;
        if (dx * u.coverFacing.x + dz * u.coverFacing.z > -0.6) return true;
      } else if (imp.collider && imp.collider.tag === r) return true;
    }
    return false;
  }

  onSegment(seg) {
    const S = CONFIG.suppression;
    const b = seg.bullet;
    const units = this.game.units;
    const consider2 = S.considerDist * S.considerDist;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === b.shooter || !u.alive) continue;
      // 같은 편 탄은 제압하지 않는다. 단, 플레이어 탄은 아군 분대원도 제압한다 (2단계)
      if (u.team === b.team && !(b.shooter && b.shooter.isPlayer && CONFIG.squad.playerFriendlyFire)) continue;
      let rec = b.records.get(u);
      if (rec && rec.finalized) continue;
      u.getChestPos(_chest);
      const dc2 = segPointDistSq(seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz, _chest.x, _chest.y, _chest.z, _out);
      const tc = _out.t;
      if (!rec) {
        if (dc2 > consider2) continue;
        rec = { minDist: Infinity, impactValue: 0, impactDist: Infinity, finalized: false, closest: new THREE.Vector3() };
        b.records.set(u, rec);
      }
      u.getHeadPos(_head);
      const dh2 = segPointDistSq(seg.ax, seg.ay, seg.az, seg.bx, seg.by, seg.bz, _head.x, _head.y, _head.z, _out);
      const th = _out.t;
      const d = Math.sqrt(Math.min(dc2, dh2));
      if (d < rec.minDist) {
        rec.minDist = d;
        const t = dh2 < dc2 ? th : tc;
        rec.closest.set(seg.ax + (seg.bx - seg.ax) * t, seg.ay + (seg.by - seg.ay) * t, seg.az + (seg.bz - seg.az) * t);
      }
      const imp = seg.impact;
      if (imp && !imp.unit) {
        const di = Math.min(
          Math.hypot(imp.x - _head.x, imp.y - _head.y, imp.z - _head.z),
          Math.hypot(imp.x - _chest.x, imp.y - _chest.y, imp.z - _chest.z),
        );
        const maxD = this.isCoverHit(u, imp) ? S.nearImpact.coverMaxDist : S.nearImpact.maxDist;
        const v = this.impactValue(di, maxD);
        if (v > rec.impactValue) rec.impactValue = v;
        if (di < rec.impactDist) rec.impactDist = di;
      }
      // 판정 확정: 탄이 끝났거나, 대상을 충분히 지나쳤을 때
      let done = seg.terminated;
      if (!done) {
        const vx = seg.bx - _chest.x;
        const vy = seg.by - _chest.y;
        const vz = seg.bz - _chest.z;
        const along = vx * b.dir.x + vy * b.dir.y + vz * b.dir.z;
        if (along > S.finalizePastDist) done = true;
      }
      if (done) this.finalize(b, u, rec);
    }
  }

  finalize(b, u, rec) {
    const S = CONFIG.suppression;
    rec.finalized = true;
    const pass = this.passValue(rec.minDist);
    let value = Math.max(pass, rec.impactValue);
    const near3 = rec.minDist <= 3 || rec.impactDist <= S.nearImpact.maxDist;
    if (value <= 0) return;
    const now = this.game.time;
    const sup = u.suppression;
    const repeatMul = sup.repeatMultiplier(now);
    value *= (b.isTracer ? S.tracerMul : 1) * sup.resilience * repeatMul;
    const prev = sup.add(value, now);
    this.events.emit(EV.UNIT_SUPPRESSED, {
      unit: u,
      amount: value,
      value: sup.value,
      level: sup.level,
      prevLevel: prev,
      bullet: b,
      distance: rec.minDist,
      impactDist: rec.impactDist,
    });
    if (sup.level !== prev) this.events.emit(EV.SUPPRESSION_LEVEL, { unit: u, level: sup.level, prevLevel: prev });
    this.events.emit(EV.BULLET_NEAR_MISS, {
      bullet: b,
      target: u,
      distance: rec.minDist,
      impactDist: rec.impactDist,
      point: rec.closest,
      value,
      near3m: near3,
    });
  }

  update(dt) {
    const now = this.game.time;
    for (const u of this.game.units) {
      if (!u.alive) continue;
      const prev = u.suppression.update(dt, now);
      if (prev >= 0) this.events.emit(EV.SUPPRESSION_LEVEL, { unit: u, level: u.suppression.level, prevLevel: prev });
    }
  }
}

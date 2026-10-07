// =============================================================================
// Squad — 2단계 아군 분대 (6명: 분대장·1번 = 1조, 2번·3번 = 2조, 플레이어·4번 = 엄호조)
//  분대장 판단: 1초마다 다음 약진 구간의 출발 조건을 본다.
//   1) 그 구간에 사선이 닿는 적(관통 불가 엄폐물만 막는다)은 모두 압박(25) 이상이거나 쓰러졌다
//   2) 뛸 분대원의 제압 값이 25 미만
//   3) 최근 2초 동안 뛸 분대원 3m 안에 적 탄이 없었다
//   4) 지난 약진 도착 뒤 8초 이상 (플레이어 G 요청이면 생략)
//  판단은 실제 제압 값으로 하지만, 막힌 이유는 분대원이 보고 들을 수 있는 말로 전한다.
//  교대 약진: 뒤처진 조가 앞 조 자리까지, 두 조가 나란하면 지난번에 앞서지 않은 조가 다음 지점으로.
//  플레이어 명령: G 약진 요청 / H 정지(보류) / X 표적 지시 / (Tab 분대 상태는 UI)
//  콜아웃: EV.CALLOUT (화면 아래 자막), 같은 말은 6초 안에 반복하지 않는다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { SQUAD_MAP } from '../world/mapData.js';
import { Soldier } from '../units/Soldier.js';
import { LEVEL } from '../suppression/Suppressible.js';
import { randRange } from '../core/Random.js';
import { FriendlyAI } from './FriendlyAI.js';

const MEMBERS = [
  { role: 'leader', team: 1, callName: '분대장', slot: 0 },
  { role: 'm1', team: 1, callName: '1번', slot: 1 },
  { role: 'm2', team: 2, callName: '2번', slot: 2 },
  { role: 'm3', team: 2, callName: '3번', slot: 3 },
  { role: 'm4', team: 0, callName: '4번', slot: 0 },
];
export const TEAM_NAMES = { 0: '엄호조', 1: '1조', 2: '2조' };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _hit = {};

// 방위각 (북 = -z 가 0°, 동 = +x 가 90°)
export function bearingDeg(from, to) {
  const b = (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
  return (b + 360) % 360;
}

export function fmtBearing(deg) {
  return String(Math.round(deg) % 360).padStart(3, '0');
}

export function fmtRange(d) {
  return d >= 100 ? String(Math.round(d / 10) * 10) : String(Math.max(5, Math.round(d / 5) * 5));
}

export class Squad {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.members = [];
    this.byUnit = new Map();
    for (const def of MEMBERS) {
      const s = new Soldier(game, { team: 'friendly', typeId: 'squadRifleman', name: def.callName, addToScene: false });
      const m = new FriendlyAI(game, this, s, def);
      m.slotIndex = def.slot;
      this.members.push(m);
      this.byUnit.set(s, m);
    }
    this.mobile = this.members.filter((m) => m.team !== 0);
    this.buildRoute();
    this.losCache = new Map();
    this.reset();

    const ev = game.events;
    ev.on(EV.SHOT_FIRED, (e) => {
      if (!this.active) return;
      if (e.team === 'enemy') {
        const ai = game.director.byUnit(e.shooter);
        if (ai) for (const m of this.members) if (m.alive) m.onHostileShot(e, ai);
      } else if (e.shooter === game.player.body) this.onPlayerShot(e);
    });
    ev.on(EV.UNIT_SUPPRESSED, (e) => {
      if (!this.active) return;
      const m = this.byUnit.get(e.unit);
      if (m && m.alive) m.onSuppressed(e);
    });
    ev.on(EV.BULLET_NEAR_MISS, (e) => this.active && this.onNearMiss(e));
    ev.on(EV.UNIT_HIT, (e) => this.active && this.onUnitHit(e));
    ev.on(EV.UNIT_INCAPACITATED, (e) => this.active && this.onIncapacitated(e));
  }

  // ------------------------------------------------------------------ 경로
  buildRoute() {
    const S = CONFIG.squad;
    const t = this.game.world.terrain;
    this.nodes = {};
    for (const [id, n] of Object.entries(SQUAD_MAP.nodes)) {
      let best = null;
      let bd = S.craterSnap;
      if (n.crater) {
        for (const c of t.craters) {
          const d = Math.hypot(c.x - n.x, c.z - n.z);
          if (d < bd && c.r > 0.9) {
            bd = d;
            best = c;
          }
        }
      }
      const node = { id, name: n.name, kind: n.kind, x: best ? best.x : n.x, z: best ? best.z : n.z, r: best ? best.r : 0, next: SQUAD_MAP.edges[id] || [] };
      node.y = t.heightAt(node.x, node.z);
      node.slots = node.kind === 'canal' ? null : this.computeSlots(node);
      this.nodes[id] = node;
    }
  }

  // 구덩이 안 엎드릴 자리 4곳: 적 쪽 안 경사면, 테두리보다 조금 낮은 곳 (눈만 테두리 위로).
  // 적 방향과 직각으로 slotSpacing 간격 (작은 구덩이면 테두리 옆 땅까지 퍼진다)
  computeSlots(node) {
    const S = CONFIG.squad;
    const t = this.game.world.terrain;
    const [fx, fz] = S.facePoint;
    const baseYaw = Math.atan2(fx - node.x, fz - node.z);
    node.yaw = baseYaw;
    const ux = Math.sin(baseYaw);
    const uz = Math.cos(baseYaw);
    const sx = uz; // 오른쪽 (적을 볼 때)
    const sz = -ux;
    const n = S.slotCount;
    const out = [];
    for (let i = 0; i < n; i++) {
      const lat = (i - (n - 1) / 2) * S.slotSpacing;
      const ox = node.x + sx * lat;
      const oz = node.z + sz * lat;
      // 이 줄을 따라 적 쪽으로: 가장 높은 곳(테두리)과 그보다 slotRimBelow 낮은 첫 지점
      const reach = Math.max(1.5, node.r * 1.4);
      let rimH = -Infinity;
      let rimD = 0;
      for (let d = -0.5; d <= reach; d += 0.1) {
        const h = t.heightAt(ox + ux * d, oz + uz * d);
        if (h > rimH) {
          rimH = h;
          rimD = d;
        }
      }
      let sd = rimD;
      for (let d = -0.5; d <= rimD; d += 0.05) {
        if (t.heightAt(ox + ux * d, oz + uz * d) >= rimH - S.slotRimBelow) {
          sd = d;
          break;
        }
      }
      // 엎드린 몸 중심은 머리보다 뒤 (머리·눈이 테두리 근처)
      const bd = sd - S.slotBodyBack;
      const x = ox + ux * bd;
      const z = oz + uz * bd;
      out.push(new THREE.Vector3(x, t.heightAt(x, z), z));
    }
    return out;
  }

  canalSlot(m, out) {
    const t = this.game.world.terrain;
    const x = SQUAD_MAP.start[m.role];
    return out.set(x, 0, t.canalZ(x) - CONFIG.squad.canalBench);
  }

  slotFor(m, nodeId, out) {
    const node = this.nodes[nodeId];
    if (!node.slots) return this.canalSlot(m, out);
    return out.copy(node.slots[m.slotIndex]);
  }

  // ------------------------------------------------------------------ 상태
  setActive(v) {
    if (this.active === v) return;
    this.active = v;
    const g = this.game;
    for (const m of this.members) {
      const s = m.s;
      if (v) {
        g.scene.add(s.root);
        if (!g.units.includes(s)) g.units.push(s);
      } else {
        g.scene.remove(s.root);
        const i = g.units.indexOf(s);
        if (i >= 0) g.units.splice(i, 1);
      }
    }
    g.refreshTargets();
  }

  get targets() {
    return this.members;
  }

  memberOf(unit) {
    return this.byUnit.get(unit) || null;
  }

  reset() {
    this.route = ['S'];
    this.teamIdx = { 1: 0, 2: 0 };
    this.lastLead = 2; // 처음엔 1조가 앞선다
    this.bound = null;
    this.lastBoundEnd = this.game.time;
    this.halted = false;
    this.designation = null;
    this.threats = [];
    this.block = null; // 마지막 판단 {ok, reasons, plan}
    this.blockedSince = null;
    this.lastCoverCall = -99;
    this.checkTimer = 1.5;
    this.calloutTimes = new Map();
    this.pendingShares = [];
    this.nearFriendMarks = []; // 디버그: 아군 근처를 지난 플레이어 탄 위치
    this.lastShiftCheck = null; // 디버그: 플레이어 사선 판정 결과
    this.contactTimes = new Map();
    this.markersUntil = 0;
    this.stats = {
      bounds: 0,
      autoBounds: 0,
      gRequests: 0,
      gBlocked: 0,
      threatTime: 0,
      threatSuppressedTime: 0,
      playerNearFriend: 0,
      friendlyHitsByPlayer: 0,
      friendlyKilledByPlayer: 0,
      coverTeamHits: 0,
      losses: 0,
      mobileLosses: 0,
      shiftFireCalls: 0,
      boundLog: [],
    };
    const t = this.game.world.terrain;
    for (const m of this.members) {
      const s = m.s;
      s.damage.reset();
      s.suppression.reset();
      s.weapon.reset();
      s.coverRef = 'terrain';
      s.inCover = true;
      s.coverFacing.set(0, 0, -1);
      m.tracks.clear();
      m.node = 'S';
      m.bound = null;
      m.path = null;
      m.halt = null;
      m.aimTrack = null;
      m.up = false;
      m.upTimer = randRange(CONFIG.squad.downTime);
      m.fireTimer = randRange(CONFIG.squad.fireInterval);
      m.lastShotTime = -99;
      m.lastNearRound = -99;
      m.lastAmmoCall = -99;
      m.knocked = false;
      this.canalSlot(m, _v);
      m.placeAt(_v.x, _v.z, Math.PI, true);
      m.slot.y = t.heightAt(_v.x, _v.z);
      s.model.aimPitch = 0;
      s.model.slopePitch = 0;
    }
  }

  // ------------------------------------------------------------------ 갱신
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const now = g.time;
    const input = g.input;
    if (g.state === 'playing' && g.player.alive && input) {
      if (input.wasPressed('KeyG')) this.requestBound();
      if (input.wasPressed('KeyH')) this.toggleHalt();
      if (input.wasPressed('KeyX')) this.designateFromPlayer();
      if (input.isDown('Tab')) this.markersUntil = now + CONFIG.squad.markerTime;
    }
    // 분대 안 위치 공유 (외침·무전: 지연 + 오차)
    for (let i = this.pendingShares.length - 1; i >= 0; i--) {
      const sh = this.pendingShares[i];
      if (now < sh.at) continue;
      this.pendingShares.splice(i, 1);
      if (!sh.ai.alive) continue;
      for (const m of this.members) if (m !== sh.from && m.alive) m.receive(sh.ai, sh.pos, sh.sigma);
    }
    for (const m of this.members) m.update(dt);
    if (this.designation && now >= this.designation.until) this.designation = null;
    this.updateBound(dt);
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = CONFIG.squad.checkInterval;
      this.autoCheck();
    }
    if (this.nearFriendMarks.length && now - this.nearFriendMarks[0].time > 12) this.nearFriendMarks.shift();
  }

  // ------------------------------------------------------------------ 약진 계획
  // 살아 있고 부상이 아니며 자리에서 대기 중인 조원
  ableOf(team) {
    return this.mobile.filter((m) => m.team === team && m.canBound);
  }

  // 다음 약진: {team, movers, fromId, toId, toIdx, branch}
  nextPlan() {
    if (this.bound) return null;
    const a1 = this.ableOf(1);
    const a2 = this.ableOf(2);
    let team = 0;
    if (a1.length && a2.length) {
      const i1 = this.teamIdx[1];
      const i2 = this.teamIdx[2];
      if (i1 < i2) team = 1;
      else if (i2 < i1) team = 2;
      else team = this.lastLead === 1 ? 2 : 1;
    } else if (a1.length) team = 1;
    else if (a2.length) team = 2;
    if (!team) return null;
    const movers = team === 1 ? a1 : a2;
    if (movers.some((m) => m.state !== 'hold')) return null;
    const idx = this.teamIdx[team];
    const other = team === 1 ? 2 : 1;
    const otherAble = (team === 1 ? a2 : a1).length > 0;
    const fromId = this.route[idx];
    // 뒤처진 조는 앞 조 자리까지
    if (otherAble && this.teamIdx[other] > idx) {
      return { team, movers, fromId, toId: this.route[idx + 1], toIdx: idx + 1, lead: false };
    }
    // 앞서 나가기: 경로 끝이면 없음
    if (this.route[idx + 1]) return { team, movers, fromId, toId: this.route[idx + 1], toIdx: idx + 1, lead: true };
    const next = this.nodes[fromId].next;
    if (!next.length) return null;
    let toId = next[0];
    if (next.length > 1) toId = this.chooseBranch(fromId, next);
    return { team, movers, fromId, toId, toIdx: idx + 1, lead: true, branch: next.length > 1 };
  }

  // 갈림길: 지금 열린(압박되지 않은) 적 사선이 적은 쪽, 같으면 사선이 닿는 적 수, 그래도 같으면 왼쪽
  chooseBranch(fromId, list) {
    let best = list[0];
    let bs = Infinity;
    for (const id of list) {
      const th = this.segmentThreats(fromId, id);
      const open = th.filter((ai) => ai.level < LEVEL.PRESSURED).length;
      const sc = open * 10 + th.length;
      if (sc < bs) {
        bs = sc;
        best = id;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ 사선
  enemyEye(ai, out) {
    const S = CONFIG.squad;
    const fp = ai.fp;
    if (fp && (ai.state === 'cover' || ai.state === 'observe' || ai.state === 'fire' || ai.state === 'blindfire' || ai.state === 'pinned')) {
      return out.set(fp.firePos.x, fp.firePos.y + (S.enemyEyeHeights[fp.fire] || 1.4), fp.firePos.z);
    }
    return out.set(ai.pos.x, ai.pos.y + 1.2, ai.pos.z);
  }

  // 구간 위 한 점이라도 적의 사격 자리에서 관통 불가 엄폐물 없이 보이면 true (자리별로 기억)
  segmentVisibleFrom(fromId, toId, eye) {
    const key = `${fromId}>${toId}|${Math.round(eye.x * 2)},${Math.round(eye.y * 4)},${Math.round(eye.z * 2)}`;
    const c = this.losCache.get(key);
    if (c !== undefined) return c;
    const S = CONFIG.squad;
    const t = this.game.world.terrain;
    const col = this.game.world.collision;
    const a = this.nodes[fromId];
    const b = this.nodes[toId];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(len / S.losStep));
    let vis = false;
    for (let i = 1; i <= n && !vis; i++) {
      const k = i / n;
      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      const y = t.heightAt(x, z) + S.losRunnerHeight;
      if (!col.solidLineBlocked(eye.x, eye.y, eye.z, x, y, z)) vis = true;
    }
    this.losCache.set(key, vis);
    return vis;
  }

  // 구간에 사선이 닿는 살아 있는 적
  segmentThreats(fromId, toId) {
    const out = [];
    for (const ai of this.game.director.ais) {
      if (!ai.s.alive) continue;
      this.enemyEye(ai, _v);
      if (this.segmentVisibleFrom(fromId, toId, _v)) out.push(ai);
    }
    return out;
  }

  // 출발 조건 판단 → {ok, reasons: [{type, ...}], threats, blockers}
  evaluate(plan, requested) {
    const S = CONFIG.squad;
    const now = this.game.time;
    const reasons = [];
    const threats = this.segmentThreats(plan.fromId, plan.toId);
    const blockers = threats.filter((ai) => ai.s.suppression.value < S.threatMinSuppression);
    if (blockers.length) reasons.push({ type: 'threat', blockers });
    const pinned = plan.movers.filter((m) => m.s.suppression.value >= S.departMaxSuppression);
    if (pinned.length) reasons.push({ type: 'suppressed', members: pinned });
    const near = plan.movers.filter((m) => now - m.lastNearRound < S.departQuietTime);
    if (near.length) reasons.push({ type: 'near', members: near });
    const gap = S.minBoundGap - (now - this.lastBoundEnd);
    if (!requested && gap > 0) reasons.push({ type: 'gap', left: gap });
    return { ok: reasons.length === 0, reasons, threats, blockers, plan };
  }

  autoCheck() {
    const now = this.game.time;
    const plan = this.nextPlan();
    this.threats = [];
    if (!plan) {
      this.block = null;
      this.blockedSince = null;
      return;
    }
    const ev = this.evaluate(plan, false);
    this.block = ev;
    this.threats = ev.blockers;
    if (this.halted) {
      this.blockedSince = null;
      return;
    }
    if (ev.ok) {
      this.startBound(plan, false);
      return;
    }
    // 대기 시간 말고 다른 이유로 막혀 있으면, 오래 막힐 때 엄호 사격을 다시 요청
    const real = ev.reasons.filter((r) => r.type !== 'gap');
    if (!real.length) {
      this.blockedSince = null;
      return;
    }
    if (this.blockedSince === null) this.blockedSince = now;
    if (now - this.blockedSince > CONFIG.squad.blockedRepeat && now - this.lastCoverCall > CONFIG.squad.blockedRepeat) {
      this.lastCoverCall = now;
      this.say(this.speaker(), `엄호 사격 바란다! ${this.reasonText(ev, plan)}`, 'cover-request', 'warn');
    }
  }

  startBound(plan, requested) {
    const now = this.game.time;
    if (plan.toIdx >= this.route.length) this.route.push(plan.toId);
    if (plan.lead) this.lastLead = plan.team;
    this.bound = {
      team: plan.team,
      members: plan.movers.slice(),
      fromId: plan.fromId,
      toId: plan.toId,
      toIdx: plan.toIdx,
      start: now,
      requested,
    };
    for (const m of plan.movers) {
      this.slotFor(m, plan.toId, _v);
      m.beginBound(_v, plan.toId);
      m.s.inCover = false;
    }
    this.blockedSince = null;
    this.stats.bounds++;
    if (!requested) this.stats.autoBounds++;
    const dest = this.nodes[plan.toId];
    this.say(this.speaker(), `${TEAM_NAMES[plan.team]} 이동! ${dest.name}까지!`, `bound-${this.stats.bounds}`, 'info');
    this.game.events.emit(EV.SQUAD_BOUND_START, { team: plan.team, members: plan.movers, from: plan.fromId, to: plan.toId, requested });
  }

  updateBound(dt) {
    const b = this.bound;
    if (!b) return;
    // 진행 중 약진의 위협 제압률 (핵심 지표): 사선이 닿는 적 중 압박 이상인 비율의 시간 평균
    const exposed = b.members.some((m) => m.alive && (m.state === 'bound' || m.state === 'drop' || m.state === 'halted'));
    if (exposed) {
      const th = this.segmentThreats(b.fromId, b.toId);
      let sup = 0;
      for (const ai of th) if (ai.s.suppression.value >= CONFIG.squad.threatMinSuppression) sup++;
      this.stats.threatTime += dt;
      this.stats.threatSuppressedTime += dt * (th.length ? sup / th.length : 1);
    }
    // 모두 도착(또는 멈춤·전투 불능)하면 끝
    const pending = b.members.filter((m) => m.alive && m.bound);
    if (pending.length) return;
    const arrived = b.members.filter((m) => m.alive && m.node === b.toId && m.state === 'hold');
    this.bound = null;
    this.lastBoundEnd = this.game.time;
    this.stats.boundLog.push({ team: b.team, from: b.fromId, to: b.toId, t0: b.start, t1: this.game.time, arrived: arrived.length, requested: b.requested });
    if (arrived.length) {
      this.teamIdx[b.team] = b.toIdx;
      for (const m of arrived) {
        m.s.inCover = true;
        _d.set(Math.sin(this.nodes[b.toId].yaw || Math.PI), 0, Math.cos(this.nodes[b.toId].yaw || Math.PI));
        m.s.coverFacing.copy(_d);
      }
      const atA = b.toId === SQUAD_MAP.assault;
      this.say(arrived[0], atA ? '돌격 대기 위치 도착! 자리 잡는다!' : `${TEAM_NAMES[b.team]} 도착, 엄호한다!`, `arrive-${b.team}-${b.toId}`, 'info');
    }
    this.game.events.emit(EV.SQUAD_BOUND_END, { team: b.team, members: arrived, node: b.toId });
  }

  // ------------------------------------------------------------------ 분대원 → 분대장
  onMemberHalted(m) {
    this.say(m, '엎드려! 사격 받는다!', `halted-${m.team}`, 'warn');
  }

  onMemberStopped(m) {
    m.s.inCover = true;
    this.say(m, '부상이다, 여기서 엄호한다!', `stopped-${m.role}`, 'warn');
  }

  onMemberArrived(m) {
    m.s.inCover = true;
  }

  // 분대원이 적을 새로 봤다: 분대에 알리고 처음 보는 적이면 콜아웃
  shareSighting(m, ai, p) {
    const now = this.game.time;
    this.pendingShares.push({ from: m, ai, at: now + randRange(CONFIG.ai.shareDelay), pos: p.estimate.clone(), sigma: p.sigma });
    const last = this.contactTimes.get(ai);
    if (last !== undefined && now - last < 40) return;
    this.contactTimes.set(ai, now);
    const pl = this.game.player.pos;
    const d = Math.hypot(p.estimate.x - pl.x, p.estimate.z - pl.z);
    if (d > CONFIG.squad.contactRange) return;
    this.say(m, `적 발견! ${this.placeText(p.estimate)}`, `contact-${ai.s.id}`, 'alert');
  }

  facingYaw(m) {
    const [fx, fz] = CONFIG.squad.facePoint;
    return Math.atan2(fx - m.pos.x, fz - m.pos.z);
  }

  // 사선(눈 → 조준점)에 다른 아군(플레이어 포함)이 가까우면 true
  friendInLine(shooter, eye, dir, range) {
    const S = CONFIG.squad;
    const tan = Math.tan((S.lineClearanceDeg * Math.PI) / 180);
    const check = (p) => {
      _w.subVectors(p, eye);
      const along = _w.dot(dir);
      if (along < 0.5 || along > range + 3) return false;
      const perp = Math.sqrt(Math.max(0, _w.lengthSq() - along * along));
      return perp < S.lineClearance || perp < along * tan;
    };
    for (const m of this.members) {
      if (m === shooter || !m.alive) continue;
      if (check(m.s.getChestPos(_o))) return true;
    }
    const pl = this.game.player;
    return pl.alive && check(pl.body.getChestPos(_o));
  }

  // ------------------------------------------------------------------ 플레이어 명령
  // G: 약진 요청 ("엄호한다, 이동!")
  requestBound() {
    const st = this.stats;
    st.gRequests++;
    const reply = (ok, text, reason) => {
      if (!ok) st.gBlocked++;
      this.say(this.speaker(), text, `g-${ok ? 'ok' : reason}`, ok ? 'info' : 'warn', true);
      this.game.events.emit(EV.SQUAD_REQUEST, { ok, reason });
      return ok;
    };
    if (this.halted) this.halted = false;
    if (this.bound) return reply(false, '아직 이동 중이다!', 'moving');
    if (!this.ableOf(1).length && !this.ableOf(2).length) return reply(false, '움직일 사람이 없다!', 'none');
    const plan = this.nextPlan();
    if (!plan) {
      const atEnd = this.mobile.some((m) => m.alive && m.node === SQUAD_MAP.assault);
      return reply(false, atEnd ? '여기가 돌격 대기 위치다, 자리 지킨다!' : '아직 자리 잡는 중이다!', atEnd ? 'end' : 'busy');
    }
    const ev = this.evaluate(plan, true);
    this.block = ev;
    this.threats = ev.blockers;
    if (!ev.ok) return reply(false, `안 된다! ${this.reasonText(ev, plan)}`, ev.reasons[0].type);
    reply(true, `알았다! ${TEAM_NAMES[plan.team]} 간다!`, 'ok');
    this.startBound(plan, true);
    return true;
  }

  // H: 다음 약진 보류 / 다시 진행
  toggleHalt() {
    this.halted = !this.halted;
    this.say(this.speaker(), this.halted ? '정지! 다음 약진 보류한다.' : '약진 재개!', `halt-${this.halted}`, 'info', true);
  }

  // X: 조준점 표적 지시 → 분대 추정 갱신 + 15초 집중 사격
  designateFromPlayer() {
    const g = this.game;
    const cam = g.camera;
    cam.getWorldPosition(_o);
    cam.getWorldDirection(_d);
    const R = CONFIG.squad.designateRange;
    const col = g.world.collision;
    if (!col.segmentCast(_o.x, _o.y, _o.z, _o.x + _d.x * R, _o.y + _d.y * R, _o.z + _d.z * R, _hit)) {
      g.events.emit(EV.MESSAGE, { text: '표적 지시: 지점이 너무 멀다', kind: 'warn' });
      return false;
    }
    return this.designate(_w.set(_hit.x, _hit.y, _hit.z));
  }

  designate(point) {
    const S = CONFIG.squad;
    const g = this.game;
    const now = g.time;
    const p = point.clone();
    const pl = g.player.pos;
    const bearing = bearingDeg(pl, p);
    const range = Math.hypot(p.x - pl.x, p.z - pl.z);
    this.designation = { point: p, until: now + S.designateTime, bearing, range, time: now };
    // 지시 지점 근처의 적: 분대 추정을 지시 지점으로 갱신
    let best = null;
    let bd = S.designateMatch;
    for (const ai of g.director.ais) {
      if (!ai.s.alive) continue;
      const d = Math.hypot(ai.pos.x - p.x, ai.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = ai;
      }
    }
    if (best) for (const m of this.members) if (m.alive) m.receive(best, p, S.designateSigma);
    const text = `표적 지시: 방위 ${fmtBearing(bearing)}, 거리 ${fmtRange(range)}`;
    g.events.emit(EV.MESSAGE, { text, kind: 'info' });
    g.events.emit(EV.SQUAD_DESIGNATE, { point: p, bearing, range });
    this.say(this.speaker(), `표적 확인! 방위 ${fmtBearing(bearing)}, 집중 사격!`, 'designate', 'info', true);
    return true;
  }

  // ------------------------------------------------------------------ 오사·사격 전환
  // 플레이어 사격마다: 사선(약 5°·3m) 안이나 탄착 지점 30m 안에 아군이 있으면 '사격 전환' 콜아웃
  onPlayerShot(e) {
    const S = CONFIG.squad.shiftFire;
    const g = this.game;
    const o = e.origin;
    const dir = e.dir;
    const R = CONFIG.squad.designateRange;
    const col = g.world.collision;
    let hitDist = R;
    if (col.segmentCast(o.x, o.y, o.z, o.x + dir.x * R, o.y + dir.y * R, o.z + dir.z * R, _hit)) hitDist = _hit.t * R;
    _w.set(o.x + dir.x * hitDist, o.y + dir.y * hitDist, o.z + dir.z * hitDist);
    const tan = Math.tan((S.angleDeg * Math.PI) / 180);
    const inLine = [];
    for (const m of this.members) {
      if (!m.alive) continue;
      m.s.getChestPos(_v);
      const dx = _v.x - o.x;
      const dy = _v.y - o.y;
      const dz = _v.z - o.z;
      const along = dx * dir.x + dy * dir.y + dz * dir.z;
      const nearTarget = _v.distanceTo(_w) < S.targetDist;
      let line = false;
      if (along > S.minRange && along < hitDist + 5) {
        const perp = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
        line = perp < S.lineDist || perp < along * tan;
      }
      if (line || nearTarget) inLine.push({ m, line, nearTarget });
    }
    this.lastShiftCheck = { time: g.time, origin: o.clone(), dir: dir.clone(), hitDist, target: _w.clone(), inLine: inLine.map((x) => x.m) };
    if (!inLine.length) return;
    const who = inLine[0].m;
    const team = who.team ? TEAM_NAMES[who.team] : who.callName;
    const text = inLine[0].line ? `사격 전환! ${team}이 사선에 있다!` : `사격 옮겨! 그 근처에 ${team}이 있다!`;
    if (this.say(this.speaker(), text, 'shift-fire', 'alert', true)) this.stats.shiftFireCalls++;
  }

  onNearMiss(e) {
    const m = this.byUnit.get(e.target);
    if (!m || e.bullet.shooter !== this.game.player.body) return;
    const S = CONFIG.squad;
    if (e.distance > S.friendlyNearDist && e.impactDist > S.friendlyNearDist) return;
    if (e.bullet.nearFriendCounted) return;
    e.bullet.nearFriendCounted = true;
    this.stats.playerNearFriend++;
    this.nearFriendMarks.push({ pos: e.point.clone(), time: this.game.time, member: m });
    this.say(m, '아군이다! 사격 중지!', 'friendly-near', 'alert', true);
  }

  onUnitHit(e) {
    const g = this.game;
    const fromPlayer = e.bullet && e.bullet.shooter === g.player.body;
    if (e.unit === g.player.body) {
      this.stats.coverTeamHits++;
      return;
    }
    const m = this.byUnit.get(e.unit);
    if (!m) return;
    if (m.team === 0) this.stats.coverTeamHits++;
    if (fromPlayer) {
      this.stats.friendlyHitsByPlayer++;
      this.say(m, '아군 오사! 사격 중지! 사격 중지!', 'friendly-hit', 'alert', true);
    }
    m.onHit(e);
    if (e.result === 'wounded') this.say(this.speaker(m), `${m.callName} 부상!`, `wounded-${m.role}`, 'alert');
    else if (e.result === 'plate') this.say(m, '맞았다! 방탄판이다, 괜찮다!', `plate-${m.role}`, 'warn');
  }

  onIncapacitated(e) {
    const g = this.game;
    const m = this.byUnit.get(e.unit);
    if (m) {
      this.stats.losses++;
      if (m.team !== 0) this.stats.mobileLosses++;
      if (e.bullet && e.bullet.shooter === g.player.body) this.stats.friendlyKilledByPlayer++;
      this.say(this.speaker(m), `${m.callName} 쓰러졌다!`, `down-${m.role}`, 'alert', true);
      return;
    }
    if (e.unit.team === 'enemy') {
      const ai = g.director.byUnit(e.unit);
      if (ai) this.contactTimes.delete(ai);
      this.say(this.speaker(), '적 하나 쓰러졌다!', 'enemy-down', 'info');
    }
  }

  // ------------------------------------------------------------------ 콜아웃
  // 말할 사람: 분대장 → 1번 → … (살아 있는 첫 사람). except: 이 사람은 빼고
  speaker(except = null) {
    for (const m of this.members) if (m.alive && m !== except) return m;
    return null;
  }

  // 같은 key 는 calloutGap 안에 반복하지 않는다. 말했으면 true
  say(m, text, key, kind = 'info', force = false) {
    if (!m || !this.active) return false;
    const now = this.game.time;
    const k = key || text;
    const last = this.calloutTimes.get(k);
    if (!force && last !== undefined && now - last < CONFIG.squad.calloutGap) return false;
    if (force && last !== undefined && now - last < 1.0) return false;
    this.calloutTimes.set(k, now);
    const radio = m.pos.distanceTo(this.game.player.pos) > 20;
    this.game.events.emit(EV.CALLOUT, { speaker: m.callName, text, key: k, kind, radio });
    return true;
  }

  // 위치 설명: 가장 가까운 지형지물 + 플레이어 기준 방위·거리
  placeText(p) {
    const pl = this.game.player.pos;
    let lm = null;
    let ld = 45;
    for (const L of SQUAD_MAP.landmarks) {
      const d = Math.hypot(L.x - p.x, L.z - p.z);
      if (d < ld) {
        ld = d;
        lm = L;
      }
    }
    const b = fmtBearing(bearingDeg(pl, p));
    const r = fmtRange(Math.hypot(p.x - pl.x, p.z - pl.z));
    return lm ? `${lm.name}, 방위 ${b}, 거리 ${r}` : `방위 ${b}, 거리 ${r}`;
  }

  // 분대가 아는 그 적의 위치 (가장 정확한 추정). 모르면 null
  knownPos(ai) {
    let best = null;
    let bs = 30;
    for (const m of this.members) {
      if (!m.alive) continue;
      const p = m.tracks.get(ai);
      if (!p || !p.has) continue;
      const s = p.effectiveSigma();
      if (s < bs) {
        bs = s;
        best = p.estimate;
      }
    }
    return best;
  }

  // 막힌 이유 (관측 가능한 말로)
  reasonText(ev) {
    const now = this.game.time;
    const r = ev.reasons.find((x) => x.type !== 'gap') || ev.reasons[0];
    if (!r) return '';
    if (r.type === 'threat') {
      // 가장 위험한 적: 최근에 쏜 적 > 분대가 아는 적 > 나머지
      const list = r.blockers.slice().sort((a, b) => b.lastShotTime - a.lastShotTime);
      const ai = list[0];
      const pos = this.knownPos(ai);
      const more = list.length > 1 ? ` (그 밖에 ${list.length - 1}곳)` : '';
      if (pos && now - ai.lastShotTime < 5) return `${this.placeText(pos)}에서 아직 쏜다${more}`;
      if (pos) return `${this.placeText(pos)} 쪽 놈이 아직 고개를 든다${more}`;
      return `적이 아직 고개를 들고 있다${more ? `, ${list.length}곳` : ''} — 계속 눌러줘`;
    }
    if (r.type === 'suppressed') return `${r.members[0].callName}이 묶였다, 고개를 못 든다`;
    if (r.type === 'near') return `${r.members[0].callName} 옆에 탄이 떨어진다`;
    if (r.type === 'gap') return '자리 잡는 중이다';
    return '';
  }

  // ------------------------------------------------------------------ 표시용
  memberRows() {
    const pl = this.game.player.pos;
    return this.members.map((m) => {
      const w = m.s.weapon;
      return {
        m,
        name: m.callName,
        team: TEAM_NAMES[m.team],
        bearing: fmtBearing(bearingDeg(pl, m.pos)),
        range: fmtRange(Math.hypot(m.pos.x - pl.x, m.pos.z - pl.z)),
        status: m.statusName(),
        rounds: w.totalRounds(),
        mags: w.mags.filter((x) => x.rounds > 0).length, // 탄이 남은 탄창 수
      };
    });
  }

  // 돌격 대기 위치에 있는 기동조 (살아 있고 뛰는 중이 아님)
  atAssault() {
    const A = this.nodes[SQUAD_MAP.assault];
    const R = CONFIG.advanceMission.assaultRadius;
    return this.mobile.filter((m) => m.alive && !m.moving && Math.hypot(m.pos.x - A.x, m.pos.z - A.z) < R);
  }
}

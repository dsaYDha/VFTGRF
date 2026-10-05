// =============================================================================
// AIDirector — 적 배치·이동 시도·엄호사격·정보 공유·증원
//  20~40초마다 적 한 명이 한 단계 앞으로 이동을 시도한다 (건물 → 참호 → 전방 구덩이 → 진출선).
//  출발 3~5초 전부터 다른 적들이 엄호사격을 늘린다 (적 사격이 갑자기 늘면 누군가 움직이려 한다는 단서).
//  출발 조건(제압 25 미만 + 최근 3초간 근처에 탄 없음)이 안 되면 기다리다 포기 → '저지'.
//  적이 전투 불능이 되면 30~60초 뒤 단지 뒤편에서 증원이 와 빈자리를 채운다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { AI_MAP } from '../world/mapData.js';
import { Soldier } from '../units/Soldier.js';
import { EnemyAI } from './EnemyAI.js';
import { Navigation } from './Navigation.js';
import { rand, randRange, pickWeighted } from '../core/Random.js';

export class AIDirector {
  constructor(game, nav) {
    this.game = game;
    this.nav = nav;
    this.ais = [];
    this.plan = null;
    this.pendingShares = [];
    this.reinforcements = [];
    this.attemptSeq = 0;
    this.nameSeq = 0;
    const ev = game.events;
    ev.on(EV.SHOT_FIRED, (e) => {
      if (e.shooter === game.player.body) for (const ai of this.ais) if (ai.s.alive) ai.onPlayerShot(e);
    });
    ev.on(EV.UNIT_SUPPRESSED, (e) => {
      const ai = this.byUnit(e.unit);
      if (ai) ai.onSuppressed(e);
    });
    ev.on(EV.UNIT_INCAPACITATED, (e) => {
      const ai = this.byUnit(e.unit);
      if (!ai) return;
      if (this.plan && this.plan.ai === ai) {
        // 이동하려던 병사가 쓰러짐: 이동 시도는 실패(저지)로 기록
        const moving = !!ai.advance;
        const plan = this.plan;
        this.endPlan(moving ? 'stopped' : 'deterred', true);
        this.game.events.emit(moving ? EV.ADVANCE_STOPPED : EV.ADVANCE_DETERRED, { unit: ai.s, to: plan.to.id, attempt: plan.id, killed: true });
      }
      ai.die();
      this.reinforcements.push({ at: game.time + randRange(CONFIG.mission.reinforcementDelay) });
    });
  }

  byUnit(u) {
    for (const ai of this.ais) if (ai.s === u) return ai;
    return null;
  }

  get alive() {
    return this.ais.filter((a) => a.s.alive);
  }

  reset() {
    for (const ai of this.ais) {
      ai.release();
      ai.s.dispose();
      const i = this.game.units.indexOf(ai.s);
      if (i >= 0) this.game.units.splice(i, 1);
    }
    this.ais = [];
    for (const node of Object.values(this.nav.nodes)) {
      node.occupants.clear();
      for (const fp of node.fps) fp.occupiedBy = null;
    }
    this.plan = null;
    this.pendingShares = [];
    this.reinforcements = [];
    this.attemptSeq = 0;
    this.nameSeq = 0;
    const M = CONFIG.mission;
    this.nextAttempt = this.game.time + randRange(M.firstAdvanceDelay);
    for (const init of AI_MAP.initial) {
      const node = this.nav.nodes[init.node];
      const fp = node.fps[init.fp];
      const ai = this.spawn();
      ai.placeAt(node, fp);
    }
  }

  spawn() {
    const s = new Soldier(this.game, { team: 'enemy', name: `적${++this.nameSeq}` });
    this.game.units.push(s);
    const ai = new EnemyAI(this.game, this, s);
    this.ais.push(ai);
    return ai;
  }

  // 발견 정보 공유 (외침: 지연 + 오차)
  share(from, pos, sigma) {
    if (!CONFIG.ai.shareDelay) return;
    this.pendingShares.push({ from, at: this.game.time + randRange(CONFIG.ai.shareDelay), pos: pos.clone(), sigma });
  }

  // ------------------------------------------------------------------ 이동 시도 계획
  candidates() {
    const out = [];
    for (const ai of this.ais) {
      if (!ai.s.alive || ai.advance || ai.isMoving()) continue;
      if (ai.strandedDest) {
        const to = ai.strandedDest.to;
        if (this.nav.nodeHasRoom(to)) out.push({ ai, to, weight: CONFIG.mission.nodeWeights.open });
        continue;
      }
      const node = ai.node;
      if (!node || !node.next.length) continue;
      const nexts = node.next.map((id) => this.nav.nodes[id]).filter((n) => this.nav.nodeHasRoom(n));
      if (!nexts.length) continue;
      const to = nexts[Math.floor(Math.random() * nexts.length)];
      out.push({ ai, to, weight: CONFIG.mission.nodeWeights[node.kind] ?? 1 });
    }
    return out;
  }

  planAttempt() {
    const c = pickWeighted(this.candidates(), (x) => x.weight);
    if (!c) return false;
    const M = CONFIG.mission;
    const now = this.game.time;
    const lead = randRange(M.coveringFireLead);
    this.plan = {
      id: ++this.attemptSeq,
      ai: c.ai,
      to: c.to,
      from: c.ai.node,
      state: 'pending',
      start: now,
      earliest: now + lead,
      deadline: now + lead + M.abandonAfter,
    };
    c.ai.preparing = true;
    this.game.events.emit(EV.ADVANCE_PLANNED, { unit: c.ai.s, from: c.ai.node ? c.ai.node.id : '개활지', to: c.to.id, attempt: this.plan.id });
    return true;
  }

  // 목적 노드의 빈 사격 위치 중 마지막 경유점(없으면 현재 위치)에서 가장 가까운 곳
  pickDestFp(ai, plan) {
    let ref = ai.pos;
    if (ai.strandedDest) {
      const pts = ai.strandedDest.path;
      if (pts.length > 1) ref = pts[pts.length - 2];
    } else if (ai.node) {
      const e = this.nav.edges[this.nav.edgeKey(ai.node.id, plan.to.id)];
      if (e && e.length) ref = e[e.length - 1];
    }
    let best = null;
    let bd = Infinity;
    for (const fp of plan.to.fps) {
      if (fp.occupiedBy) continue;
      const d = Math.hypot(fp.coverPos.x - ref.x, fp.coverPos.z - ref.z);
      if (d < bd) {
        bd = d;
        best = fp;
      }
    }
    return best;
  }

  depart() {
    const plan = this.plan;
    const ai = plan.ai;
    const destFp = this.pickDestFp(ai, plan);
    if (!destFp) return false;
    let path;
    let startIdx = 0;
    if (ai.strandedDest) {
      path = ai.strandedDest.path;
      startIdx = Math.min(ai.strandedDest.idx, path.length - 1);
      // 목적지 사격 위치는 지금 빈 곳으로
      const last = destFp.coverPos.clone();
      last.bound = false;
      path = path.slice(0, path.length - 1).concat([last]);
      plan.from = ai.strandedDest.from;
    } else {
      path = this.nav.advancePath(ai.node, plan.to, destFp);
    }
    plan.state = 'moving';
    plan.destFp = destFp;
    ai.preparing = false;
    ai.beginAdvance({ from: plan.from, to: plan.to, destFp, path, startIdx, attempt: plan.id });
    this.game.events.emit(EV.ADVANCE_DEPARTED, { unit: ai.s, to: plan.to.id, attempt: plan.id });
    return true;
  }

  endPlan(outcome, silent = false) {
    const plan = this.plan;
    if (!plan) return;
    this.plan = null;
    plan.ai.preparing = false;
    const M = CONFIG.mission;
    const now = this.game.time;
    // 다음 시도까지 최소한의 조용한 시간을 둬서 '사격이 갑자기 늘어나는' 단서가 살아 있게
    this.nextAttempt = Math.max(plan.start + randRange(M.advanceInterval), now + randRange(M.quietBetweenAttempts));
    for (const ai of this.ais) ai.coveringUntil = now + 1.5;
    if (silent) return;
    if (outcome === 'deterred') this.game.events.emit(EV.ADVANCE_DETERRED, { unit: plan.ai.s, to: plan.to.id, attempt: plan.id });
  }

  onAdvanceCompleted(ai, plan) {
    if (this.plan && this.plan.ai === ai) {
      this.endPlan('completed', true);
      this.game.events.emit(EV.ADVANCE_COMPLETED, { unit: ai.s, to: plan.to.id, attempt: plan.attempt });
      if (plan.to.line) this.game.events.emit(EV.ENEMY_REACHED_LINE, { unit: ai.s, node: plan.to.id });
    }
  }

  onAdvanceStopped(ai, plan, pinned) {
    if (this.plan && this.plan.ai === ai) {
      this.endPlan('stopped', true);
      this.game.events.emit(EV.ADVANCE_STOPPED, { unit: ai.s, to: plan.to.id, attempt: plan.attempt, pinned });
    }
  }

  // ------------------------------------------------------------------ 증원
  spawnReinforcement() {
    // 비어 있는 뒤쪽 노드 우선 (건물·잔해·참호)
    const order = ['B1', 'B2', 'R1', 'G1', 'T1', 'T2'];
    let node = null;
    for (const id of order) {
      const n = this.nav.nodes[id];
      if (n && this.nav.nodeHasRoom(n)) {
        node = n;
        break;
      }
    }
    if (!node) return false;
    const fp = this.nav.freeFp(node);
    const sp = AI_MAP.spawnPoints[Math.floor(Math.random() * AI_MAP.spawnPoints.length)];
    const ai = this.spawn();
    const t = this.game.world.terrain;
    ai.pos.set(sp[0], t.heightAt(sp[0], sp[1]), sp[1]);
    const path = [];
    for (const [x, z] of node.approach || []) path.push(new THREE.Vector3(x, t.heightAt(x, z), z));
    path.push(fp.coverPos.clone());
    ai.fp = fp;
    ai.yaw = Math.atan2(path[0].x - sp[0], path[0].z - sp[1]);
    ai.targetYaw = ai.yaw;
    ai.beginTravel(node, fp, path);
    this.game.events.emit(EV.REINFORCEMENT, { unit: ai.s, node: node.id });
    return true;
  }

  // ------------------------------------------------------------------ 갱신
  update(dt) {
    const now = this.game.time;
    const M = CONFIG.mission;
    // 정보 공유
    for (let i = this.pendingShares.length - 1; i >= 0; i--) {
      const sh = this.pendingShares[i];
      if (now < sh.at) continue;
      this.pendingShares.splice(i, 1);
      for (const ai of this.ais) if (ai !== sh.from && ai.s.alive) ai.perception.receiveShared(sh.pos, sh.sigma);
    }
    // 증원
    for (let i = this.reinforcements.length - 1; i >= 0; i--) {
      if (now >= this.reinforcements[i].at && this.alive.length < CONFIG.ai.maxEnemies) {
        if (this.spawnReinforcement()) this.reinforcements.splice(i, 1);
        else this.reinforcements[i].at = now + 5;
      }
    }
    // 이동 시도
    if (!this.plan && now >= this.nextAttempt) {
      if (!this.planAttempt()) this.nextAttempt = now + 5;
    }
    const plan = this.plan;
    if (plan) {
      // 엄호사격: 이동할 병사 외 모두
      for (const ai of this.ais) if (ai !== plan.ai && ai.s.alive && now >= plan.start) ai.coveringUntil = now + 0.5;
      if (plan.state === 'pending') {
        if (!plan.ai.s.alive) this.endPlan('deterred', true);
        else if (now >= plan.earliest && plan.ai.canDepart()) {
          if (!this.depart()) this.endPlan('deterred', true);
        } else if (now > plan.deadline) {
          // 출발을 포기 → 저지
          this.endPlan('deterred');
        }
      }
    }
    for (const ai of this.ais) ai.update(dt);
  }
}

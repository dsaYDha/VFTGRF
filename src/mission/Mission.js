// =============================================================================
// Mission — 1단계 테스트 임무 "이동 저지"
//  진출선(파괴된 장갑차 ↔ 트랙터 잔해)의 엄폐물에 적이 도착하면 '적 진출' 1회.
//  진출 3회 또는 플레이어 전투 불능이면 실패, 5분 버티면 성공.
//  평가는 사살이 아니라 제압 유지율·이동 저지로 한다.
// =============================================================================
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { LEVEL } from '../suppression/Suppressible.js';

export class Mission {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.reset();
    const ev = game.events;
    const isPlayer = (u) => u === game.player.body;
    ev.on(EV.ADVANCE_PLANNED, () => this.running && this.stats.attempts++);
    ev.on(EV.ADVANCE_CANCELLED, () => this.running && this.stats.attempts--);
    ev.on(EV.ADVANCE_DETERRED, () => this.running && this.stats.deterred++);
    ev.on(EV.ADVANCE_STOPPED, () => this.running && this.stats.stopped++);
    ev.on(EV.ADVANCE_COMPLETED, () => this.running && this.stats.completed++);
    ev.on(EV.ENEMY_REACHED_LINE, () => {
      if (!this.running) return;
      this.advances++;
      const M = CONFIG.mission;
      ev.emit(EV.MESSAGE, { text: `적이 진출선에 도달했다 (${this.advances}/${M.maxAdvances})`, kind: 'warn' });
      if (this.advances >= M.maxAdvances) this.end(false, '적이 진출선에 세 번 도달했다');
    });
    ev.on(EV.SHOT_FIRED, (e) => {
      if (this.running && isPlayer(e.shooter)) this.stats.shotsFired++;
    });
    ev.on(EV.BULLET_NEAR_MISS, (e) => {
      if (!this.running || !isPlayer(e.bullet.shooter) || !e.near3m || e.bullet.nearCounted) return;
      e.bullet.nearCounted = true;
      this.stats.nearRounds++;
    });
    ev.on(EV.UNIT_HIT, (e) => {
      if (this.running && isPlayer(e.unit)) this.stats.hitsTaken++;
    });
    ev.on(EV.UNIT_INCAPACITATED, (e) => {
      if (!this.running) return;
      if (isPlayer(e.unit)) {
        this.endDelay = 2.5;
        this.pendingEnd = { success: false, reason: '전투 불능' };
      } else if (e.bullet && isPlayer(e.bullet.shooter)) this.stats.kills++;
    });
  }

  get running() {
    return this.state === 'running';
  }

  reset() {
    this.time = 0;
    this.advances = 0;
    this.pendingEnd = null;
    this.endDelay = 0;
    this.stats = {
      attempts: 0,
      deterred: 0,
      stopped: 0,
      completed: 0,
      shotsFired: 0,
      nearRounds: 0,
      hitsTaken: 0,
      kills: 0,
      aliveTime: 0,
      suppressedTime: 0,
    };
    this.result = null;
  }

  start() {
    this.reset();
    this.state = 'running';
    this.game.events.emit(EV.MISSION_START, {});
    this.game.events.emit(EV.MESSAGE, { text: '임무 시작 — 적이 개활지를 건너오지 못하게 5분간 묶어둬라', kind: 'radio' });
  }

  get remaining() {
    return Math.max(0, CONFIG.mission.duration - this.time);
  }

  update(dt) {
    if (!this.running) return;
    if (this.pendingEnd) {
      this.endDelay -= dt;
      if (this.endDelay <= 0) this.end(this.pendingEnd.success, this.pendingEnd.reason);
      return;
    }
    this.time += dt;
    // 제압 유지율: 살아 있는 적들이 '압박' 이상이었던 시간 비율
    for (const ai of this.game.director.ais) {
      if (!ai.s.alive) continue;
      this.stats.aliveTime += dt;
      if (ai.s.suppression.level >= LEVEL.PRESSURED) this.stats.suppressedTime += dt;
    }
    if (this.time >= CONFIG.mission.duration) this.end(true, '5분간 적의 이동을 저지했다');
  }

  end(success, reason) {
    if (!this.running) return;
    this.state = 'ended';
    const s = this.stats;
    const w = this.game.player.weapon;
    this.result = {
      success,
      reason,
      time: this.time,
      uptime: s.aliveTime > 0 ? s.suppressedTime / s.aliveTime : 0,
      attempts: s.attempts,
      blocked: s.deterred + s.stopped,
      deterred: s.deterred,
      stopped: s.stopped,
      advances: this.advances,
      shotsFired: s.shotsFired,
      magsUsed: s.shotsFired / w.def.magCapacity,
      roundsLeft: w.totalRounds(),
      nearRatio: s.shotsFired > 0 ? s.nearRounds / s.shotsFired : 0,
      nearRounds: s.nearRounds,
      hitsTaken: s.hitsTaken,
      kills: s.kills,
    };
    this.game.events.emit(EV.MISSION_END, this.result);
  }
}

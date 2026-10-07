// =============================================================================
// AdvanceMission — 2단계 임무 "약진 엄호"
//  기동조(분대장·1번 / 2번·3번)가 수로에서 개활지를 건너 돌격 대기 위치(참호 전방 구덩이 지대)까지 약진한다.
//  플레이어와 4번은 수로에서 엄호. 기동조 2명 이상이 돌격 대기 위치에서 30초 버티면 성공.
//  실패: 기동조 3명 전투 불능 / 플레이어 전투 불능 / 플레이어 탄에 아군 전투 불능 / 12분 초과.
//  핵심 평가: 약진하는 동안 그 구간에 사선이 닿는 적이 압박 이상이었던 비율 (위협 제압률).
// =============================================================================
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';

export const BRIEFING_ADVANCE =
  '기동조가 개활지를 건너 적 참호 앞 구덩이 지대까지 약진한다. 너와 4번은 수로에서 엄호한다. 놈들이 고개를 못 들게 해라. 아군이 사선에 들어오면 사격을 옮겨라.';

export class AdvanceMission {
  constructor(game) {
    this.game = game;
    this.id = 'advance';
    this.title = '약진 엄호';
    this.state = 'idle';
    this.reset();
    const ev = game.events;
    const isPlayer = (u) => u === game.player.body;
    ev.on(EV.SHOT_FIRED, (e) => {
      if (this.running && isPlayer(e.shooter)) this.stats.shotsFired++;
    });
    ev.on(EV.BULLET_NEAR_MISS, (e) => {
      if (!this.running || !isPlayer(e.bullet.shooter) || !e.near3m || e.bullet.nearCounted) return;
      if (e.target.team !== 'enemy') return;
      e.bullet.nearCounted = true;
      this.stats.nearRounds++;
    });
    ev.on(EV.UNIT_HIT, (e) => {
      if (this.running && isPlayer(e.unit)) this.stats.hitsTaken++;
    });
    ev.on(EV.UNIT_INCAPACITATED, (e) => {
      if (!this.running || this.pendingEnd) return;
      const sq = game.squad;
      if (isPlayer(e.unit)) {
        this.finishLater(false, '전투 불능');
        return;
      }
      if (e.unit.team === 'enemy') {
        if (e.bullet && isPlayer(e.bullet.shooter)) this.stats.kills++;
        return;
      }
      const m = sq.memberOf(e.unit);
      if (!m) return;
      if (e.bullet && isPlayer(e.bullet.shooter)) {
        this.finishLater(false, `내 탄에 ${m.callName}이 쓰러졌다`);
        return;
      }
      const lost = sq.mobile.filter((x) => !x.alive).length;
      if (lost >= CONFIG.advanceMission.maxMobileLosses) this.finishLater(false, `기동조 ${lost}명 전투 불능`);
    });
    ev.on(EV.SQUAD_BOUND_END, (e) => {
      if (this.running && e.node === 'A' && e.members.length) {
        ev.emit(EV.MESSAGE, { text: `돌격 대기 위치 도착 — ${CONFIG.advanceMission.assaultHoldTime}초 버텨라`, kind: 'radio' });
      }
    });
  }

  get running() {
    return this.state === 'running';
  }

  reset() {
    this.time = 0;
    this.pendingEnd = null;
    this.endDelay = 0;
    this.holdTime = 0;
    this.advances = 0; // (1단계 HUD 호환)
    this.stats = { shotsFired: 0, nearRounds: 0, hitsTaken: 0, kills: 0 };
    this.result = null;
  }

  start() {
    this.reset();
    this.state = 'running';
    this.game.events.emit(EV.MISSION_START, { id: this.id });
    this.game.events.emit(EV.MESSAGE, { text: '임무 시작 — 기동조가 돌격 대기 위치까지 가도록 엄호하라', kind: 'radio' });
  }

  get remaining() {
    return Math.max(0, CONFIG.advanceMission.timeLimit - this.time);
  }

  // HUD 오른쪽 위 한 줄 상태
  get statusText() {
    const sq = this.game.squad;
    const st = sq.stats;
    if (this.holdTime > 0) return `돌격 대기 위치 ${Math.floor(this.holdTime)} / ${CONFIG.advanceMission.assaultHoldTime}초`;
    const n1 = sq.nodes[sq.route[sq.teamIdx[1]]];
    const n2 = sq.nodes[sq.route[sq.teamIdx[2]]];
    return `약진 ${st.bounds}회 · 1조 ${n1 ? n1.name : '-'} · 2조 ${n2 ? n2.name : '-'}${sq.halted ? ' · 정지' : ''}`;
  }

  finishLater(success, reason) {
    if (this.pendingEnd) return;
    this.pendingEnd = { success, reason };
    this.endDelay = CONFIG.advanceMission.endDelay;
  }

  update(dt) {
    if (!this.running) return;
    if (this.pendingEnd) {
      this.endDelay -= dt;
      if (this.endDelay <= 0) this.end(this.pendingEnd.success, this.pendingEnd.reason);
      return;
    }
    this.time += dt;
    const M = CONFIG.advanceMission;
    const at = this.game.squad.atAssault();
    if (at.length >= M.minAtAssault) {
      this.holdTime += dt;
      if (this.holdTime >= M.assaultHoldTime) {
        this.end(true, `기동조 ${at.length}명이 돌격 대기 위치를 확보했다`);
        return;
      }
    } else this.holdTime = 0;
    if (this.time >= M.timeLimit) this.end(false, '12분 안에 돌격 대기 위치에 닿지 못했다');
  }

  end(success, reason) {
    if (!this.running) return;
    this.state = 'ended';
    const s = this.stats;
    const sq = this.game.squad;
    const q = sq.stats;
    const w = this.game.player.weapon;
    this.result = {
      mission: this.id,
      success,
      reason,
      time: this.time,
      threatRate: q.threatTime > 0 ? q.threatSuppressedTime / q.threatTime : 0,
      threatTime: q.threatTime,
      bounds: q.bounds,
      gRequests: q.gRequests,
      gBlocked: q.gBlocked,
      losses: q.losses,
      mobileLosses: q.mobileLosses,
      coverTeamHits: q.coverTeamHits,
      playerNearFriend: q.playerNearFriend,
      friendlyHitsByPlayer: q.friendlyHitsByPlayer,
      friendlyKilledByPlayer: q.friendlyKilledByPlayer,
      shiftFireCalls: q.shiftFireCalls,
      shotsFired: s.shotsFired,
      magsUsed: s.shotsFired / w.def.magCapacity,
      roundsLeft: w.totalRounds(),
      nearRatio: s.shotsFired > 0 ? s.nearRounds / s.shotsFired : 0,
      nearRounds: s.nearRounds,
      hitsTaken: s.hitsTaken,
      kills: s.kills,
      atAssault: sq.atAssault().length,
    };
    this.game.events.emit(EV.MISSION_END, this.result);
  }
}

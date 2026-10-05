// =============================================================================
// HUD (최소한) — 나침반 띠, 잔탄 확인(대략), 사격 모드, 가늠자 거리, 자세, 부상, 남은 시간, 짧은 메시지
// 적 위치 표시·미니맵·크로스헤어는 없다.
// =============================================================================
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { yawToBearing } from '../core/mathUtils.js';

const AMMO_TEXT = {
  full: '가득',
  halfPlus: '절반 이상',
  halfMinus: '절반 미만',
  almostEmpty: '거의 없음',
  empty: '비었음',
  none: '탄창 없음',
};
const ZONE_TEXT = { arm: '팔', leg: '다리' };

export class HUD {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.compass = $('compass');
    this.cctx = this.compass.getContext('2d');
    this.timer = $('hud-timer');
    this.advances = $('hud-advances');
    this.posture = $('hud-posture');
    this.wound = $('hud-wound');
    this.staminaBar = $('hud-stamina-bar');
    this.ammo = $('hud-ammo-check');
    this.fireMode = $('hud-firemode');
    this.sight = $('hud-sight');
    this.rested = $('hud-rested');
    this.messages = $('hud-messages');
    this.boundary = $('hud-boundary');
    this.lastBearing = -999;
    this.ammoTimer = 0;
    this.ammoPending = null;
    this.cache = {};
    const ev = game.events;
    ev.on(EV.MESSAGE, (m) => this.message(m.text, m.kind));
    ev.on(EV.AMMO_CHECK, (e) => {
      if (e.owner !== game.player.body) return;
      // 탄창을 빼 보는 데 잠깐 걸린다
      this.ammoPending = { at: game.time + CONFIG.hud.ammoCheckDelay, e };
    });
    ev.on(EV.RELOAD_START, (e) => {
      if (e.owner === game.player.body) this.message(e.empty ? '재장전 (노리쇠 후퇴)' : '재장전', 'info', 1.6);
    });
    ev.on(EV.BOUNDARY, (e) => {
      if (e.state === 'warn' || e.state === 'near') this.boundary.textContent = e.state === 'warn' ? '작전 구역을 벗어났다 — 돌아가라' : '작전 구역 경계';
      else this.boundary.textContent = '';
      if (e.state === 'return') this.message('작전 구역으로 되돌아왔다', 'warn');
    });
    ev.on(EV.UNIT_HIT, (e) => {
      if (e.unit !== game.player.body) return;
      if (e.result === 'plate') this.message('방탄판 피격 — 충격으로 쓰러졌다', 'warn');
      else if (e.result === 'wounded') this.message(`부상: ${ZONE_TEXT[e.zone] || '팔다리'}`, 'warn');
    });
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  // 새 임무 시작 시 이전 판의 표시 정리
  reset() {
    this.ammoPending = null;
    this.ammoTimer = 0;
    this.ammo.classList.remove('show');
    this.boundary.textContent = '';
    this.messages.textContent = '';
    this.rested.classList.remove('show');
  }

  set(el, key, text) {
    if (this.cache[key] !== text) {
      this.cache[key] = text;
      el.textContent = text;
    }
  }

  message(text, kind = 'info', time = CONFIG.hud.messageTime) {
    const d = document.createElement('div');
    d.className = 'msg ' + kind;
    d.textContent = text;
    this.messages.appendChild(d);
    while (this.messages.children.length > 4) this.messages.removeChild(this.messages.firstChild);
    setTimeout(() => {
      d.style.opacity = '0';
      setTimeout(() => d.remove(), 700);
    }, time * 1000);
  }

  update(dt) {
    const g = this.game;
    const pl = g.player;
    const w = pl.weapon;
    const m = g.mission;
    // 남은 시간·진출 횟수
    const rem = Math.ceil(m.remaining);
    this.set(this.timer, 'timer', `${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}`);
    this.set(this.advances, 'adv', `적 진출 ${m.advances} / ${CONFIG.mission.maxAdvances}`);
    // 자세·부상·스태미나
    let pst = pl.postureName();
    if (Math.abs(pl.lean) > 0.4) pst += pl.lean > 0 ? ' · 오른쪽 기울임' : ' · 왼쪽 기울임';
    this.set(this.posture, 'posture', pst);
    const dmg = pl.body.damage;
    const knocked = dmg.isKnockedDown(g.time);
    const wt = dmg.incapacitated ? '전투 불능' : knocked ? '쓰러짐' : dmg.wounded ? `부상 (${ZONE_TEXT[dmg.woundZone] || '팔다리'})` : '이상 없음';
    this.set(this.wound, 'wound', wt);
    this.wound.classList.toggle('hurt', dmg.wounded || knocked || dmg.incapacitated);
    this.staminaBar.style.width = `${(pl.stamina / CONFIG.player.stamina.max) * 100}%`;
    // 무기
    this.set(this.fireMode, 'mode', w.fireMode === 'semi' ? '단발' : '연발');
    this.set(this.sight, 'sight', `가늠자 ${w.sightRange}m`);
    this.rested.classList.toggle('show', pl.rested && pl.restKind !== 'prone');
    // 잔탄 확인 (T)
    if (this.ammoPending && g.time >= this.ammoPending.at) {
      const e = this.ammoPending.e;
      this.ammoPending = null;
      const partial = e.partial > 0 ? ` (쓰던 것 ${e.partial})` : '';
      this.ammo.textContent = `탄창: ${AMMO_TEXT[e.level]} · 예비 탄창 ${e.spare}개${partial}`;
      this.ammo.classList.add('show');
      this.ammoTimer = CONFIG.hud.ammoCheckTime;
    }
    if (this.ammoTimer > 0) {
      this.ammoTimer -= dt;
      if (this.ammoTimer <= 0) this.ammo.classList.remove('show');
    }
    this.drawCompass();
  }

  drawCompass() {
    const pl = this.game.player;
    const bearing = yawToBearing(pl.yaw);
    if (Math.abs(bearing - this.lastBearing) < 0.05) return;
    this.lastBearing = bearing;
    const c = this.cctx;
    const W = this.compass.width;
    const H = this.compass.height;
    const fov = CONFIG.hud.compassFovDeg;
    const pxPerDeg = W / fov;
    c.clearRect(0, 0, W, H);
    const grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.15, 'rgba(0,0,0,0.32)');
    grad.addColorStop(0.85, 'rgba(0,0,0,0.32)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.fillRect(0, 4, W, 22);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const start = Math.floor((bearing - fov / 2) / 5) * 5;
    for (let d = start; d <= bearing + fov / 2; d += 5) {
      const x = W / 2 + (d - bearing) * pxPerDeg;
      const deg = ((d % 360) + 360) % 360;
      const edge = 1 - Math.abs(x - W / 2) / (W / 2);
      const alpha = Math.max(0, Math.min(1, edge * 1.8));
      c.strokeStyle = `rgba(230,226,212,${alpha})`;
      c.fillStyle = `rgba(230,226,212,${alpha})`;
      const major = deg % 15 === 0;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + 0.5, 6);
      c.lineTo(x + 0.5, major ? 14 : 10);
      c.stroke();
      if (major) {
        const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
        const label = names[deg] ?? String(deg);
        c.font = names[deg] !== undefined ? 'bold 13px sans-serif' : '11px sans-serif';
        c.fillText(label, x, 20);
      }
    }
    // 중앙 표시와 현재 방위각
    c.fillStyle = 'rgba(240,236,220,0.95)';
    c.beginPath();
    c.moveTo(W / 2 - 5, 28);
    c.lineTo(W / 2 + 5, 28);
    c.lineTo(W / 2, 23);
    c.fill();
    c.font = '12px monospace';
    c.fillText(String(Math.round(bearing) % 360).padStart(3, '0') + '°', W / 2, 38);
  }
}

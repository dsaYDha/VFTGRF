// =============================================================================
// HUD (최소한) — 나침반 띠, 잔탄 확인(대략), 사격 모드, 가늠자 거리, 자세, 부상, 남은 시간, 짧은 메시지
// 적 위치 표시·미니맵·크로스헤어는 없다.
// 2단계: 분대 콜아웃 자막 (화면 아래 가운데, EV.CALLOUT), 탄약 상자 탄창 채우기 안내·진행 (오른쪽 아래)
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
// 탄창 채우기가 멈춘 이유 → 메시지 (없으면 표시 안 함)
const REFILL_STOP_TEXT = {
  done: ['예비 탄창을 모두 채웠다', 'info'],
  empty: ['탄약 상자가 비었다', 'warn'],
  cancel: ['탄창 채우기 중단', 'info'],
  moved: ['탄약 상자에서 멀어졌다 — 탄창 채우기 중단', 'info'],
  sprint: ['탄창 채우기 중단', 'info'],
  fire: ['탄창 채우기 중단', 'info'],
  reload: ['탄창 채우기 중단', 'info'],
};

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
    this.calloutBox = $('hud-callouts');
    this.calloutLines = []; // {el, speaker, text, until, fading, removeAt}
    this.refillBox = $('hud-refill');
    this.refillKey = $('hud-refill-key');
    this.refillText = $('hud-refill-text');
    this.refillBar = $('hud-refill-bar');
    this.refillFill = $('hud-refill-fill');
    this.lastBearing = -999;
    this.ammoTimer = 0;
    this.ammoPending = null;
    this.cache = {};
    const ev = game.events;
    ev.on(EV.MESSAGE, (m) => this.message(m.text, m.kind));
    ev.on(EV.AMMO_CHECK, (e) => {
      if (e.owner !== game.player.body || this.playerDown()) return;
      // 탄창을 빼 보는 데 잠깐 걸린다
      this.ammoPending = { at: game.time + CONFIG.hud.ammoCheckDelay, e };
    });
    ev.on(EV.RELOAD_START, (e) => {
      if (e.owner === game.player.body) this.message(e.empty ? '재장전 (노리쇠 후퇴)' : '재장전', 'info', 1.6);
    });
    ev.on(EV.BOUNDARY, (e) => {
      if (this.playerDown()) return;
      if (e.state === 'warn' || e.state === 'near') this.boundary.textContent = e.state === 'warn' ? '작전 구역을 벗어났다 — 돌아가라' : '작전 구역 경계';
      else this.boundary.textContent = '';
      if (e.state === 'return') this.message('작전 구역으로 되돌아왔다', 'warn');
    });
    ev.on(EV.UNIT_HIT, (e) => {
      if (e.unit !== game.player.body) return;
      if (e.result === 'plate') this.message('방탄판 피격 — 충격으로 쓰러졌다', 'warn');
      else if (e.result === 'wounded') this.message(`부상: ${ZONE_TEXT[e.zone] || '팔다리'}`, 'warn');
    });
    // 전투 불능: 떠 있던 상황 메시지·경계 경고·잔탄 표시를 바로 지운다
    ev.on(EV.UNIT_INCAPACITATED, (e) => {
      if (e.unit === game.player.body) this.clearSituational();
    });
    // 2단계: 분대 콜아웃 자막, 탄창 채우기 결과
    ev.on(EV.CALLOUT, (c) => this.callout(c));
    ev.on(EV.AMMO_REFILL, (e) => {
      if (e.owner !== game.player.body || e.step !== 'stop') return;
      const m = REFILL_STOP_TEXT[e.reason];
      if (m) this.message(m[0], m[1], 2.2);
    });
  }

  // 플레이어 전투 불능 (이후 상황 메시지를 띄우지 않는다)
  playerDown() {
    return this.game.player.body.damage.incapacitated;
  }

  clearSituational() {
    this.ammoPending = null;
    this.ammoTimer = 0;
    this.ammo.classList.remove('show');
    this.boundary.textContent = '';
    this.messages.textContent = '';
    this.rested.classList.remove('show');
    this.clearCallouts();
    this.hideRefill();
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
    this.clearCallouts();
    this.hideRefill();
  }

  // ------------------------------------------------------------------ 2단계: 분대 콜아웃 자막
  // "[분대장] 2조 이동!" — 새 줄이 아래, 최대 callouts.maxLines 줄 (넘치면 가장 오래된 줄을 바로 뺀다).
  // 같은 줄이 연달아 오면 새 줄을 만들지 않고 시간만 늘린다. 시간은 게임 시간 (일시정지 중에는 멈춤)
  callout(c) {
    if (!c || !c.text || this.playerDown()) return;
    const C = CONFIG.callouts;
    const now = this.game.time;
    const speaker = c.speaker ? String(c.speaker) : '';
    const text = String(c.text);
    const lines = this.calloutLines;
    const last = lines[lines.length - 1];
    if (last && last.speaker === speaker && last.text === text) {
      last.until = now + C.time;
      if (last.fading) {
        last.fading = false;
        last.el.classList.remove('out');
      }
      return;
    }
    const kind = c.kind === 'warn' || c.kind === 'alert' ? c.kind : 'info';
    const el = document.createElement('div');
    el.className = `callout ${kind}${c.radio === false ? ' voice' : ' radio'}`;
    el.style.transitionDuration = `${C.fade}s`;
    if (speaker) {
      const s = document.createElement('span');
      s.className = 'spk';
      s.textContent = `[${speaker}]`;
      el.appendChild(s);
      el.appendChild(document.createTextNode(' '));
    }
    const t = document.createElement('span');
    t.className = 'txt';
    t.textContent = text;
    el.appendChild(t);
    this.calloutBox.appendChild(el);
    lines.push({ el, speaker, text, until: now + C.time, fading: false, removeAt: 0 });
    while (lines.length > C.maxLines) lines.shift().el.remove();
  }

  updateCallouts() {
    const lines = this.calloutLines;
    if (!lines.length) return;
    const now = this.game.time;
    for (let i = lines.length - 1; i >= 0; i--) {
      const L = lines[i];
      if (!L.fading) {
        if (now >= L.until) {
          L.fading = true;
          L.removeAt = now + CONFIG.callouts.fade;
          L.el.classList.add('out');
        }
      } else if (now >= L.removeAt) {
        L.el.remove();
        lines.splice(i, 1);
      }
    }
  }

  clearCallouts() {
    for (const L of this.calloutLines) L.el.remove();
    this.calloutLines.length = 0;
    this.calloutBox.textContent = '';
  }

  hideRefill() {
    this.refillBox.classList.remove('show');
    this.cache.refillShow = false;
  }

  // ------------------------------------------------------------------ 2단계: 탄약 상자 (오른쪽 아래)
  // 채우는 중: "탄창 채우는 중 2/7 · 상자 270발" + 지금 탄창 진행 막대 / 상자 옆(채울 탄창이 있을 때): "F 탄창 채우기 (상자 300발)"
  updateRefill() {
    const g = this.game;
    const pl = g.player;
    const rf = pl.refill;
    const crate = g.ammoCrate && g.ammoCrate.active ? g.ammoCrate : null;
    let text = '';
    let prompt = false;
    let prog = -1;
    if (rf && crate && !this.playerDown()) {
      if (rf.active) {
        const total = Math.max(1, rf.toFill);
        text = `탄창 채우는 중 ${Math.min(rf.filled + 1, total)}/${total} · 상자 ${crate.rounds}발`;
        prog = rf.currentMagRounds() / pl.weapon.def.magCapacity;
      } else if (rf.near && pl.weapon.spareNeedsRefill()) {
        if (crate.rounds > 0) {
          text = `탄창 채우기 (상자 ${crate.rounds}발)`;
          prompt = true;
        } else text = '탄약 상자 비었음';
      }
    }
    const show = text !== '';
    if (this.cache.refillShow !== show) {
      this.cache.refillShow = show;
      this.refillBox.classList.toggle('show', show);
    }
    if (!show) return;
    this.set(this.refillText, 'refill', text);
    if (this.cache.refillPrompt !== prompt) {
      this.cache.refillPrompt = prompt;
      this.refillKey.classList.toggle('hidden', !prompt);
    }
    const bar = prog >= 0;
    if (this.cache.refillBar !== bar) {
      this.cache.refillBar = bar;
      this.refillBar.classList.toggle('hidden', !bar);
    }
    if (bar) this.refillFill.style.width = `${Math.round(Math.min(1, prog) * 100)}%`;
  }

  set(el, key, text) {
    if (this.cache[key] !== text) {
      this.cache[key] = text;
      el.textContent = text;
    }
  }

  message(text, kind = 'info', time = CONFIG.hud.messageTime) {
    if (this.playerDown()) return;
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
    // 오른쪽 위 임무 상태 (1단계: 적 진출 횟수, 2단계: 약진·조 위치·돌격 대기 시간)
    this.set(this.advances, 'adv', m.statusText);
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
    this.rested.classList.toggle('show', pl.rested && pl.restKind !== 'prone' && !dmg.incapacitated);
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
    this.updateCallouts();
    this.updateRefill();
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

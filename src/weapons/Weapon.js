// =============================================================================
// Weapon — 무기 정의(config.weapons)만으로 동작하는 총.
//  탄창마다 잔탄을 따로 기억, 약실 상태(빠른/느린 재장전), 마지막 N발 예광탄,
//  단발/연발, 연사 속도, 가늠자 거리.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { gauss } from '../core/Random.js';

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

// 방향 벡터에 원뿔형 분산 (표준편차 rad) 적용
export function applyDispersion(dir, sigma) {
  if (sigma <= 0) return dir;
  // dir 에 수직인 두 축
  if (Math.abs(dir.y) < 0.95) _t1.set(0, 1, 0);
  else _t1.set(1, 0, 0);
  _t2.crossVectors(dir, _t1).normalize();
  _t1.crossVectors(_t2, dir).normalize();
  const a = gauss() * sigma;
  const b = gauss() * sigma;
  dir.addScaledVector(_t1, a).addScaledVector(_t2, b).normalize();
  return dir;
}

export class Weapon {
  constructor(game, def, owner, opts = {}) {
    this.game = game;
    this.def = def;
    this.owner = owner;
    this.ammo = CONFIG.ammo[def.ammo];
    this.spareCount = opts.spareMags ?? def.spareMags;
    this.reset();
  }

  reset() {
    const def = this.def;
    this.mags = [];
    for (let i = 0; i < this.spareCount + 1; i++) this.mags.push({ rounds: def.magCapacity });
    this.magIndex = 0;
    this.chambered = false;
    this.chamberTracer = false;
    this.feed();
    this.fireMode = def.defaultFireMode;
    this.sightRange = def.defaultSightRange;
    this.cooldown = 0;
    this.triggerDown = false;
    this.semiLatched = false;
    this.reload = null;
    this.shotsFired = 0;
    this.burst = 0; // 연발 연속 발수
    this.lastShotTime = -99;
  }

  get mag() {
    return this.magIndex >= 0 ? this.mags[this.magIndex] : null;
  }

  // 탄창에서 약실로 한 발 (마지막 N발은 예광탄)
  feed() {
    const m = this.mag;
    if (m && m.rounds > 0) {
      this.chamberTracer = m.rounds <= this.def.tracerLastRounds;
      m.rounds--;
      this.chambered = true;
    } else {
      this.chambered = false;
      this.chamberTracer = false;
    }
  }

  get reloading() {
    return !!this.reload;
  }

  canFire() {
    return this.chambered && !this.reload && this.cooldown <= 0;
  }

  // 플레이어 방아쇠: 이번 프레임에 쏴야 하면 true
  triggerWantsShot(down) {
    const wasDown = this.triggerDown;
    this.triggerDown = down;
    if (!down) {
      this.semiLatched = false;
      this.burst = 0;
      return false;
    }
    if (this.reload) return false;
    if (!this.chambered) {
      if (!wasDown) this.game.events.emit(EV.DRY_FIRE, { owner: this.owner });
      return false;
    }
    if (this.cooldown > 0) return false;
    if (this.fireMode === 'semi') {
      if (this.semiLatched) return false;
      this.semiLatched = true;
      return true;
    }
    return true;
  }

  // 실제 발사. dir 은 수정됨 (총 자체 분산 포함)
  discharge(origin, dir, opts = {}) {
    if (!this.canFire()) return null;
    const isTracer = this.chamberTracer;
    applyDispersion(dir, (this.def.dispersionMrad / 1000) * (opts.dispersionMul || 1));
    const speed = this.ammo.muzzleVelocity * (0.99 + Math.random() * 0.02);
    const bullet = this.game.ballistics.spawn({
      origin,
      dir,
      speed,
      ammo: this.ammo,
      shooter: this.owner,
      team: this.owner.team,
      isTracer,
    });
    this.chambered = false;
    this.feed();
    this.cooldown = 60 / this.def.rpm;
    this.shotsFired++;
    const now = this.game.time;
    this.burst = now - this.lastShotTime < (60 / this.def.rpm) * 1.6 ? this.burst + 1 : 1;
    this.lastShotTime = now;
    this.game.events.emit(EV.SHOT_FIRED, {
      shooter: this.owner,
      team: this.owner.team,
      weapon: this,
      origin: opts.muzzle || origin,
      dir,
      isTracer,
      bullet,
      burstIndex: this.burst,
      muzzleNearGround: opts.muzzleNearGround || false,
    });
    return bullet;
  }

  startReload() {
    if (this.reload) return false;
    // 가장 많이 남은 예비 탄창
    let best = -1;
    for (let i = 0; i < this.mags.length; i++) {
      if (i === this.magIndex) continue;
      if (this.mags[i].rounds > 0 && (best < 0 || this.mags[i].rounds > this.mags[best].rounds)) best = i;
    }
    if (best < 0) return false;
    const cur = this.mag;
    if (cur && cur.rounds >= this.def.magCapacity && this.chambered) return false; // 이미 가득
    const empty = !this.chambered;
    const duration = empty ? this.def.reloadEmptyTime : this.def.reloadTime;
    // 동작 시점 (비율)
    const steps = [
      { at: 0.1, name: 'magOut' },
      { at: 0.36, name: 'pouch' },
      { at: 0.62, name: 'magIn' },
    ];
    if (empty) {
      steps[0].at = 0.08;
      steps[1].at = 0.27;
      steps[2].at = 0.47;
      steps.push({ at: 0.7, name: 'boltBack' }, { at: 0.8, name: 'boltForward' });
    }
    this.reload = { t: 0, duration, empty, steps, next: 0, newMag: best };
    this.game.events.emit(EV.RELOAD_START, { owner: this.owner, empty, duration });
    return true;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    const r = this.reload;
    if (!r) return;
    r.t += dt;
    const frac = r.t / r.duration;
    while (r.next < r.steps.length && frac >= r.steps[r.next].at) {
      const step = r.steps[r.next++];
      if (step.name === 'magOut') {
        // 쓰던 탄창은 남은 탄과 함께 파우치로
        this.magIndex = -1;
        this.prevMag = r.newMag;
      } else if (step.name === 'magIn') {
        this.magIndex = r.newMag;
      } else if (step.name === 'boltForward') {
        this.feed();
      }
      this.game.events.emit(EV.RELOAD_STEP, { owner: this.owner, step: step.name });
    }
    if (frac >= 1) {
      if (this.magIndex < 0) this.magIndex = r.newMag;
      if (!this.chambered && !r.empty) this.feed();
      this.reload = null;
      this.game.events.emit(EV.RELOAD_END, { owner: this.owner });
    }
  }

  toggleFireMode() {
    const modes = this.def.fireModes;
    const i = modes.indexOf(this.fireMode);
    this.fireMode = modes[(i + 1) % modes.length];
    this.game.events.emit(EV.FIRE_MODE, { owner: this.owner, mode: this.fireMode });
  }

  adjustSight(delta) {
    const list = this.def.sightRanges;
    let i = list.indexOf(this.sightRange);
    if (i < 0) i = 0;
    const ni = Math.max(0, Math.min(list.length - 1, i + delta));
    if (ni !== i) {
      this.sightRange = list[ni];
      this.game.events.emit(EV.SIGHT_RANGE, { owner: this.owner, range: this.sightRange });
    }
  }

  // 잔탄 확인: 정확한 숫자 대신 대략적인 상태
  ammoStatus() {
    const m = this.mag;
    const inMag = (m ? m.rounds : 0) + (this.chambered ? 1 : 0);
    const cap = this.def.magCapacity;
    let level;
    if (!m && !this.chambered) level = 'none';
    else if (inMag >= cap - 1) level = 'full';
    else if (inMag >= cap / 2) level = 'halfPlus';
    else if (inMag > cap * 0.2) level = 'halfMinus';
    else if (inMag > 0) level = 'almostEmpty';
    else level = 'empty';
    let spare = 0;
    let partial = 0;
    for (let i = 0; i < this.mags.length; i++) {
      if (i === this.magIndex) continue;
      if (this.mags[i].rounds > 0) {
        spare++;
        if (this.mags[i].rounds < cap) partial++;
      }
    }
    return { level, spare, partial };
  }

  totalRounds() {
    let n = this.chambered ? 1 : 0;
    for (const m of this.mags) n += m.rounds;
    return n;
  }

  // ------------------------------------------------------------------ 탄창 채우기 (2단계 탄약 상자, world/AmmoCrate.js)
  // 총에 꽂힌 탄창은 채우지 않는다. 재장전 중(탄창이 빠져 있는 동안)에는 아무것도 하지 않는다

  // 가장 덜 찬 예비 탄창 번호 (가득 차지 않은 것 중), 없으면 -1
  emptiestSpareMag() {
    if (this.reload) return -1;
    const cap = this.def.magCapacity;
    let best = -1;
    for (let i = 0; i < this.mags.length; i++) {
      if (i === this.magIndex || this.mags[i].rounds >= cap) continue;
      if (best < 0 || this.mags[i].rounds < this.mags[best].rounds) best = i;
    }
    return best;
  }

  // 예비 탄창에 탄 n 발을 넣는다 (기본: 가장 덜 찬 예비 탄창). 탄창 용량까지만 → 실제로 넣은 수
  addRoundsToMag(n, index = this.emptiestSpareMag()) {
    if (this.reload || index < 0 || index === this.magIndex || !this.mags[index]) return 0;
    const m = this.mags[index];
    const k = Math.max(0, Math.min(Math.floor(n), this.def.magCapacity - m.rounds));
    m.rounds += k;
    return k;
  }

  // 가득 차지 않은 예비 탄창이 있는지
  spareNeedsRefill() {
    return this.emptiestSpareMag() >= 0;
  }

  // 가득 차지 않은 예비 탄창 수
  spareMagsNotFull() {
    const cap = this.def.magCapacity;
    let n = 0;
    for (let i = 0; i < this.mags.length; i++) if (i !== this.magIndex && this.mags[i].rounds < cap) n++;
    return n;
  }
}

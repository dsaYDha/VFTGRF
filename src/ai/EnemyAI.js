// =============================================================================
// EnemyAI — 적 병사 1명의 행동 (1단계 기본형)
//  기본 순환: 엄폐 대기 → 관측(고개 내밀기) → 사격(단발/점사) → 엄폐 → (사격 위치 변경)
//  제압 단계: 정상(모두 가능) / 압박(노출 짧게·명중률 절반·새 이동 없음)
//             / 제압(엄폐 유지·맹목 사격만) / 고착(사격·이동 불가, 웅크림·즉시 엎드림)
//  관측·사격 중 근접탄을 받으면 즉시 몸을 숙인다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { LEVEL, LEVEL_NAMES } from '../suppression/Suppressible.js';
import { Perception } from './Perception.js';
import { rand, randRange, randInt, chance, gauss } from '../core/Random.js';
import { applyDispersion } from '../weapons/Weapon.js';
import { elevationInterp } from '../weapons/zeroing.js';
import { dampAngle, wrapAngle } from '../core/mathUtils.js';

const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();

export const STATE_NAMES = {
  cover: '엄폐',
  observe: '관측',
  fire: '사격',
  blindfire: '맹목사격',
  reposition: '위치변경',
  advance: '이동 중',
  pinned: '고착',
  knockdown: '쓰러짐',
  dead: '전투불능',
  travel: '증원 이동',
  dive: '엎드림',
};

export class EnemyAI {
  constructor(game, director, soldier) {
    this.game = game;
    this.director = director;
    this.nav = director.nav;
    this.s = soldier;
    this.perception = new Perception(game, soldier);
    this.state = 'cover';
    this.stateT = 0;
    this.timer = 0;
    this.exposed = false;
    this.node = null;
    this.fp = null;
    this.yaw = 0;
    this.targetYaw = 0;
    this.pendingReposition = false;
    this.blindTimer = randRange(CONFIG.ai.blindFireInterval);
    this.lastNearRound = -99;
    this.coveringUntil = -1;
    this.advance = null; // 진행 중 이동
    this.strandedDest = null; // 이동 중 고착되어 멈춘 경우 원래 목적지
    this.path = null;
    this.pathIdx = 0;
    this.posTarget = new THREE.Vector3();
    this.firedThisCycle = false;
    this.decidedFire = null;
    this.shots = 0;
    this.shotTimer = 0;
    this.burstIndex = 0;
  }

  get level() {
    return this.s.suppression.level;
  }

  get covering() {
    return this.game.time < this.coveringUntil;
  }

  get pos() {
    return this.s.position;
  }

  isMoving() {
    return this.state === 'advance' || this.state === 'reposition' || this.state === 'travel' || this.state === 'dive';
  }

  statusName() {
    if (!this.s.alive) return '전투불능';
    if (this.state === 'advance' || this.state === 'dive') return '이동 중';
    return LEVEL_NAMES[this.level];
  }

  // ------------------------------------------------------------------ 위치 지정
  occupy(node, fp) {
    if (this.fp && this.fp.occupiedBy === this) this.fp.occupiedBy = null;
    if (this.node && this.node !== node) this.node.occupants.delete(this);
    this.node = node;
    this.fp = fp;
    if (fp) fp.occupiedBy = this;
    if (node) node.occupants.add(this);
  }

  release() {
    if (this.fp && this.fp.occupiedBy === this) this.fp.occupiedBy = null;
    if (this.node) this.node.occupants.delete(this);
  }

  placeAt(node, fp) {
    this.occupy(node, fp);
    this.pos.copy(fp.coverPos);
    this.yaw = fp.yaw;
    this.targetYaw = fp.yaw;
    this.s.model.root.rotation.y = fp.yaw;
    this.s.model.snapPose(fp.coverPose);
    this.setState('cover');
  }

  // 임시 위치 (이동 중 멈춘 곳 / 구덩이)
  makeTempFp(x, z, yaw, inCrater) {
    const t = this.game.world.terrain;
    const y = t.heightAt(x, z);
    return {
      node: null,
      temp: true,
      fire: 'prone',
      firePose: 'proneAim',
      observePose: 'proneAim',
      coverPose: 'proneLow',
      coverRef: 'terrain',
      light: 1,
      pos: new THREE.Vector3(x, y, z),
      firePos: new THREE.Vector3(x, y, z),
      coverPos: new THREE.Vector3(x, y, z),
      yaw,
      inCrater,
      occupiedBy: this,
    };
  }

  setState(name) {
    this.state = name;
    this.stateT = 0;
    const A = CONFIG.ai;
    const fp = this.fp;
    const s = this.s;
    this.exposed = false;
    switch (name) {
      case 'cover': {
        let w = this.covering ? randRange(A.coverWaitCoveringFire) : randRange(A.coverWait);
        if (this.level === LEVEL.PRESSURED) w *= A.coverWaitPressuredMul;
        this.timer = w;
        s.model.setPose(fp.coverPose, 10);
        this.posTarget.copy(fp.coverPos);
        this.targetYaw = fp.yaw;
        break;
      }
      case 'observe': {
        let t = randRange(A.observeTime);
        if (this.level === LEVEL.PRESSURED) t *= A.observeTimePressuredMul;
        if (this.covering) t *= A.observeTimeCoveringFireMul;
        this.timer = t;
        this.aimDelay = randRange(A.aimTime);
        this.decidedFire = null;
        this.exposed = true;
        s.model.setPose(fp.observePose, 7);
        this.posTarget.copy(fp.firePos);
        break;
      }
      case 'fire': {
        this.exposed = true;
        s.model.setPose(fp.firePose, 9);
        this.posTarget.copy(fp.firePos);
        if (this.covering) this.shots = randInt(A.coveringFireBurst[0], A.coveringFireBurst[1]);
        else {
          const r = Math.random();
          const c = A.burstChoice;
          this.shots = r < c.single ? 1 : r < c.single + c.two ? 2 : 3;
        }
        this.burstMode = this.shots > 1;
        this.shotTimer = rand(0.05, 0.2);
        this.burstIndex = 0;
        this.perception.aimPoint(this.aimPointV || (this.aimPointV = new THREE.Vector3()));
        break;
      }
      case 'blindfire':
        this.shots = randInt(A.blindFireRounds[0], A.blindFireRounds[1]);
        this.shotTimer = 0.55;
        s.model.setPose('blindFire', 8);
        this.posTarget.copy(fp.coverPos);
        break;
      case 'pinned':
        s.model.setPose(fp && fp.coverPose === 'proneLow' ? 'proneLow' : 'curl', 12);
        if (fp) this.posTarget.copy(fp.coverPos);
        break;
      case 'knockdown':
        s.model.setPose('knockdown', 7);
        break;
      case 'dead':
        s.model.setPose(Math.random() < 0.5 ? 'dead' : 'deadBack', 5);
        break;
      default:
        break;
    }
    // 엄폐물 정보 (제압 시스템의 5m 규칙)
    const atFp = fp && (name === 'cover' || name === 'observe' || name === 'fire' || name === 'blindfire' || name === 'pinned');
    s.inCover = !!atFp && (!fp.temp || fp.inCrater);
    s.coverRef = fp ? fp.coverRef : null;
    s.coverFacing.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    s.model.setTint(atFp ? fp.light : 1);
  }

  // ------------------------------------------------------------------ 반응
  onSuppressed() {
    this.lastNearRound = this.game.time;
    // 관측·사격 중 근접탄 → 즉시 몸을 숙인다
    if (this.state === 'observe' || this.state === 'fire') {
      this.firedThisCycle = this.firedThisCycle || this.state === 'fire';
      this.setState('cover');
      this.timer = Math.max(this.timer, CONFIG.ai.duckTime + rand(0.5, 1.5));
    }
  }

  onPlayerShot(e) {
    this.perception.onPlayerShot(e, this.exposed);
  }

  die() {
    this.release();
    if (this.advance) {
      const plan = this.advance;
      if (plan.destFp.occupiedBy === this) plan.destFp.occupiedBy = null;
      plan.to.occupants.delete(this);
      this.advance = null;
    }
    this.strandedDest = null;
    this.exposed = false;
    this.setState('dead');
  }

  // ------------------------------------------------------------------ 갱신
  update(dt) {
    const s = this.s;
    const now = this.game.time;
    this.stateT += dt;
    if (!s.alive) {
      if (this.state !== 'dead') this.die();
      this.finishFrame(dt, 0);
      return;
    }
    if (s.damage.isKnockedDown(now)) {
      if (this.state !== 'knockdown') {
        // 방탄판 피격: 몇 초간 쓰러짐. 이동 중이었다면 그 자리에서 멈춘다
        if (this.state === 'advance') this.stopAdvance(true);
        else if (this.state === 'dive') this.becomeStranded(this.pos.x, this.pos.z, this.pendingStopYaw ?? this.yaw, true);
        this.preKnockState = this.state === 'travel' || this.state === 'reposition' ? this.state : 'cover';
        this.setState('knockdown');
      }
      this.finishFrame(dt, 0);
      return;
    }
    if (this.state === 'knockdown') {
      if (this.preKnockState === 'travel' || this.preKnockState === 'reposition') {
        this.state = this.preKnockState;
        this.stateT = 0;
      } else this.setState('cover');
    }

    const lvl = this.level;
    if (lvl >= LEVEL.PINNED) {
      if (this.state === 'advance') this.hitTheDirt();
      else if (this.state === 'cover' || this.state === 'observe' || this.state === 'fire' || this.state === 'blindfire') {
        this.setState('pinned');
      }
    }

    // 무기 재장전 (엄폐 중)
    const w = s.weapon;
    if (!w.chambered && !w.reloading && this.state !== 'fire') w.startReload();

    this.perception.update(dt, this.exposed, this.state === 'advance' ? 0.4 : 1);
    // 새로 발견하면 분대원에게 알린다 (지연·오차 추가)
    if (this.perception.lastSeen !== this.lastSharedSeen && this.perception.source === 'visual') {
      this.lastSharedSeen = this.perception.lastSeen;
      this.director.share(this, this.perception.estimate, this.perception.sigma);
    }

    let moveSpeed = 0;
    switch (this.state) {
      case 'cover':
        this.updateCover(dt);
        break;
      case 'observe':
        this.updateObserve(dt);
        break;
      case 'fire':
        this.updateFire(dt);
        break;
      case 'blindfire':
        this.updateBlindFire(dt);
        break;
      case 'pinned':
        if (lvl < LEVEL.PINNED) this.setState('cover');
        break;
      case 'reposition':
        moveSpeed = this.updateReposition(dt);
        break;
      case 'advance':
        moveSpeed = this.updateAdvance(dt);
        break;
      case 'dive':
        moveSpeed = this.updateDive(dt);
        break;
      case 'travel':
        moveSpeed = this.updateTravel(dt);
        break;
      default:
        break;
    }
    this.finishFrame(dt, moveSpeed);
  }

  finishFrame(dt, moveSpeed) {
    const s = this.s;
    const A = CONFIG.ai;
    // 정지 상태에서는 목표 위치로 부드럽게 (발판 오르기·구덩이 테두리로 기어오르기)
    if (moveSpeed === 0 && this.state !== 'dead' && this.state !== 'knockdown') {
      const k = 1 - Math.exp(-6 * dt);
      this.pos.x += (this.posTarget.x - this.pos.x) * k;
      this.pos.z += (this.posTarget.z - this.pos.z) * k;
      const fp = this.fp;
      const atFp = this.state !== 'reposition' && this.state !== 'travel';
      const ty = atFp && fp && fp.step ? fp.pos.y : this.game.world.terrain.heightAt(this.pos.x, this.pos.z);
      this.pos.y += (ty - this.pos.y) * k;
    }
    this.yaw = dampAngle(this.yaw, this.targetYaw, A.turnRate, dt);
    s.model.root.rotation.y = this.yaw;
    s.model.moveSpeed = moveSpeed;
    // 엎드린 자세는 지형 경사를 따라 몸을 기울인다
    const pose = s.model.pose;
    if (pose === 'proneAim' || pose === 'proneLow' || pose === 'prone' || pose === 'crawl' || pose === 'dead') {
      const t = this.game.world.terrain;
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const hHead = t.heightAt(this.pos.x + fx * 0.85, this.pos.z + fz * 0.85);
      const hFeet = t.heightAt(this.pos.x - fx * 0.85, this.pos.z - fz * 0.85);
      const target = -Math.atan2(hHead - hFeet, 1.7);
      s.model.slopePitch += (target - s.model.slopePitch) * (1 - Math.exp(-8 * dt));
    } else {
      s.model.slopePitch *= Math.exp(-8 * dt);
    }
    // 조준 피치
    if (this.state === 'fire' || this.state === 'observe') {
      s.getEyePos(_v);
      const tgt = this.aimPointV && this.state === 'fire' ? this.aimPointV : this.perception.estimate;
      const dy = tgt.y - _v.y;
      const dh = Math.hypot(tgt.x - _v.x, tgt.z - _v.z);
      s.model.aimPitch = -Math.atan2(dy, dh);
    } else s.model.aimPitch *= 0.9;
    s.update(dt);
  }

  // 사격 위치의 정면에서 ±70° 안이면 추정 방향을 본다
  faceEstimate() {
    const est = this.perception.estimate;
    const yawTo = Math.atan2(est.x - this.pos.x, est.z - this.pos.z);
    const base = this.fp ? this.fp.yaw : this.yaw;
    const d = wrapAngle(yawTo - base);
    this.targetYaw = base + Math.max(-1.2, Math.min(1.2, d));
  }

  updateCover(dt) {
    const A = CONFIG.ai;
    const lvl = this.level;
    // 계획된 이동 출발은 지휘 쪽에서 판단 (canDepart/begin)
    if (lvl >= LEVEL.SUPPRESSED) {
      // 고개를 들지 못한다: 가끔 맹목 사격만
      this.blindTimer -= dt * (this.covering ? 2 : 1);
      const canBlind = this.fp && this.fp.fire !== 'prone' && !this.fp.temp;
      if (this.blindTimer <= 0 && canBlind && this.s.weapon.chambered && !this.s.weapon.reloading) {
        this.blindTimer = randRange(A.blindFireInterval);
        this.setState('blindfire');
      }
      return;
    }
    this.timer -= dt;
    // 이동을 앞둔 병사는 고개를 들지 않고 엄폐한 채 출발 기회를 본다
    if (this.preparing) return;
    if (this.timer > 0 || this.s.weapon.reloading) return;
    if (this.pendingReposition && lvl === LEVEL.NORMAL && this.node && !this.fp.temp) {
      this.pendingReposition = false;
      if (this.startReposition()) return;
    }
    this.setState('observe');
  }

  wantsToFire() {
    const A = CONFIG.ai;
    if (this.level >= LEVEL.SUPPRESSED) return false;
    const p = this.perception;
    if (!p.has || this.s.weapon.reloading || !this.s.weapon.chambered) return false;
    if (this.covering) return true;
    if (p.visible && this.game.time - p.lastSeen < 3) return true;
    if (p.source === 'flash' || p.source === 'visual') return p.age() < 10;
    if (this.decidedFire === null) {
      const c = p.source === 'prior' ? A.fireAtPriorChance : A.fireAtSoundChance;
      this.decidedFire = Math.random() < c;
    }
    return this.decidedFire;
  }

  updateObserve(dt) {
    this.timer -= dt;
    if (this.preparing) this.timer = Math.min(this.timer, 0.3);
    this.faceEstimate();
    if (this.stateT > this.aimDelay && this.wantsToFire()) {
      this.setState('fire');
      return;
    }
    if (this.timer <= 0) {
      if (this.firedThisCycle) this.pendingReposition = Math.random() < CONFIG.ai.repositionChance;
      this.firedThisCycle = false;
      this.setState('cover');
    }
  }

  updateFire(dt) {
    const A = CONFIG.ai;
    this.faceEstimate();
    if (this.level >= LEVEL.SUPPRESSED) {
      this.setState('cover');
      return;
    }
    this.shotTimer -= dt;
    if (this.shotTimer <= 0 && this.shots > 0) {
      if (this.fireShot(false)) {
        this.shots--;
        this.burstIndex++;
        this.firedThisCycle = true;
        this.shotTimer = this.burstMode ? A.burstInterval * rand(1, 1.25) : randRange(A.singleShotInterval);
        // 단발은 매번 다시 조준
        if (!this.burstMode) this.perception.aimPoint(this.aimPointV);
      } else {
        this.shots = 0;
      }
    }
    if (this.shots <= 0 && this.shotTimer <= 0) {
      this.pendingReposition = Math.random() < A.repositionChance;
      this.firedThisCycle = false;
      this.setState('cover');
    }
  }

  updateBlindFire(dt) {
    this.shotTimer -= dt;
    if (this.shotTimer <= 0) {
      if (this.shots > 0) {
        this.perception.aimPoint(this.aimPointV || (this.aimPointV = new THREE.Vector3()), 2.5);
        this.fireShot(true);
        this.shots--;
        this.shotTimer = rand(0.08, 0.25);
      } else if (this.stateT > 0.5) {
        this.setState(this.level >= LEVEL.PINNED ? 'pinned' : 'cover');
      }
    }
  }

  fireShot(blind) {
    const A = CONFIG.ai;
    const s = this.s;
    const w = s.weapon;
    if (!w.canFire()) return false;
    s.model.getMuzzle(_muzzle);
    _aim.copy(this.aimPointV || this.perception.estimate);
    _dir.subVectors(_aim, _muzzle);
    const range = _dir.length();
    _dir.normalize();
    // 탄 낙차 보정 (같은 탄도표)
    const elev = elevationInterp(w.ammo, range);
    const h = Math.hypot(_dir.x, _dir.z);
    const pitch = Math.atan2(_dir.y, h) + elev;
    const yaw = Math.atan2(_dir.x, _dir.z);
    _dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    let sigma;
    if (blind) sigma = s.type.blindFireDispersionMrad / 1000;
    else {
      sigma = s.type.aimDispersionMrad / 1000;
      if (this.level === LEVEL.PRESSURED) sigma /= Math.sqrt(A.pressuredAccuracyMul);
      if (this.covering) sigma *= A.coveringFireDispersionMul;
      sigma *= 1 + A.burstClimbMul * this.burstIndex;
      const fire = this.fp ? this.fp.fire : 'stand';
      sigma *= fire === 'prone' ? 0.75 : fire === 'kneel' ? 0.9 : 1;
      if (this.game.player.speedClass !== 'still' && this.perception.visible) sigma *= 1.4;
    }
    applyDispersion(_dir, sigma);
    const ground = this.game.world.terrain.heightAt(_muzzle.x, _muzzle.z);
    // 흉벽·구덩이 테두리 바로 위로 쏘면 총구 앞 흙먼지
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const ahead = this.game.world.terrain.heightAt(_muzzle.x + fx * 0.6, _muzzle.z + fz * 0.6);
    const nearGround = _muzzle.y - Math.max(ground, ahead) < CONFIG.effects.muzzleDustHeight;
    w.discharge(_muzzle.clone(), _dir, { muzzle: _muzzle.clone(), muzzleNearGround: nearGround });
    return true;
  }

  // ------------------------------------------------------------------ 위치 변경 (같은 노드 안)
  startReposition() {
    const node = this.node;
    const target = this.nav.freeFp(node, this.fp);
    if (!target) return false;
    const from = this.fp;
    this.path = this.nav.pathBetweenFps(from, target);
    this.pathIdx = 0;
    this.occupy(node, target);
    this.state = 'reposition';
    this.stateT = 0;
    this.exposed = false;
    this.s.inCover = false;
    const crawl = target.fire === 'prone';
    this.moveSpeedV = crawl ? CONFIG.ai.moveSpeeds.crawl : CONFIG.ai.moveSpeeds.crouchWalk;
    this.s.model.setPose(crawl ? 'crawl' : 'crouchWalk', 8);
    this.s.model.setTint(target.light);
    return true;
  }

  moveAlong(dt, speed) {
    const p = this.path[this.pathIdx];
    if (!p) return true;
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    const t = this.game.world.terrain;
    const gy = t.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-14 * dt));
    if (d > 0.3) this.targetYaw = Math.atan2(dx, dz);
    return false;
  }

  updateReposition(dt) {
    // 이동 중 고착: 그 자리에서 웅크리고 수치가 떨어질 때까지 멈춤
    if (this.level >= LEVEL.PINNED) {
      this.s.model.setPose(this.fp.fire === 'prone' ? 'proneLow' : 'curl', 12);
      this.posTarget.copy(this.pos);
      return 0;
    }
    this.s.model.setPose(this.fp.fire === 'prone' ? 'crawl' : 'crouchWalk', 8);
    if (this.moveAlong(dt, this.moveSpeedV)) {
      this.setState('cover');
      return 0;
    }
    return this.moveSpeedV;
  }

  makeTempFpFromCurrent() {
    const t = this.game.world.terrain;
    const c = this.nearestCrater(this.pos.x, this.pos.z, 0.5);
    return this.makeTempFp(this.pos.x, this.pos.z, this.fp ? this.fp.yaw : this.yaw, !!c && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < c.r);
  }

  // ------------------------------------------------------------------ 약진 (노드 간 이동)
  // 출발 가능: 본인 제압 25 미만 + 최근 3초간 근처에 탄 없음 + 지금 노출/사격 중 아님
  canDepart() {
    const M = CONFIG.mission;
    const now = this.game.time;
    if (!this.s.alive || this.s.damage.isKnockedDown(now)) return false;
    if (this.s.suppression.value >= M.departMaxSuppression) return false;
    if (now - this.lastNearRound < M.departQuietTime) return false;
    if (this.state !== 'cover' && this.state !== 'observe') return false;
    if (this.s.weapon.reloading) return false;
    return true;
  }

  // plan: {from(node|null), to(node), destFp, path}
  beginAdvance(plan) {
    this.advance = plan;
    this.path = plan.path;
    this.pathIdx = plan.startIdx || 0;
    this.lastBoundIdx = this.pathIdx;
    this.release();
    // 목적지 자리 예약
    plan.destFp.occupiedBy = this;
    plan.to.occupants.add(this);
    this.fp = null;
    this.node = null;
    this.strandedDest = null;
    this.state = 'advance';
    this.stateT = 0;
    this.exposed = true;
    this.posTarget.copy(this.pos);
    this.s.inCover = false;
    this.s.coverRef = null;
    this.s.model.setTint(1);
    this.startRush();
  }

  startRush() {
    const A = CONFIG.ai;
    this.phase = 'rush';
    this.phaseT = randRange(A.rushTime);
    this.s.model.setPose('sprint', 7);
    this.exposed = true;
  }

  updateAdvance(dt) {
    const A = CONFIG.ai;
    const M = CONFIG.mission;
    const now = this.game.time;
    if (this.phase === 'rush') {
      this.phaseT -= dt;
      const arrived = this.moveAlong(dt, A.moveSpeeds.sprint);
      if (arrived) {
        this.finishAdvance();
        return 0;
      }
      // 경유점(구덩이)에 닿았거나 질주 시간이 끝나면 엎드린다
      const passed = this.path[this.pathIdx - 1];
      const reachedBound = this.pathIdx > this.lastBoundIdx && passed && passed.bound;
      if (this.phaseT <= 0 || reachedBound) {
        this.lastBoundIdx = this.pathIdx;
        this.phase = 'drop';
        this.phaseT = A.dropTime;
        this.s.model.setPose('proneAim', 10);
      }
      return A.moveSpeeds.sprint;
    }
    if (this.phase === 'drop') {
      this.phaseT -= dt;
      this.posTarget.copy(this.pos);
      if (this.phaseT <= 0) {
        this.phase = 'rest';
        this.phaseT = randRange(A.proneRestTime);
        this.restWait = 0;
        this.s.model.setPose('proneLow', 8);
        this.s.inCover = !!this.nearestCrater(this.pos.x, this.pos.z, 0.2);
        this.s.coverRef = 'terrain';
        this.posTarget.copy(this.pos);
      }
      return 0;
    }
    // rest: 엎드려 숨 고르기. 다음 질주는 '새 이동' 이므로 출발 조건을 다시 본다
    this.phaseT -= dt;
    this.restWait += dt;
    this.posTarget.copy(this.pos);
    if (this.phaseT <= 0) {
      const ok = this.s.suppression.value < M.departMaxSuppression && now - this.lastNearRound >= M.departQuietTime;
      if (ok) {
        this.s.inCover = false;
        this.startRush();
      } else if (this.restWait > A.restWaitMax) {
        // 오래 묶여 못 움직임 → 저지
        this.stopAdvance(false);
      }
    }
    return 0;
  }

  finishAdvance() {
    const plan = this.advance;
    this.advance = null;
    this.occupy(plan.to, plan.destFp);
    this.setState('cover');
    this.director.onAdvanceCompleted(this, plan);
  }

  nearestCrater(x, z, maxDist) {
    let best = null;
    let bd = Infinity;
    for (const c of this.game.world.terrain.craters) {
      const d = Math.hypot(c.x - x, c.z - z) - c.r;
      if (d < maxDist && d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  // 이동 중 고착 → 그 자리에 엎드리거나 가장 가까운 구덩이로 뛰어든다
  hitTheDirt() {
    const A = CONFIG.ai;
    const c = this.nearestCrater(this.pos.x, this.pos.z, A.hitTheDirtCraterRadius);
    const yaw = this.fp ? this.fp.yaw : Math.atan2(-this.pos.x * 0.3, 112 - this.pos.z);
    if (c && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > c.r * 0.5) {
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      const tx = c.x + (dx / d) * c.r * 0.45;
      const tz = c.z + (dz / d) * c.r * 0.45;
      this.diveTarget = new THREE.Vector3(tx, 0, tz);
      this.diveCrater = c;
      this.state = 'dive';
      this.stateT = 0;
      this.s.model.setPose('sprint', 10);
      this.pendingStopYaw = yaw;
    } else {
      this.becomeStranded(this.pos.x, this.pos.z, yaw, !!c);
    }
    this.stopAdvance(true, true);
  }

  updateDive(dt) {
    const t = this.diveTarget;
    const dx = t.x - this.pos.x;
    const dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2 || this.stateT > 2.5) {
      this.becomeStranded(this.pos.x, this.pos.z, this.pendingStopYaw, true);
      return 0;
    }
    const sp = CONFIG.ai.moveSpeeds.sprint * 0.9;
    const step = Math.min(d, sp * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.pos.y = this.game.world.terrain.heightAt(this.pos.x, this.pos.z);
    this.targetYaw = Math.atan2(dx, dz);
    if (d < 1.2) this.s.model.setPose('proneLow', 12);
    return sp;
  }

  becomeStranded(x, z, yaw, inCrater) {
    this.fp = this.makeTempFp(x, z, yaw, inCrater);
    this.node = null;
    this.setState(this.level >= LEVEL.PINNED ? 'pinned' : 'cover');
  }

  // 이동 중단 (저지). silent: 이미 처리 중인 경우 통계만
  stopAdvance(pinned, fromDirt = false) {
    const plan = this.advance;
    if (!plan) return;
    this.advance = null;
    // 예약했던 목적지 해제
    if (plan.destFp.occupiedBy === this) plan.destFp.occupiedBy = null;
    plan.to.occupants.delete(this);
    this.strandedDest = { from: plan.from, to: plan.to, path: plan.path, idx: this.pathIdx };
    if (!fromDirt && this.state === 'advance') {
      this.becomeStranded(this.pos.x, this.pos.z, this.fp ? this.fp.yaw : this.yaw, !!this.nearestCrater(this.pos.x, this.pos.z, 0.2));
    }
    this.director.onAdvanceStopped(this, plan, pinned);
  }

  // ------------------------------------------------------------------ 증원 이동
  beginTravel(node, fp, path) {
    this.occupy(node, fp);
    this.path = path;
    this.pathIdx = 0;
    this.state = 'travel';
    this.stateT = 0;
    this.exposed = false;
    this.s.inCover = false;
    this.s.model.setPose('walk', 6);
  }

  updateTravel(dt) {
    const sp = CONFIG.ai.moveSpeeds.jog;
    if (this.moveAlong(dt, sp)) {
      this.setState('cover');
      return 0;
    }
    if (this.level >= LEVEL.PINNED) {
      this.s.model.setPose('proneLow', 10);
      return 0;
    }
    this.s.model.setPose('walk', 6);
    return sp;
  }
}

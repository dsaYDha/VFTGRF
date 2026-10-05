// =============================================================================
// Player — 1인칭 이동·자세·기울이기·스태미나·진흙·조준 흔들림·총 거치·반동·사격
// 플레이어의 몸(피격 판정·제압 수치·피해 상태)은 적과 같은 Soldier 를 쓴다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG, SURFACE_BY_ID } from '../config.js';
import { EV } from '../core/events.js';
import { MAP } from '../world/mapData.js';
import { Soldier } from '../units/Soldier.js';
import { clamp, damp, DEG } from '../core/mathUtils.js';
import { elevationFor } from '../weapons/zeroing.js';
import { PLAYER_POSE } from '../units/poses.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _hit = {};

const POSTURE_NAMES = { stand: '서기', crouch: '앉기', prone: '엎드리기' };

export class Player {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.camera = game.camera;
    this.body = new Soldier(game, { team: 'friendly', isPlayer: true, addToScene: false, name: '플레이어' });
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.lastInside = new THREE.Vector3();
    this.reset();
  }

  get weapon() {
    return this.body.weapon;
  }

  get alive() {
    return this.body.alive;
  }

  reset() {
    const s = MAP.playerSpawn;
    const t = this.game.world.terrain;
    this.pos.set(s.x, t.heightAt(s.x, s.z), s.z);
    this.lastInside.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.yaw = s.yaw;
    this.pitch = 0.0;
    this.posture = 'stand';
    this.transFrom = 'stand';
    this.transT = 1;
    this.transDur = 0.4;
    this.eyeHeight = CONFIG.player.eyeHeights.stand;
    this.lean = 0;
    this.stamina = CONFIG.player.stamina.max;
    this.breath = 0;
    this.sprinting = false;
    this.sprintCooldown = 0;
    this.exhausted = false;
    this.ads = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.swayT = Math.random() * 10;
    this.swayAmp = CONFIG.player.sway.baseMrad;
    this.swayYaw = 0;
    this.swayPitch = 0;
    this.rested = false;
    this.restKind = null;
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.bobPhase = 0;
    this.stepAcc = 0;
    this.outsideTime = 0;
    this.boundaryState = 'clear';
    this.speedClass = 'still';
    this.lastShotTime = -99;
    this.knockdownActive = false;
    this.deadTime = 0;
    this.body.damage.reset();
    this.body.suppression.reset();
    // 플레이어의 엄폐물은 앞쪽 흙 둔덕·수로 벽 (근접 탄착 5m 규칙)
    this.body.coverRef = 'terrain';
    this.body.inCover = true;
    this.body.coverFacing.set(0, 0, -1);
    this.body.weapon.reset();
    this.updateBody(0);
    this.updateCamera(0);
  }

  // ------------------------------------------------------------------ 입력·갱신
  update(dt, input) {
    const P = CONFIG.player;
    const now = this.game.time;
    const dmg = this.body.damage;
    const incap = dmg.incapacitated;
    const knocked = !incap && dmg.isKnockedDown(now);

    if (knocked && !this.knockdownActive) {
      this.knockdownActive = true;
      this.events.emit(EV.PLAYER_KNOCKDOWN, { active: true });
    } else if (!knocked && this.knockdownActive) {
      this.knockdownActive = false;
      // 쓰러졌다 일어나면 엎드린 자세
      this.posture = 'prone';
      this.transFrom = 'prone';
      this.transT = 1;
      this.events.emit(EV.PLAYER_KNOCKDOWN, { active: false });
      this.events.emit(EV.PLAYER_POSTURE, { posture: this.posture });
    }
    const canAct = !incap && !knocked;

    // 시점
    const [mdx, mdy] = input.consumeMouse();
    const sens = P.mouseSensitivity * (1 - this.ads * (1 - P.adsSensitivityMul));
    if (!incap) {
      this.yaw -= mdx * sens;
      this.pitch -= mdy * sens;
      this.pitch = clamp(this.pitch, -P.maxPitchDeg * DEG, P.maxPitchDeg * DEG);
    }

    if (canAct) {
      // 자세
      if (input.wasPressed('KeyC')) this.requestPosture(this.posture === 'crouch' ? 'stand' : 'crouch');
      if (input.wasPressed('KeyZ')) this.requestPosture(this.posture === 'prone' ? 'stand' : 'prone');
      // 무기 조작
      const w = this.weapon;
      if (input.wasPressed('KeyB')) w.toggleFireMode();
      if (input.wasPressed('KeyR')) w.startReload();
      if (input.wasPressed('KeyT')) this.checkAmmo();
      const wheel = input.consumeWheel();
      if (wheel) w.adjustSight(wheel < 0 ? 1 : -1);
    } else {
      input.consumeWheel();
    }
    if (this.transT < 1) this.transT = Math.min(1, this.transT + dt / this.transDur);

    // 기울이기
    let leanTarget = 0;
    if (canAct && !this.sprinting) leanTarget = (input.isDown('KeyE') ? 1 : 0) - (input.isDown('KeyQ') ? 1 : 0);
    this.lean = damp(this.lean, leanTarget, 1 / P.lean.time * 2.2, dt);

    this.updateMovement(dt, input, canAct);

    // 조준 (우클릭)
    const reloading = this.weapon.reloading;
    const adsTarget = canAct && input.buttons.right && !this.sprinting && !reloading ? 1 : 0;
    this.ads = damp(this.ads, adsTarget, 1 / CONFIG.render.adsTransitionTime * 2.3, dt);

    // 스태미나·숨참
    const S = P.stamina;
    if (this.sprinting) {
      const surf = SURFACE_BY_ID[this.game.world.terrain.surfaceAt(this.pos.x, this.pos.z)];
      this.stamina -= S.sprintDrain * (surf ? surf.staminaMul : 1) * dt;
      this.breath = Math.min(1, this.breath + P.breath.gainPerSecSprint * dt);
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    } else {
      const regen = this.speedClass === 'still' ? S.regenStill : S.regenMoving;
      this.stamina = Math.min(S.max, this.stamina + regen * dt);
      this.breath = Math.max(0, this.breath - P.breath.decayPerSec * dt);
      if (this.exhausted && this.stamina > S.minToSprint * 2) this.exhausted = false;
    }
    if (this.sprintCooldown > 0) this.sprintCooldown -= dt;

    this.updateRest();
    this.updateSway(dt);

    // 사격
    const w = this.weapon;
    const proneTrans = this.transT < 1 && (this.posture === 'prone' || this.transFrom === 'prone');
    const canShoot = canAct && !this.sprinting && this.sprintCooldown <= 0 && !proneTrans;
    if (w.triggerWantsShot(canShoot && input.buttons.left)) this.fire();

    // 반동 회복
    const rec = CONFIG.weapons[this.body.type.weapon].recoil;
    const kRec = Math.exp(-dt / rec.recoverTime);
    this.recoilPitch *= kRec;
    this.recoilYaw *= kRec;

    // 흔들림 (피제압 충격)
    this.shakeAmp *= Math.exp(-CONFIG.hud.shakeDecay * dt);
    this.shakeT += dt;

    this.updateBoundary(dt);
    this.updateBody(dt);
    this.updateCamera(dt);
  }

  requestPosture(target) {
    if (target === this.posture) return;
    const T = CONFIG.player.postureTime;
    const from = this.posture;
    const key = [from, target].sort().join('');
    this.transDur = key === 'crouchstand' ? T.standCrouch : key === 'crouchprone' ? T.crouchProne : T.standProne;
    this.transFrom = from;
    this.posture = target;
    this.transT = 0;
    this.events.emit(EV.PLAYER_POSTURE, { posture: target });
  }

  updateMovement(dt, input, canAct) {
    const P = CONFIG.player;
    const col = this.game.world.collision;
    const terrain = this.game.world.terrain;
    let mx = 0;
    let mz = 0;
    if (canAct) {
      mz = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
      mx = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    }
    const moving = mx !== 0 || mz !== 0;
    const wounded = this.body.damage.wounded;
    // 달리기: 서기 자세에서만 (앉아 있으면 일어서며 달림)
    const wantSprint = canAct && moving && mz > 0 && input.isDown('ShiftLeft') && !wounded && !this.exhausted && !this.weapon.reloading;
    if (wantSprint && this.posture === 'crouch') this.requestPosture('stand');
    const sprinting = wantSprint && this.posture === 'stand' && this.stamina > (this.sprinting ? 0 : P.stamina.minToSprint);
    if (this.sprinting && !sprinting) this.sprintCooldown = 0.28;
    this.sprinting = sprinting;

    let speed = this.posture === 'prone' ? P.speeds.prone : this.posture === 'crouch' ? P.speeds.crouch : sprinting ? P.speeds.sprint : P.speeds.walk;
    speed *= 1 - this.ads * (1 - P.adsSpeedMul);
    if (wounded) speed *= P.wounded.speedMul;
    if (this.transT < 1) speed *= 0.3;
    if (this.weapon.reloading) speed *= 0.85;
    const surf = SURFACE_BY_ID[terrain.surfaceAt(this.pos.x, this.pos.z)];
    if (surf) speed *= surf.speedMul;

    _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _v.set(0, 0, 0);
    if (moving) {
      _v.addScaledVector(_f, mz).addScaledVector(_r, mx).normalize();
      // 경사: 너무 가파른 오르막은 못 오른다
      const ahead = terrain.heightAt(this.pos.x + _v.x * 0.6, this.pos.z + _v.z * 0.6);
      const here = terrain.heightAt(this.pos.x, this.pos.z);
      const slopeDeg = Math.atan2(ahead - here, 0.6) / DEG;
      if (slopeDeg > P.maxSlopeDeg) _v.set(0, 0, 0);
      else if (slopeDeg > P.slopeSlowStartDeg) speed *= 1 - 0.7 * ((slopeDeg - P.slopeSlowStartDeg) / (P.maxSlopeDeg - P.slopeSlowStartDeg));
      _v.multiplyScalar(speed);
    }
    const k = 1 - Math.exp(-P.accel * dt);
    this.vel.x += (_v.x - this.vel.x) * k;
    this.vel.z += (_v.z - this.vel.z) * k;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedClass = hs < 0.25 ? 'still' : sprinting ? 'sprint' : 'walk';

    const oldX = this.pos.x;
    const oldZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const bodyH = this.posture === 'prone' ? 0.5 : this.eyeHeight + 0.15;
    col.resolveCylinder(this.pos, P.radius, bodyH, P.stepHeight);
    // 지면 높이: 오를 때는 부드럽게, 내려갈 때는 중력
    const ground = col.groundHeight(this.pos.x, this.pos.z, this.pos.y + P.stepHeight);
    if (ground > this.pos.y) {
      if (ground - this.pos.y > P.stepHeight + 0.6) {
        // 너무 높은 턱: 이동 취소
        this.pos.x = oldX;
        this.pos.z = oldZ;
      } else {
        this.pos.y = damp(this.pos.y, ground, 18, dt);
        if (ground - this.pos.y < 0.01) this.pos.y = ground;
      }
      this.vy = 0;
    } else if (ground < this.pos.y - 0.02) {
      this.vy -= CONFIG.ballistics.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vy = 0;
      }
    } else {
      this.pos.y = ground;
      this.vy = 0;
    }

    // 발소리 / 화면 흔들림 주기
    const moved = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    if (moved > 0.0005) {
      const L = P.stepLength;
      const stepLen = this.posture === 'prone' ? L.prone : this.posture === 'crouch' ? L.crouch : sprinting ? L.sprint : L.walk;
      this.stepAcc += moved;
      this.bobPhase += (moved / stepLen) * Math.PI;
      if (this.stepAcc >= stepLen) {
        this.stepAcc -= stepLen;
        this.events.emit(EV.FOOTSTEP, {
          unit: this.body,
          position: this.pos,
          surface: surf ? surf.step : 'mud',
          intensity: sprinting ? 1 : this.posture === 'prone' ? 0.45 : this.posture === 'crouch' ? 0.6 : 0.8,
          posture: this.posture,
        });
      }
    }
  }

  // 총 거치: 엎드리기, 또는 총열 아래 가까이에 엄폐물 윗면 / 기울인 쪽 벽 모서리
  updateRest() {
    const P = CONFIG.player.rest;
    const still = this.speedClass === 'still';
    this.rested = false;
    this.restKind = null;
    if (!still || this.transT < 1) return;
    if (this.posture === 'prone') {
      this.rested = true;
      this.restKind = 'prone';
      return;
    }
    const col = this.game.world.collision;
    const sh = CONFIG.ammo[this.weapon.def.ammo].sightHeight;
    const boreY = this.eye.y - sh;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    for (let d = P.probeDist[0]; d <= P.probeDist[1] + 1e-6; d += 0.2) {
      const px = this.eye.x + fx * d;
      const pz = this.eye.z + fz * d;
      const top = col.surfaceTopNear(px, pz, boreY - P.bandBelowBore[1], boreY - P.bandBelowBore[0]);
      if (top > -Infinity) {
        this.rested = true;
        this.restKind = 'top';
        return;
      }
    }
    // 기울였을 때 옆쪽 벽 모서리
    if (Math.abs(this.lean) > 0.5) {
      const side = Math.sign(this.lean);
      const rx = Math.cos(this.yaw) * side;
      const rz = -Math.sin(this.yaw) * side;
      const ax = this.eye.x + fx * 0.45;
      const az = this.eye.z + fz * 0.45;
      if (col.castColliders(ax, boreY, az, ax + rx * P.sideProbe, boreY, az + rz * P.sideProbe, _hit)) {
        this.rested = true;
        this.restKind = 'side';
      }
    }
  }

  updateSway(dt) {
    const S = CONFIG.player.sway;
    const postureMul = S.postureMul[this.posture];
    let amp = S.baseMrad * postureMul;
    if (this.rested) amp *= S.restedMul;
    if (this.speedClass !== 'still') amp *= S.movingMul;
    amp *= 1 + this.breath * S.breathMul;
    if (this.body.damage.wounded) amp *= S.woundedMul;
    amp *= 1 + (this.body.suppression.value / 100) * S.suppressionMul;
    amp *= 1 - this.ads * (1 - S.adsMul);
    if (this.transT < 1) amp *= S.transitionMul;
    this.swayAmp = damp(this.swayAmp, amp, 3, dt);
    const breathRate = 1.4 + this.breath * 2.2;
    this.swayT += dt;
    const t = this.swayT;
    const a = this.swayAmp / 1000;
    this.swayYaw = a * (0.65 * Math.sin(t * 0.83 + 1.3) + 0.35 * Math.sin(t * 1.91));
    this.swayPitch = a * (0.5 * Math.sin(t * 0.67) + 0.25 * Math.sin(t * 2.3 + 0.7) + (0.35 + this.breath * 0.6) * Math.sin(t * breathRate));
  }

  aimAngles() {
    return [this.yaw + this.recoilYaw + this.swayYaw, this.pitch + this.recoilPitch + this.swayPitch];
  }

  fire() {
    const w = this.weapon;
    const ammo = w.ammo;
    const [ay, ap] = this.aimAngles();
    const elev = elevationFor(ammo, w.sightRange, ammo.sightHeight);
    const pitch = ap + elev;
    _dir.set(-Math.sin(ay) * Math.cos(pitch), Math.sin(pitch), -Math.cos(ay) * Math.cos(pitch));
    // 총열은 조준선보다 sightHeight 아래
    _up.set(Math.sin(ay) * Math.sin(ap), Math.cos(ap), Math.cos(ay) * Math.sin(ap));
    _o.copy(this.eye).addScaledVector(_up, -ammo.sightHeight);
    const muzzle = new THREE.Vector3().copy(_o).addScaledVector(_dir, w.def.muzzleForward);
    const ground = this.game.world.terrain.heightAt(muzzle.x, muzzle.z);
    const bullet = w.discharge(_o, _dir, {
      muzzle,
      muzzleNearGround: muzzle.y - ground < CONFIG.effects.muzzleDustHeight,
    });
    if (!bullet) return;
    this.lastShotTime = this.game.time;
    // 반동
    const R = w.def.recoil;
    let kick = R.pitchDeg * DEG * (1 + (Math.random() - 0.5) * 2 * (R.pitchRandomDeg / R.pitchDeg));
    kick *= R.postureMul[this.posture] || 1;
    if (this.rested) kick *= R.restedMul;
    if (w.burst > 2) kick *= Math.pow(R.autoClimbMul, Math.min(6, w.burst - 2));
    const yawKick = (Math.random() - 0.5) * 2 * R.yawRandomDeg * DEG;
    this.pitch += kick * R.permanentFraction;
    this.recoilPitch += kick * (1 - R.permanentFraction);
    this.yaw += yawKick * R.permanentFraction;
    this.recoilYaw += yawKick * (1 - R.permanentFraction);
  }

  checkAmmo() {
    const st = this.weapon.ammoStatus();
    this.events.emit(EV.AMMO_CHECK, { owner: this.body, ...st });
  }

  addShake(amount) {
    this.shakeAmp = Math.min(0.05, this.shakeAmp + amount);
  }

  updateBoundary(dt) {
    const A = CONFIG.world.playArea;
    const m = CONFIG.world.boundaryWarnMargin;
    const p = this.pos;
    const inside = p.x > A.minX && p.x < A.maxX && p.z > A.minZ && p.z < A.maxZ;
    const near = p.x < A.minX + m || p.x > A.maxX - m || p.z < A.minZ + m || p.z > A.maxZ - m;
    if (inside) {
      this.lastInside.copy(p);
      this.outsideTime = 0;
    } else {
      this.outsideTime += dt;
      // 너무 멀리 나가지 않게
      p.x = clamp(p.x, A.minX - 12, A.maxX + 12);
      p.z = clamp(p.z, A.minZ - 12, A.maxZ + 12);
    }
    let state = inside ? (near ? 'near' : 'clear') : 'warn';
    if (!inside && this.outsideTime >= CONFIG.world.boundaryReturnTime) {
      p.copy(this.lastInside);
      this.vel.set(0, 0, 0);
      this.outsideTime = 0;
      state = 'return';
    }
    if (state !== this.boundaryState) {
      this.boundaryState = state;
      this.events.emit(EV.BOUNDARY, { state, timeLeft: CONFIG.world.boundaryReturnTime - this.outsideTime });
    }
  }

  // ------------------------------------------------------------------ 몸·카메라
  currentEyeHeight() {
    const E = CONFIG.player.eyeHeights;
    const t = this.transT;
    const s = t * t * (3 - 2 * t);
    return E[this.transFrom] + (E[this.posture] - E[this.transFrom]) * s;
  }

  updateBody(dt) {
    const m = this.body.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw + Math.PI;
    const dmg = this.body.damage;
    if (dmg.incapacitated) m.setPose('deadBack', 4);
    else if (dmg.isKnockedDown(this.game.time)) m.setPose('knockdown', 6);
    else m.setPose(PLAYER_POSE[this.posture], 8);
    m.aimPitch = -this.pitch;
    m.lean = this.lean;
    this.body.update(dt);
  }

  updateCamera(dt) {
    const P = CONFIG.player;
    const cam = this.camera;
    const dmg = this.body.damage;
    const now = this.game.time;
    let eyeH = this.currentEyeHeight();
    let roll = -this.lean * P.lean.angleDeg * DEG;
    if (dmg.incapacitated) {
      this.deadTime += dt;
      eyeH = Math.max(0.15, eyeH * Math.exp(-this.deadTime * 3));
      roll += Math.min(1.2, this.deadTime * 2);
    } else if (dmg.isKnockedDown(now)) {
      eyeH = 0.3;
      roll += 0.35;
    }
    this.eyeHeight = damp(this.eyeHeight ?? eyeH, eyeH, 14, dt || 1);
    const leanOff = (this.posture === 'prone' ? P.lean.proneOffset : P.lean.offset) * this.lean;
    // 기울이기가 벽에 막히면 줄임
    let lo = leanOff;
    if (Math.abs(leanOff) > 0.02) {
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const ex = this.pos.x;
      const ey = this.pos.y + this.eyeHeight;
      const ez = this.pos.z;
      const s = Math.sign(leanOff);
      if (this.game.world.collision.castColliders(ex, ey, ez, ex + rx * (Math.abs(leanOff) + 0.15) * s, ey, ez + rz * (Math.abs(leanOff) + 0.15) * s, _hit)) {
        lo = s * Math.max(0, _hit.t * (Math.abs(leanOff) + 0.15) - 0.15);
      }
    }
    // 걷기 흔들림
    const bobAmp = this.speedClass === 'sprint' ? P.bob.sprint : this.speedClass === 'walk' ? (this.posture === 'stand' ? P.bob.walk : P.bob.crouch) : 0;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * bobAmp * (1 - this.ads * 0.7);
    const bobX = Math.cos(this.bobPhase) * bobAmp * 0.5 * (1 - this.ads * 0.7);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const sh = this.shakeAmp;
    const st = this.shakeT * 37;
    this.eye.set(
      this.pos.x + rx * (lo + bobX) + Math.sin(st * 1.3) * sh * 0.3,
      this.pos.y + this.eyeHeight + bobY - (Math.abs(this.lean) * 0.06) + Math.sin(st * 1.7) * sh * 0.3,
      this.pos.z + rz * (lo + bobX),
    );
    cam.position.copy(this.eye);
    const adsSway = this.ads;
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw + this.recoilYaw + this.swayYaw * adsSway + Math.sin(st * 0.9) * sh;
    cam.rotation.x = this.pitch + this.recoilPitch + this.swayPitch * adsSway + Math.sin(st * 1.1 + 1) * sh;
    cam.rotation.z = roll + Math.sin(st * 0.7) * sh * 0.5;
    const baseFov = CONFIG.render.fovDeg;
    const adsFov = (2 * Math.atan(Math.tan((baseFov * DEG) / 2) / CONFIG.render.adsZoom)) / DEG;
    const fov = baseFov + (adsFov - baseFov) * this.ads;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ 다른 시스템용
  postureName() {
    return POSTURE_NAMES[this.posture];
  }

  // 적 탐지용 노출 지점 (머리·가슴·골반)
  visibilityPoints(out) {
    const m = this.body.model;
    m.getHeadPos(out[0]);
    m.getChestPos(out[1]);
    m.getHipsPos(out[2]);
    return out;
  }

  muzzlePosition(out) {
    const [ay, ap] = this.aimAngles();
    return out.set(
      this.eye.x - Math.sin(ay) * Math.cos(ap) * 0.7,
      this.eye.y + Math.sin(ap) * 0.7 - 0.06,
      this.eye.z - Math.cos(ay) * Math.cos(ap) * 0.7,
    );
  }
}

// =============================================================================
// FriendlyAI — 아군 분대원 1명 (2단계 '사격과 기동')
//  상태: hold(자리에서 엄호 사격) / bound(약진: 질주) / drop(긴 구간 중간에 엎드림)
//        / halted(약진 중 근접탄·피격 → 그 자리나 가까운 구덩이에 엎드려 멈춤) / dead
//  적의 정확한 위치가 아니라 적마다 '추정 위치'를 기억한다 (적과 같은 Perception).
//  사격: 추정 위치·표적 지시 지점에 2~5초 간격 단발. 사선에 다른 아군이 있으면 쏘지 않는다.
//  제압 단계별 행동은 1단계 적과 같다 (압박: 명중률 절반, 제압: 고개 못 듦, 고착: 사격·이동 불가).
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { LEVEL, LEVEL_NAMES } from '../suppression/Suppressible.js';
import { Perception } from './Perception.js';
import { rand, randRange, gauss } from '../core/Random.js';
import { applyDispersion } from '../weapons/Weapon.js';
import { elevationInterp } from '../weapons/zeroing.js';
import { dampAngle, wrapAngle } from '../core/mathUtils.js';

const _v = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _hit = {};

export const FRIENDLY_STATE_NAMES = {
  hold: '엄호',
  bound: '약진',
  drop: '약진(엎드림)',
  halted: '멈춤',
  dead: '전투 불능',
};

export class FriendlyAI {
  constructor(game, squad, soldier, { role, team, callName }) {
    this.game = game;
    this.squad = squad;
    this.s = soldier;
    this.role = role; // 'leader' | 'm1' .. 'm4'
    this.team = team; // 1 | 2 = 기동조, 0 = 엄호조
    this.callName = callName; // 콜아웃 이름 ('분대장', '1번' ...)
    this.tracks = new Map(); // 적 AI → Perception
    this.state = 'hold';
    this.stateT = 0;
    this.yaw = 0;
    this.targetYaw = 0;
    this.slot = new THREE.Vector3(); // 지금 자리
    this.node = 'S';
    this.inCanal = true;
    this.exposed = false;
    this.up = false; // 고개를 들고 관측·사격 중
    this.upTimer = 0;
    this.fireTimer = rand(1, 3);
    this.lastShotTime = -99;
    this.lastNearRound = -99;
    this.path = null;
    this.pathIdx = 0;
    this.phaseT = 0;
    this.speed = 0;
    this.bound = null; // 진행 중 약진 {to, dest, drops}
    this.eyeV = new THREE.Vector3();
    this.lastAmmoCall = -99;
  }

  // ---- 대상 인터페이스 (적의 Perception 이 쓴다) ----
  get body() {
    return this.s;
  }

  get alive() {
    return this.s.alive;
  }

  get pos() {
    return this.s.position;
  }

  get eye() {
    return this.s.getEyePos(this.eyeV);
  }

  get posture() {
    const pose = this.s.model.pose;
    if (pose.startsWith('prone') || pose === 'crawl' || pose.startsWith('dead')) return 'prone';
    if (pose.startsWith('kneel') || pose === 'duck' || pose === 'curl' || pose === 'crouchWalk') return 'crouch';
    return 'stand';
  }

  get speedClass() {
    return this.speed > 3 ? 'sprint' : this.speed > 0.3 ? 'walk' : 'still';
  }

  visibilityPoints(out) {
    const m = this.s.model;
    m.getHeadPos(out[0]);
    m.getChestPos(out[1]);
    m.getHipsPos(out[2]);
    return out;
  }

  get level() {
    return this.s.suppression.level;
  }

  get wounded() {
    return this.s.damage.wounded;
  }

  // 약진에 나갈 수 있는가 (살아 있고 부상 아님)
  get canBound() {
    return this.s.alive && !this.s.damage.wounded;
  }

  get moving() {
    return this.state === 'bound' || this.state === 'drop' || this.state === 'halted';
  }

  statusName() {
    if (!this.s.alive) return '전투 불능';
    if (this.s.damage.isKnockedDown(this.game.time)) return '쓰러짐';
    if (this.level >= LEVEL.PINNED) return '고착';
    if (this.level >= LEVEL.SUPPRESSED) return '제압';
    if (this.moving) return this.state === 'halted' ? '멈춤' : '약진';
    if (this.wounded) return '부상';
    return this.inCanal && this.team !== 0 ? '대기' : '엄호';
  }

  // ------------------------------------------------------------------ 위치
  placeAt(x, z, yaw, inCanal) {
    const t = this.game.world.terrain;
    this.slot.set(x, t.heightAt(x, z), z);
    this.pos.copy(this.slot);
    this.yaw = yaw;
    this.targetYaw = yaw;
    this.inCanal = inCanal;
    this.s.model.root.rotation.y = yaw;
    this.s.model.snapPose(inCanal ? 'duck' : 'proneLow');
    this.state = 'hold';
    this.stateT = 0;
  }

  // ------------------------------------------------------------------ 적 추정
  trackFor(enemyAI) {
    let t = this.tracks.get(enemyAI);
    if (!t) {
      t = new Perception(this.game, this.s, enemyAI, { prior: false });
      this.tracks.set(enemyAI, t);
    }
    return t;
  }

  onHostileShot(e, enemyAI) {
    this.trackFor(enemyAI).onShot(e, this.exposed);
  }

  // 공유·표적 지시로 받은 정보
  receive(enemyAI, pos, sigma) {
    this.trackFor(enemyAI).receiveShared(pos, sigma);
  }

  // 근접탄·피격 (제압 시스템 이벤트)
  onSuppressed(e) {
    const S = CONFIG.squad;
    if (e.distance <= S.nearRoundDist || e.impactDist <= S.nearRoundDist) this.lastNearRound = this.game.time;
    if (this.state === 'bound') this.takeCover();
    else if (this.up && this.level >= LEVEL.SUPPRESSED) this.setUp(false);
  }

  onHit() {
    if (this.state === 'bound' || this.state === 'drop') this.takeCover();
  }

  // ------------------------------------------------------------------ 약진
  // dest: 도착 자리 (Vector3), nodeId: 도착 지점
  beginBound(dest, nodeId) {
    const S = CONFIG.squad;
    const pts = [];
    const from = this.pos.clone();
    const len = Math.hypot(dest.x - from.x, dest.z - from.z);
    const runMax = S.sprintSpeed * S.runTime[1];
    // 엄폐 없이 긴 구간: 중간에 한 번 엎드렸다가 다시 뛴다
    if (len > runMax) {
      const k = Math.min(0.6, randRange(S.runTime) * S.sprintSpeed / len);
      const p = new THREE.Vector3().lerpVectors(from, dest, k);
      p.drop = true;
      pts.push(p);
    }
    pts.push(dest.clone());
    this.path = pts;
    this.pathIdx = 0;
    this.bound = { to: nodeId, dest: dest.clone() };
    this.setState('bound');
    this.inCanal = false;
    this.setUp(false);
  }

  // 약진 중 근접탄·피격: 가까운 구덩이로 뛰어들거나 그 자리에 엎드린다
  takeCover() {
    if (!this.bound) return;
    const S = CONFIG.squad;
    const t = this.game.world.terrain;
    let best = null;
    let bd = S.diveCraterRadius;
    for (const c of t.craters) {
      const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (d < bd && c.r > 0.9) {
        bd = d;
        best = c;
      }
    }
    this.halt = { until: 0, dive: null };
    if (best && bd > 0.8) {
      // 구덩이 안쪽, 적 쪽 경사로
      const dx = this.bound.dest.x - this.pos.x;
      const dz = this.bound.dest.z - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      this.halt.dive = new THREE.Vector3(best.x + (dx / l) * best.r * 0.3, 0, best.z + (dz / l) * best.r * 0.3);
      this.halt.dive.y = t.heightAt(this.halt.dive.x, this.halt.dive.z);
    }
    this.setState('halted');
    this.squad.onMemberHalted(this);
  }

  // ------------------------------------------------------------------ 상태
  setState(name) {
    this.state = name;
    this.stateT = 0;
    const m = this.s.model;
    switch (name) {
      case 'bound':
        m.setPose('sprint', 7);
        this.phaseT = randRange(CONFIG.squad.runTime);
        break;
      case 'drop':
        m.setPose('proneLow', 10);
        this.phaseT = randRange(CONFIG.squad.dropTime);
        break;
      case 'halted':
        m.setPose('proneLow', 12);
        break;
      case 'hold':
        m.setPose(this.inCanal ? 'duck' : 'proneLow', 8);
        break;
      case 'dead':
        m.setPose(Math.random() < 0.5 ? 'dead' : 'deadBack', 5);
        break;
      default:
        break;
    }
  }

  setUp(v) {
    if (this.up === v) return;
    this.up = v;
    this.upTimer = v ? randRange(CONFIG.squad.upTime) : randRange(CONFIG.squad.downTime);
    if (this.state === 'hold') this.s.model.setPose(v ? (this.inCanal ? 'kneelAim' : 'proneAim') : this.inCanal ? 'duck' : 'proneLow', 8);
  }

  die() {
    this.bound = null;
    this.path = null;
    this.exposed = false;
    this.setState('dead');
  }

  // ------------------------------------------------------------------ 갱신
  update(dt) {
    const s = this.s;
    const now = this.game.time;
    this.stateT += dt;
    this.speed = 0;
    if (!s.alive) {
      if (this.state !== 'dead') this.die();
      this.finishFrame(dt);
      return;
    }
    if (s.damage.isKnockedDown(now)) {
      // 방탄판 피격: 몇 초간 쓰러짐 (약진 중이었다면 그 자리에서 멈춘다)
      if (this.state === 'bound' || this.state === 'drop') this.takeCover();
      s.model.setPose('knockdown', 7);
      this.knocked = true;
      this.exposed = false;
      this.finishFrame(dt);
      return;
    }
    if (this.knocked) {
      this.knocked = false;
      this.setState(this.state);
    }
    const w = s.weapon;
    if (!w.chambered && !w.reloading && this.state !== 'bound') {
      if (w.startReload() && now - this.lastAmmoCall > 20) {
        this.lastAmmoCall = now;
        // 분대 전체에서 6초에 한 번만 (탄 부족은 사람마다)
        const low = w.totalRounds() < CONFIG.squad.lowAmmoRounds;
        this.squad.say(this, low ? '탄 부족!' : '탄창 교환!', low ? `lowammo-${this.role}` : 'reload');
      }
    }
    // 관측 (고개를 든 동안만 볼 수 있다)
    for (const [, p] of this.tracks) p.update(dt, this.exposed, 1);
    for (const ai of this.game.director.ais) if (ai.s.alive) this.trackFor(ai);
    this.shareSightings();

    switch (this.state) {
      case 'hold':
        this.updateHold(dt);
        break;
      case 'bound':
        this.updateBound(dt);
        break;
      case 'drop':
        this.updateDrop(dt);
        break;
      case 'halted':
        this.updateHalted(dt);
        break;
      default:
        break;
    }
    this.finishFrame(dt);
  }

  // 새로 본 적은 분대에 알린다 (콜아웃 + 지연 공유)
  shareSightings() {
    for (const [ai, p] of this.tracks) {
      if (p.source === 'visual' && p.lastSeen !== p.lastSharedSeen) {
        p.lastSharedSeen = p.lastSeen;
        this.squad.shareSighting(this, ai, p);
      }
    }
  }

  updateHold(dt) {
    const lvl = this.level;
    // 제압 이상: 고개를 못 든다 (고착이면 웅크림)
    if (lvl >= LEVEL.SUPPRESSED) {
      this.setUp(false);
      if (lvl >= LEVEL.PINNED && this.s.model.pose !== 'curl' && this.inCanal) this.s.model.setPose('curl', 12);
      this.exposed = false;
      return;
    }
    this.upTimer -= dt;
    if (this.upTimer <= 0) this.setUp(!this.up);
    this.exposed = this.up;
    if (!this.up) return;
    this.faceTarget();
    // 사격 (2~5초 간격 단발)
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = randRange(CONFIG.squad.fireInterval);
      this.tryFire();
    }
  }

  updateBound(dt) {
    const S = CONFIG.squad;
    this.exposed = true;
    if (this.level >= LEVEL.PRESSURED && this.stateT > 0.3) {
      this.takeCover();
      return;
    }
    const p = this.path[this.pathIdx];
    if (!p) return this.arrive();
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const step = S.sprintSpeed * dt;
    if (d <= step + 0.05) {
      this.pos.x = p.x;
      this.pos.z = p.z;
      this.pathIdx++;
      if (p.drop) {
        this.setState('drop');
        return;
      }
      if (this.pathIdx >= this.path.length) return this.arrive();
    } else {
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
      this.targetYaw = Math.atan2(dx, dz);
    }
    this.speed = S.sprintSpeed;
    // 질주 시간이 다 되면 (긴 구간) 엎드린다
    this.phaseT -= dt;
    if (this.phaseT <= 0 && d > S.sprintSpeed * 1.2) this.setState('drop');
  }

  updateDrop(dt) {
    this.exposed = false;
    this.phaseT -= dt;
    if (this.level >= LEVEL.PRESSURED) {
      this.takeCover();
      return;
    }
    if (this.phaseT <= 0) this.setState('bound');
  }

  updateHalted(dt) {
    const S = CONFIG.squad;
    const now = this.game.time;
    // 구덩이로 뛰어드는 중
    if (this.halt && this.halt.dive) {
      const p = this.halt.dive;
      const dx = p.x - this.pos.x;
      const dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const step = S.sprintSpeed * dt;
      if (d > step) {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.speed = S.sprintSpeed;
        this.s.model.setPose('sprint', 9);
        this.targetYaw = Math.atan2(dx, dz);
        this.exposed = true;
        return;
      }
      this.halt.dive = null;
      this.s.model.setPose('proneLow', 12);
    }
    this.exposed = false;
    // 제압이 풀리고 (압박 미만) 최근 근접탄이 없으면 다시 약진
    if (this.level < LEVEL.PRESSURED && now - this.lastNearRound > S.resumeQuiet && this.stateT > S.resumeQuiet) {
      if (!this.canBound) {
        // 부상: 그 자리를 새 엄호 위치로 삼는다
        this.slot.copy(this.pos);
        this.bound = null;
        this.setState('hold');
        this.squad.onMemberStopped(this);
        return;
      }
      this.squad.say(this, '다시 간다!', `resume-${this.role}`);
      this.path = this.path ? this.path.slice(this.pathIdx).filter((q) => !q.drop) : [this.bound.dest.clone()];
      if (!this.path.length) this.path = [this.bound.dest.clone()];
      this.pathIdx = 0;
      this.setState('bound');
    }
  }

  arrive() {
    this.slot.copy(this.bound ? this.bound.dest : this.pos);
    this.node = this.bound ? this.bound.to : this.node;
    this.bound = null;
    this.path = null;
    this.setState('hold');
    this.setUp(false);
    this.upTimer = rand(0.4, 1.0); // 도착하면 바로 엎드려 사격 자세로
    this.squad.onMemberArrived(this);
  }

  // ------------------------------------------------------------------ 사격
  // 노릴 곳: 표적 지시 > 다음 구간 위협 적의 추정 > 최근 사격한 적 > 가까운 추정
  pickAim(out) {
    const S = CONFIG.squad;
    const now = this.game.time;
    const sq = this.squad;
    if (sq.designation && now < sq.designation.until) {
      const d = sq.designation.point;
      if (this.pos.distanceTo(d) < S.fireRange) {
        return out.set(d.x + gauss() * S.designateSpread, d.y + 0.3 + gauss() * 0.3, d.z + gauss() * S.designateSpread * 0.5);
      }
    }
    let best = null;
    let bs = -Infinity;
    for (const [ai, p] of this.tracks) {
      if (!ai.alive || !p.has || p.age(now) > S.estimateMaxAge) continue;
      const dist = this.pos.distanceTo(p.estimate);
      if (dist > S.fireRange) continue;
      let sc = -dist * 0.02 - p.effectiveSigma(now) * 0.3;
      if (sq.threats.includes(ai)) sc += 20;
      if (p.visible) sc += 15;
      if (now - ai.lastShotTime < 6) sc += 8;
      if (sc > bs) {
        bs = sc;
        best = p;
      }
    }
    if (!best) return null;
    this.aimTrack = best;
    return best.aimPoint(out);
  }

  faceTarget() {
    const base = this.squad.facingYaw(this);
    let yaw = base;
    if (this.aimTrack && this.aimTrack.has) {
      const e = this.aimTrack.estimate;
      const to = Math.atan2(e.x - this.pos.x, e.z - this.pos.z);
      yaw = base + Math.max(-1.2, Math.min(1.2, wrapAngle(to - base)));
    }
    this.targetYaw = yaw;
  }

  tryFire() {
    const A = CONFIG.ai;
    const s = this.s;
    const w = s.weapon;
    if (!w.canFire()) return false;
    if (!this.pickAim(_aim)) return false;
    s.getEyePos(_eye);
    _dir.subVectors(_aim, _eye);
    const range = _dir.length();
    _dir.normalize();
    // 사선에 다른 아군(플레이어 포함)이 있으면 쏘지 않는다
    if (this.squad.friendInLine(this, _eye, _dir, range)) return false;
    _origin.copy(_eye).addScaledVector(_dir, w.def.muzzleForward);
    // 자기 엄폐물(구덩이 테두리·흉벽)에 막히면 조금 들어 올려 넘겨 쏜다 (적과 같은 규칙)
    const C = A.ownCoverClear;
    let lift = 0;
    for (;;) {
      const ex = _origin.x + _dir.x * C.checkDist;
      const ey = _origin.y + _dir.y * C.checkDist + lift - C.endDrop;
      const ez = _origin.z + _dir.z * C.checkDist;
      if (!this.shortLineBlocked(_eye.x, _eye.y + lift, _eye.z, ex, ey, ez)) break;
      lift += C.liftStep;
      if (lift > C.maxLift + 1e-6) return false;
    }
    _origin.y += lift;
    _dir.subVectors(_aim, _origin).normalize();
    const elev = elevationInterp(w.ammo, range);
    const h = Math.hypot(_dir.x, _dir.z);
    const pitch = Math.atan2(_dir.y, h) + elev;
    const yaw = Math.atan2(_dir.x, _dir.z);
    _dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // 명중률: 1단계 적과 같은 규칙 (기본 분산, 압박이면 절반, 엎드리면 좋아짐)
    let sigma = s.type.aimDispersionMrad / 1000;
    if (this.level === LEVEL.PRESSURED) sigma /= Math.sqrt(A.pressuredAccuracyMul);
    sigma *= this.inCanal ? 0.9 : 0.75;
    applyDispersion(_dir, sigma);
    s.model.getMuzzle(_muzzle);
    const fxPos = _muzzle.distanceToSquared(_origin) < C.effectMaxOffset * C.effectMaxOffset ? _muzzle : _origin;
    w.discharge(_origin.clone(), _dir, { muzzle: fxPos.clone(), muzzleNearGround: !this.inCanal });
    this.lastShotTime = this.game.time;
    return true;
  }

  shortLineBlocked(ax, ay, az, bx, by, bz) {
    const t = this.game.world.terrain;
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.08));
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (ay + (by - ay) * f - t.heightAt(ax + (bx - ax) * f, az + (bz - az) * f) < 0.02) return true;
    }
    return this.game.world.collision.segmentCast(ax, ay, az, bx, by, bz, _hit, { noTerrain: true });
  }

  // ------------------------------------------------------------------ 모델
  finishFrame(dt) {
    const s = this.s;
    const t = this.game.world.terrain;
    // 정지 중: 자리로 부드럽게 (수로 사격 턱·구덩이 경사)
    if (this.speed === 0 && this.state === 'hold' && s.alive) {
      const k = 1 - Math.exp(-6 * dt);
      this.pos.x += (this.slot.x - this.pos.x) * k;
      this.pos.z += (this.slot.z - this.pos.z) * k;
    }
    const gy = this.game.world.collision.groundHeight(this.pos.x, this.pos.z, t.heightAt(this.pos.x, this.pos.z) + 0.4);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-14 * dt));
    if (this.state === 'hold' || this.state === 'halted' || this.state === 'drop') {
      if (this.speed === 0) this.targetYaw = this.state === 'hold' ? this.targetYaw : this.squad.facingYaw(this);
    }
    this.yaw = dampAngle(this.yaw, this.targetYaw, CONFIG.ai.turnRate, dt);
    s.model.root.rotation.y = this.yaw;
    s.model.moveSpeed = this.speed;
    const pose = s.model.pose;
    if (pose === 'proneAim' || pose === 'proneLow' || pose === 'prone' || pose === 'dead') {
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const hHead = t.heightAt(this.pos.x + fx * 0.85, this.pos.z + fz * 0.85);
      const hFeet = t.heightAt(this.pos.x - fx * 0.85, this.pos.z - fz * 0.85);
      const target = -Math.atan2(hHead - hFeet, 1.7);
      s.model.slopePitch += (target - s.model.slopePitch) * (1 - Math.exp(-8 * dt));
    } else s.model.slopePitch *= Math.exp(-8 * dt);
    if (this.up && this.aimTrack && this.aimTrack.has && this.state === 'hold') {
      s.getEyePos(_v);
      const e = this.aimTrack.estimate;
      s.model.aimPitch = -Math.atan2(e.y - _v.y, Math.hypot(e.x - _v.x, e.z - _v.z));
    } else s.model.aimPitch *= 0.9;
    s.update(dt);
  }

  levelName() {
    return LEVEL_NAMES[this.level];
  }
}

// =============================================================================
// AutoBot — 시뮬레이션 모드용 자동 사격 '플레이어' (2단계 밸런스 확인)
//  실제 입력과 같은 길로 조작한다: 조준(시점 회전) + 방아쇠 + 키(C 자세, R 재장전, F 탄약 상자) + 분대 명령(G·X).
//  mode
//   'good'   : 숙련자. 드러난 적(총을 쏜 적·분대가 외친 적)만 노린다. 아군이 다음에 뛸 구간에 사선이 닿는 적을
//              돌아가며 2~3발씩 눌러 두고 G 로 약진을 요청한다. 아군이 사선(5°·3m)이나 탄착점 30m 안에 있으면 쏘지 않고
//              다른 적으로 옮긴다. 탄이 줄면 약진 사이에 탄약 상자에서 채운다. 둔덕 뒤에서 앉아 쏘고 사이에는 엎드려 숨는다.
//   'random' : 적 진지 쪽 아무 곳에나 1~2발씩, 가끔 G. 아군 사선을 보지 않는다.
//   'none'   : 쏘지 않는다 (앉아서 기다림).
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { gauss, rand } from '../core/Random.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

// 게임 Input 과 같은 모양의 가짜 입력 (Player·Squad 가 읽는다)
export function makeBotInput() {
  return {
    enabled: true,
    locked: true,
    down: new Set(),
    pressed: new Set(),
    buttons: { left: false, right: false },
    clicked: { left: false, right: false },
    consumeMouse: () => [0, 0],
    consumeWheel: () => 0,
    isDown(code) {
      return this.down.has(code);
    },
    wasPressed(code) {
      return this.pressed.has(code);
    },
    press(code) {
      this.pressed.add(code);
    },
    endFrame() {
      this.pressed.clear();
      this.clicked.left = false;
      this.clicked.right = false;
    },
    pollLock() {},
    requestLock() {},
    releaseLock() {},
  };
}

export class AutoBot {
  constructor(game, mode = 'good') {
    this.game = game;
    this.mode = mode;
    this.input = makeBotInput();
    this.known = new Map(); // 적 AI → 드러난 시각
    this.engaged = new Map(); // 적 AI → 마지막으로 눌러 준 시각
    this.onShot = (e) => {
      if (e.team !== 'enemy') return;
      const ai = game.director.byUnit(e.shooter);
      if (ai) this.known.set(ai, game.time);
    };
    this.onCallout = (e) => {
      // 분대가 외친 적 (적 발견) — 가장 가까운 살아 있는 적을 안다고 본다
      if (!e.key || !e.key.startsWith('contact-')) return;
      const id = Number(e.key.slice(8));
      for (const ai of game.director.ais) if (ai.s.id === id) this.known.set(ai, game.time);
    };
    game.events.on(EV.SHOT_FIRED, this.onShot);
    game.events.on(EV.CALLOUT, this.onCallout);
    this.reset();
  }

  dispose() {
    this.game.events.off?.(EV.SHOT_FIRED, this.onShot);
    this.game.events.off?.(EV.CALLOUT, this.onCallout);
  }

  reset() {
    this.known.clear();
    this.engaged.clear();
    this.target = null;
    this.aim = null;
    this.shotsLeft = 0;
    this.shotTimer = 0;
    this.switchTimer = 0;
    this.restTimer = rand(1, 3);
    this.lastG = -99;
    this.lastX = -99;
    this.trigger = false;
    this.peekLeft = 0; // 이번에 일어나서 누를 적 수
    this.hideTimer = rand(0.5, 1.5);
    this.stats = { shots: 0, skippedFriendly: 0, gPresses: 0, refills: 0, peeks: 0 };
  }

  // 매 프레임 (stepSim 전에)
  update(dt) {
    const g = this.game;
    const inp = this.input;
    inp.buttons.left = false;
    if (g.state !== 'playing' || !g.player.alive) return;
    if (this.mode === 'none') return this.keepPosture('crouch');
    if (this.mode === 'random') return this.updateRandom(dt);
    return this.updateGood(dt);
  }

  // 자세 맞추기 (C: 앉기/서기, Z: 엎드리기/서기 — 실제 키와 같은 토글)
  keepPosture(want) {
    const pl = this.game.player;
    if (pl.posture === want || pl.transT < 1) return;
    if (want === 'prone') this.input.press('KeyZ');
    else if (want === 'crouch') this.input.press('KeyC');
    else this.input.press(pl.posture === 'prone' ? 'KeyZ' : 'KeyC');
  }

  aimAt(p) {
    const pl = this.game.player;
    const e = pl.eye;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dz = p.z - e.z;
    pl.yaw = Math.atan2(-dx, -dz);
    pl.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    pl.recoilPitch = 0;
    pl.recoilYaw = 0;
  }

  // 재장전·탄약 상자 (사격 사이에)
  manageAmmo(busy) {
    const g = this.game;
    const pl = g.player;
    const w = pl.weapon;
    if (pl.refill && pl.refill.active) return true;
    if (!w.chambered && !w.reloading) {
      this.input.press('KeyR');
      return true;
    }
    if (busy) return false;
    if (w.mag && w.mag.rounds < 6 && w.totalRounds() > 40 && !w.reloading) {
      this.input.press('KeyR');
      return true;
    }
    // 탄약 상자: 탄이 넉넉하지 않고 지금 아군이 뛰고 있지 않으면 채운다
    const crate = g.ammoCrate;
    const sq = g.squad;
    if (crate && crate.active && crate.rounds > 0 && w.totalRounds() <= 90 && !(sq && sq.bound) && pl.refill && pl.refill.near) {
      this.input.press('KeyF');
      this.stats.refills++;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ 숙련자
  updateGood(dt) {
    const g = this.game;
    const sq = g.squad;
    const now = g.time;
    const pl = g.player;
    // 채우는 중: 탄창 6개(180발)가 차거나 상자가 빌 때까지 (상자가 비면 저절로 멈춘다)
    if (pl.refill && pl.refill.active) {
      if (pl.weapon.totalRounds() >= 180) this.input.press('KeyF');
      return;
    }
    const wanted = this.wantedTargets();
    const busy = wanted.length > 0 && (sq.bound || now - sq.lastBoundEnd > CONFIG.squad.minBoundGap - 2.5);
    if (this.manageAmmo(busy)) return;
    // 숨어 있다가 (바쁘면 짧게) 일어나서 적 1~3명을 누르고 다시 앉는다
    if (this.peekLeft <= 0) {
      this.keepPosture('prone');
      this.hideTimer -= dt;
      if (this.hideTimer > 0 || !wanted.length) return;
      this.peekLeft = busy ? (Math.random() < 0.5 ? 2 : 3) : 1;
      this.hideTimer = busy ? rand(0.5, 1.2) : rand(3, 6);
      this.target = null;
      this.stats.peeks++;
    }
    this.keepPosture('crouch');
    if (pl.posture !== 'crouch' || pl.transT < 1) return;
    // 표적 지시: 가장 오래 못 누른 위협을 15초마다
    if (sq && sq.active && wanted.length && now - this.lastX > CONFIG.squad.designateTime) {
      const ai = wanted[0];
      ai.s.getHeadPos(_v);
      sq.designate(_v.set(_v.x + gauss() * 1.5, _v.y, _v.z + gauss() * 1.5));
      this.lastX = now;
    }
    // 겨누는 중
    if (this.switchTimer > 0) {
      this.switchTimer -= dt;
      if (this.aim) this.aimAt(this.aim);
      return;
    }
    if (!this.target || this.shotsLeft <= 0 || !this.target.s.alive) {
      this.pickNext(wanted);
      if (!this.target) return;
    }
    this.aimAt(this.aim);
    this.shotTimer -= dt;
    if (this.shotTimer <= 0) {
      if (this.friendlyInDanger(this.aim)) {
        this.stats.skippedFriendly++;
        this.engaged.set(this.target, now);
        this.target = null;
        this.peekLeft--;
        return;
      }
      this.input.buttons.left = true; // 한 프레임 당김 (단발)
      this.stats.shots++;
      this.shotsLeft--;
      this.shotTimer = rand(0.16, 0.26);
      this.refreshAim();
      if (this.shotsLeft <= 0) {
        this.engaged.set(this.target, now);
        this.peekLeft--;
      }
    }
    // 위협을 한 바퀴 다 눌렀으면 약진 요청 (G)
    if (sq && sq.active && !sq.bound && wanted.length && now - this.lastG > 4) {
      const allFresh = wanted.every((ai) => now - (this.engaged.get(ai) ?? -99) < 3.0);
      if (allFresh) {
        this.lastG = now;
        this.stats.gPresses++;
        this.input.press('KeyG');
      }
    }
  }

  // 지금 눌러야 할 적: 다음(또는 진행 중) 약진 구간에 사선이 닿고 드러난 적, 오래 못 누른 순
  wantedTargets() {
    const g = this.game;
    const sq = g.squad;
    const now = g.time;
    let list = [];
    if (sq && sq.active) {
      const seg = sq.bound ? { fromId: sq.bound.fromId, toId: sq.bound.toId } : sq.nextPlan();
      if (seg) list = sq.segmentThreats(seg.fromId, seg.toId);
    }
    if (!list.length) list = g.director.ais.filter((a) => a.s.alive);
    list = list.filter((ai) => ai.s.alive && this.known.has(ai));
    // 최근 쏜 적을 조금 앞으로
    list.sort((a, b) => {
      const ea = (this.engaged.get(a) ?? -99) - (now - a.lastShotTime < 3 ? 1.5 : 0);
      const eb = (this.engaged.get(b) ?? -99) - (now - b.lastShotTime < 3 ? 1.5 : 0);
      return ea - eb;
    });
    return list;
  }

  pickNext(wanted) {
    const now = this.game.time;
    this.target = null;
    for (const ai of wanted) {
      if (ai === this.target) continue;
      this.target = ai;
      break;
    }
    if (!this.target) return;
    this.shotsLeft = Math.random() < 0.5 ? 2 : 3;
    this.switchTimer = rand(0.5, 0.9); // 다음 적으로 옮겨 겨누는 시간 (200m 밖, 사람 손)
    this.shotTimer = 0;
    this.refreshAim();
    if (now - (this.engaged.get(this.target) ?? -99) < 0.5) this.shotsLeft = 1;
  }

  // 조준점: 적 머리 근처 (엄폐물 마루 바로 위·앞), 사람의 조준 오차
  refreshAim() {
    const ai = this.target;
    if (!ai) return;
    const fp = ai.fp;
    if (fp && ai.state !== 'fire' && ai.state !== 'observe') {
      _v.set(fp.firePos.x, fp.firePos.y + (CONFIG.squad.enemyEyeHeights[fp.fire] || 1.4), fp.firePos.z);
    } else ai.s.getHeadPos(_v);
    const pl = this.game.player.eye;
    const range = Math.hypot(_v.x - pl.x, _v.z - pl.z);
    const err = 0.004 * range; // 약 4mrad
    this.aim = new THREE.Vector3(_v.x + gauss() * err, _v.y + 0.15 + gauss() * err * 0.5, _v.z + gauss() * err * 0.5);
  }

  // 사격 전환 규칙과 같은 판단 (사선 5°·3m, 탄착점 30m 안 아군)
  friendlyInDanger(aim) {
    const g = this.game;
    const sq = g.squad;
    if (!sq || !sq.active) return false;
    const S = CONFIG.squad.shiftFire;
    const e = g.player.eye;
    _d.subVectors(aim, e);
    const range = _d.length();
    _d.normalize();
    const tan = Math.tan((S.angleDeg * Math.PI) / 180);
    for (const m of sq.members) {
      if (!m.alive) continue;
      m.s.getChestPos(_v);
      if (range >= S.minTargetRange && _v.distanceTo(aim) < S.targetDist) return true;
      _v.sub(e);
      const along = _v.dot(_d);
      if (along < S.minRange || along > range + 5) continue;
      const perp = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      if (perp < S.lineDist || perp < along * tan) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ 아무 데나
  updateRandom(dt) {
    const g = this.game;
    const now = g.time;
    if (this.manageAmmo(false)) return;
    this.keepPosture('stand');
    const pl = g.player;
    if (pl.posture !== 'stand' || pl.transT < 1) return;
    if (!this.aim || this.shotsLeft <= 0) {
      this.restTimer -= dt;
      if (this.restTimer > 0) return;
      this.restTimer = rand(1.0, 2.5);
      this.aim = new THREE.Vector3(rand(-110, 110), rand(0, 4), rand(-160, -60));
      this.shotsLeft = Math.random() < 0.5 ? 1 : 2;
      this.shotTimer = 0.5;
    }
    this.aimAt(this.aim);
    this.shotTimer -= dt;
    if (this.shotTimer <= 0) {
      this.input.buttons.left = true;
      this.stats.shots++;
      this.shotsLeft--;
      this.shotTimer = rand(0.2, 0.4);
    }
    if (g.squad && g.squad.active && now - this.lastG > 15) {
      this.lastG = now;
      this.stats.gPresses++;
      this.input.press('KeyG');
    }
  }
}

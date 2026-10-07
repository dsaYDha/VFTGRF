// =============================================================================
// AmmoCrate — 2단계 임무('약진 엄호')에서만 시작 위치 옆 사격 발판에 놓이는 탄약 상자 (CONFIG.ammoCrate)
//  - 뚜껑을 연 나무 상자 + 안의 종이 탄포(남은 탄에 맞춰 줄어듦), 충돌 상자(나무, 관통 가능)
//  - setActive(bool): 장면·충돌 판정에 넣고 뺀다 (Game: 임무 시작 때 missionId === 'advance')
//  - reset(): 상자를 다시 가득 (totalRounds)
// AmmoRefill — 플레이어가 상자 옆에서 F 로 예비 탄창을 클립으로 채우는 동작 (Player 가 하나 가진다)
//  탄창 하나씩(30발 ≈ 8초): 파우치에서 꺼냄 → 클립마다 꽂기·눌러 넣기·빈 클립 빼기(이때 탄이 옮겨짐) → 파우치에 넣음.
//  F 를 다시 누르거나, 멀어지거나, 달리거나, 방아쇠·재장전, 쓰러지면 멈춘다. 채우는 동안은 총을 내리고 쏠 수 없다.
//  이벤트 EV.AMMO_REFILL {owner, step, mags, magsTotal, crateRounds, ...}
//   step: 'start' | 'clip' (phase: 'take'|'in'|'press'|'out' — 소리용) | 'mag' (탄창 하나 다 채움) | 'stop' (reason)
//   stop reason: 'done' (예비 탄창 모두 가득) | 'empty' (상자 빔) | 'cancel' (F) | 'moved' | 'sprint' | 'fire' | 'reload' | 'incap' | 'inactive'
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { MAP } from './mapData.js';
import { GeoBatch, boxGeo, place } from './geom.js';
import { crateTexture } from './textures.js';

const TAG = 'AMMO_CRATE';
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

// 상자 옆면 스텐실 글씨 (반투명 캔버스)
function stencilTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 96);
  g.fillStyle = 'rgba(222, 214, 182, 0.82)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 34px "Arial Narrow", Arial, sans-serif';
  g.fillText('5,45 ПС гж', 128, 30);
  g.font = 'bold 26px "Arial Narrow", Arial, sans-serif';
  g.fillText('300 шт.', 128, 70);
  // 스텐실 다리 (글씨를 가로지르는 가는 틈) + 칠 벗겨짐
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,1)';
  for (let x = 14; x < 256; x += 19) g.fillRect(x, 0, 2, 96);
  for (let i = 0; i < 90; i++) g.fillRect((i * 97) % 256, (i * 53) % 96, 2 + (i % 4), 1 + (i % 3));
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export class AmmoCrate {
  constructor(game) {
    this.game = game;
    const A = CONFIG.ammoCrate;
    this.capacity = A.totalRounds;
    this.rounds = this.capacity;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.choosePlace();
    this.group = this.buildMesh();
    const [L, H, W] = A.size;
    const col = game.world.collision;
    this.collider = col.addBox(this.pos.x, this.pos.y + H / 2, this.pos.z, L / 2, H / 2, W / 2, this.yaw, 'wood', TAG);
    // 처음에는 없음 (임무가 시작될 때 setActive)
    col.removeCollider(this.collider);
    this.updateContents();
  }

  // 놓을 자리: 시작 위치 옆 사격 발판에서 지면이 평평하고 다른 충돌체와 겹치지 않는 첫 후보
  choosePlace() {
    const A = CONFIG.ammoCrate;
    const t = this.game.world.terrain;
    const col = this.game.world.collision;
    const s = MAP.playerSpawn;
    const [L, H, W] = A.size;
    const benchMid = (t.canalBenchInner() + MAP.canal.bench.outer) / 2;
    let chosen = null;
    let first = null;
    for (let k = 0; k < A.spots.length; k++) {
      const [dx, d] = A.spots[k];
      const x = s.x + dx;
      const z = t.canalZ(x) - (d ?? benchMid);
      const yaw = -Math.atan(t.canalDzDx(x)) + A.yawJitter * (k % 2 ? -1 : 1);
      const c = Math.cos(yaw);
      const sn = Math.sin(yaw);
      // 발자국 네 모서리 + 가운데 지면 높이
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      const pts = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [a, b] of pts) {
        const lx = (a * L) / 2;
        const lz = (b * W) / 2;
        const h = t.heightAt(x + c * lx + sn * lz, z - sn * lx + c * lz);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
        sum += h;
      }
      const y = sum / pts.length;
      const cand = { x, y, z, yaw };
      if (!first) first = cand;
      if (hi - lo > A.flatTol) continue;
      // 다른 충돌체(모래주머니·잡동사니 상자 등)와 겹치는지 (수평 AABB + 높이)
      const r = Math.hypot(L, W) / 2 + A.clear;
      let blocked = false;
      for (const o of col.gatherNear(x, z, r)) {
        if (o.max[1] < y - 0.05 || o.min[1] > y + H + 0.3) continue;
        if (o.max[0] < x - r || o.min[0] > x + r || o.max[2] < z - r || o.min[2] > z + r) continue;
        blocked = true;
        break;
      }
      if (blocked) continue;
      chosen = cand;
      break;
    }
    const p = chosen || first;
    this.pos.set(p.x, p.y - 0.012, p.z);
    this.yaw = p.yaw;
  }

  buildMesh() {
    const A = CONFIG.ammoCrate;
    const [L, H, W] = A.size;
    const tw = 0.018; // 판자 두께
    const b = new GeoBatch();
    // 열린 상자: 바닥 + 긴 벽 2 + 마구리 2 (안이 보이게)
    b.add('crate', place(boxGeo(L, tw, W, 0.6), 0, tw / 2, 0), 0xb4b4a8, 0.2);
    for (const sz of [-1, 1]) b.add('crate', place(boxGeo(L, H, tw, 0.6), 0, H / 2, sz * (W / 2 - tw / 2)), 0xffffff, 0.3);
    for (const sx of [-1, 1]) b.add('crate', place(boxGeo(tw, H, W - 2 * tw, 0.6), sx * (L / 2 - tw / 2), H / 2, 0), 0xf2f2ea, 0.3);
    // 긴 벽 바깥 덧댄 각목 (양끝 가까이)
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) b.add('crate', place(boxGeo(0.05, H, 0.02, 0.6), sx * (L / 2 - 0.06), H / 2, sz * (W / 2 + 0.01)), 0xd6d6cc, 0.35);
    }
    // 마구리 밧줄 손잡이 (반원 고리)
    for (const sx of [-1, 1]) {
      const g = new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI);
      g.rotateZ(-Math.PI / 2);
      g.rotateX(Math.PI / 2);
      g.rotateZ(-0.35);
      if (sx < 0) g.rotateY(Math.PI);
      g.translate(sx * (L / 2 + 0.004), H * 0.62, 0);
      b.add('rope', g, 0x8c7c5c, 0);
    }
    // 앞면 걸쇠 (긴 벽 +z)
    for (const sx of [-1, 1]) b.add('steel', place(boxGeo(0.03, 0.05, 0.006), sx * 0.15, H - 0.03, W / 2 + 0.022), 0x3c3c38, 0);
    // 뚜껑: 뒤쪽(-z, 둔덕 쪽) 긴 벽에 비스듬히 기대 세움
    b.add('crate', place(boxGeo(L + 0.02, 0.02, W + 0.02, 0.6), 0, H * 0.58, -(W / 2 + 0.07), [-1.22, 0, 0]), 0xe8e8de, 0.25);
    const mats = {
      crate: new THREE.MeshLambertMaterial({ map: crateTexture(), vertexColors: true }),
      rope: new THREE.MeshLambertMaterial({ vertexColors: true }),
      steel: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
    const group = b.build(mats, { name: 'ammoCrate' });
    // 스텐실 글씨 (앞면 +z, 오른쪽 마구리 +x)
    const decalMat = new THREE.MeshLambertMaterial({ map: stencilTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    decalMat.userData.noShadow = true;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), decalMat);
    front.position.set(0, H * 0.5, W / 2 + 0.0015);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.08), decalMat);
    side.position.set(L / 2 + 0.0015, H * 0.48, 0);
    side.rotation.y = Math.PI / 2;
    group.add(front, side);
    // 안의 종이 탄포 (InstancedMesh: 보이는 개수 = 남은 탄 / packetRounds, 올림)
    const P = [0.098, 0.06, 0.14];
    const nx = 5;
    const nz = 2;
    const packets = new THREE.InstancedMesh(new THREE.BoxGeometry(P[0], P[1], P[2]), new THREE.MeshLambertMaterial({ color: 0xffffff }), nx * nz);
    packets.name = 'ammoCrate:packets';
    packets.castShadow = false;
    packets.receiveShadow = true;
    let n = 0;
    // 한쪽 끝부터 꺼내 쓴다 (마지막 인스턴스가 먼저 사라짐)
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const j = ((i * 7 + k * 3) % 5) / 5;
        _e.set(0, (j - 0.5) * 0.08, 0);
        _q.setFromEuler(_e);
        _p.set((i - (nx - 1) / 2) * (P[0] + 0.004) + (j - 0.5) * 0.006, tw + P[1] / 2, (k - (nz - 1) / 2) * (P[2] + 0.006));
        _m.compose(_p, _q, _s);
        packets.setMatrixAt(n, _m);
        packets.setColorAt(n, _c.setRGB(0.62 + j * 0.06, 0.55 + j * 0.05, 0.42 + j * 0.03, THREE.SRGBColorSpace));
        n++;
      }
    }
    packets.instanceMatrix.needsUpdate = true;
    if (packets.instanceColor) packets.instanceColor.needsUpdate = true;
    group.add(packets);
    this.packets = packets;
    this.packetMax = n;
    group.position.copy(this.pos);
    group.rotation.y = this.yaw;
    group.updateMatrixWorld(true);
    return group;
  }

  // 임무에 따라 장면·충돌 판정에 넣고 뺀다
  setActive(on) {
    on = !!on;
    if (on === this.active) return;
    this.active = on;
    const col = this.game.world.collision;
    const scene = this.game.scene;
    if (on) {
      col.restoreCollider(this.collider);
      if (scene && !this.group.parent) scene.add(this.group);
    } else {
      col.removeCollider(this.collider);
      if (this.group.parent) this.group.parent.remove(this.group);
    }
  }

  // 새 판: 상자를 다시 가득
  reset() {
    this.rounds = this.capacity;
    this.updateContents();
  }

  // 상자에서 최대 n 발 꺼냄 → 실제로 꺼낸 수
  take(n) {
    const k = Math.max(0, Math.min(Math.floor(n), this.rounds));
    this.rounds -= k;
    if (k) this.updateContents();
    return k;
  }

  // 못 넣은 탄을 되돌림
  giveBack(n) {
    if (n <= 0) return;
    this.rounds = Math.min(this.capacity, this.rounds + n);
    this.updateContents();
  }

  updateContents() {
    if (!this.packets) return;
    this.packets.count = Math.min(this.packetMax, Math.ceil(this.rounds / CONFIG.ammoCrate.packetRounds));
  }

  // 손이 닿는지 판정용: 수평 거리 (높이 차가 maxDy 보다 크면 Infinity)
  distanceTo(p) {
    if (Math.abs(p.y - this.pos.y) > CONFIG.ammoCrate.maxDy) return Infinity;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }
}

// =============================================================================
// AmmoRefill — 플레이어의 탄창 채우기 동작 (Player.update 에서 무기 조작 다음에 update)
// =============================================================================
export class AmmoRefill {
  constructor(player) {
    this.player = player;
    this.game = player.game;
    this.reset();
  }

  reset() {
    this.active = false;
    this.cycle = null; // 지금 채우는 탄창 하나의 진행 {mag, t, steps, next, end}
    this.near = false; // 상자 손 닿는 거리 (HUD 안내)
    this.raise = 0; // 멈춘 뒤 총을 다시 드는 남은 시간
    this.triggerHold = false; // 방아쇠로 멈췄으면 손을 뗄 때까지 사격 무시
    this.filled = 0; // 이번에 다 채운 탄창 수
    this.toFill = 0; // 시작할 때 채울 예비 탄창 수
  }

  // 지금 쓸 수 있는 상자 (2단계 임무에서만 있음)
  get crate() {
    const c = this.game.ammoCrate;
    return c && c.active ? c : null;
  }

  // 1인칭 총을 내리고 있어야 하는지 (ViewModel, 조준 막기)
  get lowered() {
    return this.active || this.raise > 0;
  }

  blocksFire() {
    return this.active || this.raise > 0 || this.triggerHold;
  }

  // 지금 채우는 탄창의 탄 수 (HUD 진행 막대)
  currentMagRounds() {
    if (!this.cycle) return 0;
    const m = this.player.weapon.mags[this.cycle.mag];
    return m ? m.rounds : 0;
  }

  emit(step, extra = null) {
    const w = this.player.weapon;
    const crate = this.game.ammoCrate;
    const e = {
      owner: this.player.body,
      step,
      mags: this.filled,
      magsTotal: this.toFill,
      crateRounds: crate ? crate.rounds : 0,
      mag: this.cycle ? this.cycle.mag : -1,
      rounds: this.currentMagRounds(),
      capacity: w.def.magCapacity,
    };
    if (extra) Object.assign(e, extra);
    this.game.events.emit(EV.AMMO_REFILL, e);
  }

  update(dt, input, canAct) {
    const pl = this.player;
    const w = pl.weapon;
    const crate = this.crate;
    if (this.raise > 0) this.raise = Math.max(0, this.raise - dt);
    if (this.triggerHold && !input.buttons.left) this.triggerHold = false;
    const dist = crate ? crate.distanceTo(pl.pos) : Infinity;
    this.near = !!crate && canAct && dist <= CONFIG.ammoCrate.useRadius;
    const pressedF = input.wasPressed('KeyF');
    if (this.active) {
      let reason = null;
      if (!crate) reason = 'inactive';
      else if (!canAct) reason = 'incap';
      else if (pressedF) reason = 'cancel';
      else if (dist > CONFIG.ammoCrate.leaveRadius) reason = 'moved';
      else if (pl.sprinting) reason = 'sprint';
      else if (w.reloading) reason = 'reload';
      else if (input.buttons.left) {
        reason = 'fire';
        this.triggerHold = true;
      }
      if (reason) this.stop(reason);
      else this.advance(dt);
      return;
    }
    if (pressedF && this.near) this.start(input);
  }

  start(input) {
    const pl = this.player;
    const w = pl.weapon;
    const crate = this.crate;
    const msg = (text) => this.game.events.emit(EV.MESSAGE, { text, kind: 'info' });
    if (!crate || pl.sprinting || input.buttons.left) return;
    if (w.reloading) return msg('재장전 중');
    if (!w.spareNeedsRefill()) return msg('예비 탄창이 모두 가득 찼다');
    if (crate.rounds <= 0) return msg('탄약 상자가 비었다');
    this.active = true;
    this.filled = 0;
    this.toFill = w.spareMagsNotFull();
    this.beginMag();
    if (this.active) this.emit('start');
  }

  // 다음 탄창 하나: 가장 빈 예비 탄창을 꺼내 클립 수만큼 일정을 짠다
  beginMag() {
    const A = CONFIG.ammoCrate;
    const w = this.player.weapon;
    const crate = this.crate;
    this.cycle = null;
    if (!crate || crate.rounds <= 0) return this.stop('empty');
    const mag = w.emptiestSpareMag();
    if (mag < 0) return this.stop('done');
    const need = Math.min(w.def.magCapacity - w.mags[mag].rounds, crate.rounds);
    const clips = Math.max(1, Math.ceil(need / A.clipRounds));
    const steps = [{ at: 0, phase: 'take' }];
    let t = A.takeTime;
    for (let k = 0; k < clips; k++) {
      steps.push({ at: t, phase: 'in' });
      steps.push({ at: t + A.clipInTime, phase: 'press' });
      t += A.clipInTime + A.pressTime;
      steps.push({ at: t, phase: 'out', transfer: true });
      t += A.clipOutTime;
    }
    this.cycle = { mag, t: 0, steps, next: 0, end: t + A.stowTime };
  }

  advance(dt) {
    const c = this.cycle;
    if (!c) return;
    c.t += dt;
    const A = CONFIG.ammoCrate;
    while (c.next < c.steps.length && c.t >= c.steps[c.next].at) {
      const st = c.steps[c.next++];
      if (st.transfer) this.transferClip(c.mag, A.clipRounds);
      this.emit('clip', { phase: st.phase });
    }
    if (c.t >= c.end) {
      this.filled++;
      this.emit('mag');
      const w = this.player.weapon;
      const crate = this.crate;
      if (!crate || crate.rounds <= 0) this.stop('empty');
      else if (!w.spareNeedsRefill()) this.stop('done');
      else this.beginMag();
    }
  }

  // 클립 하나 분량을 상자에서 탄창으로
  transferClip(mag, n) {
    const w = this.player.weapon;
    const crate = this.crate;
    if (!crate) return;
    const room = w.def.magCapacity - w.mags[mag].rounds;
    const got = crate.take(Math.min(n, room));
    const added = w.addRoundsToMag(got, mag);
    if (added < got) crate.giveBack(got - added);
  }

  stop(reason) {
    if (!this.active) return;
    this.emit('stop', { reason });
    this.active = false;
    this.cycle = null;
    this.raise = CONFIG.ammoCrate.raiseTime;
  }
}

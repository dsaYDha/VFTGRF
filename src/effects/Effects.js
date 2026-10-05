// =============================================================================
// Effects — 총구 화염·흙먼지, 재질별 탄착 효과(거리 보정), 예광탄, 파편, 탄흔, 원경 연기
// 탄착 효과는 플레이어가 사격을 수정하는 핵심 단서이므로 멀리서도 보이게 크기를 키운다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { MAP } from '../world/mapData.js';
import { ParticleSystem } from './ParticleSystem.js';
import { DebrisSystem } from './DebrisSystem.js';
import { TracerSystem } from './TracerSystem.js';
import { smokeParticleTexture, glowParticleTexture, flashTexture, bulletHoleTexture } from '../world/textures.js';
import { rand } from '../core/Random.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
const HARD = new Set(['concrete', 'brick', 'armor', 'steel', 'sheetMetal', 'carBody', 'wood', 'log', 'slate', 'thinWall']);

export class Effects {
  constructor(game) {
    this.game = game;
    const E = CONFIG.effects;
    this.dust = new ParticleSystem({ max: E.maxDust, texture: smokeParticleTexture(), fogMul: E.particleFogMul });
    this.glow = new ParticleSystem({ max: E.maxGlow, texture: glowParticleTexture(), additive: true, fogMul: 0.4, renderOrder: 4 });
    this.flashes = new ParticleSystem({ max: 96, texture: flashTexture(), additive: true, fogMul: 0.3, renderOrder: 4 });
    this.distant = new ParticleSystem({ max: 1400, texture: smokeParticleTexture(), fogMul: 0.12, renderOrder: 0 });
    this.debris = new DebrisSystem(E.maxDebris, game.world.terrain);
    this.tracers = new TracerSystem(E.maxTracers);
    const scene = game.scene;
    for (const s of [this.distant, this.dust, this.glow, this.flashes, this.tracers]) scene.add(s.mesh);
    scene.add(this.debris.mesh);
    // 탄흔
    const hm = new THREE.MeshLambertMaterial({
      map: bulletHoleTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), hm, E.maxDecals);
    this.holes.count = 0;
    this.holes.frustumCulled = false;
    this.holeNext = 0;
    scene.add(this.holes);
    const W = CONFIG.atmosphere;
    this.wind = new THREE.Vector3(...W.windDirection).normalize().multiplyScalar(W.windSpeed);
    this.dustWind = this.wind.clone().multiplyScalar(0.35);
    this.initDistantSmoke();

    game.events.on(EV.SHOT_FIRED, (e) => this.onShot(e));
    game.events.on(EV.BULLET_IMPACT, (e) => this.onImpact(e));
  }

  // 멀리서도 보이게 크기 보정
  distScale(x, y, z) {
    const E = CONFIG.effects;
    const c = this.game.camera.position;
    const d = Math.hypot(x - c.x, y - c.y, z - c.z);
    if (d <= E.distanceScaleRef) return 1;
    return Math.min(E.distanceScaleMax, Math.pow(d / E.distanceScaleRef, E.distanceScaleExp));
  }

  // ------------------------------------------------------------------ 사격
  onShot(e) {
    const p = e.origin;
    const s = this.distScale(p.x, p.y, p.z);
    const isPlayer = e.shooter === this.game.player.body;
    if (!isPlayer) {
      // 짧고 밝은 총구 화염 (흐린 날에도 보이게)
      this.flashes.spawn({
        x: p.x,
        y: p.y,
        z: p.z,
        life: CONFIG.effects.muzzleFlashTime,
        size0: CONFIG.effects.muzzleFlashSize * s,
        size1: CONFIG.effects.muzzleFlashSize * 1.3 * s,
        color: 0xffe2b0,
        bright: 3,
        alpha: 1,
        fadeIn: 0,
      });
      this.glow.spawn({
        x: p.x,
        y: p.y,
        z: p.z,
        life: 0.07,
        size0: 1.1 * s,
        size1: 1.4 * s,
        color: 0xffa050,
        bright: 1.6,
        alpha: 0.55,
        fadeIn: 0,
      });
      this.dust.spawn({
        x: p.x + e.dir.x * 0.3,
        y: p.y + 0.05,
        z: p.z + e.dir.z * 0.3,
        vx: e.dir.x * 1.5,
        vy: 0.4,
        vz: e.dir.z * 1.5,
        life: 1.1,
        size0: 0.2 * s,
        size1: 0.9 * s,
        color: 0x9a9690,
        alpha: 0.22,
        drag: 2.5,
      });
    }
    // 엎드려 쏘거나 흉벽 위로 쏘면 총구 앞 흙먼지
    if (e.muzzleNearGround) {
      const t = this.game.world.terrain;
      const fx = e.dir.x;
      const fz = e.dir.z;
      const fl = Math.hypot(fx, fz) || 1;
      for (let i = 0; i < 3; i++) {
        const d = 0.4 + i * 0.35;
        const x = p.x + (fx / fl) * d;
        const z = p.z + (fz / fl) * d;
        const y = Math.max(t.heightAt(x, z) + 0.1, p.y - 0.3);
        this.dust.spawn({
          x,
          y,
          z,
          vx: (fx / fl) * rand(1.5, 3.5) + rand(-0.8, 0.8),
          vy: rand(0.3, 0.9),
          vz: (fz / fl) * rand(1.5, 3.5) + rand(-0.8, 0.8),
          life: rand(1.4, 2.4),
          size0: 0.35 * s,
          size1: rand(1.4, 2.2) * s,
          color: 0x7c6b57,
          alpha: 0.7,
          drag: 1.8,
        });
      }
    }
  }

  // ------------------------------------------------------------------ 탄착
  onImpact(imp) {
    const s = this.distScale(imp.x, imp.y, imp.z);
    _n.set(imp.nx, imp.ny, imp.nz);
    const fx = imp.effect;
    if (fx === 'dirt') this.dirt(imp, s, false);
    else if (fx === 'subsoil') this.dirt(imp, s, false, true);
    else if (fx === 'mud') this.dirt(imp, s, true);
    else if (fx === 'water') this.water(imp, s);
    else if (fx === 'concrete') this.mineral(imp, s, 0x9b9890, 0x8c8a84);
    else if (fx === 'brick') this.mineral(imp, s, 0x8f6656, 0x7a4a3a);
    else if (fx === 'metal') this.metal(imp, s);
    else if (fx === 'wood') this.wood(imp, s);
    else if (fx === 'sand') this.sand(imp, s);
    else if (fx === 'flesh') this.flesh(imp, s, false);
    else if (fx === 'plate') this.flesh(imp, s, true);
    if (HARD.has(imp.material) && !imp.unit) this.addHole(imp);
  }

  spray(imp, count, speed, spread, o) {
    // 멀리 있는 탄착은 기둥이 더 높이 솟아 보이게 속도도 조금 키운다
    const vk = o.velScale || 1;
    for (let i = 0; i < count; i++) {
      _v.copy(_n).multiplyScalar((speed[0] + Math.random() * (speed[1] - speed[0])) * vk);
      _v.x += (Math.random() - 0.5) * spread;
      _v.y += (Math.random() - 0.5) * spread + (o.up || 0);
      _v.z += (Math.random() - 0.5) * spread;
      o.sys.spawn({
        x: imp.x + _n.x * 0.05,
        y: imp.y + _n.y * 0.05,
        z: imp.z + _n.z * 0.05,
        vx: _v.x,
        vy: _v.y,
        vz: _v.z,
        life: o.life[0] + Math.random() * (o.life[1] - o.life[0]),
        size0: o.size[0],
        size1: o.size[1],
        color: o.color,
        alpha: o.alpha,
        drag: o.drag ?? 2,
        gravity: o.gravity ?? 0,
        bright: o.bright,
        fadeIn: o.fadeIn,
      });
    }
  }

  chips(imp, count, s, color, size, speed = [2, 6]) {
    const k = Math.sqrt(s);
    for (let i = 0; i < count; i++) {
      _v.copy(_n).multiplyScalar(speed[0] + Math.random() * (speed[1] - speed[0]));
      _v.x += (Math.random() - 0.5) * 3;
      _v.y += Math.random() * 2.5;
      _v.z += (Math.random() - 0.5) * 3;
      const sz = size * (0.6 + Math.random() * 0.8) * k;
      this.debris.spawn({
        x: imp.x + _n.x * 0.05,
        y: imp.y + _n.y * 0.05,
        z: imp.z + _n.z * 0.05,
        vx: _v.x,
        vy: _v.y,
        vz: _v.z,
        size: [sz, sz * 0.7, sz * 0.9],
        color,
        life: 2.5 + Math.random() * 2,
      });
    }
  }

  dirt(imp, s, wet, light = false) {
    // 흙먼지 기둥 (멀리서도 보이도록 밝은 흙빛 + 어두운 흙 줄기) + 흙덩이
    // light: 파낸 하층토 (흉벽·구덩이 분출물) — 밝은 황갈색 먼지
    const brown = light ? 0x9c8664 : wet ? 0x5a4c3e : 0x7c6b57;
    const vk = 0.65 + 0.35 * s;
    this.spray(imp, wet ? 4 : 6, [1.5, 4.5], 2.0, {
      sys: this.dust,
      life: [1.6, 3.0],
      size: [0.25 * s, 1.3 * s],
      color: brown,
      alpha: wet ? 0.8 : 0.95,
      drag: 2.8,
      gravity: 0.6,
      up: 0.8,
      velScale: vk,
    });
    this.spray(imp, 3, [5, 9], 1.2, {
      sys: this.dust,
      life: [0.8, 1.3],
      size: [0.12 * s, 0.55 * s],
      color: light ? 0x6e5c44 : wet ? 0x2e2620 : 0x43382d,
      alpha: 1,
      drag: 3.0,
      gravity: 6,
      up: 1.5,
      velScale: vk,
    });
    this.chips(imp, wet ? 9 : 6, s, light ? 0x8a7454 : wet ? 0x2a221c : 0x3a3027, 0.05, [2, 6]);
  }

  water(imp, s) {
    this.spray(imp, 6, [3, 7], 1.5, {
      sys: this.dust,
      life: [0.6, 1.1],
      size: [0.12 * s, 0.6 * s],
      color: 0xaeb2b2,
      alpha: 0.7,
      drag: 2,
      gravity: 6,
      up: 3,
    });
    this.spray(imp, 3, [1, 2], 2, { sys: this.dust, life: [0.8, 1.4], size: [0.2 * s, 0.9 * s], color: 0x6a6a64, alpha: 0.4, drag: 2 });
  }

  mineral(imp, s, dustColor, chipColor) {
    this.spray(imp, 6, [2, 5], 2.5, {
      sys: this.dust,
      life: [1.4, 2.6],
      size: [0.24 * s, 1.25 * s],
      color: dustColor,
      alpha: 0.95,
      drag: 2.8,
      gravity: 0.4,
    });
    this.chips(imp, 7, s, chipColor, 0.04, [3, 8]);
    if (Math.random() < 0.35) this.sparks(imp, s, 4);
  }

  metal(imp, s) {
    this.sparks(imp, s, 12);
    this.glow.spawn({ x: imp.x, y: imp.y, z: imp.z, life: 0.06, size0: 0.45 * s, size1: 0.6 * s, color: 0xffd090, bright: 2.5, alpha: 1, fadeIn: 0 });
    this.spray(imp, 2, [0.5, 1.5], 1, { sys: this.dust, life: [0.8, 1.4], size: [0.12 * s, 0.6 * s], color: 0x7a7672, alpha: 0.4, drag: 2 });
  }

  sparks(imp, s, n) {
    const k = Math.sqrt(s);
    this.spray(imp, n, [4, 13], 7, {
      sys: this.glow,
      life: [0.15, 0.45],
      size: [0.07 * k, 0.04 * k],
      color: 0xffb060,
      bright: 3,
      alpha: 1,
      drag: 1.2,
      gravity: 9,
      fadeIn: 0,
    });
  }

  wood(imp, s) {
    this.spray(imp, 3, [1.5, 4], 2, { sys: this.dust, life: [0.9, 1.6], size: [0.15 * s, 0.7 * s], color: 0x9a8a6e, alpha: 0.6, drag: 2.5 });
    const k = Math.sqrt(s);
    for (let i = 0; i < 6; i++) {
      _v.copy(_n).multiplyScalar(2 + Math.random() * 5);
      this.debris.spawn({
        x: imp.x,
        y: imp.y,
        z: imp.z,
        vx: _v.x + (Math.random() - 0.5) * 3,
        vy: _v.y + Math.random() * 3,
        vz: _v.z + (Math.random() - 0.5) * 3,
        size: [0.012 * k, 0.012 * k, (0.06 + Math.random() * 0.08) * k],
        color: 0xb8a07a,
        life: 3,
      });
    }
  }

  sand(imp, s) {
    this.spray(imp, 5, [1.5, 4.5], 2, { sys: this.dust, life: [1.4, 2.4], size: [0.22 * s, 1.15 * s], color: 0x9a8b70, alpha: 0.9, drag: 2.8, gravity: 0.6, up: 0.8 });
    this.chips(imp, 3, s, 0x7a6e58, 0.03);
  }

  flesh(imp, s, plate) {
    this.spray(imp, plate ? 2 : 3, [0.5, 1.8], 1, {
      sys: this.dust,
      life: [0.5, 0.9],
      size: [0.1 * s, 0.45 * s],
      color: plate ? 0x8a8478 : 0x4a2a24,
      alpha: 0.55,
      drag: 3,
    });
  }

  addHole(imp) {
    const i = this.holeNext;
    this.holeNext = (this.holeNext + 1) % CONFIG.effects.maxDecals;
    _n.set(imp.nx, imp.ny, imp.nz);
    _q.setFromUnitVectors(_z, _n);
    const sz = 0.05 + Math.random() * 0.04;
    _v.set(imp.x + _n.x * 0.01, imp.y + _n.y * 0.01, imp.z + _n.z * 0.01);
    _m.compose(_v, _q, new THREE.Vector3(sz, sz, sz));
    this.holes.setMatrixAt(i, _m);
    this.holes.count = Math.max(this.holes.count, i + 1);
    this.holes.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ 원경 연기 기둥
  initDistantSmoke() {
    this.columns = MAP.distantSmoke.map((c) => {
      const a = (c.bearing * Math.PI) / 180;
      return { x: Math.sin(a) * c.dist, z: -Math.cos(a) * c.dist, size: c.size, acc: Math.random() };
    });
    // 미리 시뮬레이션해 처음부터 기둥이 서 있게
    for (let t = 0; t < 90; t += 0.5) {
      this.emitDistant(0.5);
      this.distant.update(0.5, this.wind);
    }
  }

  emitDistant(dt) {
    for (const c of this.columns) {
      c.acc += dt;
      while (c.acc > 0.45) {
        c.acc -= 0.45;
        this.distant.spawn({
          x: c.x + rand(-6, 6),
          y: 8,
          z: c.z + rand(-6, 6),
          vx: rand(-0.5, 0.5),
          vy: rand(4, 6.5) * c.size,
          vz: rand(-0.5, 0.5),
          life: rand(70, 95),
          size0: 30 * c.size,
          size1: rand(170, 240) * c.size,
          color: 0x2e2c2a,
          alpha: 0.3,
          drag: 0.02,
          fadeIn: 0.05,
          rotVel: rand(-0.02, 0.02),
        });
      }
    }
  }

  update(dt) {
    this.tracers.update(this.game.ballistics.active, this.glow, dt, this.game.camera.position);
    this.dust.update(dt, this.dustWind);
    this.glow.update(dt, null);
    this.flashes.update(dt, null);
    this.debris.update(dt);
    this.emitDistant(dt);
    this.distant.update(dt, this.wind);
  }

  reset() {
    this.dust.clear();
    this.glow.clear();
    this.flashes.clear();
    this.debris.clear();
    this.holes.count = 0;
    this.holeNext = 0;
  }
}

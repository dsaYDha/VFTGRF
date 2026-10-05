// =============================================================================
// SmokeColumns — 연기 기둥 (건물 화재 + 원경). 파티클 시스템 하나(드로우콜 1)로 모든 기둥을 그린다.
// 지면 근처 발원점에서 짙고 좁게 시작해 올라가며 넓어지고 옅어지며, bendHeight 위에서 바람을 받아
// 휘어 길게 흘러간다. 부드러운 원형 스프라이트 수십 장이 각각 아주 천천히 돌고 커진다.
// 위치: MAP.smokeSources (건물 화재), MAP.distantSmoke (원경, 방위각·거리). 수치: CONFIG.smoke
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MAP } from '../world/mapData.js';
import { ParticleSystem } from './ParticleSystem.js';
import { smokePuffTexture } from '../world/textures.js';

const _ca = new THREE.Color();
const _cb = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (range) => _ca.set(range[0]).lerp(_cb.set(range[1]), Math.random()).getHex();

export class SmokeColumns {
  constructor(scene, terrain) {
    const S = CONFIG.smoke;
    this.ps = new ParticleSystem({
      max: S.maxParticles,
      texture: smokePuffTexture(),
      fogMul: 1,
      renderOrder: 0,
      sizeCurve: 'plume',
      fadePow: 1.25,
      shade: S.shade,
    });
    this.ps.mesh.name = 'smokeColumns';
    scene.add(this.ps.mesh);
    const W = CONFIG.atmosphere;
    this.wind = new THREE.Vector3(...W.windDirection).normalize().multiplyScalar(W.windSpeed);
    const groundY = (x, z) => {
      const y = terrain ? terrain.heightAt(x, z) : 0;
      return Number.isFinite(y) ? y : 0;
    };
    this.sources = [];
    for (const s of MAP.smokeSources || []) {
      this.sources.push({ x: s.x, z: s.z, y: groundY(s.x, s.z), k: s.size ?? 1, P: S[s.kind] || S.fire, acc: Math.random() });
    }
    for (const c of MAP.distantSmoke || []) {
      const a = (c.bearing * Math.PI) / 180;
      const x = Math.sin(a) * c.dist;
      const z = -Math.cos(a) * c.dist;
      this.sources.push({ x, z, y: groundY(x, z), k: c.size ?? 1, P: S.distant, acc: Math.random() });
    }
    // 미리 흘려 두어 처음부터 기둥이 서 있게 (종류별 prewarm 시간만큼)
    const maxPre = Math.max(0, ...this.sources.map((s) => s.P.prewarm || 0));
    const step = 0.5;
    for (let t = 0; t < maxPre; t += step) {
      this.emit(step, maxPre - t);
      this.ps.update(step, this.wind);
    }
  }

  // remain: 미리 흘리기 중 남은 시간 (그 종류의 prewarm 보다 크면 아직 내보내지 않음)
  emit(dt, remain = 0) {
    for (const s of this.sources) {
      const P = s.P;
      if (remain > (P.prewarm || 0)) continue;
      s.acc += dt * P.rate;
      while (s.acc >= 1) {
        s.acc -= 1;
        const k = s.k;
        const ang = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * P.spread * k;
        this.ps.spawn({
          x: s.x + Math.cos(ang) * r,
          y: s.y + Math.random() * 0.6 * k,
          z: s.z + Math.sin(ang) * r,
          vx: rnd(-0.15, 0.15),
          vy: rnd(P.rise[0], P.rise[1]) * Math.sqrt(k),
          vz: rnd(-0.15, 0.15),
          life: rnd(P.life[0], P.life[1]),
          size0: rnd(P.size[0], P.size[1]) * k,
          size1: rnd(P.grow[0], P.grow[1]) * k,
          rot: Math.random() * Math.PI * 2,
          rotVel: rnd(-0.05, 0.05),
          color: pick(P.colorNear),
          color1: pick(P.colorFar),
          alpha: P.alpha * rnd(0.8, 1.1),
          drag: P.windDrag,
          dragY: P.riseDrag,
          baseY: s.y,
          shear: P.bendHeight * k,
          windMin: P.windMin,
          fadeIn: 0.04,
        });
      }
    }
  }

  update(dt) {
    this.emit(dt);
    this.ps.update(dt, this.wind);
  }
}

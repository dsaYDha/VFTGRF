// =============================================================================
// Perception — 적은 플레이어의 정확한 위치가 아니라 '추정 위치'를 기억한다.
//  갱신: 관측 중 시야에 들어올 때(거리·자세·움직임·은폐·안개에 따른 확률),
//        플레이어가 쏠 때(총구 화염을 보면 정확, 총성만 들으면 거리 비례 오차).
//  시간이 지나면 오차가 커지고, 오래되면 '수로 어딘가'라는 처음 추정으로 돌아간다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { AI_MAP } from '../world/mapData.js';
import { rand, gauss } from '../core/Random.js';

const _eye = new THREE.Vector3();
const _pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const W = [0.35, 0.4, 0.25];
const SOURCE_RANK = { prior: 0, shared: 1, sound: 2, flash: 3, visual: 4 };

export class Perception {
  constructor(game, soldier) {
    this.game = game;
    this.soldier = soldier;
    this.estimate = new THREE.Vector3();
    this.has = false;
    this.visible = false;
    this.visibleFrac = 0;
    this.timer = Math.random() * 0.2;
    this.lastSeen = -999;
    this.setPrior();
  }

  setPrior() {
    const Z = AI_MAP.priorZone;
    const x = rand(Z.x0, Z.x1);
    const z = Z.z;
    this.estimate.set(x, this.game.world.terrain.heightAt(x, z) + 0.35, z);
    this.sigma = CONFIG.ai.priorError;
    this.time = this.game.time;
    this.source = 'prior';
    this.has = true;
  }

  effectiveSigma(now = this.game.time) {
    return this.sigma + Math.max(0, now - this.time) * CONFIG.ai.estimateGrowthPerSec;
  }

  age(now = this.game.time) {
    return now - this.time;
  }

  // exposed: 고개를 내밀고 있는가 (관측·사격 중)
  update(dt, exposed, rateMul = 1) {
    const A = CONFIG.ai;
    const now = this.game.time;
    if (this.source !== 'prior' && now - this.time > A.estimateForgetTime) this.setPrior();
    this.timer -= dt;
    if (!exposed) {
      this.visible = false;
      return;
    }
    if (this.timer > 0) return;
    this.timer = A.perceptionInterval;
    const pl = this.game.player;
    if (!pl.alive) {
      this.visible = false;
      return;
    }
    const col = this.game.world.collision;
    this.soldier.getEyePos(_eye);
    pl.visibilityPoints(_pts);
    let frac = 0;
    for (let i = 0; i < 3; i++) {
      const p = _pts[i];
      if (!col.lineBlocked(_eye.x, _eye.y, _eye.z, p.x, p.y, p.z)) {
        frac += W[i] * col.concealment(_eye.x, _eye.y, _eye.z, p.x, p.y, p.z);
      }
    }
    this.visibleFrac = frac;
    this.visible = frac > 0.05;
    if (!this.visible) return;
    const d = _eye.distanceTo(pl.eye);
    let rate = A.detectBaseRate * Math.pow(100 / Math.max(d, 30), A.detectRangeExp);
    rate *= A.detectPostureMul[pl.posture] || 1;
    rate *= A.detectMotionMul[pl.speedClass] || 1;
    const fd = CONFIG.atmosphere.fogDensity * d;
    rate *= Math.exp(-fd * fd);
    rate *= frac * rateMul;
    if (now - pl.lastShotTime < 1.0) rate *= A.firingDetectMul;
    const p = 1 - Math.exp(-rate * A.perceptionInterval);
    if (Math.random() < p) {
      this.lastSeen = now;
      this.observe(_pts[1], A.visualErrorBase + d * A.visualErrorPerMeter, 'visual');
    }
  }

  // 관측값 반영 (오차 포함). 일관되면 기존 추정과 합쳐 점점 정확해진다
  observe(pos, sigma, source) {
    const now = this.game.time;
    const ex = gauss() * sigma;
    const ez = gauss() * sigma;
    const ox = pos.x + ex;
    const oz = pos.z + ez;
    const oy = source === 'visual' || source === 'flash' ? pos.y + gauss() * sigma * 0.15 : this.game.world.terrain.heightAt(ox, oz) + 0.4;
    if (this.has && this.source !== 'prior' && source !== 'visual') {
      const cur = this.effectiveSigma(now);
      const dist = Math.hypot(ox - this.estimate.x, oz - this.estimate.z);
      if (dist < 2.5 * Math.max(cur, sigma)) {
        const w1 = 1 / (cur * cur);
        const w2 = 1 / (sigma * sigma);
        const k = w2 / (w1 + w2);
        this.estimate.x += (ox - this.estimate.x) * k;
        this.estimate.z += (oz - this.estimate.z) * k;
        this.estimate.y += (oy - this.estimate.y) * k;
        // 화염·총성을 아무리 모아도 직접 본 것만큼 정확해지지는 않는다
        const A = CONFIG.ai;
        const floor = source === 'sound' || source === 'shared' ? A.soundErrorMin : A.flashErrorMin;
        this.sigma = Math.max(floor, 1 / Math.sqrt(w1 + w2));
        this.time = now;
        if (SOURCE_RANK[source] > SOURCE_RANK[this.source]) this.source = source;
        return true;
      }
    }
    this.estimate.set(ox, oy, oz);
    this.sigma = sigma;
    this.time = now;
    this.source = source;
    this.has = true;
    return true;
  }

  // 플레이어 사격: 총구 화염(보이면) 또는 총성
  onPlayerShot(e, exposed) {
    const A = CONFIG.ai;
    const now = this.game.time;
    this.soldier.getEyePos(_eye);
    const o = e.origin;
    const d = _eye.distanceTo(o);
    const col = this.game.world.collision;
    if (exposed && !col.lineBlocked(_eye.x, _eye.y, _eye.z, o.x, o.y, o.z) && Math.random() < A.flashDetectChance) {
      return this.observe(o, A.flashErrorBase + d * A.flashErrorPerMeter, 'flash');
    }
    // 최근에 더 정확한 정보가 있으면 총성은 무시
    if ((this.source === 'visual' || this.source === 'flash') && now - this.time < 4) return false;
    return this.observe(o, Math.max(3, d * A.soundErrorPerMeter), 'sound');
  }

  receiveShared(pos, sigma) {
    const s = sigma * CONFIG.ai.shareErrorMul;
    if (s < this.effectiveSigma() * 0.9) this.observe(pos, s, 'shared');
  }

  // 조준점: 지금 보이면 실제 위치 근처, 아니면 추정 위치 주변
  aimPoint(out, spreadMul = 1) {
    const pl = this.game.player;
    const A = CONFIG.ai;
    if (this.visible && this.game.time - this.lastSeen < 2.5 && pl.alive) {
      pl.visibilityPoints(_pts);
      const p = this.visibleFrac > 0.5 ? _pts[1] : _pts[0];
      return out.set(p.x + gauss() * A.trackingError, p.y + gauss() * A.trackingError * 0.5, p.z + gauss() * A.trackingError);
    }
    const s = this.effectiveSigma() * A.aimPointSpreadMul * spreadMul;
    out.set(this.estimate.x + gauss() * s, this.estimate.y + gauss() * 0.25, this.estimate.z + gauss() * s * 0.5);
    return out;
  }
}

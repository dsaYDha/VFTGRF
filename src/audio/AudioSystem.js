// =============================================================================
// AudioSystem — Web Audio 합성음 재생
//  3D 위치 음향(HRTF), 음속(340m/s) 지연, 거리별 음색(저역 통과)·잔향 비율,
//  적 탄이 3m 이내를 지나면 총성보다 먼저 들리는 초음속 파열음.
//  시스템과는 이벤트로만 연결된다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { buildSoundBank } from './SoundBank.js';
import { SR, buf, rng, noise, lowpass, toBuffer } from './dsp.js';
import { rand, randRange } from '../core/Random.js';

const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.nextArtillery = 5;
    this.nextDistantFire = 9;
    this.pendingCasing = [];
    const ev = game.events;
    ev.on(EV.SHOT_FIRED, (e) => this.onShot(e));
    ev.on(EV.BULLET_IMPACT, (e) => this.onImpact(e));
    ev.on(EV.BULLET_NEAR_MISS, (e) => this.onNearMiss(e));
    ev.on(EV.RELOAD_STEP, (e) => {
      if (e.owner === game.player.body) this.playUI(e.step, CONFIG.audio.reloadGain);
    });
    ev.on(EV.FIRE_MODE, (e) => {
      if (e.owner === game.player.body) this.playUI('selector', 0.6);
    });
    ev.on(EV.DRY_FIRE, (e) => {
      if (e.owner === game.player.body) this.playUI('dryFire', 0.6);
    });
    ev.on(EV.FOOTSTEP, (e) => this.onStep(e));
    ev.on(EV.UNIT_HIT, (e) => {
      if (e.unit === game.player.body) this.onPlayerHit(e);
    });
  }

  // 사용자 입력(클릭) 뒤에 호출해야 소리가 난다
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.bank = buildSoundBank(ctx);
    // 출력 체인: master → compressor → destination
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = CONFIG.audio.master;
    // 피격·폭발 시 먹먹해지는 효과용 저역 통과
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle);
    this.muffle.connect(this.comp);
    this.comp.connect(ctx.destination);
    // 잔향 (합성 임펄스 응답)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR();
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.8;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.startAmbience();
    this.ready = true;
    if (ctx.state === 'suspended') await ctx.resume();
  }

  makeIR() {
    const dur = 2.6;
    const r = rng(4242);
    const chans = [0, 1].map(() => {
      const a = noise(buf(dur), 1, r);
      lowpass(a, 2400);
      for (let i = 0; i < a.length; i++) {
        const t = i / SR;
        a[i] *= Math.exp(-t / 0.55) * Math.min(1, t * 60);
      }
      // 이른 반사 (지면·건물)
      for (const [dt, g] of [
        [0.028, 0.5],
        [0.061, 0.32],
        [0.12, 0.2],
        [0.34, 0.12],
      ]) {
        const k = Math.floor((dt + r() * 0.01) * SR);
        if (k < a.length) a[k] += g;
      }
      return a;
    });
    return toBuffer(this.ctx, chans);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  pick(name) {
    const list = this.bank[name];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 위치 소리: 거리 지연·감쇠·저역 통과·잔향
  playAt(name, x, y, z, { gain = 1, delay = 0, lowpass = 20000, reverb = 0.25, rate = 1, minGain = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pick(name);
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.max(minGain, gain);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    f.Q.value = 0.5;
    const p = ctx.createPanner();
    p.panningModel = CONFIG.audio.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 0; // 감쇠는 직접 계산
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    src.connect(g);
    g.connect(f);
    f.connect(p);
    p.connect(this.master);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb * gain;
      f.connect(s);
      s.connect(this.reverb);
    }
    src.start(ctx.currentTime + Math.max(0, delay));
  }

  // 귀 바로 앞 소리 (내 총·조작음)
  playUI(name, gain = 1, delay = 0, reverb = 0) {
    if (!this.ready || !this.bank[name]) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pick(name);
    src.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb * gain;
      g.connect(s);
      s.connect(this.reverb);
    }
    src.start(ctx.currentTime + delay);
  }

  listenerDist(x, y, z) {
    const c = this.game.camera.position;
    return Math.hypot(x - c.x, y - c.y, z - c.z);
  }

  // ------------------------------------------------------------------ 이벤트
  onShot(e) {
    if (!this.ready) return;
    const A = CONFIG.audio;
    const isPlayer = e.shooter === this.game.player.body;
    if (isPlayer) {
      this.playUI('shotNear', A.gunshotNearGain, 0, A.reverbSend.near);
      // 탄피 떨어지는 소리
      this.playUI('casing', A.casingGain, rand(0.35, 0.6));
      return;
    }
    const p = e.origin;
    const d = this.listenerDist(p.x, p.y, p.z);
    const delay = d / A.speedOfSound;
    const g = Math.max(A.gunshotMinGain, Math.pow(A.gunshotFarRef / Math.max(d, A.gunshotFarRef), A.gunshotFarExp));
    const t = Math.min(1, d / A.farLowpass.range);
    const lp = A.farLowpass.near + (A.farLowpass.far - A.farLowpass.near) * t;
    const near = d < 40;
    this.playAt(near ? 'shotNear' : 'shotFar', p.x, p.y, p.z, {
      gain: g * (near ? 0.9 : 1.15),
      delay,
      lowpass: lp,
      reverb: A.reverbSend.near + (A.reverbSend.far - A.reverbSend.near) * t,
      rate: 0.94 + Math.random() * 0.1,
    });
  }

  onImpact(imp) {
    if (!this.ready) return;
    const A = CONFIG.audio;
    const d = this.listenerDist(imp.x, imp.y, imp.z);
    if (d > A.impactMaxDist) return;
    const name = this.bank[imp.effect] ? imp.effect : 'dirt';
    const g = A.impactGain * Math.min(1, Math.pow(4 / Math.max(4, d), 1.1));
    if (g < 0.01) return;
    this.playAt(name, imp.x, imp.y, imp.z, {
      gain: g,
      delay: d / A.speedOfSound,
      lowpass: d < 15 ? 16000 : 5000,
      reverb: 0.15,
      rate: 0.9 + Math.random() * 0.2,
    });
    if (imp.ricochet && d < 40) {
      this.playAt('ricochet', imp.x, imp.y, imp.z, { gain: g * 1.2, delay: d / A.speedOfSound, reverb: 0.2, rate: 0.85 + Math.random() * 0.3 });
    }
  }

  // 적 탄이 플레이어 근처를 지남 → 파열음 (총성보다 먼저)
  onNearMiss(e) {
    if (!this.ready) return;
    if (e.target !== this.game.player.body) return;
    const A = CONFIG.audio;
    if (e.distance > CONFIG.suppression.playerNearMissCrackDist) return;
    const p = e.point;
    const g = A.crackGain * Math.min(1, 1.6 / (0.6 + e.distance));
    this.playAt('crack', p.x, p.y, p.z, { gain: g, delay: 0, reverb: 0.3, rate: 0.92 + Math.random() * 0.16 });
  }

  onStep(e) {
    if (!this.ready) return;
    if (e.unit !== this.game.player.body) return;
    const name = 'step_' + (e.surface === 'gravel' ? 'gravel' : e.surface === 'water' ? 'water' : e.surface === 'grass' ? 'grass' : e.surface === 'hard' ? 'hard' : 'mud');
    this.playUI(name, CONFIG.audio.footstepGain * e.intensity);
  }

  onPlayerHit(e) {
    if (!this.ready) return;
    this.playUI(e.plate ? 'plate' : 'flesh', 1.0);
    // 잠깐 먹먹해짐
    const f = this.muffle.frequency;
    const now = this.ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(e.plate ? 600 : 400, now);
    f.exponentialRampToValueAtTime(20000, now + (e.plate ? 3.5 : 5));
  }

  // ------------------------------------------------------------------ 환경음
  startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bank.wind[0];
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = CONFIG.audio.windGain;
    // 바람 세기 변화 (LFO)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = CONFIG.audio.windGain * 0.45;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.031;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 220;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(f.frequency);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    lfo.start();
    lfo2.start();
    this.wind = { src, g };
  }

  update(dt) {
    if (!this.ready) return;
    const ctx = this.ctx;
    // 청취자 위치·방향
    const cam = this.game.camera;
    const L = ctx.listener;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _u.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const p = cam.position;
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = _f.x;
      L.forwardY.value = _f.y;
      L.forwardZ.value = _f.z;
      L.upX.value = _u.x;
      L.upY.value = _u.y;
      L.upZ.value = _u.z;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z);
    }
    // 일시정지 등으로 오디오가 멈춰 있으면 배경음을 예약하지 않는다 (재개 순간 한꺼번에 터지지 않게)
    if (ctx.state !== 'running') return;
    // 멀리서 울리는 포성
    const A = CONFIG.audio;
    this.nextArtillery -= dt;
    if (this.nextArtillery <= 0) {
      this.nextArtillery = randRange(A.artilleryInterval);
      const a = Math.random() * Math.PI * 2;
      const dist = rand(2500, 6000);
      this.playAt('artillery', p.x + Math.sin(a) * dist, 50, p.z - Math.cos(a) * dist, {
        gain: A.artilleryGain * rand(0.5, 1),
        lowpass: rand(250, 500),
        reverb: 0.6,
        rate: rand(0.8, 1.05),
      });
    }
    // 멀리서 들리는 다른 전투의 총성
    this.nextDistantFire -= dt;
    if (this.nextDistantFire <= 0) {
      this.nextDistantFire = randRange(A.distantFireInterval);
      const a = Math.random() * Math.PI * 2;
      const dist = rand(900, 1800);
      const n = 2 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        this.playAt('shotFar', p.x + Math.sin(a) * dist, 2, p.z - Math.cos(a) * dist, {
          gain: rand(0.03, 0.06),
          delay: i * rand(0.09, 0.4),
          lowpass: 900,
          reverb: 0.7,
        });
      }
    }
  }
}

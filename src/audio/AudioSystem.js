// =============================================================================
// AudioSystem — Web Audio 합성음 재생
//  3D 위치 음향(HRTF), 음속(340m/s) 지연, 거리별 음색(저역 통과)·잔향 비율,
//  적 탄이 3m 이내를 지나면 총성보다 먼저 들리는 초음속 파열음.
//  시스템과는 이벤트로만 연결된다.
//  출력 버스 (2단계): 효과음(sfxBus, 모든 게임 효과음) + 음성(voiceBus, 분대 콜아웃 무전 스켈치) → master(전체) → 리미터.
//  볼륨 3개(전체·효과음·음성)는 일시정지 메뉴 슬라이더 → setVolumeOf(kind, v), 브라우저에 저장 (CONFIG.audioMix).
//  분대 콜아웃(EV.CALLOUT, radio !== false) → 무전 스켈치. 선택: 브라우저 음성 합성(ko-KR)으로 읽기 (기본 끔, setSpeechEnabled)
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { buildSoundBank } from './SoundBank.js';
import { SR, buf, rng, noise, lowpass, toBuffer } from './dsp.js';
import { rand, randRange } from '../core/Random.js';

const VOLUME_KINDS = ['master', 'sfx', 'voice'];
// 새 재질 이름 → 비슷한 탄착음
const IMPACT_ALIAS = { subsoil: 'dirt', hay: 'sand', rubber: 'mud', fabric: 'sand', sandbag: 'sand', earth: 'dirt' };
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.bank = null;
    this.error = null;
    this.pausedByGame = false;
    this.activeCount = 0;
    // 볼륨 (0~1): 전체 / 효과음 / 음성. 저장소를 못 쓰면 기본값
    const MX = CONFIG.audioMix;
    this.volume = this.loadVolume('master', CONFIG.audio.defaultVolume);
    this.sfxVolume = this.loadVolume('sfx', MX.defaultSfx);
    this.voiceVolume = this.loadVolume('voice', MX.defaultVoice);
    this.lastSquelch = -1e9;
    this.initSpeech();
    this.installUnlock();
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
    // 2단계: 분대 콜아웃 (무전 스켈치 + 선택 음성), 탄약 상자 탄창 채우기 소리
    ev.on(EV.CALLOUT, (c) => this.onCallout(c));
    ev.on(EV.AMMO_REFILL, (e) => this.onRefill(e));
    // 임무 시작·끝, 플레이어 전투 불능: 읽던·대기 중인 음성을 버린다
    ev.on(EV.MISSION_START, () => this.cancelSpeech());
    ev.on(EV.MISSION_END, () => this.cancelSpeech());
    ev.on(EV.UNIT_INCAPACITATED, (e) => {
      if (e.unit === game.player.body) this.cancelSpeech();
    });
  }

  // ------------------------------------------------------------------ 시작·잠금 해제
  // 브라우저 자동재생 정책: AudioContext 는 사용자 입력(클릭·키) 처리 중에 만들거나 resume() 해야 소리가 난다.
  // 그래서 첫 입력 순간 바로 컨텍스트를 만들고 resume() 한다 (무거운 소리 합성은 그 뒤에).
  // 이후에도 게임이 멈춘 것도 아닌데 컨텍스트가 멈춰 있으면 다음 입력 때 다시 켠다.
  installUnlock() {
    const h = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchend', 'click']) document.addEventListener(type, h, true);
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        this.error = 'Web Audio 미지원';
        return;
      }
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch (e) {
        this.error = String(e && e.message ? e.message : e);
        return;
      }
      const ctx = this.ctx;
      ctx.addEventListener('statechange', () => this.onStateChange());
      this.buildOutput();
      // 아주 짧은 무음 버퍼를 재생해 두면 (특히 Safari) 출력 장치가 확실히 열린다
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start(0);
    }
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed' && !this.pausedByGame) {
      this.ctx.resume().catch(() => {});
    }
  }

  // 출력 체인: [sfxBus(효과음) | voiceBus(음성)] → master(전체 볼륨) → muffle(피격 시 먹먹함) → compressor → limiter → destination
  buildOutput() {
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = CONFIG.audio.master * this.volume;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    // 마지막 리미터: 연발·여러 총성이 겹쳐도 출력이 1.0 을 넘어 찢어지지 않게
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = this.voiceVolume;
    this.sfxBus.connect(this.master);
    this.voiceBus.connect(this.master);
    this.master.connect(this.muffle);
    this.muffle.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(ctx.destination);
  }

  // 임무 시작(클릭) 때 호출: 컨텍스트를 깨우고, 처음 한 번은 소리 묶음·잔향·환경음을 만든다
  async init() {
    this.pausedByGame = false;
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.bank) {
      this.bank = buildSoundBank(ctx);
      // 잔향 (합성 임펄스 응답)
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeIR();
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.8;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.sfxBus);
      this.startAmbience();
      this.ready = true;
    }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  }

  onStateChange() {
    const st = this.ctx.state;
    // 게임이 멈추지 않았는데 오디오가 멈춤 (자동재생 차단·탭 전환·다른 앱이 출력 장치를 가져감 등)
    if (st !== 'running' && !this.pausedByGame && this.game.state === 'playing') {
      const now = performance.now();
      if (now - (this.lastBlockedMsg || -1e9) > 8000) {
        this.lastBlockedMsg = now;
        this.game.events.emit(EV.MESSAGE, { text: '소리가 멈췄다 — 화면을 클릭하면 다시 켜진다', kind: 'warn' });
      }
    }
  }

  // ------------------------------------------------------------------ 볼륨 (전체·효과음·음성)
  loadVolume(kind, def) {
    try {
      const raw = window.localStorage.getItem(CONFIG.audioMix.storageKeys[kind]);
      const v = raw === null ? NaN : parseFloat(raw);
      if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    } catch {
      // 저장소를 못 쓰면 기본 볼륨
    }
    return def;
  }

  // kind: 'master' | 'sfx' | 'voice' → 0~1
  getVolumeOf(kind) {
    return kind === 'sfx' ? this.sfxVolume : kind === 'voice' ? this.voiceVolume : this.volume;
  }

  // 볼륨 0~1 (일시정지 메뉴 슬라이더). 브라우저에 저장한다
  setVolumeOf(kind, v) {
    if (!VOLUME_KINDS.includes(kind)) return;
    v = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    if (kind === 'sfx') {
      this.sfxVolume = v;
      this.rampGain(this.sfxBus, v);
    } else if (kind === 'voice') {
      this.voiceVolume = v;
      this.rampGain(this.voiceBus, v);
    } else {
      this.volume = v;
      this.rampGain(this.master, CONFIG.audio.master * v);
    }
    // 읽고 있는 음성 합성은 다음 문장부터 새 음량 (전체 × 음성)
    try {
      window.localStorage.setItem(CONFIG.audioMix.storageKeys[kind], String(v));
    } catch {
      // 저장소를 못 쓰는 환경 (사생활 보호 모드 등)
    }
  }

  // 전체 볼륨 (예전 API, 슬라이더 하나일 때)
  setVolume(v) {
    this.setVolumeOf('master', v);
  }

  rampGain(node, target) {
    if (!node || !this.ctx) return;
    const g = node.gain;
    // 일시정지 중(컨텍스트 멈춤)에는 시간이 흐르지 않아 램프가 진행되지 않으므로 바로 넣는다
    if (this.ctx.state === 'running') g.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    else {
      g.cancelScheduledValues(0);
      g.value = target;
    }
  }

  // F3 디버그 표시용 (+ 일시정지 메뉴 오디오 상태 줄)
  status() {
    const c = this.ctx;
    const sp = this.speech;
    return {
      state: c ? c.state : this.error || '아직 없음 (첫 클릭 전)',
      active: this.activeCount,
      sampleRate: c ? c.sampleRate : 0,
      volume: this.volume,
      sfx: this.sfxVolume,
      voice: this.voiceVolume,
      ready: this.ready,
      speech: sp.supported ? (sp.enabled ? (sp.busy ? '읽는 중' : '켬') : '끔') : '지원 안 함',
      speechVoice: sp.voice ? sp.voice.name : null,
    };
  }

  // 재생 중인 소리 수 세기 (예약된 것 포함)
  track(src) {
    this.activeCount++;
    src.onended = () => {
      this.activeCount--;
    };
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

  // 일시정지 메뉴가 열려 있는 동안만 멈춘다 (이때는 클릭해도 다시 켜지 않는다). 읽던·대기 중인 음성도 버린다
  suspend() {
    this.pausedByGame = true;
    this.cancelSpeech();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    this.pausedByGame = false;
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
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
    p.connect(this.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb * gain;
      f.connect(s);
      s.connect(this.reverb);
    }
    src.start(ctx.currentTime + Math.max(0, delay));
    this.track(src);
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
    g.connect(this.sfxBus);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb * gain;
      g.connect(s);
      s.connect(this.reverb);
    }
    src.start(ctx.currentTime + delay);
    this.track(src);
  }

  // 음성 버스 소리 (무전 스켈치): 잔향 없음, 효과음 볼륨과 무관
  playVoice(name, gain = 1, delay = 0) {
    if (!this.ready || !this.bank[name]) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pick(name);
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.voiceBus);
    src.start(ctx.currentTime + delay);
    this.track(src);
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
    const name = this.bank[imp.effect] ? imp.effect : IMPACT_ALIAS[imp.effect] || 'dirt';
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
    g.connect(this.sfxBus);
    src.start();
    lfo.start();
    lfo2.start();
    this.activeCount++; // 바람 (계속 재생)
    this.wind = { src, g };
  }

  // ------------------------------------------------------------------ 2단계: 분대 콜아웃 (무전 스켈치 + 음성 합성)
  playerDown() {
    const pl = this.game.player;
    return !!(pl && pl.body.damage.incapacitated);
  }

  onCallout(c) {
    if (!c || !c.text || this.playerDown()) return;
    const MX = CONFIG.audioMix;
    if (c.radio !== false && this.ready) {
      // 같은 순간 여러 개가 오면 스켈치는 한 번만
      const now = this.ctx.currentTime;
      if (now - this.lastSquelch >= MX.squelchMinInterval) {
        this.lastSquelch = now;
        this.playVoice('radioOpen', MX.squelchGain);
      }
    }
    this.speakCallout(c);
  }

  onRefill(e) {
    if (e.owner !== this.game.player.body) return;
    const G = CONFIG.audioMix.refillGain;
    if (e.step === 'clip') {
      const name = e.phase === 'in' ? 'clipIn' : e.phase === 'press' ? 'clipPress' : e.phase === 'out' ? 'clipOut' : 'pouch';
      this.playUI(name, G * (e.phase === 'take' ? 0.8 : 1));
    } else if (e.step === 'mag') this.playUI('pouch', G * 0.8);
    else if (e.step === 'stop' && e.mag >= 0 && e.reason !== 'done' && e.reason !== 'empty') this.playUI('pouch', G * 0.6);
  }

  // 음성 합성 (speechSynthesis). 모든 호출은 지원 여부를 확인하고 try/catch 로 감싼다 (지원하지 않거나 막혀도 게임은 그대로)
  initSpeech() {
    const sp = { supported: false, enabled: false, voice: null, voiceCount: 0, hasKorean: false, queued: null, utter: null, busy: false, startedAt: 0 };
    this.speech = sp;
    try {
      const synth = window.speechSynthesis;
      sp.supported = !!synth && typeof synth.speak === 'function' && typeof window.SpeechSynthesisUtterance === 'function';
      if (!sp.supported) return;
      sp.synth = synth;
      const pick = () => this.pickVoice();
      if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', pick);
      else synth.onvoiceschanged = pick;
      pick();
      // 페이지를 떠날 때 읽던 것을 끊는다 (일부 브라우저는 새로 고친 뒤에도 계속 읽음)
      window.addEventListener('pagehide', () => this.cancelSpeech());
    } catch {
      sp.supported = false;
    }
    try {
      sp.enabled = sp.supported && window.localStorage.getItem(CONFIG.audioMix.storageKeys.speech) === '1';
    } catch {
      sp.enabled = false;
    }
  }

  // 한국어 음성 고르기 (목록은 늦게 채워질 수 있다: voiceschanged)
  pickVoice() {
    const sp = this.speech;
    try {
      const list = sp.synth.getVoices() || [];
      sp.voiceCount = list.length;
      const lang = CONFIG.audioMix.speech.lang.toLowerCase();
      const ko = list.filter((v) => v && typeof v.lang === 'string' && v.lang.toLowerCase().replace('_', '-').startsWith(lang.slice(0, 2)));
      sp.voice = ko.find((v) => v.lang.toLowerCase().replace('_', '-') === lang && v.localService) || ko.find((v) => v.lang.toLowerCase().replace('_', '-') === lang) || ko[0] || null;
      sp.hasKorean = !!sp.voice;
    } catch {
      sp.voice = null;
    }
  }

  // 일시정지 메뉴용: {supported, enabled, hasKorean, voiceName, voicesKnown}
  speechInfo() {
    const sp = this.speech;
    return { supported: sp.supported, enabled: sp.enabled, hasKorean: sp.hasKorean, voiceName: sp.voice ? sp.voice.name : null, voicesKnown: sp.voiceCount > 0 };
  }

  setSpeechEnabled(on) {
    const sp = this.speech;
    sp.enabled = !!on && sp.supported;
    if (!sp.enabled) this.cancelSpeech();
    else if (!sp.voice) this.pickVoice();
    try {
      window.localStorage.setItem(CONFIG.audioMix.storageKeys.speech, sp.enabled ? '1' : '0');
    } catch {
      // 저장소를 못 쓰면 이번 실행에만
    }
    return sp.enabled;
  }

  speakCallout(c) {
    const sp = this.speech;
    if (!sp.supported || !sp.enabled || this.game.state !== 'playing') return;
    // 음성 목록을 알고 있는데 한국어 음성이 없으면 읽지 않는다 (다른 언어 음성으로 한글을 읽으면 알아들을 수 없다)
    if (sp.voiceCount > 0 && !sp.hasKorean) return;
    const S = CONFIG.audioMix.speech;
    const item = { text: String(c.text), radio: c.radio !== false, at: performance.now() / 1000 };
    // 대기는 하나만: 새 문장이 대기 중인 것을 바꾼다. 경고(alert)는 읽던 것을 끊고 바로
    sp.queued = item;
    if (c.kind === 'alert' && S.alertInterrupts && sp.busy) this.stopUtterance();
    this.pumpSpeech();
  }

  pumpSpeech() {
    const sp = this.speech;
    if (!sp.queued || sp.busy || !sp.enabled) return;
    const S = CONFIG.audioMix.speech;
    const item = sp.queued;
    sp.queued = null;
    const now = performance.now() / 1000;
    if (now - item.at > S.maxAge || this.game.state !== 'playing') return;
    try {
      const synth = sp.synth;
      // 우리 것이 아닌 대기(다른 탭 등)가 쌓여 있으면 비운다
      if (synth.pending) synth.cancel();
      const u = new window.SpeechSynthesisUtterance(item.text);
      u.lang = S.lang;
      if (sp.voice) u.voice = sp.voice;
      u.rate = S.rate;
      u.pitch = S.pitch;
      u.volume = Math.max(0, Math.min(1, this.volume * this.voiceVolume));
      const done = () => {
        if (sp.utter !== u) return;
        sp.utter = null;
        sp.busy = false;
        // 송신 끝 스켈치
        if (item.radio && this.ready && !this.pausedByGame) this.playVoice('radioClose', CONFIG.audioMix.squelchGain * 0.8);
        this.pumpSpeech();
      };
      u.onend = done;
      u.onerror = done;
      sp.utter = u;
      sp.busy = true;
      sp.startedAt = now;
      synth.speak(u);
    } catch {
      sp.utter = null;
      sp.busy = false;
    }
  }

  // 지금 읽는 문장만 끊는다 (대기 중인 것은 남김)
  stopUtterance() {
    const sp = this.speech;
    const u = sp.utter;
    sp.utter = null;
    sp.busy = false;
    if (u) {
      u.onend = null;
      u.onerror = null;
    }
    try {
      if (sp.synth) sp.synth.cancel();
    } catch {
      // 무시
    }
  }

  // 읽던 것과 대기 중인 것을 모두 버린다 (일시정지·임무 끝·전투 불능)
  cancelSpeech() {
    const sp = this.speech;
    if (!sp) return;
    sp.queued = null;
    if (sp.busy || sp.utter) this.stopUtterance();
    else {
      try {
        if (sp.synth && (sp.synth.speaking || sp.synth.pending)) sp.synth.cancel();
      } catch {
        // 무시
      }
    }
  }

  // 매 프레임: 끝 알림이 오지 않는 브라우저 대비 (읽기가 끝났거나 너무 오래되면 다음 문장으로)
  updateSpeech() {
    const sp = this.speech;
    if (!sp.supported || (!sp.busy && !sp.queued)) return;
    const now = performance.now() / 1000;
    if (sp.busy) {
      let speaking = true;
      try {
        speaking = sp.synth.speaking;
      } catch {
        speaking = false;
      }
      const age = now - sp.startedAt;
      if ((!speaking && age > 0.5) || age > CONFIG.audioMix.speech.stuckTimeout) {
        sp.utter = null;
        sp.busy = false;
      }
    }
    this.pumpSpeech();
  }

  update(dt) {
    this.updateSpeech();
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

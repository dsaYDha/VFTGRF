// =============================================================================
// Game — 초기화(로딩 단계), 상태(브리핑 → 플레이 ⇄ 일시정지 → 결과), 메인 루프.
// 시스템 생성 순서와 갱신 순서를 한 곳에서 관리한다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EventBus } from './EventBus.js';
import { EV } from './events.js';
import { Input } from './Input.js';
import { World } from '../world/World.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { setMaxAnisotropy } from '../world/textures.js';
import { Navigation } from '../ai/Navigation.js';
import { AIDirector } from '../ai/AIDirector.js';
import { Ballistics } from '../weapons/Ballistics.js';
import { ViewModel } from '../weapons/ViewModel.js';
import { SuppressionSystem } from '../suppression/SuppressionSystem.js';
import { Player } from '../player/Player.js';
import { Effects } from '../effects/Effects.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Mission } from '../mission/Mission.js';
import { HUD } from '../ui/HUD.js';
import { Screens } from '../ui/Screens.js';
import { ScreenFX } from '../ui/ScreenFX.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { ViewPoints } from '../ui/ViewPoints.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const _fwd = new THREE.Vector3();

export class Game {
  constructor(container) {
    this.container = container;
    this.events = new EventBus();
    this.state = 'loading';
    this.time = 0;
    this.units = []; // 탄도·제압 판정 대상 (플레이어 몸 + 적)
    this.ready = false;
  }

  async init() {
    // 그래픽 품질 프리셋 (브라우저에 기억된 값): 렌더러·월드를 만들기 전에 CONFIG 에 써 넣으면 로딩 단계가 그 값으로 만든다
    this.setQualityConfig(this.loadQualityName());
    this.screens = new Screens(this);
    const step = async (text, frac) => {
      this.screens.setLoading(text, frac);
      await nextFrame();
    };
    await step('렌더러 준비 중…', 0.02);
    const R = CONFIG.render;
    this.renderer = new THREE.WebGLRenderer({ antialias: R.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, R.pixelRatioMax));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = R.shadows;
    // PCF + 흐림 반경(render.shadowRadius) = 부드러운 그림자. 그림자 맵은 Atmosphere 가 필요할 때만 다시 그린다
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // ACESFilmic + 채도·색조 보정 (CustomToneMapping 청크는 Atmosphere.js 에서 교체)
    this.renderer.toneMapping = THREE.CustomToneMapping;
    this.renderer.toneMappingExposure = R.exposure;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(R.fovDeg, window.innerWidth / window.innerHeight, R.near, R.far);
    this.camera.rotation.order = 'YXZ';
    this.atmosphere = new Atmosphere(this.scene, this.renderer);

    await step('지형 생성 중… (수로·참호·포탄 구덩이)', 0.1);
    this.world = new World(this.scene);
    this.world.generateTerrain();
    await step('구조물 배치 중… (축사·저장탑·잔해)', 0.35);
    this.world.buildStructures();
    await step('적 진지 준비 중…', 0.5);
    this.nav = new Navigation(this.world);
    await step('지형 메시·식생 생성 중…', 0.6);
    this.world.finalize();
    this.atmosphere.applyToWorld(this.world);
    await step('시스템 준비 중…', 0.8);

    this.input = new Input(this.renderer.domElement);
    this.ballistics = new Ballistics(this);
    this.suppression = new SuppressionSystem(this);
    this.player = new Player(this);
    this.units.push(this.player.body);
    this.viewModel = new ViewModel(this);
    this.effects = new Effects(this);
    this.audio = new AudioSystem(this);
    this.director = new AIDirector(this, this.nav);
    this.mission = new Mission(this);
    this.hud = new HUD(this);
    this.screenFx = new ScreenFX(this);
    this.debug = new DebugOverlay(this);
    this.viewPoints = new ViewPoints(this);
    this.freezeSim = false;

    this.events.on(EV.MISSION_END, (r) => this.onMissionEnd(r));
    this.input.onLockChange = (locked, failed) => this.onLockChange(locked, failed);
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.director.reset();
    this.player.reset();
    await step('준비 완료', 1);
    // 셰이더 미리 컴파일 (첫 프레임 끊김 방지)
    this.renderer.compile(this.scene, this.camera);
    this.state = 'briefing';
    this.screens.showBriefing(() => this.startMission());
    this.ready = true;
    this.clock = new THREE.Timer();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ 상태 전환
  async startMission() {
    this.screens.hideAll();
    this.restartWorldState();
    this.mission.start();
    this.state = 'playing';
    this.hud.show(true);
    this.input.requestLock();
    try {
      await this.audio.init();
    } catch (e) {
      console.warn('audio init failed', e);
    }
  }

  restartWorldState() {
    this.time = 0;
    this.ballistics.reset();
    this.effects.reset();
    this.director.reset();
    this.player.reset();
    this.screenFx.reset();
    this.debug.reset();
    this.hud.reset();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.suspend();
    this.screens.showPause(
      () => this.resume(),
      () => {
        this.screens.hidePause();
        this.startMission();
      },
    );
  }

  resume() {
    if (this.state !== 'paused') return;
    this.screens.hidePause();
    this.state = 'playing';
    this.audio.resume();
    this.input.requestLock();
  }

  // 잠금이 풀리거나 잠금 요청이 거절되면(Esc 직후 너무 빨리 다시 누른 경우 등) 일시정지 화면으로.
  // 잠금 없이 계속 진행되면 조준·사격·일시정지를 할 수 없는 상태로 적 사격만 받게 된다.
  onLockChange(locked) {
    if (!locked && this.state === 'playing') this.pause();
  }

  onMissionEnd(r) {
    this.state = 'result';
    this.hud.show(false);
    this.input.releaseLock();
    setTimeout(() => {
      this.screens.showResult(r, () => {
        this.screens.hideAll();
        this.startMission();
      });
    }, 400);
  }

  // ------------------------------------------------------------------ 그래픽 품질 프리셋 (CONFIG.quality)
  // 브라우저에 기억된 프리셋 이름 (저장소를 쓸 수 없거나 모르는 이름이면 기본값)
  loadQualityName() {
    const Q = CONFIG.quality;
    let name = null;
    try {
      name = window.localStorage.getItem(Q.storageKey);
    } catch {
      name = null; // 사생활 보호 모드·파일 열기 등 저장소가 막힌 환경
    }
    return Object.hasOwn(Q.presets, name || '') ? name : Q.default;
  }

  // 프리셋 수치를 원래 설정 키에 써 넣는다 (각 모듈은 그 키를 읽는다)
  setQualityConfig(name) {
    const P = CONFIG.quality.presets[name];
    const R = CONFIG.render;
    CONFIG.vegetation.density = P.vegetationDensity;
    CONFIG.vegetation.lodScale = P.vegetationLod;
    CONFIG.terrain.mesh.lodDistance = P.terrainLod;
    CONFIG.distant.range = P.distantRange;
    R.shadows = P.shadows;
    R.shadowMapSize = P.shadowMapSize;
    R.shadowRadius = P.shadowRadius;
    R.pixelRatioMax = P.pixelRatioMax;
    R.antialias = P.antialias;
    this.quality = name;
  }

  // 실행 중 프리셋 바꾸기 (일시정지 메뉴): 다시 만들지 않고 각 모듈의 적용 함수만 부른다 → 다음 프레임부터 반영.
  // 안티앨리어싱만 WebGL 문맥을 만들 때 정해지므로 페이지를 새로 고쳐야 바뀐다 (qualityNeedsReload)
  setQuality(name) {
    if (!Object.hasOwn(CONFIG.quality.presets, name)) return false;
    this.setQualityConfig(name);
    try {
      window.localStorage.setItem(CONFIG.quality.storageKey, name);
    } catch {
      // 저장소가 막혀 있어도 이번 실행에는 적용된다
    }
    if (!this.ready) return true;
    const w = this.world;
    if (w.vegetation) w.vegetation.applyConfig();
    w.terrain.setLodDistance(CONFIG.terrain.mesh.lodDistance);
    w.setDistantRange(CONFIG.distant.range);
    this.atmosphere.applyShadowSettings();
    this.resetResolution();
    return true;
  }

  // 지금 쓰는 WebGL 문맥의 안티앨리어싱이 프리셋과 다르면 true (새로 고침해야 적용)
  qualityNeedsReload() {
    const attr = this.renderer && this.renderer.getContextAttributes();
    return !!attr && !!attr.antialias !== !!CONFIG.render.antialias;
  }

  // 렌더 해상도를 상한(render.pixelRatioMax)으로 되돌리고 동적 해상도 측정을 처음부터 (프리셋을 바꿨을 때)
  resetResolution() {
    const pr = Math.min(window.devicePixelRatio, CONFIG.render.pixelRatioMax);
    this.dynAcc = 0;
    this.dynFrames = 0;
    this.dynGood = 0;
    if (this.dynDts) this.dynDts.length = 0;
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 0.001) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  // 동적 해상도: 2초 평균이 목표보다 낮으면 픽셀 비율을 낮추고, 여유가 있으면 천천히 올린다
  adaptResolution(dt) {
    const R = CONFIG.render;
    if (!R.dynamicResolution || this.state !== 'playing' || dt <= 0 || dt > 0.25) return;
    this.dynAcc = (this.dynAcc || 0) + dt;
    this.dynFrames = (this.dynFrames || 0) + 1;
    (this.dynDts || (this.dynDts = [])).push(dt);
    if (this.dynAcc < 2) return;
    const fps = this.dynFrames / this.dynAcc;
    // 화면 주사율 상한 추정: 짧은 쪽 10% 프레임 간격. 50Hz·30Hz 화면이면 목표 fps 를 그에 맞춰 낮춘다
    // (그렇지 않으면 GPU 여유가 있어도 목표에 못 미친다고 보고 해상도를 계속 내린다)
    const dts = this.dynDts.sort((a, b) => a - b);
    const displayFps = 1 / Math.max(1 / 240, dts[Math.floor(dts.length * 0.1)]);
    const target = Math.min(R.targetFps, displayFps * 0.95);
    this.dynDts.length = 0;
    this.dynAcc = 0;
    this.dynFrames = 0;
    const maxPr = Math.min(window.devicePixelRatio, R.pixelRatioMax);
    const pr = this.renderer.getPixelRatio();
    let next = pr;
    if (fps < target - 6) {
      next = Math.max(R.pixelRatioMin, pr - 0.15);
      this.dynGood = 0;
    } else if (fps >= target - 1 && pr < maxPr) {
      // 여유가 연속 3번(6초) 확인될 때만 올린다 (깜빡임 방지)
      this.dynGood = (this.dynGood || 0) + 1;
      if (this.dynGood >= 3) {
        next = Math.min(maxPr, pr + 0.05);
        this.dynGood = 0;
      }
    } else this.dynGood = 0;
    if (Math.abs(next - pr) > 0.001) {
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel.setAspect(w / h);
  }

  // ------------------------------------------------------------------ 루프
  // 게임 논리 한 단계 (렌더 없이도 돌 수 있다 — 자동 테스트에서 사용)
  stepSim(dt) {
    this.time += dt;
    this.player.update(dt, this.input);
    this.director.update(dt);
    this.ballistics.update(dt);
    this.suppression.update(dt);
    this.mission.update(dt);
  }

  frame(t) {
    this.clock.update(t);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    const input = this.input;
    input.pollLock();
    if (input.wasPressed('F3')) this.debug.toggle();
    // 점검용 고정 시점 순환 (디버그 모드에서만)
    if (input.wasPressed('F4') && this.debug.enabled && this.state === 'playing') this.viewPoints.next();

    if (this.state === 'playing' && this.freezeSim) {
      // 개발용: 시뮬레이션을 멈추고 화면만 그린다 (점검 스크린샷)
      this.player.updateCamera(0);
      this.player.updateBody(0);
    } else if (this.state === 'playing') {
      this.stepSim(dt);
    } else if (this.state === 'briefing') {
      // 브리핑 뒤 배경: 천천히 둘러보는 시점
      this.player.yaw = Math.sin(performance.now() * 0.00005) * 0.4;
      this.player.updateCamera(dt);
    }
    _fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.atmosphere.update(dt, this.camera.position, _fwd);
    this.world.update(dt);
    if (this.state === 'playing' || this.state === 'result') this.effects.update(dt);
    else if (this.state === 'briefing') this.effects.smoke.update(dt); // 브리핑 배경에서도 연기 기둥은 흐른다
    this.viewModel.update(dt);
    this.audio.update(dt);
    if (this.state === 'playing') {
      this.hud.update(dt);
      this.screenFx.update(dt);
    }
    this.debug.update(rawDt);
    input.endFrame();

    this.adaptResolution(rawDt);
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.camera);
    if (this.state !== 'result') this.viewModel.render(r);
  }
}

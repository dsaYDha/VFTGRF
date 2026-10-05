// =============================================================================
// ViewModel — 1인칭 소총(AK 계열)과 손. 크로스헤어 없이 가늠자(뒤)·가늠쇠(앞)로 조준.
// 조준(우클릭) 시 가늠자 홈 위쪽과 가늠쇠 끝이 화면 중앙 시선과 일직선이 된다.
// 깊이 버퍼를 비운 뒤 따로 그려 벽에 파묻히지 않게 한다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { camoAtlas, flashTexture } from '../world/textures.js';
import { damp } from '../core/mathUtils.js';

const POSE = {
  hip: { p: [0.13, -0.1, -0.02], r: [0.025, 0.05, 0.06] },
  ads: { p: [0, 0, 0], r: [0, 0, 0] },
  sprint: { p: [0.16, -0.17, 0.02], r: [-0.42, 0.7, 0.32] },
  reload: { p: [0.07, -0.12, 0.02], r: [0.22, 0.32, 0.55] },
  down: { p: [0.12, -0.32, 0.05], r: [-0.8, 0.4, 0.4] },
};

export class ViewModel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    const R = CONFIG.render;
    this.camera = new THREE.PerspectiveCamera(R.fovDeg, window.innerWidth / window.innerHeight, 0.01, 10);
    const A = CONFIG.atmosphere;
    this.scene.add(new THREE.HemisphereLight(A.hemiSky, A.hemiGround, A.hemiIntensity * 0.9));
    const dl = new THREE.DirectionalLight(A.sunColor, A.sunIntensity * 0.9);
    dl.position.set(0.4, 1, 0.3);
    this.scene.add(dl);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.6, 2);
    this.flashLight.position.set(0, -0.05, -0.85);
    this.scene.add(this.flashLight);

    this.root = new THREE.Group(); // 카메라 기준 자세
    this.scene.add(this.root);
    this.rifle = new THREE.Group();
    this.root.add(this.rifle);
    this.buildRifle();
    this.buildArms();

    this.blend = { ads: 0, sprint: 0, reload: 0, down: 0 };
    this.kick = 0;
    this.kickRot = 0;
    this.kickVel = 0;
    this.flashTime = 0;
    this.boltOffset = 0;
    this.reloadInfo = null;
    this.magState = 'in';

    game.events.on(EV.SHOT_FIRED, (e) => {
      if (e.shooter !== game.player.body) return;
      this.kickVel += e.weapon.def.recoil.visualKick * 30;
      this.kickRot += 0.035 + Math.random() * 0.015;
      this.flashTime = CONFIG.effects.muzzleFlashTime;
      this.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.09 + Math.random() * 0.06;
      this.flash.scale.set(s, s, s);
      this.flash2.scale.set(s * 0.6, s * 1.8, s);
      this.boltOffset = 0.07;
    });
    game.events.on(EV.RELOAD_START, (e) => {
      if (e.owner !== game.player.body) return;
      this.reloadInfo = { empty: e.empty, duration: e.duration, t: 0 };
    });
    game.events.on(EV.RELOAD_END, (e) => {
      if (e.owner !== game.player.body) return;
      this.reloadInfo = null;
      this.mag.visible = true;
      this.mag.position.copy(this.magHome);
      this.mag.rotation.set(0, 0, 0);
    });
  }

  mat(color, opts = {}) {
    return new THREE.MeshPhongMaterial({ color, shininess: 28, specular: 0x222222, ...opts });
  }

  part(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    return m;
  }

  buildRifle() {
    const g = this.rifle;
    const metal = this.mat(0x2a2a29, { shininess: 45, specular: 0x3a3a3a });
    const darkMetal = this.mat(0x1b1b1b, { shininess: 30 });
    const polymer = this.mat(0x3a2622, { shininess: 12 });
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const Cy = (r, l, s = 10) => new THREE.CylinderGeometry(r, r, l, s).rotateX(Math.PI / 2);
    const boreY = -0.055;
    // 개머리판 (대부분 화면 밖)
    this.part(g, B(0.045, 0.07, 0.32), polymer, 0, -0.1, 0.2, 0.12, 0, 0);
    // 기관부 + 덮개
    this.part(g, B(0.048, 0.07, 0.31), metal, 0, -0.078, -0.115);
    this.part(g, new THREE.CylinderGeometry(0.024, 0.024, 0.29, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), metal, 0, -0.045, -0.11);
    // 손잡이·방아쇠울
    this.part(g, B(0.032, 0.1, 0.04), polymer, 0, -0.15, 0.02, -0.32, 0, 0);
    this.part(g, B(0.006, 0.006, 0.07), darkMetal, 0, -0.125, -0.04);
    // 조정간 (오른쪽)
    this.selector = this.part(g, B(0.004, 0.012, 0.07), metal, 0.026, -0.065, -0.07);
    // 장전손잡이 (노리쇠)
    this.bolt = new THREE.Group();
    g.add(this.bolt);
    this.part(this.bolt, Cy(0.006, 0.03), metal, 0.036, -0.06, -0.2, 0, 0, Math.PI / 2);
    this.part(this.bolt, B(0.012, 0.01, 0.06), metal, 0.028, -0.06, -0.19);
    // 가늠자 (뒤): 받침 + 판 + U홈 (홈 윗면이 y=0)
    this.part(g, B(0.034, 0.018, 0.06), metal, 0, -0.03, -0.28);
    this.part(g, B(0.026, 0.006, 0.05), metal, 0, -0.017, -0.29);
    const notchW = 0.0036;
    for (const s of [-1, 1]) this.part(g, B(0.009, 0.014, 0.004), darkMetal, s * (notchW / 2 + 0.0045), -0.007, -0.302);
    this.part(g, B(0.0036, 0.004, 0.004), darkMetal, 0, -0.012, -0.302);
    this.sightSlider = this.part(g, B(0.03, 0.005, 0.012), metal, 0, -0.012, -0.27);
    // 총몸 덮개 (위·아래)
    this.part(g, B(0.04, 0.026, 0.19), polymer, 0, -0.035, -0.4);
    this.part(g, B(0.056, 0.062, 0.2), polymer, 0, -0.088, -0.4);
    // 총열·가스블록·가늠쇠 블록
    this.part(g, Cy(0.0095, 0.2), metal, 0, boreY, -0.6);
    this.part(g, B(0.03, 0.035, 0.03), metal, 0, -0.045, -0.515);
    this.part(g, B(0.024, 0.032, 0.035), metal, 0, -0.052, -0.68);
    // 가늠쇠 (끝이 y=0) + 보호 귀
    this.part(g, B(0.0022, 0.034, 0.0022), darkMetal, 0, -0.017, -0.68);
    for (const s of [-1, 1]) this.part(g, B(0.0018, 0.03, 0.012), metal, s * 0.0085, -0.02, -0.68);
    // 소염기
    this.part(g, Cy(0.0125, 0.08), metal, 0, boreY, -0.74);
    // 탄창 (곡선: 3단)
    this.mag = new THREE.Group();
    g.add(this.mag);
    this.magHome = new THREE.Vector3(0, -0.11, -0.2);
    this.mag.position.copy(this.magHome);
    const magMat = this.mat(0x4a2e26, { shininess: 10 });
    this.part(this.mag, B(0.026, 0.07, 0.07), magMat, 0, -0.03, 0, 0.15, 0, 0);
    this.part(this.mag, B(0.026, 0.07, 0.068), magMat, 0, -0.095, -0.022, 0.32, 0, 0);
    this.part(this.mag, B(0.026, 0.065, 0.064), magMat, 0, -0.155, -0.055, 0.5, 0, 0);
    // 총구 화염 (가산 혼합)
    const fm = new THREE.MeshBasicMaterial({
      map: flashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
    this.flash.position.set(0, boreY, -0.8);
    this.flash.visible = false;
    g.add(this.flash);
    this.flash2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
    this.flash2.position.set(0, boreY, -0.82);
    this.flash2.rotation.x = -Math.PI / 2;
    this.flash2.visible = false;
    g.add(this.flash2);
  }

  buildArms() {
    const camo = new THREE.MeshLambertMaterial({ map: camoAtlas() });
    const glove = new THREE.MeshLambertMaterial({ color: 0x2f3028 });
    const tape = new THREE.MeshLambertMaterial({ color: CONFIG.factions.friendly.tapeColor });
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    // 오른손: 손잡이
    this.part(this.rifle, B(0.045, 0.08, 0.06), glove, 0.014, -0.165, 0.035, -0.32, 0, 0);
    const rArm = this.part(this.rifle, B(0.075, 0.075, 0.32), camo, 0.07, -0.25, 0.17, -0.55, 0.32, 0);
    rArm.renderOrder = 1;
    // 왼손: 덮개 아래
    this.leftHand = new THREE.Group();
    this.rifle.add(this.leftHand);
    this.leftHomeP = new THREE.Vector3(0, 0, 0);
    this.part(this.leftHand, B(0.062, 0.045, 0.08), glove, -0.005, -0.122, -0.42);
    this.part(this.leftHand, B(0.075, 0.075, 0.34), camo, -0.085, -0.2, -0.29, -0.45, -0.45, 0.1);
    this.part(this.leftHand, B(0.082, 0.04, 0.082), tape, -0.13, -0.26, -0.18, -0.45, -0.45, 0.1);
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    const pl = this.game.player;
    const w = pl.weapon;
    const now = this.game.time;
    const dmg = pl.body.damage;
    const b = this.blend;
    const down = dmg.incapacitated || dmg.isKnockedDown(now) ? 1 : 0;
    b.down = damp(b.down, down, 8, dt);
    b.ads = pl.ads;
    b.sprint = damp(b.sprint, pl.sprinting ? 1 : 0, 9, dt);
    b.reload = damp(b.reload, w.reloading ? 1 : 0, 8, dt);

    // 자세 섞기
    const mix = (key) => {
      const out = [0, 0, 0, 0, 0, 0];
      const H = POSE.hip;
      for (let i = 0; i < 3; i++) {
        out[i] = H.p[i];
        out[i + 3] = H.r[i];
      }
      const blendIn = (P, t) => {
        for (let i = 0; i < 3; i++) {
          out[i] += (P.p[i] - out[i]) * t;
          out[i + 3] += (P.r[i] - out[i + 3]) * t;
        }
      };
      blendIn(POSE.ads, b.ads * (1 - b.reload));
      blendIn(POSE.sprint, b.sprint);
      blendIn(POSE.reload, b.reload);
      blendIn(POSE.down, b.down);
      return out;
    };
    const o = mix();
    // 반동 (스프링)
    this.kickVel += (-this.kick * 180 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    this.kickRot *= Math.exp(-dt * 14);
    // 걷기 흔들림·조준 흔들림 (비조준 시 총만 흔들림)
    const hipW = 1 - b.ads;
    const bob = pl.speedClass !== 'still' ? 1 : 0;
    const bp = pl.bobPhase;
    const bx = Math.cos(bp) * 0.006 * bob * (1 - b.ads * 0.8);
    const by = Math.abs(Math.sin(bp)) * 0.008 * bob * (1 - b.ads * 0.8);
    this.root.position.set(o[0] + bx, o[1] - by, o[2] + this.kick);
    this.root.rotation.set(o[3] + this.kickRot + pl.swayPitch * hipW, o[4] + pl.swayYaw * hipW, o[5] + pl.lean * 0.0);

    // 노리쇠 (사격 시 잠깐 뒤로, 빈 재장전 시 당김)
    this.boltOffset = Math.max(0, this.boltOffset - dt * 1.2);
    let boltPull = this.boltOffset;
    // 재장전 동작
    const r = w.reload;
    if (r) {
      const p = r.t / r.duration;
      const st = r.steps;
      const tOut = st[0].at;
      const tPouch = st[1].at;
      const tIn = st[2].at;
      if (p < tOut) {
        this.mag.visible = true;
        this.mag.position.copy(this.magHome);
        this.mag.rotation.set(0, 0, 0);
      } else if (p < tPouch) {
        const k = (p - tOut) / (tPouch - tOut);
        this.mag.visible = k < 0.8;
        this.mag.position.set(this.magHome.x - k * 0.05, this.magHome.y - k * 0.28, this.magHome.z + k * 0.08);
        this.mag.rotation.set(k * 0.6, 0, k * 0.4);
      } else if (p < tIn) {
        const k = (p - tPouch) / (tIn - tPouch);
        this.mag.visible = k > 0.15;
        this.mag.position.set(this.magHome.x - (1 - k) * 0.06, this.magHome.y - (1 - k) * 0.3, this.magHome.z + (1 - k) * 0.06);
        this.mag.rotation.set((1 - k) * 0.5, 0, (1 - k) * 0.3);
      } else {
        this.mag.visible = true;
        this.mag.position.copy(this.magHome);
        this.mag.rotation.set(0, 0, 0);
      }
      // 왼손이 탄창을 따라감
      if (p > tOut * 0.6 && p < tIn + 0.08) {
        this.leftHand.position.set(this.mag.position.x, this.mag.position.y + 0.12 - this.magHome.y - 0.12, this.mag.position.z + 0.22);
      } else this.leftHand.position.set(0, 0, 0);
      if (r.empty && st[3] && st[4]) {
        if (p >= st[3].at - 0.05 && p < st[4].at) boltPull = 0.08 * Math.min(1, (p - st[3].at + 0.05) / 0.05);
      }
    } else {
      this.leftHand.position.set(0, 0, 0);
      this.mag.visible = w.magIndex >= 0;
    }
    this.bolt.position.z = boltPull;
    // 조정간: 단발(아래) / 연발(가운데)
    this.selector.rotation.x = w.fireMode === 'semi' ? 0.25 : 0.0;
    this.selector.position.y = w.fireMode === 'semi' ? -0.07 : -0.062;
    // 가늠자 거리 표시 슬라이더
    const ranges = w.def.sightRanges;
    const si = Math.max(0, ranges.indexOf(w.sightRange));
    this.sightSlider.position.z = -0.255 - si * 0.006;
    this.sightSlider.position.y = -0.0125 + si * 0.0006;

    // 총구 화염
    this.flashTime -= dt;
    const fl = this.flashTime > 0;
    this.flash.visible = fl;
    this.flash2.visible = fl;
    this.flashLight.intensity = fl ? 3.5 : 0;

    // 카메라 시야각 동기화
    const cam = this.game.camera;
    if (this.camera.fov !== cam.fov) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

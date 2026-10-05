// 임시: 월드 렌더 확인용 최소 루프 (이후 전체 게임 루프로 교체)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EventBus } from './EventBus.js';
import { World } from '../world/World.js';
import { Atmosphere } from '../world/Atmosphere.js';
import { setMaxAnisotropy } from '../world/textures.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(container) {
    this.container = container;
    this.events = new EventBus();
  }

  async init() {
    const R = CONFIG.render;
    this.renderer = new THREE.WebGLRenderer({ antialias: R.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, R.pixelRatioMax));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = R.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(R.fovDeg, window.innerWidth / window.innerHeight, R.near, R.far);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(-18, 2, 112);
    this.atmosphere = new Atmosphere(this.scene);

    const t0 = performance.now();
    this.world = new World(this.scene);
    this.world.generateTerrain();
    const t1 = performance.now();
    await nextFrame();
    this.world.buildStructures();
    const t2 = performance.now();
    this.world.finalize();
    const t3 = performance.now();
    this.timings = { terrain: t1 - t0, structures: t2 - t1, finalize: t3 - t2 };
    console.log('world timings', this.timings, 'terrain tris', this.world.terrain.triangleCount);
    document.getElementById('screen-loading').classList.add('hidden');
    this.ready = true;
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  debugCam(x, y, z, yawDeg, pitchDeg) {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0);
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.atmosphere.update(dt, this.camera.position, fwd);
    this.world.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

// ---- 임시 자세 확인용
import { SoldierModel } from '../units/SoldierModel.js';
import { POSES } from '../units/poses.js';
Game.prototype.poseGallery = function () {
  const names = Object.keys(POSES);
  const t = this.world.terrain;
  const cx = 0;
  const cz = 60;
  this.galleryModels = [];
  names.forEach((n, i) => {
    const m = new SoldierModel({ tapeColor: CONFIG.factions.enemy.tapeColor, colors: CONFIG.soldierTypes.rifleman.colors });
    const x = cx + (i % 6) * 2.2 - 5.5;
    const z = cz + Math.floor(i / 6) * 3;
    m.root.position.set(x, t.heightAt(x, z), z);
    m.snapPose(n);
    m.update(0);
    this.scene.add(m.root);
    this.galleryModels.push(m);
  });
  return names;
};

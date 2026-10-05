// =============================================================================
// World — 지형·충돌·구조물·식생·물웅덩이를 조립한다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MAP } from './mapData.js';
import { Random } from '../core/Random.js';
import { Terrain, createTerrainMaterial } from './Terrain.js';
import { CollisionWorld } from './CollisionWorld.js';
import { GeoBatch } from './geom.js';
import { StructureBuilder, InstanceCollector } from './Structures.js';
import { Vegetation, windUniforms } from './Vegetation.js';
import { createVisualMaterials } from './visualMaterials.js';
import { ContactShadows } from './ContactShadows.js';

// 물웅덩이 재질: 흐린 하늘(지평선~천정 색)을 프레넬로 비추는 평평한 수면 (낮은 각도일수록 밝은 회색).
// 안개·톤매핑은 표준 경로. 하늘색은 CONFIG.atmosphere 에서 읽고, 바꾸려면 userData.puddleUniforms 를 갱신.
function createPuddleMaterial() {
  const A = CONFIG.atmosphere;
  const P = CONFIG.ground.puddle;
  const mat = new THREE.MeshBasicMaterial({
    color: P.deepColor,
    transparent: true,
    opacity: P.opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const uniforms = {
    uHorizon: { value: new THREE.Color(A.skyHorizon) },
    uZenith: { value: new THREE.Color(A.skyZenith) },
    uReflect: { value: P.reflect },
  };
  mat.name = 'puddle';
  mat.userData.puddleUniforms = uniforms;
  mat.userData.noShadow = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHorizon;\nuniform vec3 uZenith;\nuniform float uReflect;\nvarying vec3 vPWPos;')
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize(vPWPos - cameraPosition);
          // 바람에 아주 약한 잔물결
          vec2 q = vPWPos.xz * 3.1;
          vec3 N = normalize(vec3(0.012 * sin(q.x + 1.7 * sin(q.y)), 1.0, 0.012 * sin(q.y * 1.3 + 1.1 * sin(q.x))));
          vec3 R = reflect(V, N);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
          float fres = clamp(0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0), 0.0, 1.0);
          outgoingLight = mix(outgoingLight, sky * uReflect, fres);
          diffuseColor.a = mix(diffuseColor.a, 1.0, fres);
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'puddleSky';
  return mat;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rng = new Random(CONFIG.world.seed + 101);
  }

  // 단계별 생성 (로딩 화면 갱신을 위해 나눔)
  generateTerrain() {
    this.terrain = new Terrain();
    this.terrain.generate();
    this.collision = new CollisionWorld(this.terrain);
  }

  buildStructures() {
    this.materials = createVisualMaterials();
    this.batch = new GeoBatch();
    this.inst = new InstanceCollector();
    this.structures = new StructureBuilder({
      batch: this.batch,
      col: this.collision,
      terrain: this.terrain,
      rng: this.rng,
      inst: this.inst,
    });
    // 접지 그림자 데칼: 구조물 코드에서 this.contactShadows?.add({...}) 로 새 물체 발자국을 더할 수 있다
    this.contactShadows = new ContactShadows(this.terrain);
    this.structures.contactShadows = this.contactShadows;
    this.structures.buildAll(this.materials);
  }

  addFireStep(x, z, floorY, height, yaw, parapetY) {
    this.structures.addFireStep(x, z, floorY, height, yaw, parapetY);
  }

  finalize() {
    const scene = this.scene;
    const terrainMat = createTerrainMaterial(this.terrain);
    this.terrainMaterial = terrainMat;
    this.terrainMesh = this.terrain.buildMesh(terrainMat);
    scene.add(this.terrainMesh);
    this.staticMeshes = this.batch.build(this.materials, { name: 'structures' });
    scene.add(this.staticMeshes);
    scene.add(this.structures.buildInstances(this.materials));
    scene.add(this.structures.buildWires());
    this.vegetation = new Vegetation({ terrain: this.terrain, col: this.collision, rng: this.rng });
    scene.add(this.vegetation.build());
    scene.add(this.buildPuddles());
    scene.add(this.buildDistantVillages());
    // 차량·잔해·건물 아래 접지 그림자 (맵 데이터 + 구조물 코드가 더한 발자국, 메시 하나)
    scene.add(this.contactShadows.addFromMap().build());
  }

  // 원경의 먼 마을 실루엣 (접근 불가). 다른 물체와 같은 안개를 받아 희미한 실루엣으로만 보인다
  // (안개 식의 먼 곳 실루엣 몫 CONFIG.atmosphere.fog.farResidual)
  buildDistantVillages() {
    const rng = new Random(77);
    const parts = [];
    const A = CONFIG.atmosphere;
    for (const c of MAP.distantSmoke) {
      const a = (c.bearing * Math.PI) / 180;
      const d = c.dist * 0.92;
      const cx = Math.sin(a) * d;
      const cz = -Math.cos(a) * d;
      const n = 10 + Math.floor(rng.next() * 10);
      for (let i = 0; i < n; i++) {
        const w = rng.range(8, 18);
        const h = rng.range(4, 8);
        const g = new THREE.BoxGeometry(w, h, w * rng.range(0.6, 1.2));
        // 지붕 (박공)
        const roof = new THREE.ConeGeometry(w * 0.72, h * 0.5, 4);
        roof.rotateY(Math.PI / 4);
        roof.translate(0, h / 2 + h * 0.25, 0);
        const off = (rng.next() - 0.5) * 260;
        const along = (rng.next() - 0.5) * 60;
        const px = cx + Math.cos(a) * off + Math.sin(a) * along;
        const pz = cz + Math.sin(a) * off - Math.cos(a) * along;
        for (const geo of [g, roof]) {
          geo.translate(px, h / 2 - 1, pz);
          parts.push(geo.index ? geo.toNonIndexed() : geo);
        }
      }
      // 교회 탑이나 급수탑 하나
      const tower = new THREE.CylinderGeometry(2.5, 3, rng.range(18, 26), 8);
      tower.translate(cx + Math.cos(a) * 40, 10, cz + Math.sin(a) * 40);
      parts.push(tower.toNonIndexed());
    }
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array, o * 3);
      o += p.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeBoundingSphere();
    // 어두운 지붕·벽 색 (안개가 섞어 거의 안개색이 된다)
    const col = new THREE.Color(A.fogColor).multiplyScalar(0.3);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, fog: true }));
    mesh.name = 'distantVillages';
    mesh.renderOrder = -5;
    return mesh;
  }

  // 물웅덩이: 수로 물 구간, 깊은 구덩이 바닥, 바퀴 자국. 모두 평평한 수면이고 가장자리는 지형이 가린다.
  // 흐린 하늘을 프레넬로 비춰 어두운 땅 위에 밝은 선·점으로 보인다 (원근감 단서).
  buildPuddles() {
    const t = this.terrain;
    const pos = [];
    const idx = [];
    const pushQuadStrip = (pts) => {
      // pts: [[xl,y,zl,xr,y,zr], ...]
      const base = pos.length / 3;
      for (const p of pts) pos.push(p[0], p[1], p[2], p[3], p[4], p[5]);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };
    for (const p of t.puddles) {
      if (p.type === 'canal') {
        const pts = [];
        const hw = MAP.canal.floorHalf * 0.92;
        for (let x = p.x0; x <= p.x1; x += 2) {
          const zc = t.canalZ(x);
          const y = t.heightAt(x, zc) + 0.07;
          const w = hw * (0.75 + 0.25 * Math.sin(x * 0.3));
          pts.push([x, y, zc - w, x, y, zc + w]);
        }
        pushQuadStrip(pts);
      } else if (p.type === 'strip') {
        // 바퀴 자국을 따라 길쭉한 수면
        const pts = [];
        const L = p.pts;
        for (let i = 0; i < L.length; i++) {
          const a = L[Math.max(0, i - 1)];
          const b = L[Math.min(L.length - 1, i + 1)];
          const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const nx = -(b[1] - a[1]) / dl;
          const nz = (b[0] - a[0]) / dl;
          const w = p.hw * (0.85 + 0.15 * Math.sin(i * 1.7 + L[0][0]));
          pts.push([L[i][0] - nx * w, p.level, L[i][1] - nz * w, L[i][0] + nx * w, p.level, L[i][1] + nz * w]);
        }
        pushQuadStrip(pts);
      } else {
        const seg = 16;
        const base = pos.length / 3;
        const y = p.level ?? (p.crater ? t.heightAt(p.x, p.z) + p.crater.d * 0.16 : t.heightAt(p.x, p.z) + 0.03);
        pos.push(p.x, y, p.z);
        const st = p.stretch;
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          const wob = 0.82 + 0.18 * Math.sin(a * 3 + p.x);
          let dx = Math.cos(a) * p.r * wob;
          let dz = Math.sin(a) * p.r * wob;
          if (st) {
            // 바퀴 자국 방향으로 길쭉하게
            const along = dx * st[2];
            const across = dz * 0.45;
            dx = st[0] * along - st[1] * across;
            dz = st[1] * along + st[0] * across;
          }
          pos.push(p.x + dx, y, p.z + dz);
        }
        for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i + 1, base + 1 + i);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nor = new Float32Array(pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, createPuddleMaterial());
    mesh.name = 'puddles';
    mesh.renderOrder = 1;
    return mesh;
  }

  update(dt) {
    windUniforms.uTime.value += dt;
  }
}

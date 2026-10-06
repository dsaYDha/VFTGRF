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
import { Distant } from './Distant.js';

// 물웅덩이 재질: 흐린 하늘(지평선~천정 색)을 프레넬로 비추는 평평한 수면 (낮은 각도일수록 밝은 회색, 지평선 색을 넘지 않는다).
// 정점 속성 aDepth = 그 자리 수심(m, 수면 - 렌더 지면). 물가(수심 0 근처)는 노이즈로 흔든 선을 따라 투명해져
// 얕은 물 아래 진흙이 비치고, 수면 윤곽이 다각형 판처럼 보이지 않는다. 가파른 각도에서도 하늘이 minReflect 만큼 비쳐
// 검은 구멍이 아니라 어두운 회색 물로 보인다. 안개·톤매핑은 표준 경로. 하늘색은 Atmosphere.applyToWorld 가
// 톤매핑 전 값으로 바꿔 넣는다 (userData.puddleUniforms).
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
    uMinRefl: { value: P.minReflect },
    uEdge: { value: new THREE.Vector3(P.edgeSoft, P.edgeNoise, P.shallowAlpha) },
    uCloud: { value: P.cloudReflect },
    uShallowDepth: { value: P.shallowDepth },
  };
  mat.name = 'puddle';
  mat.userData.puddleUniforms = uniforms;
  mat.userData.noShadow = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying vec3 vPWPos;\nvarying float vPDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPDepth = aDepth;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uHorizon;\nuniform vec3 uZenith;\nuniform float uReflect;\nuniform float uMinRefl;\nuniform vec3 uEdge;\nuniform float uCloud;\nuniform float uShallowDepth;\nvarying vec3 vPWPos;\nvarying float vPDepth;',
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 V = normalize(vPWPos - cameraPosition);
          // 바람에 아주 약한 잔물결
          vec2 q = vPWPos.xz * 3.1;
          vec3 N = normalize(vec3(0.012 * sin(q.x + 1.7 * sin(q.y)), 1.0, 0.012 * sin(q.y * 1.3 + 1.1 * sin(q.x))));
          vec3 R = reflect(V, N);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.55));
          // 비친 구름 얼룩: 반사 방향이 구름층에 닿는 자리의 큰 명암 무늬 (보는 자리가 움직이면 함께 흘러 한 가지 회색 판이 아니라 수면으로 읽힌다)
          vec2 cp = R.xz / max(R.y, 0.12) * 3.2;
          sky *= 1.0 + uCloud * sin(cp.x * 1.1 + 1.6 * sin(cp.y * 0.7)) * sin(cp.y * 0.9 + 1.3 * sin(cp.x * 0.6));
          float fres = max(uMinRefl, clamp(0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0), 0.0, 1.0));
          outgoingLight = mix(outgoingLight, sky * uReflect, fres);
          // 물가: 노이즈로 흔든 또렷한 물가 선 (수심 0 → edgeSoft, 화면에서 1.5px 보다 좁아지지 않게 — 계단 현상 방지),
          // 그 안쪽 얕은 띠(수심 shallowDepth 까지)는 바닥 진흙이 조금 비친다. 물가 쪽 수심은 완만하게 0 이 되므로 두 폭 모두 수심으로 아주 작게 잡는다
          vec2 e = vPWPos.xz;
          float en = sin(e.x * 3.7 + 1.9 * sin(e.y * 2.3)) * sin(e.y * 3.1 + 2.1 * sin(e.x * 1.7)) * 0.7
            + sin(e.x * 9.3 - e.y * 7.1) * 0.3;
          float dd = vPDepth + en * uEdge.y;
          float ew = max(uEdge.x, fwidth(dd) * 1.5);
          float edge = smoothstep(0.0, ew, dd);
          float shallow = mix(uEdge.z, 1.0, smoothstep(ew, ew + uShallowDepth, dd));
          diffuseColor.a = mix(diffuseColor.a * shallow, 1.0, fres) * edge;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'puddleSky4';
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
    // 원경: 먼 마을 지붕·교회·급수탑·곡물 창고, 송전탑·전신주 행렬과 전선 (맵 밖, 거리순 병합 메시 — setDistantRange)
    this.distant = new Distant({ terrain: this.terrain, col: this.collision });
    scene.add(this.distant.build());
    // 차량·잔해·건물 아래 접지 그림자 (맵 데이터 + 구조물 코드가 더한 발자국, 메시 하나)
    scene.add(this.contactShadows.addFromMap().build());
  }

  // 그래픽 품질 프리셋: 원경(맵 밖 지형·먼 마을·송전선)을 그리는 거리 (맵 중심에서 m, CONFIG.distant.maxRange 이하). 실행 중 바로 적용
  setDistantRange(m) {
    const r = Math.min(CONFIG.distant.maxRange, Math.max(this.terrain.half + 50, m));
    CONFIG.distant.range = r;
    this.terrain.setFarRange(r);
    if (this.distant) this.distant.setRange(r);
    return r;
  }

  // 물웅덩이: 수로 물 구간, 구덩이 물, 빗물 웅덩이, 바퀴·궤도 자국. 모두 평평한 수면이고 정점마다 수심(aDepth)을 넣는다
  // (렌더 지면 기준 — 밭은 고랑 바닥만큼 내린 면). 물가 바깥으로 지형 속에 묻히는 여유 테를 둬서 지형이 윤곽을 자르고,
  // 수심 0 근처는 재질이 투명하게 녹인다. 흐린 하늘을 프레넬로 비춰 어두운 땅 위에 밝은 선·점으로 보인다 (원근감 단서).
  buildPuddles() {
    const t = this.terrain;
    const pos = [];
    const dep = [];
    const idx = [];
    const ground = (x, z) => t.heightAt(x, z) - t.renderDrop(x, z);
    const depthAt = (x, y, z) => Math.max(-0.3, Math.min(0.6, y - ground(x, z)));
    // 띠 (rows: [[x, z, nx, nz], ...], 가로 오프셋 offs, 행마다 수심 보정 fn(i, j))
    const pushStrip = (rows, y, offs, depthFn) => {
      const base = pos.length / 3;
      const nc = offs.length;
      for (let i = 0; i < rows.length; i++) {
        const [x, z, nx, nz, w] = rows[i];
        for (let j = 0; j < nc; j++) {
          const px = x + nx * offs[j] * w;
          const pz = z + nz * offs[j] * w;
          pos.push(px, y, pz);
          dep.push(depthFn(i, j, px, pz));
        }
      }
      for (let i = 0; i < rows.length - 1; i++) {
        for (let j = 0; j < nc - 1; j++) {
          const a = base + i * nc + j;
          idx.push(a, a + 1, a + nc, a + 1, a + nc + 1, a + nc);
        }
      }
    };
    for (const p of t.puddles) {
      if (p.type === 'canal') {
        // 수로 바닥 물: 바닥이 평평해 지형이 가장자리를 자르지 않으므로 가장자리 정점의 수심을 0 으로 둬 녹인다
        const rows = [];
        const hw = MAP.canal.floorHalf * 0.92;
        const ys = [];
        for (let x = p.x0; x <= p.x1; x += 2) {
          const zc = t.canalZ(x);
          ys.push(t.heightAt(x, zc) + 0.07);
          rows.push([x, zc, 0, 1, hw * (0.75 + 0.25 * Math.sin(x * 0.3))]);
        }
        const base = pos.length / 3;
        const offs = [-1, -0.62, 0, 0.62, 1];
        for (let i = 0; i < rows.length; i++) {
          const [x, zc, , , w] = rows[i];
          for (let j = 0; j < offs.length; j++) {
            const pz = zc + offs[j] * w;
            pos.push(x, ys[i], pz);
            dep.push(Math.abs(offs[j]) > 0.99 ? -0.01 : depthAt(x, ys[i], pz));
          }
        }
        for (let i = 0; i < rows.length - 1; i++) {
          for (let j = 0; j < offs.length - 1; j++) {
            const a = base + i * offs.length + j;
            idx.push(a, a + 1, a + offs.length, a + 1, a + offs.length + 1, a + offs.length);
          }
        }
      } else if (p.type === 'strip') {
        // 바퀴·궤도 자국을 따라 길쭉한 수면: 자국 벽이 옆을 자르고, 양 끝은 수심을 줄여 둥글게 녹인다
        const L = p.pts;
        const rows = [];
        let total = 0;
        const along = [0];
        for (let i = 1; i < L.length; i++) along.push((total += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1])));
        for (let i = 0; i < L.length; i++) {
          const a = L[Math.max(0, i - 1)];
          const b = L[Math.min(L.length - 1, i + 1)];
          const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          rows.push([L[i][0], L[i][1], -(b[1] - a[1]) / dl, (b[0] - a[0]) / dl, p.hw]);
        }
        pushStrip(rows, p.level, [-1.6, -0.55, 0, 0.55, 1.6], (i, j, px, pz) => {
          const sEnd = Math.min(along[i], total - along[i]);
          return depthAt(px, p.level, pz) - 0.07 * (1 - Math.min(1, sEnd / 1.1)) ** 2;
        });
      } else if (p.rays) {
        // 원판형 (구덩이·빗물 웅덩이): 방사선 윤곽 × 고리 비율 + 지형 속 여유 테
        const n = p.rays.length;
        const rings = [0.45, 0.72, 0.88, 0.96, 1.0];
        const y = p.level;
        const base = pos.length / 3;
        pos.push(p.x, y, p.z);
        dep.push(depthAt(p.x, y, p.z));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const R = p.rays[i];
          for (const f of rings) {
            const x = p.x + ca * R * f;
            const z = p.z + sa * R * f;
            pos.push(x, y, z);
            dep.push(depthAt(x, y, z));
          }
          const x = p.x + ca * (R + 0.3);
          const z = p.z + sa * (R + 0.3);
          pos.push(x, y, z);
          dep.push(Math.min(-0.02, depthAt(x, y, z)));
        }
        const nr = rings.length + 1;
        for (let i = 0; i < n; i++) {
          const a = base + 1 + i * nr;
          const b = base + 1 + ((i + 1) % n) * nr;
          idx.push(base, b, a);
          for (let r = 0; r < nr - 1; r++) idx.push(a + r, b + r, a + r + 1, b + r, b + r + 1, a + r + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    const nor = new Float32Array(pos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, createPuddleMaterial());
    mesh.name = 'puddles';
    mesh.renderOrder = 1;
    this.puddleTriangleCount = idx.length / 3;
    return mesh;
  }

  update(dt) {
    windUniforms.uTime.value += dt;
  }
}

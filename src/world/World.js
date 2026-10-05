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
import * as TX from './textures.js';

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
    this.structures.buildAll(this.materials);
  }

  addFireStep(x, z, floorY, height, yaw, parapetY) {
    this.structures.addFireStep(x, z, floorY, height, yaw, parapetY);
  }

  finalize() {
    const scene = this.scene;
    const terrainMat = createTerrainMaterial({
      soil: TX.soilDetail(),
      grass: TX.grassDetail(),
      mud: TX.mudDetail(),
    });
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
  }

  // 원경의 먼 마을 실루엣 (안개에 묻히지 않게 직접 흐린 색으로 칠함, 접근 불가)
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
    const col = new THREE.Color(A.fogColor).multiplyScalar(0.86);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, fog: false }));
    mesh.name = 'distantVillages';
    mesh.renderOrder = -5;
    return mesh;
  }

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
      } else {
        const seg = 14;
        const base = pos.length / 3;
        const y = p.crater ? t.heightAt(p.x, p.z) + p.crater.d * 0.16 : t.heightAt(p.x, p.z) + 0.03;
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
    const mesh = new THREE.Mesh(geo, this.materials.water);
    mesh.name = 'puddles';
    mesh.renderOrder = 1;
    return mesh;
  }

  update(dt) {
    windUniforms.uTime.value += dt;
  }
}

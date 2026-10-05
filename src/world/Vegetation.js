// =============================================================================
// Vegetation — 말라 죽은 해바라기밭과 마른 풀 (InstancedMesh, 구역별로 나눠 컬링)
// 탄은 그대로 통과하고, 시야만 가리는 은폐 볼륨을 CollisionWorld 에 등록한다.
// =============================================================================
import * as THREE from 'three';
import { MAP } from './mapData.js';
import { grassBladeTexture } from './textures.js';
import { polylineDistance } from '../core/mathUtils.js';

// 바람 흔들림을 넣는 공용 셰이더 패치 (높이 비례)
export const windUniforms = { uTime: { value: 0 } };

function addWind(material, strength, fixNormal = false) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    if (fixNormal) {
      // 양면 카드의 뒷면 법선 반전을 막아 양쪽 모두 같은 밝기로
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n normal = normalize(vNormal);',
      );
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float hgt = max(0.0, transformed.y);
          #ifdef USE_INSTANCING
            vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 ip = vec3(0.0);
          #endif
          float ph = ip.x * 0.37 + ip.z * 0.23;
          float w = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
          transformed.x += w * hgt * hgt * ${strength.toFixed(3)};
          transformed.z += w * hgt * hgt * ${(strength * 0.4).toFixed(3)};
        }`,
      );
  };
}

// 해바라기 한 그루: 줄기(삼각기둥) + 고개 숙인 머리(원판) + 처진 잎 2장
function sunflowerGeometry() {
  const parts = [];
  const stalk = new THREE.CylinderGeometry(0.014, 0.022, 1, 3, 1, true);
  stalk.translate(0, 0.5, 0);
  parts.push(stalk);
  const head = new THREE.CircleGeometry(0.13, 6);
  head.rotateX(-0.35);
  head.translate(0, 0.94, 0.07);
  parts.push(head);
  for (const [y, a] of [
    [0.55, 0],
    [0.72, 2.4],
  ]) {
    const leaf = new THREE.PlaneGeometry(0.16, 0.22);
    leaf.translate(0, -0.11, 0);
    leaf.rotateX(0.5);
    leaf.rotateY(a);
    leaf.translate(0, y, 0);
    parts.push(leaf);
  }
  // 병합 (비인덱스로 통일)
  const geos = parts.map((g) => {
    const ng = g.toNonIndexed();
    ng.deleteAttribute('uv');
    return ng;
  });
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// 마른 풀 포기: 교차된 카드 2장
function grassTuftGeometry() {
  const a = new THREE.PlaneGeometry(1, 1);
  a.translate(0, 0.5, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const c = a.clone();
  c.rotateY(Math.PI / 4);
  const geos = [a, b, c].map((g) => g.toNonIndexed());
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    // 위쪽을 향한 법선 (카드 조명이 부드럽게)
    for (let i = 0; i < g.attributes.position.count; i++) {
      nor[(off + i) * 3] = 0;
      nor[(off + i) * 3 + 1] = 1;
      nor[(off + i) * 3 + 2] = 0;
    }
    uv.set(g.attributes.uv.array, off * 2);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

export class Vegetation {
  constructor({ terrain, col, rng }) {
    this.terrain = terrain;
    this.col = col;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
  }

  build() {
    this.buildSunflowers();
    this.buildGrass();
    return this.group;
  }

  isBlocked(x, z) {
    // 구덩이·도로·참호 위는 비움
    const s = this.terrain.surfaceAt(x, z);
    if (s === 2 || s === 3 || s === 6 || s === 7 || s === 8 || s === 4 || s === 9) return true;
    return false;
  }

  buildSunflowers() {
    const rng = this.rng;
    const geo = sunflowerGeometry();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    addWind(mat, 0.035);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const chunk = 24;
    for (const f of MAP.fields.sunflower) {
      const cells = new Map();
      const rowSp = 0.95;
      const inRow = 1.4;
      for (let x = f.x0 + 1; x < f.x1 - 1; x += rowSp) {
        for (let z = f.z0 + 1; z < f.z1 - 1; z += inRow) {
          const px = x + rng.range(-0.15, 0.15);
          const pz = z + rng.range(-0.4, 0.4);
          if (this.isBlocked(px, pz)) continue;
          // 포격으로 빈 곳, 쓰러진 줄기
          const gap = this.terrain.noise.noise(px / 11, pz / 11);
          if (gap < -0.38 && rng.next() < 0.85) continue;
          if (rng.next() < 0.08) continue;
          const key = `${Math.floor(px / chunk)}_${Math.floor(pz / chunk)}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push([px, pz]);
        }
      }
      for (const list of cells.values()) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([px, pz], i) => {
          const y = this.terrain.heightAt(px, pz);
          const h = rng.range(1.25, 1.95);
          const fallen = rng.next() < 0.12;
          dummy.position.set(px, y - 0.03, pz);
          dummy.rotation.set(fallen ? rng.range(0.9, 1.4) : rng.range(-0.12, 0.12), rng.next() * Math.PI * 2, fallen ? 0 : rng.range(-0.12, 0.12));
          dummy.scale.set(1, h, 1);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          const v = rng.range(0.07, 0.14);
          im.setColorAt(i, col.setRGB(v * 1.1, v * 0.92, v * 0.75));
        });
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.receiveShadow = true;
        this.group.add(im);
      }
      const cx = (f.x0 + f.x1) / 2;
      const cz = (f.z0 + f.z1) / 2;
      const y = this.terrain.baseHeight(cx, cz);
      this.col.addConcealer(cx, y + 0.9, cz, (f.x1 - f.x0) / 2, 1.1, (f.z1 - f.z0) / 2, 0, 'sunflower');
    }
  }

  buildGrass() {
    const rng = this.rng;
    const geo = grassTuftGeometry();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map: grassBladeTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    addWind(mat, 0.25, true);
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const chunk = 60;
    const cells = new Map();
    const put = (x, z, scale) => {
      if (this.isBlocked(x, z)) return;
      const key = `${Math.floor(x / chunk)}_${Math.floor(z / chunk)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push([x, z, scale]);
    };
    // 풀밭(그루터기) 지역에 흩뿌림 + 수로 둑·도로변·밭 경계에 촘촘히
    for (let k = 0; k < 9000; k++) {
      const x = rng.range(-290, 290);
      const z = rng.range(-290, 290);
      const s = this.terrain.surfaceAt(x, z);
      if (s !== 1) continue;
      // 수로 바로 앞(북쪽 18m)은 아주 낮은 풀만: 수로에서 고개를 내밀면 시야가 트여야 한다
      const dz = this.terrain.canalZ(x) - z;
      if (dz > -1 && dz < 18) {
        if (dz < 6 || rng.next() < 0.7) continue;
        put(x, z, rng.range(0.07, 0.13));
        continue;
      }
      // 참호 흉벽 주변은 낮은 풀 (흉벽 위 머리·총구 화염이 가끔은 보이게)
      let nearTrench = false;
      for (const line of MAP.trench.lines) if (polylineDistance(line, x, z) < 7) nearTrench = true;
      put(x, z, nearTrench ? rng.range(0.12, 0.25) : rng.range(0.3, 0.7));
    }
    // 수로 둑: 남쪽은 촘촘하고 키 큰 풀, 북쪽 둔덕은 드문드문 낮은 풀
    for (let x = -280; x < 280; x += 0.55) {
      for (const off of [2.6, 3.6, 4.8]) {
        if (rng.next() < 0.2) continue;
        const z = this.terrain.canalZ(x) + off + rng.range(-0.6, 0.6);
        put(x + rng.range(-0.3, 0.3), z, rng.range(0.45, 0.95));
      }
    }
    // 도로변
    for (const rd of MAP.roads) {
      for (let i = 0; i < rd.points.length - 1; i++) {
        const [ax, az] = rd.points[i];
        const [bx, bz] = rd.points[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        for (let s = 0; s < len; s += 0.7) {
          for (const side of [-1, 1]) {
            if (rng.next() < 0.35) continue;
            const off = rd.width / 2 + rng.range(0.5, 1.8);
            const x = ax + ((bx - ax) * s) / len + nx * side * off;
            const z = az + ((bz - az) * s) / len + nz * side * off;
            put(x, z, rng.range(0.4, 0.9));
          }
        }
      }
    }
    // 밭 북쪽 가장자리 띠 (남쪽 가장자리는 수로에서의 시야를 가리므로 두지 않는다)
    for (const f of MAP.fields.plowed) {
      for (let x = f.x0; x < f.x1; x += 0.8) {
        if (rng.next() < 0.4) continue;
        put(x + rng.range(-0.3, 0.3), f.z0 - 1.5 + rng.range(-1, 1), rng.range(0.3, 0.6));
      }
    }
    for (const list of cells.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, sc], i) => {
        const y = this.terrain.heightAt(x, z);
        dummy.position.set(x, y - 0.02, z);
        dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
        dummy.scale.set(sc * rng.range(0.9, 1.5), sc, sc * rng.range(0.9, 1.5));
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        const v = rng.range(0.42, 0.68);
        im.setColorAt(i, col.setRGB(v * 0.95, v * 0.9, v * 0.78));
      });
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
    // 풀 은폐: 수로 남쪽 둑의 키 큰 풀
    for (let x = -260; x < 260; x += 40) {
      const z = this.terrain.canalZ(x) + 3.8;
      this.col.addConcealer(x + 20, this.terrain.heightAt(x + 20, z) + 0.35, z, 20, 0.4, 1.4, 0, 'grass');
    }
    this.tuftCount = [...cells.values()].reduce((a, l) => a + l.length, 0);
  }
}

export function roadDistance(x, z) {
  let best = Infinity;
  for (const rd of MAP.roads) best = Math.min(best, polylineDistance(rd.points, x, z) - rd.width / 2);
  return best;
}

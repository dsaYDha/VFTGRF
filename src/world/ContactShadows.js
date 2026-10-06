// =============================================================================
// ContactShadows — 차량·잔해·건물 아래 어두운 접지 그림자 데칼 (모두 합친 메시 하나, 드로우콜 1)
// 흐린 날이라 실제 그림자는 플레이어 주변에서만 옅게 쓰고, 그 밖의 물체가 땅 위에 떠 보이지 않게 하는 건
// 이 데칼이 맡는다. 데칼마다 지형을 따라 휘는 격자를 깔고, 조각 셰이더에서 둥근 상자/타원 거리장으로
// 발자국 가장자리 바깥으로 부드럽게 번지는 그림자를 만든다 (텍스처 없음, 안개는 표준 경로).
//
// 다른 모듈에서 새 물체의 발자국 더하기 (World.finalize 전, 예: StructureBuilder 안에서):
//   this.contactShadows?.add({ x, z, hx, hz, rot, shape: 'box' | 'ellipse', preset: 'vehicle' | 'building' | 'rubble' | 'small' })
//   rot 은 Structures 의 frame(x, z, rot) 와 같은 Y 회전. soft / strength / inner 로 프리셋 값을 덮어쓸 수 있다.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MAP } from './mapData.js';

export class ContactShadows {
  constructor(terrain) {
    this.terrain = terrain;
    this.items = [];
    this.mesh = null;
  }

  // o: { x, z, hx, hz, rot = 0, shape = 'box', preset = 'small', soft?, strength?, inner? }
  add(o) {
    const C = CONFIG.contactShadows;
    const p = C[o.preset] || C.small;
    this.items.push({
      x: o.x,
      z: o.z,
      hx: Math.max(0.05, o.hx),
      hz: Math.max(0.05, o.hz ?? o.hx),
      rot: o.rot || 0,
      ell: o.shape === 'ellipse' ? 1 : 0,
      soft: o.soft ?? p.soft,
      strength: o.strength ?? p.strength,
      inner: o.inner ?? p.inner,
    });
    return this;
  }

  // 맵 데이터에 있는 물체들 (차량은 지형의 차량 바닥 목록을 그대로 쓴다)
  addFromMap() {
    const t = this.terrain;
    for (const v of t.vehiclePads || []) {
      this.add({ x: v.x, z: v.z, hx: v.hx * 0.92, hz: v.hz * 0.95, rot: v.rot, preset: 'vehicle' });
    }
    // 장갑차 옆에 날아가 뒤집힌 포탑 (Structures.apc 의 로컬 좌표 1.2, 3.4)
    if (MAP.apc) {
      const a = MAP.apc;
      const c = Math.cos(a.rot || 0);
      const s = Math.sin(a.rot || 0);
      this.add({ x: a.x + 1.2 * c + 3.4 * s, z: a.z - 1.2 * s + 3.4 * c, hx: 1.0, shape: 'ellipse', preset: 'vehicle', strength: 0.55, soft: 0.9 });
    }
    for (const b of MAP.barns || []) this.add({ x: b.x, z: b.z, hx: b.length / 2, hz: b.width / 2, rot: b.rot, preset: 'building' });
    if (MAP.garage) {
      const g = MAP.garage;
      this.add({ x: g.x, z: g.z, hx: g.w / 2, hz: g.d / 2, preset: 'building' });
    }
    if (MAP.silo) {
      const s = MAP.silo;
      this.add({ x: s.x, z: s.z, hx: s.r + 0.15, shape: 'ellipse', preset: 'building', inner: 1, strength: 0.55 });
    }
    for (const r of MAP.ruins || []) this.add({ x: r.x, z: r.z, hx: r.moundR, shape: 'ellipse', preset: 'rubble' });
    for (const r of MAP.rubbleMounds || []) this.add({ x: r.x, z: r.z, hx: r.r, shape: 'ellipse', preset: 'rubble' });
    for (const d of MAP.dugouts || []) this.add({ x: d.x, z: d.z, hx: d.w / 2, hz: d.d / 2, rot: d.rot, preset: 'rubble', strength: 0.36 });
    for (const n of MAP.camoNets || []) this.add({ x: n.x, z: n.z, hx: n.w / 2 - 0.4, hz: n.d / 2 - 0.4, rot: n.rot || 0, preset: 'small', soft: 1.4, strength: 0.28 });
    for (const tr of MAP.trees || []) this.add({ x: tr.x, z: tr.z, hx: 0.5, shape: 'ellipse', preset: 'small', soft: 1.0 });
    for (const s of MAP.stumps || []) {
      if (Array.isArray(s)) this.add({ x: s[0], z: s[1], hx: 0.3, shape: 'ellipse', preset: 'small', soft: 0.5, strength: 0.32 });
    }
    return this;
  }

  // 데칼 메시 하나로 합친다 (World.finalize 에서 한 번)
  build() {
    const C = CONFIG.contactShadows;
    const t = this.terrain;
    const pos = [];
    const loc = [];
    const box = [];
    const shp = [];
    const idx = [];
    for (const it of this.items) {
      const ex = it.hx + it.soft;
      const ez = it.hz + it.soft;
      const nx = Math.max(2, Math.ceil((2 * ex) / C.gridStep));
      const nz = Math.max(2, Math.ceil((2 * ez) / C.gridStep));
      const c = Math.cos(it.rot);
      const s = Math.sin(it.rot);
      const base = pos.length / 3;
      for (let j = 0; j <= nz; j++) {
        const lz = -ez + (2 * ez * j) / nz;
        for (let i = 0; i <= nx; i++) {
          const lx = -ex + (2 * ex * i) / nx;
          const wx = it.x + lx * c + lz * s;
          const wz = it.z - lx * s + lz * c;
          pos.push(wx, t.heightAt(wx, wz) + C.lift, wz);
          loc.push(lx, lz);
          box.push(it.hx, it.hz, it.soft, it.strength);
          shp.push(it.ell, it.inner);
        }
      }
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const a = base + j * (nx + 1) + i;
          const b = a + nx + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
    geo.setAttribute('aBox', new THREE.Float32BufferAttribute(box, 4));
    geo.setAttribute('aShape', new THREE.Float32BufferAttribute(shp, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, createContactShadowMaterial());
    mesh.name = 'contactShadows';
    mesh.renderOrder = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.mesh = mesh;
    return mesh;
  }
}

// 검은 반투명 데칼: 알파 = 발자국 거리장 → 가장자리 바깥 soft 폭에 걸쳐 사라짐, 깊은 안쪽은 inner 배.
// 안개는 표준 fog 청크 (검정이 안개색으로 섞여, 멀리서도 '안개 낀 어두운 땅'과 정확히 같은 결과)
// 톤매핑은 받지 않는다: 색감 보정의 어두운 쪽 들어 올림(render.grade.lift)이 데칼 색까지 밝혀 그림자가 옅어지지 않게
// (C.color 가 화면 출력 색 그대로 → 땅이 들어 올려진 만큼 비율로 어두워진다)
function createContactShadowMaterial() {
  const C = CONFIG.contactShadows;
  const mat = new THREE.MeshBasicMaterial({
    color: C.color,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  mat.name = 'contactShadow';
  mat.userData.noShadow = true;
  const iw = Number(C.innerWidth).toFixed(3);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aLocal;\nattribute vec4 aBox;\nattribute vec2 aShape;\nvarying vec2 vCSLocal;\nvarying vec4 vCSBox;\nvarying vec2 vCSShape;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCSLocal = aLocal;\nvCSBox = aBox;\nvCSShape = aShape;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCSLocal;\nvarying vec4 vCSBox;\nvarying vec2 vCSShape;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 q = abs(vCSLocal) - vCSBox.xy;
          float dBox = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          float dEll = (length(vCSLocal / max(vCSBox.xy, vec2(0.01))) - 1.0) * min(vCSBox.x, vCSBox.y);
          float d = mix(dBox, dEll, vCSShape.x);
          float o = clamp(d / max(vCSBox.z, 0.05), 0.0, 1.0);
          float a = (1.0 - o) * (1.0 - o);
          a *= mix(vCSShape.y, 1.0, smoothstep(-${iw}, -0.15, d));
          diffuseColor.a *= a * vCSBox.w;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'contactShadow';
  return mat;
}

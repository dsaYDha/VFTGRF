// 기하 보조: 월드 크기에 맞춘 UV, 정점색, 재질별 병합 배치
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// 면마다 미터 단위 UV 를 갖는 상자 (uvScale m 당 텍스처 1회 반복)
export function boxGeo(sx, sy, sz, uvScale = 1) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  // BoxGeometry 면 순서: +x, -x, +y, -y, +z, -z (각 4정점)
  const dims = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / uvScale, (uv.getY(i) * dims[f][1]) / uvScale);
    }
  }
  return g;
}

export function cylGeo(rTop, rBot, h, seg = 10, uvScale = 1, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * (rTop + rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / uvScale, (uv.getY(i) * h) / uvScale);
  return g;
}

// 삼각기둥 (박공벽 등). 밑변 폭 w, 높이 h, 두께 t. 밑변 중앙이 원점
export function gableGeo(w, h, t, uvScale = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  g.translate(0, 0, -t / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / uvScale, uv.getY(i) / uvScale);
  return g.index ? g : withIndex(g);
}

// 쐐기 (경사판). 길이 l(x), 높이 h(y), 깊이 d(z). 앞쪽(+x)이 낮아짐
export function wedgeGeo(l, h, d) {
  const shape = new THREE.Shape();
  shape.moveTo(-l / 2, 0);
  shape.lineTo(l / 2, 0);
  shape.lineTo(-l / 2, h);
  shape.lineTo(-l / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g.index ? g : withIndex(g);
}

export function withIndex(g) {
  if (g.index) return g;
  const count = g.attributes.position.count;
  const idx = [];
  for (let i = 0; i < count; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

// 위치·회전·스케일 적용. rot: 숫자(yaw) 또는 [x,y,z]
export function place(g, x, y, z, rot = 0, scale = null) {
  if (typeof rot === 'number') _e.set(0, rot, 0);
  else _e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  if (scale) _s.set(scale[0], scale[1], scale[2]);
  else _s.set(1, 1, 1);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

export function applyMatrix(g, m) {
  g.applyMatrix4(m);
  return g;
}

// 정점색 부여 (tint: THREE.Color 또는 hex), 아래쪽 어둡게(ao) 옵션
const _c = new THREE.Color();
export function tint(g, color = 0xffffff, bottomDark = 0, yRange = null) {
  withIndex(g);
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  _c.set(color);
  let y0 = 0;
  let y1 = 1;
  if (bottomDark > 0) {
    if (yRange) {
      y0 = yRange[0];
      y1 = yRange[1];
    } else {
      g.computeBoundingBox();
      y0 = g.boundingBox.min.y;
      y1 = g.boundingBox.max.y;
    }
  }
  for (let i = 0; i < pos.count; i++) {
    let k = 1;
    if (bottomDark > 0) {
      const t = Math.max(0, Math.min(1, (pos.getY(i) - y0) / Math.max(0.01, y1 - y0)));
      k = 1 - bottomDark * (1 - t);
    }
    arr[i * 3] = _c.r * k;
    arr[i * 3 + 1] = _c.g * k;
    arr[i * 3 + 2] = _c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// 재질별 기하 모음 → 병합 메시
export class GeoBatch {
  constructor() {
    this.parts = new Map();
  }

  add(key, g, color = 0xffffff, bottomDark = 0) {
    withIndex(g);
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.color) tint(g, color, bottomDark);
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  build(materials, { castShadow = true, receiveShadow = true, name = 'batch' } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.parts) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      if (!merged) {
        console.warn('merge failed for', key);
        continue;
      }
      merged.computeBoundingSphere();
      const mat = materials[key];
      if (!mat) {
        console.warn('missing material', key);
        continue;
      }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow && !mat.userData.noShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.name = `${name}:${key}`;
      group.add(mesh);
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    return group;
  }
}

// =============================================================================
// ViewModel — 1인칭 소총(AK-74)과 장갑 낀 손·위장복 소매.
//  실제 치수로 만든다: 눈 → 가늠자 U홈 25cm, 가늠자 → 가늠쇠 38cm, 가늠쇠 기둥 폭 2mm (config.viewModel).
//  좌표: 눈(카메라) = 원점, 조준선 = -Z 축(y=0), 총열은 ammo.sightHeight 아래.
//  조준(우클릭) 시 눈이 가늠자 뒤에 오고 장면 카메라와 같은 시야각으로 그려
//  가늠쇠 기둥이 실제 각크기(약 3mrad)로 보인다. 가늠쇠 끝 = 화면 중앙 = 설정 거리의 탄착점.
//  가늠자 거리를 바꾸면 총이 가늠쇠 끝을 축으로 영점 앙각만큼 들리고 가늠자 판이 그만큼 올라간다.
//  조준 시 총몸(가늠자 받침·기관부·총열 덮개·손·소매)은 정점 셰이더에서 눈을 축으로 아래로 돌려
//  화면 아래 약 20% 안에만 남긴다. 가늠자 판·U홈·가늠쇠는 제자리(실제 치수·영점 그대로)이고,
//  판 아래는 가늠자 받침 → 기관부 덮개를 원근으로 줄인 쐐기(아래로 갈수록 넓어짐)가 내려간 총몸으로 이어진다.
//  조준 전환 중에는 총이 먼저 조준선에 정렬되고(adsAlign), 그 뒤에야 총몸 내리기·쐐기가 서서히 나타난다(adsTuck, rearWedge.fade).
//  가늠자 판은 어두운 강철, 쐐기는 윗면이 하늘빛을 받아 한 단계 밝다 (판 아래 끝이 쐐기와 구분된다).
//  총몸 재질은 불투명이다 (반투명 겹침·깊이 사전 패스 없음). 판·쐐기의 흐린 가장자리만 반투명.
//  부품은 재질별로 병합해 드로우콜을 줄이고, 깊이 버퍼를 비운 뒤 따로 그려 벽·비탈에 파묻히지 않게 한다.
//  조명은 매 프레임 장면의 반구광·태양광·주변광을 카메라 기준으로 옮겨 와 장면과 같은 빛을 받는다 (안개 없음).
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { camoAtlas, flashTexture } from '../world/textures.js';
import { clamp, damp, smoothstep } from '../core/mathUtils.js';
import { elevationFor } from './zeroing.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = new THREE.Vector3();
const _el = new THREE.Vector3();
const _col = new THREE.Color();
const _hq = new THREE.Quaternion();
const _hq2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const KEEP_ATTR = new Set(['position', 'normal', 'uv', 'color']);

// ---------------------------------------------------------------------------
// 부품을 재질 키별로 모았다가 하나의 메시로 병합 (부품 색은 정점 색)
class PartSet {
  constructor() {
    this.lists = new Map();
  }

  add(key, geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(1, 1, 1));
    return this.addMatrix(key, geo, color, _m);
  }

  addMatrix(key, geo, color, m) {
    geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (!KEEP_ATTR.has(k)) geo.deleteAttribute(k);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    _col.set(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _col.r;
      arr[i * 3 + 1] = _col.g;
      arr[i * 3 + 2] = _col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(geo);
    return geo;
  }

  // 두 점 사이 원기둥/캡슐 (손가락 마디, 가는 막대)
  seg(key, A, B, r, color, capsule = true, radial = 8) {
    _a.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const len = _a.length();
    const geo = capsule ? new THREE.CapsuleGeometry(r, Math.max(1e-4, len), 3, radial) : new THREE.CylinderGeometry(r, r, len, radial);
    _q.setFromUnitVectors(UP, _a.divideScalar(len));
    _m.compose(_p.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2), _q, _s.set(1, 1, 1));
    return this.addMatrix(key, geo, color, _m);
  }

  // 점 목록을 잇는 마디 (손가락)
  chain(key, pts, r, color, taper = 0.9) {
    let rr = r;
    for (let i = 0; i + 1 < pts.length; i++) {
      this.seg(key, pts[i], pts[i + 1], rr, color);
      rr *= taper;
    }
  }

  build(parent, materials) {
    const meshes = [];
    for (const [key, list] of this.lists) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, materials[key]);
      mesh.frustumCulled = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}

// 축이 Z 인 원기둥 (rBack: +Z 쪽 반지름, rFront: -Z 쪽, hSeg: 길이 방향 마디 수 — 조준 시 휘어 내려가는 구간용)
function cylZ(rBack, len, seg = 12, rFront = rBack, hSeg = 1) {
  return new THREE.CylinderGeometry(rBack, rFront, len, seg, hSeg).rotateX(Math.PI / 2);
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// 윗부분을 Z 에 따라 기울인다 (y > yMin 인 꼭짓점의 y += k·(z - zRef))
function slopeTop(geo, k, zRef, yMin) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > yMin) p.setY(i, p.getY(i) + k * (p.getZ(i) - zRef));
  geo.computeVertexNormals();
  return geo;
}

// 위쪽 반원기둥 (축 Z): 총열 덮개·기관부 덮개의 둥근 윗면
function halfCylZ(r, len, seg = 12) {
  return new THREE.CylinderGeometry(r, r, len, seg, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
}

// 단면이 직사각형인 곡선 막대 (Y-Z 평면의 곡선을 따라 휨). 굽은 탄창·권총 손잡이용
// spine(t) → [y, z, ang] (ang: 아래(-Y)에서 앞(-Z)으로 기운 각), width(t)·depth(t): 단면 크기
function sweptBox(n, spine, width, depth) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const rings = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [y, z, ang] = spine(t);
    const T = [0, -Math.cos(ang), -Math.sin(ang)];
    const F = [0, Math.sin(ang), -Math.cos(ang)]; // 앞면 방향 (T 에 수직)
    rings.push({ c: [0, y, z], T, F, w: width(t) / 2, d: depth(t) / 2, t });
  }
  const corner = (r, sf, sx) => [sx * r.w, r.c[1] + r.F[1] * r.d * sf, r.c[2] + r.F[2] * r.d * sf];
  const quad = (a, b, c, d, na, nb, ua, ub) => {
    // a,b: 앞 링의 두 꼭짓점 / c,d: 다음 링. 바깥 법선 쪽으로 감기게 확인
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    nor.push(...na, ...na, ...nb, ...nb);
    uv.push(0, ua, 1, ua, 0, ub, 1, ub);
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _c.crossVectors(_a, _b);
    if (_c.x * na[0] + _c.y * na[1] + _c.z * na[2] >= 0) idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  for (let i = 0; i < n; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    const neg = (v) => [-v[0], -v[1], -v[2]];
    // 앞(+F)·뒤(-F)·오른쪽(+X)·왼쪽(-X)
    quad(corner(r0, 1, -1), corner(r0, 1, 1), corner(r1, 1, -1), corner(r1, 1, 1), r0.F, r1.F, r0.t, r1.t);
    quad(corner(r0, -1, -1), corner(r0, -1, 1), corner(r1, -1, -1), corner(r1, -1, 1), neg(r0.F), neg(r1.F), r0.t, r1.t);
    quad(corner(r0, -1, 1), corner(r0, 1, 1), corner(r1, -1, 1), corner(r1, 1, 1), [1, 0, 0], [1, 0, 0], r0.t, r1.t);
    quad(corner(r0, -1, -1), corner(r0, 1, -1), corner(r1, -1, -1), corner(r1, 1, -1), [-1, 0, 0], [-1, 0, 0], r0.t, r1.t);
  }
  // 위·아래 마구리
  const cap = (r, sign) => {
    const nT = [r.T[0] * sign, r.T[1] * sign, r.T[2] * sign];
    quad(corner(r, -1, -1), corner(r, -1, 1), corner(r, 1, -1), corner(r, 1, 1), nT, nT, 0, 1);
  };
  cap(rings[0], -1);
  cap(rings[n], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// 일정한 곡률의 곡선: 시작점(y0,z0)·시작각 a0 에서 길이 len 동안 a1 까지 휜다
function arcSpine(y0, z0, a0, a1, len) {
  return (t) => {
    const k = (a1 - a0) / len;
    const s = t * len;
    const ang = a0 + k * s;
    if (Math.abs(k) < 1e-6) return [y0 - Math.cos(a0) * s, z0 - Math.sin(a0) * s, ang];
    // 적분: dy/ds = -cos(ang), dz/ds = -sin(ang)
    const y = y0 - (Math.sin(ang) - Math.sin(a0)) / k;
    const z = z0 + (Math.cos(ang) - Math.cos(a0)) / k;
    return [y, z, ang];
  };
}

// ---------------------------------------------------------------------------
// 절차적 텍스처 (뷰모델 전용)
// 적층목: 채도 낮은 짙은 자두빛 갈색 바탕에 얇은 합판 층 무늬
function laminateTexture(hex) {
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const base = new THREE.Color(hex);
  const rgb = { r: 0, g: 0, b: 0 };
  base.getRGB(rgb, THREE.SRGBColorSpace);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const rows = new Float32Array(H);
  let layer = 0;
  let next = 0;
  for (let y = 0; y < H; y++) {
    if (y >= next) {
      layer = (rnd() - 0.5) * 0.16;
      next = y + 2 + Math.floor(rnd() * 5);
    }
    rows[y] = 1 + layer + Math.sin(y * 0.21) * 0.03;
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = rows[y] * (1 + (rnd() - 0.5) * 0.06);
      const i = (y * W + x) * 4;
      img.data[i] = clamp(rgb.r * 255 * k, 0, 255);
      img.data[i + 1] = clamp(rgb.g * 255 * k, 0, 255);
      img.data[i + 2] = clamp(rgb.b * 255 * k, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 가늠자 판 뒷면 실루엣 (U홈 포함). 네 가장자리와 U홈을 모두 blur 폭만큼 부드럽게 (가까워서 초점이 맞지 않는 느낌)
// 판 영역: x ∈ [-W/2, W/2], y ∈ [-H, 0]. 텍스처는 사방에 blur 여백을 더한 평면에 입힌다.
// 아래 가장자리도 흐려, 어두운 판이 그 아래의 조금 밝은 쐐기(조준 시)로 부드럽게 넘어간다.
function rearSightAlpha(W, H, nw, nd, blur, pxW = 256, pxH = 192) {
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const g = c.getContext('2d');
  const img = g.createImageData(pxW, pxH);
  const PW = W + blur * 2;
  const PH = H + blur * 2;
  const r = nw / 2;
  const cy = -nd + r;
  for (let j = 0; j < pxH; j++) {
    const y = blur - ((j + 0.5) / pxH) * PH;
    for (let i = 0; i < pxW; i++) {
      const x = -PW / 2 + ((i + 0.5) / pxW) * PW;
      // 판(사각형) 바깥이 양수인 거리
      const sdRect = Math.max(Math.abs(x) - W / 2, y, -H - y);
      // U홈: 위로 열린 홈 + 둥근 바닥
      const sdSlot = Math.max(Math.abs(x) - r, cy - y);
      const sdCirc = Math.hypot(x, y - cy) - r;
      const sdU = Math.min(sdSlot, sdCirc);
      const sd = Math.max(sdRect, -sdU);
      const a = smoothstep(blur / 2, -blur / 2, sd);
      const v = Math.round(a * 255);
      const k = (j * pxW + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return { tex: t, PW, PH };
}

// ---------------------------------------------------------------------------
// 2관절 IK: 어깨 S → 손목 W, 위팔 L1, 아래팔 L2, 팔꿈치가 향할 방향 pole → 팔꿈치 out
function solveElbow(S, W, L1, L2, pole, out) {
  _d.subVectors(W, S);
  const dist = _d.length() || 1e-4;
  _d.divideScalar(dist);
  const dd = clamp(dist, Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.999);
  const a = (L1 * L1 - L2 * L2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _c.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  return out.copy(S).addScaledVector(_d, a).addScaledVector(_c, h);
}

// 밑면이 원점, 위가 +Y(길이 1)인 소매 원기둥 → A 에서 B 로 늘여 배치
function placeLimb(mesh, A, B) {
  _a.subVectors(B, A);
  const len = _a.length() || 1e-4;
  mesh.position.copy(A);
  mesh.quaternion.setFromUnitVectors(UP, _a.divideScalar(len));
  mesh.scale.set(1, len, 1);
}

function sleeveGeometry(rBase, rTop, seg = 12) {
  const g = new THREE.CylinderGeometry(rTop, rBase, 1, seg, 4, false).translate(0, 0.5, 0);
  // 위장 무늬 아틀라스의 왼쪽 75% 만 쓴다 (오른쪽은 흰 칸)
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.72, uv.getY(i) * 0.6);
  return g;
}

// 손 자세: 손 지오메트리의 기준점 pivot 을 X 로, 회전 q 로 옮기는 그룹 변환
function setHandPose(group, pivot, X, q) {
  group.quaternion.copy(q);
  _p.copy(pivot).applyQuaternion(q);
  group.position.copy(X).sub(_p);
}

const easeInOut = (t) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------------------
export class ViewModel {
  constructor(game) {
    this.game = game;
    const V = CONFIG.viewModel;
    this.V = V;
    this.scene = new THREE.Scene();
    const R = CONFIG.render;
    this.camera = new THREE.PerspectiveCamera(R.fovDeg, window.innerWidth / window.innerHeight, 0.01, 10);

    // 조명: 장면의 빛을 매 프레임 복사 (syncLights)
    const A = CONFIG.atmosphere;
    this.hemi = new THREE.HemisphereLight(A.hemiSky, A.hemiGround, A.hemiIntensity);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(A.sunColor, A.sunIntensity);
    this.sun.position.set(0.4, 1, 0.3);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.amb = new THREE.AmbientLight(0xffffff, 0);
    this.scene.add(this.amb);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.6, 2);
    this.scene.add(this.flashLight);
    this.srcLights = null;
    this.lightScanTimer = 0;

    // 치수
    this.sightH = CONFIG.ammo[CONFIG.weapons.ak545.ammo].sightHeight;
    this.zN = -V.eyeToRearSight; // 가늠자 U홈 (뒷면)
    this.zF = this.zN - V.sightRadius; // 가늠쇠 기둥
    this.yB = -this.sightH; // 총열 축

    this.root = new THREE.Group(); // 카메라 기준 자세
    this.scene.add(this.root);
    this.rifle = new THREE.Group(); // 가늠쇠 끝을 축으로 영점 앙각만큼 들린다
    this.root.add(this.rifle);
    this.makeMaterials();
    this.buildRifle();
    this.buildHands();
    this.buildArms();

    this.blend = { ads: 0, sprint: 0, reload: 0, bolt: 0, down: 0 };
    this.boltPose = 0; // 재장전 애니메이션이 정하는 장전손잡이 자세 비율
    this.pose = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // 총 위치(3)·회전(3)·왼쪽 어깨 이동(3)
    this.kick = 0;
    this.kickRot = 0;
    this.kickVel = 0;
    this.flashTime = 0;
    this.boltOffset = 0;
    this.elevKey = -1;

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
    game.events.on(EV.RELOAD_END, (e) => {
      if (e.owner !== game.player.body) return;
      this.resetMag();
    });
  }

  makeMaterials() {
    const C = this.V.colors;
    // 조준 시 총몸 내리기: x = 눈을 축으로 아래로 돌리는 각, y→z = 회전이 0 → 최대가 되는 깊이 (카메라 기준 z)
    // 가늠쇠 블록(y 보다 앞)은 제자리에 남아 총열과 이어지고, 그 뒤 총몸 전체가 함께 내려간다
    const T = this.V.adsTuck;
    this.adsTuck = { value: new THREE.Vector3(0, this.zF + T.zFrom, this.zF + T.zTo) };
    const std = (o) => this.withAdsTuck(new THREE.MeshStandardMaterial({ vertexColors: true, ...o }));
    this.mats = {
      // 무광 흑회색 금속 (부품 색은 정점 색)
      metal: std({ roughness: 0.55, metalness: 0.2 }),
      // 적층목 (색은 텍스처, 정점 색은 밝기 배율)
      wood: std({ map: laminateTexture(C.furniture), roughness: 0.66, metalness: 0 }),
      glove: std({ roughness: 0.92, metalness: 0 }),
      // 탄창: 폴리머 (색은 재질, 정점 색은 밝기 배율)
      mag: std({ color: C.magazine, roughness: 0.72, metalness: 0 }),
      // 가늠자 판: 조준 시에도 제자리 (내리지 않는다)
      sight: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15 }),
    };
    this.sleeveMat = this.withAdsTuck(new THREE.MeshStandardMaterial({ map: camoAtlas(), roughness: 0.95, metalness: 0 }));
    this.tapeMat = this.withAdsTuck(new THREE.MeshStandardMaterial({ color: CONFIG.factions.friendly.tapeColor, roughness: 0.8 }));
  }

  // 정점 셰이더에 조준 시 총몸 내리기를 끼워 넣는다 (조준하지 않을 때는 각이 0 → 그대로).
  //  카메라 기준 좌표를 눈을 축으로 아래로 돌린다: 화면에서 총몸 전체가 원근 그대로 아래로 내려가고 빛(법선)도 같이 돈다.
  //  회전각은 깊이에 따라 가늠쇠 블록 뒤에서 0 → 최대로 부드럽게 늘어 총열이 끊기지 않는다.
  withAdsTuck(mat) {
    const uni = this.adsTuck;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uAdsTuck = uni;
      sh.vertexShader = 'uniform vec3 uAdsTuck;\n' + sh.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        float vmA = uAdsTuck.x * smoothstep( uAdsTuck.y, uAdsTuck.z, mvPosition.z );
        if ( vmA > 0.0 ) {
          float vmC = cos( vmA );
          float vmS = sin( vmA );
          mvPosition.yz = vec2( mvPosition.y * vmC + mvPosition.z * vmS, mvPosition.z * vmC - mvPosition.y * vmS );
          gl_Position = projectionMatrix * mvPosition;
          #ifndef FLAT_SHADED
          vNormal = normalize( vec3( vNormal.x, vNormal.y * vmC + vNormal.z * vmS, vNormal.z * vmC - vNormal.y * vmS ) );
          #endif
        }`,
      );
    };
    return mat;
  }

  // ------------------------------------------------------------------ 총
  buildRifle() {
    const V = this.V;
    const C = V.colors;
    const M = C.metal;
    const MD = C.metalDark;
    const WD = 0xffffff; // 적층목 (텍스처 색 그대로)
    const ps = new PartSet();
    const yB = this.yB;
    const zN = this.zN;
    const zF = this.zF;

    // ---- 소염기 (AK-74 특유의 원통형 머즐 브레이크: 뒤 고리, 큰 팽창실, 양옆 창, 앞쪽 비스듬한 절개)
    const zMz = zF - 0.025; // 가늠쇠 블록 앞
    ps.add('metal', cylZ(0.0102, 0.016, 14), M, 0, yB, zMz - 0.008);
    ps.add('metal', cylZ(0.0118, 0.054, 16), M, 0, yB, zMz - 0.043);
    ps.add('metal', cylZ(0.0118, 0.014, 16, 0.0108), M, 0, yB, zMz - 0.077);
    // 팽창실 양옆 큰 창 (어두운 홈)
    for (const s of [-1, 1]) {
      ps.add('metal', box(0.0018, 0.013, 0.02), 0x0b0b0b, s * 0.0112, yB, zMz - 0.054);
      ps.add('metal', box(0.0018, 0.009, 0.007), 0x0b0b0b, s * 0.0112, yB, zMz - 0.03);
    }
    // 앞 아래쪽 비스듬한 절개 (반동 상쇄)
    ps.add('metal', box(0.016, 0.004, 0.012), 0x101010, 0, yB - 0.0105, zMz - 0.078, -0.35, 0, 0);
    // 위 오른쪽 작은 구멍 3개
    for (let i = 0; i < 3; i++) ps.add('metal', cylZ(0.0016, 0.004, 6).rotateX(Math.PI / 2), 0x0a0a0a, 0.006, yB + 0.0098, zMz - 0.012 - i * 0.007, 0, 0, -0.55);
    // 총구 (검은 구멍)
    ps.add('metal', new THREE.CircleGeometry(0.0045, 12).rotateY(Math.PI), 0x050505, 0, yB, zMz - 0.0851);

    // ---- 총열·가스 피스톤 관·청소봉 (조준 시 가늠쇠 블록 뒤에서 휘어 내려가므로 길이 방향으로 잘게 나눈다)
    ps.add('metal', cylZ(0.0088, 0.36, 12, 0.0088, 12), M, 0, yB, -0.48);
    ps.add('metal', cylZ(0.0028, 0.17, 6, 0.0028, 6), MD, 0, yB - 0.0165, -0.565);

    // ---- 가늠쇠 블록 (총열 고리 + 탑 + 보호 귀 + 기둥)
    ps.add('metal', box(0.023, 0.026, 0.05), M, 0, yB, zF);
    ps.add('metal', box(0.012, 0.012, 0.03), MD, 0, yB - 0.018, zF - 0.004); // 대검 착검 돌기
    const towerTop = -0.024;
    ps.add('metal', box(0.019, towerTop - (yB + 0.012), 0.026), M, 0, (towerTop + yB + 0.012) / 2, zF);
    ps.add('metal', new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 10), MD, 0, towerTop + 0.002, zF);
    // 기둥: 끝이 정확히 y=0 (조준선)
    const pw = V.frontPostWidth;
    const postBase = towerTop + 0.004;
    ps.add('metal', box(pw, -postBase, pw * 1.1), 0x161616, 0, postBase / 2, zF);
    // 보호 귀: 위가 기둥 끝보다 frontEarRise 만큼 높고, 안쪽 간격 frontEarGap
    const et = 0.0024;
    const earTop = V.frontEarRise;
    const earBot = towerTop - 0.004;
    for (const s of [-1, 1]) {
      const ex = s * (V.frontEarGap / 2 + et / 2);
      ps.add('metal', box(et, earTop - earBot, 0.013), M, ex, (earTop + earBot) / 2, zF);
      // 귀 아랫부분은 탑 쪽으로 벌어진다
      ps.add('metal', box(et * 1.6, 0.012, 0.015), M, s * (V.frontEarGap / 2 + et * 0.9), earBot + 0.004, zF);
    }

    // ---- 가스 블록·가스관 (총열 위)
    const yG = yB + 0.029;
    const zGB = -0.505;
    ps.add('metal', box(0.022, 0.024, 0.034), M, 0, yB, zGB);
    ps.add('metal', box(0.018, yG - yB, 0.028), M, 0, (yG + yB) / 2, zGB);
    ps.add('metal', cylZ(0.0098, 0.04, 12), M, 0, yG, zGB + 0.032);
    // 가스관 노출부 구멍
    for (const s of [-1, 1]) ps.add('metal', box(0.0012, 0.004, 0.006), 0x0b0b0b, s * 0.0097, yG, zGB + 0.03);

    // ---- 상부 총열 덮개 (가스관을 감싸는 적층목, 위가 둥글다)
    const zHG0 = -0.468;
    const zHG1 = -0.31;
    const hgL = zHG1 - zHG0;
    const hgC = (zHG0 + zHG1) / 2;
    ps.add('wood', box(0.03, 0.014, hgL), WD, 0, yG - 0.002, hgC);
    ps.add('wood', halfCylZ(0.015, hgL, 14).scale(1, 0.75, 1), WD, 0, yG + 0.005, hgC);
    // 상부 덮개 앞 금속 고리
    ps.add('metal', box(0.033, 0.012, 0.006), M, 0, yG + 0.002, zHG0 - 0.002);

    // ---- 하부 총열 덮개 (손바닥 받침 볼록, 손가락 홈)
    const lgTop = yB + 0.013;
    const lgBot = yB - 0.034;
    const zLG0 = -0.476;
    const zLG1 = -0.306;
    const lgL = zLG1 - zLG0;
    const lgC = (zLG0 + zLG1) / 2;
    ps.add('wood', box(0.048, lgTop - lgBot - 0.012, lgL), WD, 0, (lgTop + lgBot) / 2 + 0.006, lgC);
    ps.add('wood', cylZ(0.024, lgL, 14).scale(1, 0.5, 1), WD, 0, lgBot + 0.012, lgC);
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) ps.add('wood', box(0.003, 0.02, 0.006), 0xcfc8c6, s * 0.0242, yB - 0.006, -0.448 + i * 0.022);
    }
    // 앞 고정 고리 (금속 띠)
    ps.add('metal', box(0.051, 0.05, 0.009), M, 0, yB - 0.009, zLG0 - 0.004);

    // ---- 가늠자 받침 블록 (총열 덮개 뒤, 기관부 앞)
    const zRB0 = zN - 0.068;
    const zRB1 = zN + 0.014;
    const rbC = (zRB0 + zRB1) / 2;
    const rbL = zRB1 - zRB0;
    ps.add('metal', box(0.03, 0.05, rbL), M, 0, yB + 0.005, rbC);
    // 위쪽 가늠자 받침 (양옆 벽 + 경사 받침)
    const rbTop = -0.0125;
    for (const s of [-1, 1]) ps.add('metal', box(0.003, rbTop - (yB + 0.03), rbL * 0.9), M, s * 0.0104, (rbTop + yB + 0.03) / 2, rbC + 0.002);
    ps.add('metal', box(0.018, -0.0145 - (yB + 0.03), rbL * 0.85), MD, 0, (-0.0145 + yB + 0.03) / 2, rbC);
    // 판 스프링 덮개
    ps.add('metal', box(0.014, 0.004, 0.04), MD, 0, rbTop - 0.006, zN - 0.04);

    // ---- 기관부 (리시버) + 덮개
    const zRc0 = zN + 0.014;
    const zRc1 = 0.03;
    const rcL = zRc1 - zRc0;
    const rcC = (zRc0 + zRc1) / 2;
    const rcBot = -0.098;
    const rcTop = -0.042;
    // 윗면은 뒤로 갈수록 조금 낮아진다 (덮개 뒤 끝이 기관부 뒤 홈에 물림) → 조준 시 총몸이 화면 아래로 빠진다
    const dcK = this.V.dustCoverDrop / rcL;
    const dcY = (z) => rcTop - (z - zRc0) * dcK;
    ps.add('metal', slopeTop(box(0.03, rcTop - rcBot, rcL), -dcK, -rcL / 2, 0), M, 0, (rcTop + rcBot) / 2, rcC);
    // 덮개: 둥근 위 + 가로 리브 + 뒤 단추
    const dcL = rcL - 0.02;
    const dcC = rcC - 0.008;
    ps.add('metal', slopeTop(halfCylZ(0.0148, dcL, 16).scale(1, 0.95, 1), -dcK, 0, -1), M, 0, dcY(dcC), dcC);
    // 조준 시 가늠자 아래 쐐기가 내려간 덮개와 만나는 높이·폭 계산용 (덮개 윗면 높이 = y0 − (z − z0)·k, 반폭 half)
    this.cover = { y0: rcTop + 0.0148 * 0.95, z0: zRc0, k: dcK, half: 0.0148 };
    for (let i = 0; i < 5; i++) {
      const z = zRc0 + 0.03 + i * 0.03;
      ps.add('metal', halfCylZ(0.0152, 0.004, 16).scale(1, 0.95, 1), 0x353637, 0, dcY(z), z);
    }
    ps.add('metal', cylZ(0.004, 0.008, 8), MD, 0, dcY(dcC + dcL / 2) + 0.002, dcC + dcL / 2 - 0.004);
    // 배출구 (오른쪽, 어두운 홈)
    ps.add('metal', box(0.002, 0.014, 0.075), 0x0c0c0c, 0.0152, -0.051, zRc0 + 0.06);
    // 탄창 삽입구 아래 볼록한 부분, 리벳
    ps.add('metal', box(0.034, 0.012, 0.075), M, 0, rcBot + 0.004, zRc0 + 0.035);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) ps.add('metal', new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 8).rotateZ(Math.PI / 2), MD, s * 0.0158, -0.088, zRc0 + 0.012 + i * 0.012);
    }
    // 뒤 트러니언·개머리판 연결부
    ps.add('metal', box(0.031, 0.05, 0.026), MD, 0, -0.072, zRc1 + 0.008);

    // ---- 방아쇠울·방아쇠·탄창 멈치
    const zTG0 = -0.158;
    ps.add('metal', box(0.009, 0.003, 0.084), M, 0, -0.124, zTG0 + 0.042);
    ps.add('metal', box(0.009, 0.026, 0.003), M, 0, -0.111, zTG0);
    ps.add('metal', box(0.005, 0.022, 0.006), MD, 0, -0.108, -0.118, -0.25, 0, 0);
    ps.add('metal', box(0.011, 0.012, 0.004), M, 0, -0.105, zTG0 - 0.008, 0.3, 0, 0);

    // ---- 권총 손잡이 (적층목/폴리머, 뒤로 기운 곡선)
    const gripSpine = arcSpine(-0.098, -0.054, -0.36, -0.42, 0.108);
    this.gripSpine = gripSpine;
    ps.add('wood', sweptBox(5, gripSpine, (t) => 0.029 - t * 0.002, (t) => 0.04 - t * 0.004), 0xe8e2e0);
    ps.add('wood', box(0.032, 0.006, 0.046), 0xd8d2d0, 0, -0.201, -0.012, -0.4, 0, 0);

    // ---- 개머리판 (적층목, 아래로 처짐 + 옆 홈)
    const stockSpine = (t) => {
      const z = 0.043 + t * 0.255;
      return [-0.078 - t * 0.065, z, -Math.PI / 2];
    };
    ps.add('wood', sweptBox(4, stockSpine, () => 0.038, (t) => 0.048 + t * 0.08), WD);
    for (const s of [-1, 1]) ps.add('wood', box(0.002, 0.012, 0.15), 0xa8a2a0, s * 0.0192, -0.112, 0.16, 0.24, 0, 0);
    ps.add('metal', box(0.04, 0.13, 0.01), MD, 0, -0.143, 0.302);

    ps.build(this.rifle, this.mats);

    this.buildRearSight();
    this.buildBolt();
    this.buildMag();

    // 총구 화염 (가산 혼합)
    const fm = new THREE.MeshBasicMaterial({
      map: flashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const zMuzzle = zMz - 0.086;
    this.muzzleZ = zMuzzle;
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
    this.flash.position.set(0, yB, zMuzzle - 0.05);
    this.flash.visible = false;
    this.rifle.add(this.flash);
    this.flash2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
    this.flash2.position.set(0, yB, zMuzzle - 0.07);
    this.flash2.rotation.x = -Math.PI / 2;
    this.flash2.visible = false;
    this.rifle.add(this.flash2);
  }

  // 가늠자: 앞쪽 경첩을 축으로 도는 판 + 뒤 끝의 U홈 판 + 거리 조절 슬라이더 (+ 조준 시 판 아래 쐐기: buildRearWedge).
  //  눈에서 25cm 라 초점이 맞지 않으므로 판의 눈 쪽 실루엣 전체(위·옆·아래·모서리·U홈)를 흐린 덮개 평면이 그리고,
  //  밑의 상자들은 흐림 폭 안쪽으로 줄여 딱딱한 모서리가 드러나지 않게 한다. 슬라이더도 판 실루엣 안에 들어간다.
  //  판 색(colors.leaf)은 어둡게: 흑토 밭·하늘 어느 쪽을 겨눠도 U홈 속(배경)이 판보다 밝게 읽힌다.
  buildRearSight() {
    const V = this.V;
    const C = V.colors;
    const zN = this.zN;
    const L = 0.052; // 판 길이 (경첩 → U홈)
    const hingeY = -0.0105;
    this.leafHinge = new THREE.Vector3(0, hingeY, zN - L);
    this.leafLen = L;
    this.leaf = new THREE.Group();
    this.leaf.position.copy(this.leafHinge);
    this.rifle.add(this.leaf);
    const hz = this.leafHinge.z;
    const ps = new PartSet();
    const W = V.rearLeafWidth;
    const nw = V.rearNotchWidth;
    const nd = V.rearNotchDepth;
    const blur = V.rearSightBlur;
    const b2 = blur / 2;
    const plateH = 0.0105;
    const t = 0.0028;
    const SC = C.leaf;
    // 판 (경첩에서 U홈 판까지)
    ps.add('sight', box(W * 0.8, 0.0025, L - t), SC, 0, -0.0095 - hingeY, zN - (L - t) / 2 - t - hz);
    // U홈 판: 흐림 가장자리 안쪽으로 b2 만큼 (위·옆·아래 모두) 줄인 상자 (가장자리는 흐린 덮개 평면이 그린다)
    const zPlate = zN - t / 2 - hz;
    const shW = W / 2 - nw / 2 - 2 * b2;
    const shH = plateH - 2 * b2;
    for (const s of [-1, 1]) ps.add('sight', box(shW, shH, t), SC, s * (nw / 2 + b2 + shW / 2), -plateH / 2 - hingeY, zPlate);
    const brH = plateH - nd - 2 * b2;
    ps.add('sight', box(nw + 2 * b2, brH, t), SC, 0, -plateH + b2 + brH / 2 - hingeY, zPlate);
    // 경첩
    ps.add('sight', new THREE.CylinderGeometry(0.0025, 0.0025, W * 0.8, 8).rotateZ(Math.PI / 2), SC, 0, 0, 0);
    ps.build(this.leaf, this.mats);
    // 판 뒷면 위·아래 끝 가운데 (판 기준 좌표): 조준 시 쐐기를 판 아래 끝에 붙이는 기준
    this.leafTopL = new THREE.Vector3(0, -hingeY, zN - hz);
    this.leafBottomL = new THREE.Vector3(0, -plateH - hingeY, zN - hz);
    this.leafPlateH = plateH;

    // 흐린 가장자리 덮개 (판 뒷면, 눈 쪽): 판 실루엣 (아래 가장자리도 흐려 쐐기로 부드럽게 넘어간다)
    const { tex, PW, PH } = rearSightAlpha(W, plateH, nw, nd, blur);
    const om = new THREE.MeshStandardMaterial({
      color: SC,
      roughness: 0.62,
      metalness: 0.15,
      alphaMap: tex,
      transparent: true,
      depthWrite: false,
    });
    this.overlayMat = om;
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), om);
    overlay.position.set(0, blur - PH / 2 - hingeY, zN + 0.0002 - hz);
    overlay.renderOrder = 2;
    overlay.frustumCulled = false;
    this.leaf.add(overlay);
    this.notchOverlay = overlay;

    // 거리 조절 슬라이더 (판 위를 앞뒤로 움직인다). 날개 끝까지 판 실루엣의 불투명한 부분 안에 들어가는 폭
    const sp = new PartSet();
    const slW = W * 0.8;
    sp.add('sight', box(slW, 0.004, 0.011), SC, 0, 0, 0);
    for (const s of [-1, 1]) sp.add('sight', box(0.0012, 0.0035, 0.006), SC, s * (slW / 2 + 0.0006), 0, 0);
    this.sightSlider = new THREE.Group();
    sp.build(this.sightSlider, this.mats);
    this.leaf.add(this.sightSlider);

    this.buildRearWedge();
  }

  // ---- 조준 시 가늠자 판 아래 쐐기: 가늠자 받침 → 기관부 덮개 윗면을 원근으로 줄여 그린 모양.
  //  판 바로 아래에서 받침 폭(판보다 조금 넓다)으로 시작해 아래로 갈수록 넓어지며, 눈을 축으로 내려간 기관부 덮개의
  //  윗마루에서 덮개 폭이 되고, 덮개 단면이 가장 넓은 높이까지 이어져 덮개 뒤로 들어간다 (흐린 양옆 = 판과 같은 흐림 폭, 정점 알파).
  //  카메라 공간 평면(덮개 윗마루 거리)에 매 프레임 놓는다: 윗끝은 판의 실제 아래 끝, 아래 끝은 정점 셰이더와 같은 식으로
  //  내려간 덮개 점이라, 영점 앙각·조준 전환 중에도 판과 총몸에 붙어 있다. 평면보다 먼 내려간 가늠자 받침 블록·총열 덮개와
  //  휘어 내려가는 총열은 쐐기가 가리고, 더 가까운 덮개 뒷부분·손은 쐐기 앞에 온다.
  //  가운데 윗면은 법선을 위로 기울여 하늘빛을 받고, 가로 리브(원근 간격)가 밝은 선 + 그늘 선으로 보인다.
  buildRearWedge() {
    const V = this.V;
    const W = V.rearWedge;
    const b2 = V.rearSightBlur / 2;
    // 행 (seg 0: 윗끝, 1: 판 아래 neck, 2: neck → 총몸과 만나는 곳, 3: 그 아래 끝) / f: 구간 안 비율
    const fs = [];
    const N = 8;
    for (let i = 1; i <= N; i++) fs.push(i / N);
    // 리브: 원근 간격 (아래로 갈수록 벌어지고 두꺼워진다). 밝은 윗선 → 그늘 → 바탕
    const ribs = [];
    const span = W.neck + 0.09; // 대략의 쐐기 길이 (리브 두께를 비율로 바꾸는 데만 쓴다)
    for (let r = 0; r < W.ribs; r++) {
      const fr = ((r + 1) / (W.ribs + 1)) ** W.ribPow;
      const d = (W.ribWidth * (0.6 + fr)) / Math.abs(span);
      ribs.push({ fr, d });
      for (const o of [-0.5, 0, 0.5, 1]) fs.push(clamp(fr + o * d, 0.001, 0.999));
    }
    fs.sort((a, b) => a - b);
    const ribK = (f) => {
      let k = 1;
      for (const { fr, d } of ribs) {
        const u = (f - fr) / d;
        if (u > -0.5 && u <= 0) k += 0.22 * (1 + u / 0.5);
        else if (u > 0 && u < 1) k -= 0.26 * (1 - Math.abs(u - 0.5) / 0.5);
      }
      return k;
    };
    const rows = [{ seg: 0, f: 0 }, { seg: 1, f: 0 }];
    for (const f of fs) rows.push({ seg: 2, f });
    rows.push({ seg: 3, f: 0.5 }, { seg: 3, f: 1 });
    for (const row of rows) row.k = row.seg === 2 ? ribK(row.f) : 1;
    // 열 (왼쪽 → 오른쪽): x = m·(반폭 − b2) + o·b2. 가장자리는 흐림 폭 b2 안팎으로 알파 0 → 0.5 → 1 (판의 흐림과 같은 폭),
    // 안쪽은 5개. s: 반폭에 대한 비율 (법선·둥근 등 밝기용)
    const cols = [
      { m: -1, o: -2, a: 0, s: -1 },
      { m: -1, o: -1, a: 0.5, s: -1 },
      { m: -1, o: 0, a: 1, s: -1 },
    ];
    for (const s of [-0.6, -0.25, 0, 0.25, 0.6]) cols.push({ m: s, o: 0, a: 1, s });
    cols.push({ m: 1, o: 0, a: 1, s: 1 }, { m: 1, o: 1, a: 0.5, s: 1 }, { m: 1, o: 2, a: 0, s: 1 });
    this.wedgeRows = rows;
    this.wedgeCols = cols;
    const nr = rows.length;
    const nc = cols.length;
    const pos = new Float32Array(nr * nc * 3);
    const nor = new Float32Array(nr * nc * 3);
    const col = new Float32Array(nr * nc * 4);
    _col.set(V.colors.wedge);
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        const cc = cols[c];
        const s = cc.s;
        // 가운데 대부분은 윗면(위로 기운 법선), 양옆 끝에서만 어깨가 옆으로 돈다 (파이프처럼 둥글게 보이지 않게)
        _a.set(W.roll * s * Math.abs(s), W.ridge * (1 - 0.5 * s * s) + 0.05, 1).normalize();
        const i = r * nc + c;
        nor.set([_a.x, _a.y, _a.z], i * 3);
        const k = rows[r].k * (1 + 0.08 * (1 - s * s));
        col.set([_col.r * k, _col.g * k, _col.b * k, cc.a], i * 4);
      }
    }
    const idx = [];
    for (let r = 0; r + 1 < nr; r++) {
      for (let c = 0; c + 1 < nc; c++) {
        const a = r * nc + c;
        const b = a + nc;
        // 눈 쪽(+Z)을 향하게 감는다 (열은 +X, 행은 −Y 방향)
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.15,
      transparent: true,
      depthWrite: false,
    });
    this.wedge = new THREE.Mesh(g, m);
    this.wedge.frustumCulled = false;
    this.wedge.renderOrder = 1; // 가늠자 판 덮개(2)보다 먼저: 판의 흐린 아래 가장자리가 쐐기 위에 섞인다
    this.wedge.visible = false;
    this.scene.add(this.wedge); // 카메라 공간 (updateWedge 가 매 프레임 꼭짓점을 놓는다)
    this.wedgeB2 = b2;
    this.wedgeKey = new Float64Array(9).fill(NaN);
    this.wedgeCur = new Float64Array(9);
  }

  // 총 좌표의 점 → 카메라 공간 → 조준 시 총몸 내리기 (withAdsTuck 정점 셰이더와 같은 식)
  tuckPoint(v) {
    v.applyMatrix4(this.rifle.matrixWorld);
    const T = this.adsTuck.value;
    const a = T.x * smoothstep(T.y, T.z, v.z);
    if (a > 0) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const y = v.y * c + v.z * s;
      v.z = v.z * c - v.y * s;
      v.y = y;
    }
    return v;
  }

  // 쐐기 꼭짓점 (카메라 공간, 총몸 내리기 정도 t). 화면 좌표(tan = x/−z, y/−z)에서 판 아래 끝 → 덮개 윗마루 → 덮개 단면 가운데를
  // 잇는 띠를 만들고, 덮개 윗마루의 깊이 평면에 놓는다. 폭: 판 평면 치수(m)/눈→가늠자 거리 = tan 단위
  updateWedge(t) {
    const V = this.V;
    const W = V.rearWedge;
    const CV = this.cover;
    let vis = t > W.hipLimit;
    // 불투명도: 총몸 내리기와 함께 서서히 (총이 정렬된 뒤에만 t > 0 이다)
    this.wedge.material.opacity = smoothstep(0, W.fade, t);
    // 판 아래 끝·위 끝 (화면 위 방향), 덮개 윗마루·단면 가운데 (쐐기 거리)
    const lb = _a.copy(this.leafBottomL).applyMatrix4(this.leaf.matrixWorld);
    const lt = _b.copy(this.leafTopL).applyMatrix4(this.leaf.matrixWorld);
    // 판 평면 치수(m) → tan 단위: 실제 판 거리로 나눈다 (평소 = eyeToRearSight, 사격 반동으로 총이 눈 쪽으로 밀려도 판에 맞는다)
    const E = -lb.z > 0.05 ? -lb.z : V.eyeToRearSight;
    const zc = -W.dist;
    const yc = CV.y0 - (zc - CV.z0) * CV.k;
    const cm = this.tuckPoint(_c.set(0, yc, zc));
    const ce = this.tuckPoint(_d.set(0, yc - CV.half * 0.95, zc));
    const lbx = lb.x / -lb.z;
    const lby = lb.y / -lb.z;
    const mx = cm.x / -cm.z;
    const my = cm.y / -cm.z;
    const ex = ce.x / -ce.z;
    const ey = ce.y / -ce.z;
    const d = -cm.z;
    // 판의 화면 위 방향 u, 옆 방향 n (= u 를 시계 방향으로 90°)
    let ux = lt.x / -lt.z - lbx;
    let uy = lt.y / -lt.z - lby;
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const ph = this.leafPlateH;
    const nkx = lbx - ux * ((-ph - W.neck) / E);
    const nky = lby - uy * ((-ph - W.neck) / E);
    // 덮개가 판보다 아래에 있어야 한다 (조준 전환 초반 등 거꾸로면 숨김)
    if ((mx - nkx) * -ux + (my - nky) * -uy < 0.004) vis = false;
    this.wedge.visible = vis;
    if (!vis) return;
    // 지난 프레임과 같으면 꼭짓점을 다시 쓰지 않는다 (매 프레임 배열을 만들지 않게 미리 만든 버퍼에 비교·저장)
    const key = this.wedgeKey;
    const cur = this.wedgeCur;
    cur[0] = lbx;
    cur[1] = lby;
    cur[2] = mx;
    cur[3] = my;
    cur[4] = ex;
    cur[5] = ey;
    cur[6] = d;
    cur[7] = ux;
    cur[8] = E;
    let same = true;
    for (let i = 0; i < cur.length; i++) if (Math.abs(key[i] - cur[i]) > 1e-7 || Number.isNaN(key[i])) same = false;
    if (same) return;
    key.set(cur);
    const b2 = this.wedgeB2 / E;
    const mh = CV.half / -cm.z - b2;
    const eh = CV.half / -ce.z - b2;
    // 아래쪽 띠의 옆 방향: 판 → 덮개 축에 수직 (행마다 판의 옆 방향에서 서서히 바뀐다)
    let ax = mx - nkx;
    let ay = my - nky;
    const al = Math.hypot(ax, ay) || 1;
    ax /= al;
    ay /= al;
    const pos = this.wedge.geometry.attributes.position;
    const nc = this.wedgeCols.length;
    for (let r = 0; r < this.wedgeRows.length; r++) {
      const row = this.wedgeRows[r];
      let cx;
      let cy;
      let hw;
      let k = 0; // 옆 방향: 0 = 판의 옆, 1 = 판 → 덮개 축에 수직
      if (row.seg === 0) {
        cx = lbx + ux * ((W.top + ph) / E);
        cy = lby + uy * ((W.top + ph) / E);
        hw = W.topHalf / E;
      } else if (row.seg === 1) {
        cx = nkx;
        cy = nky;
        hw = W.neckHalf / E;
      } else if (row.seg === 2) {
        cx = nkx + (mx - nkx) * row.f;
        cy = nky + (my - nky) * row.f;
        hw = W.neckHalf / E + (Math.max(W.neckHalf / E, mh) - W.neckHalf / E) * row.f ** W.flare;
        k = row.f;
      } else {
        cx = mx + (ex - mx) * row.f;
        cy = my + (ey - my) * row.f;
        hw = Math.max(W.neckHalf / E, mh + (eh - mh) * row.f);
        k = 1;
      }
      // 옆 방향 (오른쪽): 판의 옆 (uy, −ux) 과 축의 옆 (−ay, ax) 사이
      let sx = uy + (-ay - uy) * k;
      let sy = -ux + (ax + ux) * k;
      const sl = Math.hypot(sx, sy) || 1;
      sx /= sl;
      sy /= sl;
      for (let c = 0; c < nc; c++) {
        const cc = this.wedgeCols[c];
        const x = cc.m * (hw - b2) + cc.o * b2;
        pos.setXYZ(r * nc + c, (cx + sx * x) * d, (cy + sy * x) * d, -d);
      }
    }
    pos.needsUpdate = true;
  }

  // 노리쇠 뭉치의 장전손잡이 (오른쪽) + 조정간
  buildBolt() {
    const C = this.V.colors;
    this.bolt = new THREE.Group();
    this.rifle.add(this.bolt);
    const ps = new PartSet();
    const zH = this.zN + 0.05; // 장전손잡이 위치 (덮개 앞쪽)
    this.chargeZ = zH;
    ps.add('metal', box(0.004, 0.009, 0.16), C.metal, 0.0155, -0.0535, zH + 0.07);
    ps.add('metal', box(0.016, 0.008, 0.012), C.metal, 0.023, -0.0535, zH);
    ps.add('metal', cylZ(0.0052, 0.012, 10).rotateY(Math.PI / 2).rotateZ(0.35), C.metal, 0.034, -0.051, zH);
    ps.build(this.bolt, this.mats);

    // 조정간: 뒤쪽 축을 중심으로 돈다 (위 = 안전, 가운데 = 연발, 아래 = 단발)
    this.selector = new THREE.Group();
    this.selector.position.set(0.0158, -0.058, -0.012);
    this.rifle.add(this.selector);
    const ss = new PartSet();
    ss.add('metal', box(0.0022, 0.012, 0.105), C.metal, 0, 0, -0.052);
    ss.add('metal', box(0.005, 0.016, 0.008), C.metal, 0.002, -0.004, -0.1);
    ss.add('metal', new THREE.CylinderGeometry(0.006, 0.006, 0.003, 10).rotateZ(Math.PI / 2), C.metalDark, 0, 0, 0);
    ss.build(this.selector, this.mats);
  }

  // 굽은 탄창: 단면을 곡선을 따라 휜 몸체 + 보강 리브 + 바닥판 + 앞·뒤 걸쇠
  buildMag() {
    const C = this.V.colors;
    this.mag = new THREE.Group();
    this.rifle.add(this.mag);
    this.magHome = new THREE.Vector3(0, -0.092, this.zN + 0.052); // 탄창 위 가운데
    this.magFrontLug = new THREE.Vector3(0, -0.092, this.magHome.z - 0.031);
    this.mag.position.copy(this.magHome);
    const ps = new PartSet();
    const len = 0.2;
    const spine = arcSpine(0, 0, 0.08, 0.78, len);
    const depth = (t) => 0.06 + t * 0.012;
    ps.add('mag', sweptBox(12, spine, () => 0.027, depth), 0xffffff);
    // 옆 보강 리브 (위쪽 띠 두 줄 + 앞뒤 모서리 띠)
    const ribAt = (t0, t1) => {
      const sp2 = (t) => spine(t0 + (t1 - t0) * t);
      return sweptBox(3, sp2, () => 0.0295, (t) => depth(t0 + (t1 - t0) * t) - 0.012);
    };
    ps.add('mag', ribAt(0.07, 0.11), 0xd8d8d8);
    ps.add('mag', ribAt(0.2, 0.235), 0xd8d8d8);
    const edge = (sf) => sweptBox(10, (t) => {
      const [y, z, a] = spine(0.05 + t * 0.9);
      const d = depth(0.05 + t * 0.9) / 2 - 0.004;
      return [y + Math.sin(a) * d * sf, z - Math.cos(a) * d * sf, a];
    }, () => 0.0285, () => 0.006);
    ps.add('mag', edge(1), 0xe4e4e4);
    ps.add('mag', edge(-1), 0xe4e4e4);
    // 바닥판
    const [by, bz, ba] = spine(1);
    ps.add('mag', box(0.031, 0.006, depth(1) + 0.008), 0xc8c8c8, 0, by - Math.cos(ba) * 0.002, bz - Math.sin(ba) * 0.002, ba, 0, 0);
    // 앞 걸쇠·뒤 걸쇠 (금속)
    ps.add('metal', box(0.012, 0.008, 0.006), C.metal, 0, -0.004, -0.033);
    ps.add('metal', box(0.012, 0.007, 0.005), C.metal, 0, -0.012, 0.031);
    // 송탄 립 (위, 금속)
    ps.add('metal', box(0.02, 0.004, 0.05), C.metalDark, 0, 0.002, 0);
    ps.build(this.mag, this.mats);
  }

  resetMag() {
    this.mag.visible = true;
    this.mag.position.copy(this.magHome);
    this.mag.quaternion.identity();
  }

  // ------------------------------------------------------------------ 손
  buildHands() {
    const C = this.V.colors;
    const G = C.glove;
    const GD = C.gloveDark;
    const yB = this.yB;

    // ---- 왼손: 하부 총열 덮개를 아래에서 감싸 쥔다 (손가락은 오른쪽 옆면으로, 엄지는 왼쪽 옆면)
    this.leftHand = new THREE.Group();
    this.rifle.add(this.leftHand);
    const zc = -0.4;
    this.leftPivot = new THREE.Vector3(0, yB - 0.01, zc);
    const lp = new PartSet();
    // 손바닥 (왼쪽 아래에서 비스듬히 받친다)
    lp.add('glove', box(0.058, 0.022, 0.082), G, -0.02, yB - 0.046, zc + 0.002, 0, 0, -0.45);
    lp.add('glove', box(0.05, 0.02, 0.05), GD, -0.034, yB - 0.058, zc + 0.04, 0.35, 0, -0.5); // 손바닥 아래·손목 쪽
    // 손가락 4개 (검지가 가장 앞)
    const fz = [-0.036, -0.014, 0.008, 0.028];
    const fr = [0.0092, 0.0095, 0.009, 0.0078];
    for (let i = 0; i < 4; i++) {
      const z = zc + fz[i];
      const sh = i === 3 ? 0.8 : 1;
      lp.chain('glove', [
        [0.0, yB - 0.046, z + 0.004],
        [0.022, yB - 0.042, z],
        [0.033, yB - 0.042 + 0.028 * sh, z - 0.002],
        [0.028, yB - 0.042 + 0.044 * sh, z - 0.003],
      ], fr[i], G, 0.93);
      // 손가락 마디 보호대
      lp.add('glove', box(0.006, 0.012, 0.014), GD, 0.041, yB - 0.03, z);
    }
    // 엄지: 왼쪽 옆면을 따라 앞으로
    lp.chain('glove', [
      [-0.03, yB - 0.046, zc + 0.03],
      [-0.035, yB - 0.022, zc + 0.0],
      [-0.031, yB - 0.006, zc - 0.03],
    ], 0.0105, G, 0.9);
    // 손목 커프 (손목 → 팔꿈치 방향으로)
    this.leftWrist = new THREE.Vector3(-0.045, yB - 0.075, zc + 0.065);
    lp.seg('glove', [-0.036, yB - 0.064, zc + 0.05], [-0.05, yB - 0.085, zc + 0.08], 0.03, C.cuff, false, 12);
    lp.build(this.leftHand, this.mats);

    // ---- 오른손: 권총 손잡이 (검지는 방아쇠, 엄지는 왼쪽으로 감아 쥔다)
    this.rightHand = new THREE.Group();
    this.rifle.add(this.rightHand);
    const rp = new PartSet();
    const sp = this.gripSpine;
    // 손잡이 좌표계: 위 중심에서 손잡이 축을 따라 v, 앞쪽(F)으로 w, 오른쪽 u
    const gp = (u, v, w) => {
      const [y, z, a] = sp(clamp(v / 0.108, 0, 1));
      return [u, y + Math.sin(a) * w, z - Math.cos(a) * w];
    };
    const [, , ga] = sp(0.4);
    // 손바닥·손등 (오른쪽 옆면과 뒤쪽)
    const pc = gp(0.022, 0.05, -0.004);
    rp.add('glove', box(0.022, 0.09, 0.052), G, pc[0], pc[1], pc[2], ga, 0, 0);
    const wc = gp(0.006, 0.012, -0.03);
    rp.add('glove', box(0.042, 0.034, 0.03), GD, wc[0], wc[1], wc[2], ga, 0, 0);
    // 가운데·약지·새끼 손가락이 앞쪽을 감싼다
    for (let i = 0; i < 3; i++) {
      const v = 0.032 + i * 0.022;
      const r = i === 2 ? 0.0085 : 0.0095;
      rp.chain('glove', [gp(0.024, v, 0.014), gp(0.016, v, 0.032), gp(-0.006, v, 0.03), gp(-0.019, v, 0.014)], r, G, 0.93);
    }
    // 검지: 방아쇠울 안으로
    rp.chain('glove', [gp(0.022, 0.006, 0.02), [0.012, -0.108, -0.104], [0.004, -0.116, -0.121]], 0.0092, G, 0.92);
    // 엄지: 손잡이 위 뒤쪽을 감아 왼쪽으로
    rp.chain('glove', [gp(0.018, 0.004, -0.024), [0.0, -0.104, -0.03], [-0.02, -0.106, -0.05]], 0.0105, G, 0.9);
    // 손목 커프
    const w0 = gp(0.026, 0.07, -0.04);
    this.rightWrist = new THREE.Vector3(...gp(0.03, 0.095, -0.06));
    rp.seg('glove', w0, [this.rightWrist.x, this.rightWrist.y, this.rightWrist.z], 0.031, C.cuff, false, 12);
    rp.build(this.rightHand, this.mats);
  }

  // 위장복 소매 (위팔·아래팔) — 매 프레임 IK 로 배치
  buildArms() {
    const mk = (rb, rt) => {
      const m = new THREE.Mesh(sleeveGeometry(rb, rt), this.sleeveMat);
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    };
    this.arms = {
      right: { upper: mk(0.052, 0.046), fore: mk(0.046, 0.034), S: new THREE.Vector3(), pole: new THREE.Vector3(0.75, -1, 0.15).normalize() },
      left: { upper: mk(0.05, 0.045), fore: mk(0.045, 0.033), S: new THREE.Vector3(), pole: new THREE.Vector3(-0.8, -1, 0.1).normalize() },
    };
    // 아군 식별 테이프 (왼팔 위팔)
    this.tape = new THREE.Mesh(new THREE.CylinderGeometry(0.0525, 0.0525, 0.045, 12, 1, true), this.tapeMat);
    this.tape.frustumCulled = false;
    this.scene.add(this.tape);
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ 조명
  // 장면의 빛을 찾아 둔다 (대기 모듈이 조명을 바꿔도 따라가도록 가끔 다시 찾는다)
  scanLights() {
    const L = { hemi: null, sun: null, amb: [] };
    this.game.scene.traverse((o) => {
      if (!o.isLight) return;
      if (o.isHemisphereLight && !L.hemi) L.hemi = o;
      else if (o.isDirectionalLight && (!L.sun || o.intensity > L.sun.intensity)) L.sun = o;
      else if (o.isAmbientLight) L.amb.push(o);
    });
    this.srcLights = L;
  }

  syncLights(dt) {
    this.lightScanTimer -= dt;
    if (!this.srcLights || this.lightScanTimer <= 0) {
      this.scanLights();
      this.lightScanTimer = 2;
    }
    const L = this.srcLights;
    const V = this.V;
    // 월드 → 카메라 회전
    _qi.copy(this.game.camera.quaternion).invert();
    if (L.hemi) {
      this.hemi.visible = L.hemi.visible;
      this.hemi.color.copy(L.hemi.color);
      this.hemi.groundColor.copy(L.hemi.groundColor);
      this.hemi.intensity = L.hemi.intensity * V.lightHemiMul;
      _a.setFromMatrixPosition(L.hemi.matrixWorld);
      if (_a.lengthSq() < 1e-8) _a.set(0, 1, 0);
      this.hemi.position.copy(_a.normalize().applyQuaternion(_qi));
    } else this.hemi.visible = false;
    if (L.sun) {
      this.sun.visible = L.sun.visible;
      this.sun.color.copy(L.sun.color);
      this.sun.intensity = L.sun.intensity * V.lightSunMul;
      _a.setFromMatrixPosition(L.sun.matrixWorld);
      _b.setFromMatrixPosition(L.sun.target.matrixWorld);
      _a.sub(_b);
      if (_a.lengthSq() < 1e-8) _a.set(0, 1, 0);
      this.sun.position.copy(_a.normalize().applyQuaternion(_qi));
    } else this.sun.visible = false;
    let ai = 0;
    _col.setRGB(0, 0, 0);
    for (const a of L.amb) {
      if (!a.visible) continue;
      _col.r += a.color.r * a.intensity;
      _col.g += a.color.g * a.intensity;
      _col.b += a.color.b * a.intensity;
      ai = 1;
    }
    this.amb.intensity = ai;
    this.amb.color.copy(_col);
  }

  // ------------------------------------------------------------------ 갱신
  update(dt) {
    const pl = this.game.player;
    const w = pl.weapon;
    const V = this.V;
    const now = this.game.time;
    const dmg = pl.body.damage;
    const b = this.blend;
    const down = dmg.incapacitated || dmg.isKnockedDown(now) ? 1 : 0;
    const BR = V.blendRates;
    b.down = damp(b.down, down, BR.down, dt || 1);
    b.ads = pl.ads;
    b.sprint = damp(b.sprint, pl.sprinting ? 1 : 0, BR.sprint, dt || 1);
    b.reload = damp(b.reload, w.reloading ? 1 : 0, BR.reload, dt || 1);
    // 2단계: 탄약 상자에서 탄창을 채우는 동안 총을 몸 앞에 낮춰 든다 (ammoCrate.viewPose)
    b.refill = damp(b.refill || 0, pl.refill && pl.refill.active ? 1 : 0, BR.sprint, dt || 1);

    // 자세 섞기 (조준 자세는 원점: 가늠쇠 끝 = 화면 중앙)
    const P = V.poses;
    const o = this.pose;
    for (let i = 0; i < 3; i++) {
      o[i] = P.hip.p[i];
      o[i + 3] = P.hip.r[i];
      o[i + 6] = P.hip.ls ? P.hip.ls[i] : 0;
    }
    // t: 위치·왼쪽 어깨 비율, tr: 회전 비율 (없으면 t)
    const blendIn = (pose, t, tr = t) => {
      for (let i = 0; i < 3; i++) {
        o[i] += ((pose ? pose.p[i] : 0) - o[i]) * t;
        o[i + 3] += ((pose ? pose.r[i] : 0) - o[i + 3]) * tr;
        o[i + 6] += ((pose && pose.ls ? pose.ls[i] : 0) - o[i + 6]) * t;
      }
    };
    blendIn(P.sprint, b.sprint);
    blendIn(CONFIG.ammoCrate.viewPose, b.refill);
    blendIn(P.reload, b.reload);
    b.bolt = w.reloading ? this.boltPose : damp(b.bolt, 0, BR.reload, dt || 1);
    blendIn(P.bolt, b.bolt * b.reload);
    // 조준: 달리기·재장전 자세 뒤에 섞어, 조준 정도가 adsAlign 에 이르면 (남은 자세와 상관없이) 정확히 원점에 정렬된다.
    // 회전이 위치보다 먼저 맞는다 → 총몸 내리기·쐐기(adsTuck.blendFrom 이후)는 항상 정렬된 총 위에서만 나타난다
    const AL = V.adsAlign;
    blendIn(null, smoothstep(0, AL.pos, b.ads), smoothstep(0, AL.rot, b.ads));
    blendIn(P.down, b.down);
    // 반동 (스프링)
    this.kickVel += (-this.kick * 180 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    this.kickRot *= Math.exp(-dt * 14);
    // 걷기 흔들림 (조준 중에는 흔들리지 않는다: 가늠쇠 끝이 탄착점에서 벗어나지 않게)
    const hipW = 1 - b.ads;
    const bob = pl.speedClass !== 'still' ? hipW * (1 + b.sprint * (V.bob.sprintMul - 1)) : 0;
    const bp = pl.bobPhase;
    const bx = Math.cos(bp) * V.bob.x * bob;
    const by = Math.abs(Math.sin(bp)) * V.bob.y * bob;
    // 조준 시 총몸 내리기 (총이 정렬된 뒤 전환 끝무렵부터 서서히) + 가늠자 판 아래 쐐기 늘이기.
    // 재장전·쓰러짐 자세가 섞이는 동안은 하지 않는다
    const T = V.adsTuck;
    const tuck = smoothstep(T.blendFrom, T.blendTo, b.ads) * (1 - b.reload) * (1 - b.down);
    this.adsTuck.value.x = T.angle * tuck;
    this.root.position.set(o[0] + bx, o[1] - by, o[2] + this.kick);
    this.root.rotation.set(o[3] + this.kickRot + pl.swayPitch * hipW, o[4] + pl.swayYaw * hipW, o[5]);

    // 영점: 총은 가늠쇠 끝을 축으로 앙각만큼 들리고, 가늠자 판은 U홈이 조준선에 남도록 올라간다
    this.updateZero(w);

    // 노리쇠 (사격 시 잠깐 뒤로, 빈 재장전 시 당김)
    this.boltOffset = Math.max(0, this.boltOffset - dt * 1.2);
    let boltPull = this.boltOffset;
    const r = w.reload;
    if (r) boltPull = Math.max(boltPull, this.animateReload(r));
    else {
      // 재장전이 아니면 탄창은 제자리, 왼손은 총열 덮개
      this.leftHand.position.set(0, 0, 0);
      this.leftHand.quaternion.identity();
      this.mag.visible = w.magIndex >= 0;
      this.mag.position.copy(this.magHome);
      this.mag.quaternion.identity();
    }
    this.bolt.position.z = boltPull;
    // 조정간: 단발(아래) / 연발(가운데)
    this.selector.rotation.x = w.fireMode === 'semi' ? -0.32 : -0.16;

    // 총구 화염
    this.flashTime -= dt;
    const fl = this.flashTime > 0;
    this.flash.visible = fl;
    this.flash2.visible = fl;
    this.flashLight.intensity = fl ? V.flashLight : 0;

    this.root.updateMatrixWorld(true);
    this.updateWedge(tuck);
    this.flashLight.position.set(0, this.yB, this.muzzleZ - 0.05).applyMatrix4(this.rifle.matrixWorld);
    this.updateArms();
    this.syncLights(dt);

    // 카메라 시야각 동기화 (조준 시 장면과 같은 실제 시야각)
    const cam = this.game.camera;
    if (this.camera.fov !== cam.fov) {
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateZero(w) {
    const ranges = w.def.sightRanges;
    const si = Math.max(0, ranges.indexOf(w.sightRange));
    const key = w.sightRange;
    if (key === this.elevKey) return;
    this.elevKey = key;
    const a = elevationFor(w.ammo, w.sightRange, w.ammo.sightHeight);
    const zF = this.zF;
    // 가늠쇠 끝(0,0,zF)을 축으로 a 만큼 총구를 든다
    this.rifle.rotation.set(a, 0, 0);
    this.rifle.position.set(0, zF * Math.sin(a), zF * (1 - Math.cos(a)));
    // U홈이 조준선(y=0)에 오도록 판 각도를 찾는다 (두 번 보정)
    const H = this.leafHinge;
    let beta = 0;
    for (let it = 0; it < 3; it++) {
      // 판 회전 후 U홈 위치 (총 좌표)
      const dz = this.zN - H.z;
      const dy = 0 - H.y;
      const ny = H.y + dy * Math.cos(beta) - dz * Math.sin(beta);
      const nz = H.z + dy * Math.sin(beta) + dz * Math.cos(beta);
      // 총을 든 뒤의 높이
      const wy = (ny - 0) * Math.cos(a) - (nz - zF) * Math.sin(a);
      // wy 를 0 으로: 판 끝을 올리는 각 (음수 회전이 뒤 끝을 올린다)
      beta -= Math.asin(clamp(-wy / Math.cos(a) / this.leafLen, -0.5, 0.5));
    }
    this.leaf.rotation.set(beta, 0, 0);
    // 슬라이더: 거리가 멀수록 앞으로
    this.sightSlider.position.set(0, -0.00625 - this.leafHinge.y, this.leafLen - 0.014 - (si / Math.max(1, ranges.length - 1)) * 0.028);
  }

  // 재장전: 왼손이 탄창을 잡아 앞으로 젖혀 빼고(파우치) 새 탄창을 끼운 뒤, 빈 재장전이면 장전손잡이를 당긴다.
  // Weapon.startReload 의 단계 비율(magOut / pouch / magIn / boltBack / boltForward)에 맞춘다. 반환: 노리쇠 당김 거리
  animateReload(r) {
    const p = r.t / r.duration;
    this.boltPose = 0;
    const st = r.steps;
    const tOut = st[0].at;
    const tPouch = st[1].at;
    const tIn = st[2].at;
    const empty = r.empty && st[3] && st[4];
    // ---- 탄창 자세 (총 좌표)
    const rockMax = 0.42;
    let rock = 0;
    let drop = 0;
    let pouchK = 0;
    if (p < tOut) {
      rock = 0;
    } else if (p < tPouch) {
      const k = (p - tOut) / (tPouch - tOut);
      rock = rockMax * easeInOut(k / 0.3);
      drop = 0.05 * easeInOut((k - 0.2) / 0.3);
      pouchK = easeInOut((k - 0.45) / 0.55);
    } else if (p < tIn) {
      const k = (p - tPouch) / (tIn - tPouch);
      pouchK = 1 - easeInOut(k / 0.55);
      drop = 0.05 * (1 - easeInOut((k - 0.45) / 0.3));
      rock = rockMax * (1 - easeInOut((k - 0.72) / 0.28));
    }
    // 앞 걸쇠를 축으로 젖히고 아래로 뺀다
    const lug = this.magFrontLug;
    _q.setFromAxisAngle(_a.set(1, 0, 0), rock);
    _p.subVectors(this.magHome, lug).applyQuaternion(_q).add(lug);
    _p.y -= drop;
    // 파우치 쪽(화면 밖 왼쪽 아래)으로
    _b.set(-0.16, -0.36, 0.12);
    _p.lerp(_b, pouchK);
    _q2.setFromEuler(_e.set(0.9, 0.4, 0.9));
    _q.slerp(_q2, pouchK);
    this.mag.position.copy(_p);
    this.mag.quaternion.copy(_q);
    this.mag.visible = true;

    // ---- 왼손
    const pivot = this.leftPivot;
    // 탄창을 쥔 자세: 손 기준점이 탄창 앞면 가운데쯤, 손바닥이 탄창 앞을 감싼다
    const magGrip = (out, outQ, magPos, magQ) => {
      _c.set(0, -0.07, -0.006).applyQuaternion(magQ).add(magPos);
      out.copy(_c);
      outQ.copy(magQ).multiply(_q2.setFromEuler(_e.set(Math.PI / 2, 0, 0.25)));
    };
    const homeQ = _qi.identity();
    let pull = 0;
    const handX = _w;
    const handQ = _hq;
    magGrip(handX, handQ, this.mag.position, this.mag.quaternion);
    const reachEnd = tOut * 0.9;
    const releaseAt = tIn + 0.02;
    if (p < reachEnd) {
      // 덮개 → 탄창으로 손을 뻗는다
      const k = easeInOut(p / reachEnd);
      _el.copy(pivot).lerp(handX, k);
      handX.copy(_el);
      handQ.copy(homeQ.slerp(handQ, k));
    } else if (p >= releaseAt) {
      // 탄창을 끼운 뒤: 덮개로 돌아오거나(빈 재장전이면) 장전손잡이로
      const hX = _el.copy(handX);
      const hQ = _hq2.copy(handQ);
      if (empty) {
        const tB = st[3].at;
        const tF = st[4].at;
        // 장전손잡이 쥔 자세 (총 아래로 돌아 오른쪽에서 잡는다)
        // 장전손잡이 쥔 자세: 손바닥은 기관부 아래, 손가락이 오른쪽 옆면의 손잡이를 감싼다
        const cX = _d.set(0.012, -0.058, this.chargeZ);
        const cQ = _q2.identity();
        if (p < tB) {
          const k = easeInOut((p - releaseAt) / (tB - releaseAt));
          handX.copy(hX).lerp(cX, k);
          handQ.copy(hQ.slerp(cQ, k));
          this.boltPose = k;
        } else if (p < tF + 0.03) {
          pull = 0.085 * easeInOut((p - tB) / 0.06);
          handX.copy(cX);
          handX.z += pull;
          handQ.copy(cQ);
          this.boltPose = 1;
        } else {
          const k = easeInOut((p - tF - 0.03) / 0.14);
          handX.copy(cX).lerp(pivot, k);
          handQ.copy(cQ).slerp(homeQ.identity(), k);
          this.boltPose = 1 - k;
        }
      } else {
        const k = easeInOut((p - releaseAt) / 0.2);
        handX.copy(hX).lerp(pivot, k);
        handQ.copy(hQ.slerp(homeQ, k));
      }
    }
    setHandPose(this.leftHand, pivot, handX, handQ);
    return pull;
  }

  // 어깨(카메라 기준) → 손목(손 그룹 기준) 2관절 IK 로 소매 배치
  updateArms() {
    const V = this.V;
    const sides = [
      ['right', this.rightHand, this.rightWrist],
      ['left', this.leftHand, this.leftWrist],
    ];
    for (const [side, hand, wristLocal] of sides) {
      const arm = this.arms[side];
      arm.S.fromArray(V.shoulders[side]);
      // 자세별 왼쪽 어깨 이동 (엉덩이 자세: 몸을 비틀어 왼쪽 어깨가 앞으로 나와 총열 덮개에 손이 닿는다)
      if (side === 'left') arm.S.add(_p.set(this.pose[6], this.pose[7], this.pose[8]));
      _w.copy(wristLocal).applyMatrix4(hand.matrixWorld);
      solveElbow(arm.S, _w, V.upperArm, V.foreArm, arm.pole, _el);
      placeLimb(arm.upper, arm.S, _el);
      placeLimb(arm.fore, _el, _w);
      if (side === 'left') {
        // 테이프: 위팔 가운데 (엉덩이 자세에서 팔꿈치가 화면 아래 끝에 걸려도 밝은 테이프가 화면에 들어오지 않게)
        this.tape.position.copy(arm.S).lerp(_el, 0.55);
        this.tape.quaternion.copy(arm.upper.quaternion);
      }
    }
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

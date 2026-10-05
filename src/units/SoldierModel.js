// =============================================================================
// SoldierModel — 기본 도형을 이어 붙인 저폴리 인체 (스킨드 메시 1개 = 드로우콜 1개)
// 자세(poses.js)를 보간하고, 팔은 2관절 IK 로 총을 잡는다.
// 부위별 피격 볼륨(머리·몸통·방탄판·팔·다리)을 뼈 좌표계에서 판정한다.
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { camoAtlas } from '../world/textures.js';
import { POSES } from './poses.js';
import { CONFIG } from '../config.js';
import { segBoxLocal, segSphere } from '../core/mathUtils.js';

const BONES = [
  ['hips', -1, [0, 0.95, 0]],
  ['spine', 0, [0, 0.1, 0]],
  ['chest', 1, [0, 0.22, 0]],
  ['neck', 2, [0, 0.24, 0]],
  ['head', 3, [0, 0.08, 0]],
  ['upperArmL', 2, [0.2, 0.18, 0]],
  ['foreArmL', 5, [0, -0.29, 0]],
  ['upperArmR', 2, [-0.2, 0.18, 0]],
  ['foreArmR', 7, [0, -0.29, 0]],
  ['thighL', 0, [0.1, -0.06, 0]],
  ['shinL', 9, [0, -0.44, 0]],
  ['thighR', 0, [-0.1, -0.06, 0]],
  ['shinR', 11, [0, -0.44, 0]],
  ['rifle', 2, [0, 0, 0.25]],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const UPPER = 0.29;
const FORE = 0.31;
const GRIP_R = new THREE.Vector3(0, -0.075, -0.05);
const GRIP_L = new THREE.Vector3(0, -0.03, 0.27);
const MUZZLE = new THREE.Vector3(0, 0.025, 0.62);
const EYE = new THREE.Vector3(0, 0.085, 0.085);
const HEAD_C = new THREE.Vector3(0, 0.085, 0.01);
const CHEST_C = new THREE.Vector3(0, 0.12, 0);
const SHOULDER_L = new THREE.Vector3(0.2, 0.18, 0);
const SHOULDER_R = new THREE.Vector3(-0.2, 0.18, 0);
const POLE_L = new THREE.Vector3(0.45, -1.0, -0.15).normalize();
const POLE_R = new THREE.Vector3(-1.0, -0.55, -0.25).normalize();

// 부위별 피격 볼륨 (뼈 로컬). zone: head | torso | arm | leg
const HIT_PARTS = [
  { bone: 'head', type: 'sphere', c: [0, 0.085, 0.01], r: 0.125, zone: 'head' },
  { bone: 'neck', type: 'box', c: [0, 0.04, 0], h: [0.06, 0.06, 0.06], zone: 'head' },
  { bone: 'chest', type: 'box', c: [0, 0.12, 0.005], h: [0.19, 0.165, 0.145], zone: 'torso', plate: true },
  { bone: 'spine', type: 'box', c: [0, 0.1, 0], h: [0.16, 0.115, 0.11], zone: 'torso' },
  { bone: 'hips', type: 'box', c: [0, -0.02, 0], h: [0.17, 0.11, 0.12], zone: 'torso' },
  { bone: 'upperArmL', type: 'box', c: [0, -0.14, 0], h: [0.058, 0.155, 0.06], zone: 'arm' },
  { bone: 'upperArmR', type: 'box', c: [0, -0.14, 0], h: [0.058, 0.155, 0.06], zone: 'arm' },
  { bone: 'foreArmL', type: 'box', c: [0, -0.16, 0], h: [0.05, 0.17, 0.05], zone: 'arm' },
  { bone: 'foreArmR', type: 'box', c: [0, -0.16, 0], h: [0.05, 0.17, 0.05], zone: 'arm' },
  { bone: 'thighL', type: 'box', c: [0, -0.22, 0], h: [0.08, 0.225, 0.085], zone: 'leg' },
  { bone: 'thighR', type: 'box', c: [0, -0.22, 0], h: [0.08, 0.225, 0.085], zone: 'leg' },
  { bone: 'shinL', type: 'box', c: [0, -0.22, 0.02], h: [0.065, 0.23, 0.08], zone: 'leg' },
  { bone: 'shinR', type: 'box', c: [0, -0.22, 0.02], h: [0.065, 0.23, 0.08], zone: 'leg' },
];

// ----------------------------------------------------------------------------- 기하 생성
const geoCache = new Map();

function buildGeometry(tapeColor, colors) {
  const restWorld = [];
  for (let i = 0; i < BONES.length; i++) {
    const [, parent, p] = BONES[i];
    const base = parent >= 0 ? restWorld[parent] : [0, 0, 0];
    restWorld.push([base[0] + p[0], base[1] + p[1], base[2] + p[2]]);
  }
  const parts = [];
  const col = new THREE.Color();
  let camoSeed = 0;
  const add = (boneName, g, color, camo, rot) => {
    const bi = BI[boneName];
    if (rot) {
      g.rotateX(rot[0]);
      g.rotateY(rot[1]);
      g.rotateZ(rot[2]);
    }
    const w = restWorld[bi];
    g.translate(w[0], w[1], w[2]);
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count;
    const uv = g.attributes.uv;
    if (camo) {
      // 위장 무늬 영역(0..0.75) 안의 임의 부분을 쓴다
      const ou = (camoSeed * 0.137) % 0.5;
      const ov = (camoSeed * 0.291) % 0.6;
      camoSeed++;
      for (let i = 0; i < n; i++) uv.setXY(i, ou + uv.getX(i) * 0.25, ov + uv.getY(i) * 0.4);
    } else {
      for (let i = 0; i < n; i++) uv.setXY(i, 0.88, 0.5);
    }
    col.set(color);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    parts.push(g);
  };
  const box = (sx, sy, sz, cx, cy, cz) => new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
  const C = colors;
  const camoTint = 0xffffff;
  // 골반·몸통
  add('hips', box(0.34, 0.2, 0.22, 0, -0.02, 0), camoTint, true);
  add('hips', box(0.36, 0.05, 0.24, 0, 0.07, 0), C.gear, false);
  add('spine', box(0.31, 0.22, 0.2, 0, 0.1, 0), camoTint, true);
  add('chest', box(0.37, 0.3, 0.22, 0, 0.12, 0), camoTint, true);
  // 방탄조끼 + 탄입대
  add('chest', box(0.385, 0.33, 0.29, 0, 0.11, 0.01), C.vest, false);
  for (const x of [-0.1, 0, 0.1]) add('chest', box(0.085, 0.12, 0.05, x, 0.04, 0.17), C.gear, false);
  add('chest', box(0.3, 0.08, 0.05, 0, 0.24, -0.16), C.gear, false);
  for (const x of [-0.175, 0.175]) add('chest', box(0.12, 0.09, 0.19, x, 0.25, 0), camoTint, true);
  // 목·머리·헬멧·헤드셋
  add('neck', box(0.1, 0.1, 0.1, 0, 0.04, 0), C.skin, false);
  add('neck', box(0.15, 0.06, 0.14, 0, 0.0, 0), camoTint, true);
  add('head', new THREE.IcosahedronGeometry(0.1, 1).translate(0, 0.08, 0.012), C.skin, false);
  const helmet = new THREE.SphereGeometry(0.142, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  helmet.scale(1.0, 0.92, 1.1).translate(0, 0.1, -0.008);
  add('head', helmet, C.helmet, false);
  add('head', new THREE.CylinderGeometry(0.148, 0.15, 0.03, 10, 1, true).scale(1, 1, 1.1).translate(0, 0.1, -0.008), C.helmet, false);
  for (const x of [-0.12, 0.12]) add('head', box(0.05, 0.09, 0.08, x, 0.07, 0), C.gear, false);
  // 팔 + 식별 테이프
  for (const s of ['L', 'R']) {
    add('upperArm' + s, box(0.1, 0.3, 0.11, 0, -0.14, 0), camoTint, true);
    add('upperArm' + s, box(0.116, 0.065, 0.126, 0, -0.08, 0), tapeColor, false);
    add('foreArm' + s, box(0.088, 0.27, 0.092, 0, -0.135, 0), camoTint, true);
    add('foreArm' + s, box(0.08, 0.1, 0.06, 0, -0.31, 0.01), C.gear, false);
  }
  // 다리 + 식별 테이프 + 무릎 보호대 + 군화
  for (const s of ['L', 'R']) {
    add('thigh' + s, box(0.155, 0.44, 0.165, 0, -0.22, 0), camoTint, true);
    add('thigh' + s, box(0.168, 0.07, 0.178, 0, -0.11, 0), tapeColor, false);
    add('shin' + s, box(0.125, 0.4, 0.135, 0, -0.2, 0), camoTint, true);
    add('shin' + s, box(0.115, 0.1, 0.045, 0, -0.02, 0.075), C.gear, false);
    add('shin' + s, box(0.12, 0.11, 0.28, 0, -0.41, 0.045), C.boots, false);
  }
  // 소총 (로컬 +Z 가 총구)
  add('rifle', box(0.05, 0.085, 0.34, 0, 0, 0.06), 0x252422, false);
  add('rifle', box(0.056, 0.062, 0.21, 0, 0.004, 0.31), 0x3a2a22, false);
  add('rifle', new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6).rotateX(Math.PI / 2).translate(0, 0.022, 0.52), 0x1c1c1c, false);
  add('rifle', box(0.035, 0.18, 0.07, 0, -0.1, 0.13), 0x2a2622, false, [0.35, 0, 0]);
  add('rifle', box(0.045, 0.085, 0.3, 0, -0.03, -0.25), 0x2b2724, false);
  add('rifle', box(0.034, 0.1, 0.04, 0, -0.08, -0.05), 0x222020, false, [-0.3, 0, 0]);
  const geo = mergeGeometries(parts, false);
  geo.computeBoundingSphere();
  return geo;
}

function getGeometry(tapeColor, colors) {
  const key = tapeColor + '_' + JSON.stringify(colors);
  if (!geoCache.has(key)) geoCache.set(key, buildGeometry(tapeColor, colors));
  return geoCache.get(key);
}

// ----------------------------------------------------------------------------- 자세 채널
const CH = {
  HIP_Y: 0,
  HIP_Z: 1,
  HIPS: 2,
  SPINE: 5,
  CHEST: 8,
  THIGH_L: 11,
  SHIN_L: 14,
  THIGH_R: 15,
  SHIN_R: 18,
  HEAD: 19,
  RIFLE_P: 21,
  RIFLE_R: 24,
  ARM_L: 27,
  FORE_L: 30,
  ARM_R: 31,
  FORE_R: 34,
};
const NCH = 35;

function poseToChannels(p, out) {
  const v3 = (i, a) => {
    out[i] = a ? a[0] : 0;
    out[i + 1] = a ? a[1] : 0;
    out[i + 2] = a ? a[2] : 0;
  };
  out[CH.HIP_Y] = p.hipY;
  out[CH.HIP_Z] = p.hipZ || 0;
  v3(CH.HIPS, p.hips);
  v3(CH.SPINE, p.spine);
  v3(CH.CHEST, p.chest);
  v3(CH.THIGH_L, p.thighL);
  out[CH.SHIN_L] = p.shinL || 0;
  v3(CH.THIGH_R, p.thighR);
  out[CH.SHIN_R] = p.shinR || 0;
  out[CH.HEAD] = p.head ? p.head[0] : 0;
  out[CH.HEAD + 1] = p.head ? p.head[1] : 0;
  v3(CH.RIFLE_P, p.rifle.pos);
  v3(CH.RIFLE_R, p.rifle.rot);
  v3(CH.ARM_L, p.armL);
  out[CH.FORE_L] = p.foreL || 0;
  v3(CH.ARM_R, p.armR);
  out[CH.FORE_R] = p.foreR || 0;
  return out;
}
const POSE_CH = {};
for (const [k, p] of Object.entries(POSES)) POSE_CH[k] = poseToChannels(p, new Float32Array(NCH));

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _box = {};

export class SoldierModel {
  constructor({ tapeColor, colors }) {
    this.root = new THREE.Object3D();
    this.root.rotation.order = 'YXZ';
    const geo = getGeometry(tapeColor, colors);
    this.material = new THREE.MeshLambertMaterial({ map: camoAtlas(), vertexColors: true });
    this.bones = BONES.map(([name]) => {
      const b = new THREE.Bone();
      b.name = name;
      return b;
    });
    BONES.forEach(([, parent, p], i) => {
      this.bones[i].position.set(p[0], p[1], p[2]);
      if (parent >= 0) this.bones[parent].add(this.bones[i]);
    });
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.add(this.bones[0]);
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.b = Object.fromEntries(BONES.map(([name], i) => [name, this.bones[i]]));
    this.cur = new Float32Array(NCH);
    this.tgt = new Float32Array(NCH);
    this.pose = 'stand';
    poseToChannels(POSES.stand, this.cur);
    this.phase = 0;
    this.aimPitch = 0;
    this.lean = 0;
    this.blendRate = 9;
    this.moveSpeed = 0;
    this.slopePitch = 0;
    this.rifleLocal = new THREE.Matrix4();
    this.inv = BONES.map(() => new THREE.Matrix4());
    this.invDirty = true;
    this.update(0);
  }

  setPose(name, rate = 9) {
    if (!POSES[name]) return;
    this.pose = name;
    this.blendRate = rate;
  }

  snapPose(name) {
    this.pose = name;
    this.cur.set(POSE_CH[name]);
  }

  setTint(k) {
    this.material.color.setScalar(k);
  }

  update(dt) {
    const p = POSES[this.pose];
    const tgt = this.tgt;
    tgt.set(POSE_CH[this.pose]);
    // 이동 주기 (팔다리 흔들기)
    if (p.cycle && this.moveSpeed > 0.05) {
      const stride = p.cycle === 'run' ? 2.2 : p.cycle === 'walk' ? 1.5 : p.cycle === 'crouch' ? 1.1 : 0.7;
      this.phase += (dt * this.moveSpeed * Math.PI * 2) / stride;
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      if (p.cycle === 'crawl') {
        tgt[CH.THIGH_L + 2] += 0.25 * s;
        tgt[CH.SHIN_L] += Math.max(0, s) * 1.1;
        tgt[CH.THIGH_R + 2] += 0.25 * s;
        tgt[CH.SHIN_R] += Math.max(0, -s) * 1.1;
        tgt[CH.RIFLE_P + 2] += 0.12 * s;
      } else {
        const amp = p.cycle === 'run' ? 0.85 : p.cycle === 'walk' ? 0.42 : 0.38;
        const knee = p.cycle === 'run' ? 1.2 : 0.55;
        tgt[CH.THIGH_L] += amp * s;
        tgt[CH.SHIN_L] += knee * Math.max(0, c);
        tgt[CH.THIGH_R] -= amp * s;
        tgt[CH.SHIN_R] += knee * Math.max(0, -c);
        tgt[CH.HIP_Y] += Math.abs(c) * (p.cycle === 'run' ? 0.05 : 0.02);
        tgt[CH.RIFLE_P + 1] += 0.03 * c;
      }
    }
    // 조준 피치 (+ = 아래)
    if (p.aim) {
      tgt[CH.HEAD] += this.aimPitch * 0.85;
      tgt[CH.RIFLE_R] += this.aimPitch;
      tgt[CH.CHEST] += this.aimPitch * 0.3;
      tgt[CH.RIFLE_P + 1] -= this.aimPitch * 0.12;
    }
    // 몸 기울이기 (+ = 오른쪽 = -X)
    if (this.lean) {
      tgt[CH.SPINE + 2] += this.lean * 0.22;
      tgt[CH.CHEST + 2] += this.lean * 0.18;
      tgt[CH.RIFLE_P] -= this.lean * 0.3;
      tgt[CH.RIFLE_R + 2] += this.lean * 0.3;
      tgt[CH.HEAD + 1] += 0;
    }
    const k = dt > 0 ? 1 - Math.exp(-this.blendRate * dt) : 1;
    const cur = this.cur;
    for (let i = 0; i < NCH; i++) cur[i] += (tgt[i] - cur[i]) * k;
    this.applyChannels(p);
    this.invDirty = true;
  }

  applyChannels(p) {
    const c = this.cur;
    const b = this.b;
    b.hips.position.set(0, c[CH.HIP_Y], c[CH.HIP_Z]);
    b.hips.rotation.set(c[CH.HIPS] + this.slopePitch, c[CH.HIPS + 1], c[CH.HIPS + 2]);
    b.spine.rotation.set(c[CH.SPINE], c[CH.SPINE + 1], c[CH.SPINE + 2]);
    b.chest.rotation.set(c[CH.CHEST], c[CH.CHEST + 1], c[CH.CHEST + 2]);
    b.neck.rotation.set(0, 0, 0);
    b.thighL.rotation.set(c[CH.THIGH_L], c[CH.THIGH_L + 1], c[CH.THIGH_L + 2]);
    b.shinL.rotation.set(c[CH.SHIN_L], 0, 0);
    b.thighR.rotation.set(c[CH.THIGH_R], c[CH.THIGH_R + 1], c[CH.THIGH_R + 2]);
    b.shinR.rotation.set(c[CH.SHIN_R], 0, 0);
    this.root.updateMatrixWorld(true);
    _rootInv.copy(this.root.matrixWorld).invert();

    // 머리: 병사 기준 시선 방향
    _m.multiplyMatrices(_rootInv, b.neck.matrixWorld);
    _m.decompose(_p, _q, _s);
    _e.set(c[CH.HEAD], c[CH.HEAD + 1], 0, 'YXZ');
    _q2.setFromEuler(_e);
    b.head.quaternion.copy(_q.invert()).multiply(_q2);

    // 총: 병사 기준 위치·방향 → 가슴 로컬
    _m.multiplyMatrices(_rootInv, b.chest.matrixWorld); // chestRel
    _e.set(c[CH.RIFLE_R], c[CH.RIFLE_R + 1], c[CH.RIFLE_R + 2], 'YXZ');
    _q2.setFromEuler(_e);
    _p.set(c[CH.RIFLE_P], c[CH.RIFLE_P + 1], c[CH.RIFLE_P + 2]);
    // 엎드려 경사를 따라 몸을 기울였으면 총 위치도 엉덩이를 축으로 함께 돌린다 (방향은 조준 그대로)
    if (this.slopePitch !== 0) {
      const cs = Math.cos(this.slopePitch);
      const sn = Math.sin(this.slopePitch);
      const py = _p.y - c[CH.HIP_Y];
      const pz = _p.z - c[CH.HIP_Z];
      _p.y = c[CH.HIP_Y] + py * cs - pz * sn;
      _p.z = c[CH.HIP_Z] + py * sn + pz * cs;
    }
    _m2.compose(_p, _q2, _one);
    _m.invert();
    this.rifleLocal.multiplyMatrices(_m, _m2);
    this.rifleLocal.decompose(b.rifle.position, b.rifle.quaternion, _s);

    // 팔
    if (p.arms === 'ik') {
      _t.copy(GRIP_L).applyMatrix4(this.rifleLocal);
      this.solveArm(b.upperArmL, b.foreArmL, SHOULDER_L, _t, POLE_L);
      _t.copy(GRIP_R).applyMatrix4(this.rifleLocal);
      this.solveArm(b.upperArmR, b.foreArmR, SHOULDER_R, _t, POLE_R);
    } else {
      b.upperArmL.rotation.set(c[CH.ARM_L], c[CH.ARM_L + 1], c[CH.ARM_L + 2]);
      b.foreArmL.rotation.set(c[CH.FORE_L], 0, 0);
      b.upperArmR.rotation.set(c[CH.ARM_R], c[CH.ARM_R + 1], c[CH.ARM_R + 2]);
      b.foreArmR.rotation.set(c[CH.FORE_R], 0, 0);
    }
    this.root.updateMatrixWorld(true);
  }

  // 2관절 IK (가슴 좌표계). 팔꿈치는 pole 쪽으로
  solveArm(upper, fore, shoulder, target, pole) {
    _dir.subVectors(target, shoulder);
    let d = _dir.length();
    if (d < 1e-5) return;
    _dir.multiplyScalar(1 / d);
    d = Math.min(Math.max(d, Math.abs(UPPER - FORE) + 0.01), UPPER + FORE - 0.002);
    const cosA = (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d);
    const A = Math.acos(Math.min(1, Math.max(-1, cosA)));
    _perp.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
    if (_perp.lengthSq() < 1e-8) _perp.set(0, -1, 0).addScaledVector(_dir, _dir.y);
    _perp.normalize();
    _u.copy(_dir).multiplyScalar(Math.cos(A)).addScaledVector(_perp, Math.sin(A)).normalize();
    // 팔꿈치 → 손 방향
    _f.copy(_dir).multiplyScalar(d).addScaledVector(_u, -UPPER).normalize();
    _Y.copy(_u).negate();
    _Z.copy(_f).addScaledVector(_u, -_f.dot(_u));
    if (_Z.lengthSq() < 1e-8) _Z.copy(_perp);
    _Z.normalize();
    _X.crossVectors(_Y, _Z).normalize();
    _m2.makeBasis(_X, _Y, _Z);
    upper.quaternion.setFromRotationMatrix(_m2);
    const bend = Math.acos(Math.min(1, Math.max(-1, _u.dot(_f))));
    fore.rotation.set(-bend, 0, 0);
  }

  // ------------------------------------------------------------------ 질의
  getEyePos(out) {
    return out.copy(EYE).applyMatrix4(this.b.head.matrixWorld);
  }

  getHeadPos(out) {
    return out.copy(HEAD_C).applyMatrix4(this.b.head.matrixWorld);
  }

  getChestPos(out) {
    return out.copy(CHEST_C).applyMatrix4(this.b.chest.matrixWorld);
  }

  getHipsPos(out) {
    return out.setFromMatrixPosition(this.b.hips.matrixWorld);
  }

  getMuzzle(outPos, outDir) {
    const m = this.b.rifle.matrixWorld;
    outPos.copy(MUZZLE).applyMatrix4(m);
    if (outDir) outDir.set(m.elements[8], m.elements[9], m.elements[10]).normalize();
    return outPos;
  }

  // 선분 피격 판정. out: {t, zone, plate, x,y,z}
  testSegment(ax, ay, az, bx, by, bz, out) {
    if (this.invDirty) {
      for (let i = 0; i < this.bones.length; i++) this.inv[i].copy(this.bones[i].matrixWorld).invert();
      this.invDirty = false;
    }
    let best = Infinity;
    let bestPart = null;
    let bestPlate = false;
    for (const part of HIT_PARTS) {
      const inv = this.inv[BI[part.bone]];
      _v.set(ax, ay, az).applyMatrix4(inv);
      _v2.set(bx, by, bz).applyMatrix4(inv);
      const dx = _v2.x - _v.x;
      const dy = _v2.y - _v.y;
      const dz = _v2.z - _v.z;
      if (part.type === 'sphere') {
        const t = segSphere(_v.x, _v.y, _v.z, dx, dy, dz, part.c[0], part.c[1], part.c[2], part.r);
        if (t >= 0 && t < best) {
          best = t;
          bestPart = part;
          bestPlate = false;
        }
      } else {
        const px = _v.x - part.c[0];
        const py = _v.y - part.c[1];
        const pz = _v.z - part.c[2];
        if (segBoxLocal(px, py, pz, dx, dy, dz, part.h[0], part.h[1], part.h[2], _box) && _box.t < best) {
          best = _box.t;
          bestPart = part;
          // 방탄판: 가슴 앞·뒤 면 중앙
          bestPlate = false;
          if (part.plate && _box.axis === 2) {
            const hx = px + dx * _box.t;
            if (Math.abs(hx) < CONFIG.damage.plateHalfWidth) bestPlate = true;
          }
        }
      }
    }
    if (!bestPart) return false;
    out.t = best;
    out.zone = bestPart.zone;
    out.plate = bestPlate;
    out.x = ax + (bx - ax) * best;
    out.y = ay + (by - ay) * best;
    out.z = az + (bz - az) * best;
    return true;
  }
}

export function poseEyeHeight(name) {
  // 자세별 눈 높이 측정 (평지, 조준 피치 0)
  const m = new SoldierModel({ tapeColor: 0xffffff, colors: CONFIG.soldierTypes.rifleman.colors });
  m.snapPose(name);
  m.update(0);
  const v = new THREE.Vector3();
  m.getEyePos(v);
  return v.y;
}

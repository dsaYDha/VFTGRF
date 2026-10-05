// 카메라를 향하는 인스턴스 사각형 파티클 (풀링: 고정 용량 배열)
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const VERT = `
  attribute vec3 iPos;
  attribute vec2 iSizeRot;
  attribute vec4 iColor;
  uniform float uFogDensity;
  uniform float uFogMul;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFog;
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSizeRot.x;
    vec3 wp = iPos + right * p.x + up * p.y;
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = iColor;
    float fd = uFogDensity * uFogMul;
    float d = length(mv.xyz);
    vFog = 1.0 - exp(-fd * fd * d * d);
  }
`;
const FRAG = `
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFog;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vColor.a;
    if (a < 0.004) discard;
    vec3 col = vColor.rgb * t.rgb;
    if (uAdditive > 0.5) {
      gl_FragColor = vec4(col * a * (1.0 - vFog), 1.0);
    } else {
      gl_FragColor = vec4(mix(col, uFogColor, vFog), a);
    }
    #include <colorspace_fragment>
  }
`;

const _c = new THREE.Color();

export class ParticleSystem {
  constructor({ max, texture, additive = false, fogMul = 1, renderOrder = 2 }) {
    this.max = max;
    this.count = 0;
    // 시뮬레이션 상태
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    // GPU 버퍼
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aPos, this.aSR, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSizeRot', this.aSR);
    geo.setAttribute('iColor', this.aCol);
    geo.instanceCount = 0;
    this.geo = geo;
    const A = CONFIG.atmosphere;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: texture },
        uFogColor: { value: new THREE.Color(A.fogColor) },
        uFogDensity: { value: A.fogDensity },
        uFogMul: { value: fogMul },
        uAdditive: { value: additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  // o: {x,y,z, vx,vy,vz, life, size0, size1, rot, rotVel, color(hex), alpha, drag, gravity, fadeIn}
  spawn(o) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max); // 가득 차면 임의 덮어쓰기
    const i3 = i * 3;
    this.p[i3] = o.x;
    this.p[i3 + 1] = o.y;
    this.p[i3 + 2] = o.z;
    this.v[i3] = o.vx || 0;
    this.v[i3 + 1] = o.vy || 0;
    this.v[i3 + 2] = o.vz || 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1 ?? o.size0;
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.rotV[i] = o.rotVel ?? (Math.random() - 0.5) * 0.6;
    _c.set(o.color ?? 0xffffff);
    if (o.bright) _c.multiplyScalar(o.bright);
    this.col[i3] = _c.r;
    this.col[i3 + 1] = _c.g;
    this.col[i3 + 2] = _c.b;
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.03;
  }

  update(dt, wind) {
    let w = 0;
    const n = this.count;
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    for (let i = 0; i < n; i++) {
      const life = this.life[i] - dt;
      if (life <= 0) continue;
      const i3 = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      let vx = this.v[i3] * d + wx * (1 - d);
      let vy = this.v[i3 + 1] * d - this.grav[i] * dt;
      let vz = this.v[i3 + 2] * d + wz * (1 - d);
      // 압축 복사
      const o3 = w * 3;
      this.p[o3] = this.p[i3] + vx * dt;
      this.p[o3 + 1] = this.p[i3 + 1] + vy * dt;
      this.p[o3 + 2] = this.p[i3 + 2] + vz * dt;
      this.v[o3] = vx;
      this.v[o3 + 1] = vy;
      this.v[o3 + 2] = vz;
      this.life[w] = life;
      this.maxLife[w] = this.maxLife[i];
      this.s0[w] = this.s0[i];
      this.s1[w] = this.s1[i];
      this.rot[w] = this.rot[i] + this.rotV[i] * dt;
      this.rotV[w] = this.rotV[i];
      this.col[o3] = this.col[i3];
      this.col[o3 + 1] = this.col[i3 + 1];
      this.col[o3 + 2] = this.col[i3 + 2];
      this.a0[w] = this.a0[i];
      this.drag[w] = this.drag[i];
      this.grav[w] = this.grav[i];
      this.fadeIn[w] = this.fadeIn[i];
      w++;
    }
    this.count = w;
    const P = this.aPos.array;
    const SR = this.aSR.array;
    const C = this.aCol.array;
    for (let i = 0; i < w; i++) {
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      const i3 = i * 3;
      P[i3] = this.p[i3];
      P[i3 + 1] = this.p[i3 + 1];
      P[i3 + 2] = this.p[i3 + 2];
      // 크기: 빠르게 커졌다가 천천히
      const g = 1 - (1 - t) * (1 - t);
      SR[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * g;
      SR[i * 2 + 1] = this.rot[i];
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      const a = this.a0[i] * fi * Math.pow(1 - t, 0.75);
      C[i * 4] = this.col[i3];
      C[i * 4 + 1] = this.col[i3 + 1];
      C[i * 4 + 2] = this.col[i3 + 2];
      C[i * 4 + 3] = a;
    }
    this.geo.instanceCount = w;
    if (w > 0) {
      this.aPos.needsUpdate = true;
      this.aSR.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aPos.addUpdateRange(0, w * 3);
      this.aSR.addUpdateRange(0, w * 2);
      this.aCol.addUpdateRange(0, w * 4);
    }
  }

  clear() {
    this.count = 0;
    this.geo.instanceCount = 0;
  }
}

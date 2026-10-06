// 예광탄 빛줄기: 탄 진행 방향으로 늘인 가산 혼합 사각형 (멀리서도 최소 굵기 유지)
// 안개는 장면 안개(Three.js fog 청크, Atmosphere.js 의 식)를 그대로 받는다. 거리만 effects.tracerFogMul 배로 줄여 본다
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { streakTexture } from '../world/textures.js';

const VERT = `
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec4 iCol;
  attribute float iWidth;
  uniform float uFogMul;
  varying vec2 vUv;
  varying vec4 vCol;
  #include <fog_pars_vertex>
  void main() {
    vec3 p = mix(iA, iB, position.y);
    vec3 axis = iB - iA;
    float al = length(axis);
    axis = al > 1e-4 ? axis / al : vec3(0.0, 0.0, 1.0);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float dist = length(cameraPosition - p);
    float w = max(iWidth, dist * 0.0018);
    p += side * position.x * w;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vUv = vec2(position.x + 0.5, position.y);
    vCol = iCol;
    #include <fog_vertex>
    #ifdef USE_FOG
      vFogDepth *= uFogMul;
    #endif
  }
`;
const FRAG = `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vCol;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float ff = 0.0;
    #if defined( USE_FOG ) && defined( FOG_EXP2 )
      ff = atmoFogFactor(vFogDepth, vFogDY);
    #endif
    float a = t.a * vCol.a * (1.0 - ff);
    gl_FragColor = vec4(vCol.rgb * a, 1.0);
    #include <colorspace_fragment>
  }
`;

const _c = new THREE.Color();

export class TracerSystem {
  constructor(max) {
    this.max = max;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aW = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const a of [this.aA, this.aB, this.aCol, this.aW]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iWidth', this.aW);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uMap: { value: streakTexture() },
        uFogMul: { value: CONFIG.effects.tracerFogMul },
      },
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  // bullets: 활성 탄 목록. glow: 머리 빛점용 파티클 시스템
  update(bullets, glow, dt, camPos) {
    const E = CONFIG.effects;
    let n = 0;
    const A = this.aA.array;
    const B = this.aB.array;
    const C = this.aCol.array;
    const W = this.aW.array;
    for (const b of bullets) {
      if (!b.active || !b.isTracer || n >= this.max) continue;
      const burn = b.ammo.tracerBurnTime;
      if (b.age > burn) continue;
      const traveled = b.pos.distanceTo(b.origin);
      if (traveled < 2) continue; // 총구 바로 앞은 생략
      const len = Math.min(E.tracerLength, traveled - 1);
      const vx = b.vel.x;
      const vy = b.vel.y;
      const vz = b.vel.z;
      const sp = Math.hypot(vx, vy, vz) || 1;
      A[n * 3] = b.pos.x - (vx / sp) * len;
      A[n * 3 + 1] = b.pos.y - (vy / sp) * len;
      A[n * 3 + 2] = b.pos.z - (vz / sp) * len;
      B[n * 3] = b.pos.x;
      B[n * 3 + 1] = b.pos.y;
      B[n * 3 + 2] = b.pos.z;
      _c.set(b.ammo.tracerColor);
      const fade = b.age > burn - 0.3 ? (burn - b.age) / 0.3 : 1;
      C[n * 4] = _c.r * 3.2;
      C[n * 4 + 1] = _c.g * 3.2;
      C[n * 4 + 2] = _c.b * 3.2;
      C[n * 4 + 3] = fade;
      W[n] = E.tracerWidth;
      n++;
      // 머리의 빛점 (거리에 따라 커져서 멀리서도 보임)
      if (glow) {
        const dist = camPos ? b.pos.distanceTo(camPos) : 50;
        const size = 0.28 * Math.max(1, Math.pow(dist / 35, 0.85));
        glow.spawn({
          x: b.pos.x,
          y: b.pos.y,
          z: b.pos.z,
          life: Math.max(0.02, dt * 1.6),
          size0: size,
          size1: size,
          color: b.ammo.tracerColor,
          bright: 2.2,
          alpha: 0.9 * fade,
          fadeIn: 0,
        });
      }
    }
    this.geo.instanceCount = n;
    if (n) {
      this.aA.needsUpdate = true;
      this.aB.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aW.needsUpdate = true;
    }
  }
}

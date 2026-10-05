// 카메라를 향하는 인스턴스 사각형 파티클 (풀링: 고정 용량 배열)
// 안개는 장면 안개(Three.js fog 청크, Atmosphere.js 의 식)를 그대로 받는다. fogMul 로 거리만 줄여 볼 수 있다 (탄착 먼지 등).
import * as THREE from 'three';

const VERT = `
  attribute vec3 iPos;
  attribute vec2 iSizeRot;
  attribute vec4 iColor;
  uniform float uFogMul;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vShadeY;
  #include <fog_pars_vertex>
  void main() {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSizeRot.x;
    vec3 wp = iPos + right * p.x + up * p.y;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    vUv = uv;
    vColor = iColor;
    vShadeY = position.y * 2.0; // 회전 전 화면 위쪽 (-1..1): 위쪽이 하늘빛을 받아 밝다
    #include <fog_vertex>
    #ifdef USE_FOG
      vFogDepth *= uFogMul;
    #endif
  }
`;
const FRAG = `
  uniform sampler2D uMap;
  uniform float uAdditive;
  uniform float uShade;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vShadeY;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float a = t.a * vColor.a;
    if (a < 0.004) discard;
    vec3 col = vColor.rgb * t.rgb * (1.0 + uShade * vShadeY);
    float ff = 0.0;
    #if defined( USE_FOG ) && defined( FOG_EXP2 )
      ff = atmoFogFactor(vFogDepth, vFogDY);
    #endif
    if (uAdditive > 0.5) {
      gl_FragColor = vec4(col * a * (1.0 - ff), 1.0);
      #include <colorspace_fragment>
    } else {
      gl_FragColor = vec4(col, a);
      #include <colorspace_fragment>
      #ifdef USE_FOG
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
      #endif
    }
  }
`;

const _c = new THREE.Color();

// sizeCurve: 'easeOut' (빠르게 커졌다가 천천히, 탄착 먼지) | 'plume' (연기 기둥: 위로 갈수록 꾸준히 넓어짐)
// fadePow: 수명에 따라 옅어지는 지수, shade: 스프라이트 위아래 밝기 차 (0 = 없음)
export class ParticleSystem {
  constructor({ max, texture, additive = false, fogMul = 1, renderOrder = 2, sizeCurve = 'easeOut', fadePow = 0.75, shade = 0 }) {
    this.max = max;
    this.count = 0;
    this.plume = sizeCurve === 'plume';
    this.fadePow = fadePow;
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
    this.col1 = new Float32Array(max * 3); // 수명 끝 색 (지정 안 하면 col 과 같음)
    this.a0 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.dragY = new Float32Array(max); // 세로 감쇠 (연기 상승 감쇠, 지정 안 하면 drag)
    this.grav = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    // 높이에 따른 바람 (연기 기둥이 일정 높이에서 휘어 흘러감): baseY 위 shear 높이에서 바람을 다 받는다
    this.baseY = new Float32Array(max);
    this.shear = new Float32Array(max); // 0 = 높이와 상관없이 바람 그대로
    this.windMin = new Float32Array(max);
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
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uMap: { value: texture },
        uFogMul: { value: fogMul },
        uAdditive: { value: additive ? 1 : 0 },
        uShade: { value: shade },
      },
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  // o: {x,y,z, vx,vy,vz, life, size0, size1, rot, rotVel, color(hex), color1(hex), alpha, drag, dragY, gravity, fadeIn,
  //     baseY, shear, windMin}
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
    if (o.color1 !== undefined) _c.set(o.color1);
    this.col1[i3] = _c.r;
    this.col1[i3 + 1] = _c.g;
    this.col1[i3 + 2] = _c.b;
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 0;
    this.dragY[i] = o.dragY ?? this.drag[i];
    this.grav[i] = o.gravity ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0.03;
    this.baseY[i] = o.baseY ?? o.y;
    this.shear[i] = o.shear ?? 0;
    this.windMin[i] = o.windMin ?? 1;
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
      const dY = this.dragY[i] === this.drag[i] ? d : Math.exp(-this.dragY[i] * dt);
      // 높이에 따른 바람 세기 (발원점 근처는 약하고 shear 높이 위에선 그대로)
      let wk = 1;
      const sh = this.shear[i];
      if (sh > 0) {
        const h = (this.p[i3 + 1] - this.baseY[i]) / sh;
        const s = h <= 0 ? 0 : h >= 1 ? 1 : h * h * (3 - 2 * h);
        wk = this.windMin[i] + (1 - this.windMin[i]) * s;
      }
      let vx = this.v[i3] * d + wx * wk * (1 - d);
      let vy = this.v[i3 + 1] * dY - this.grav[i] * dt;
      let vz = this.v[i3 + 2] * d + wz * wk * (1 - d);
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
      this.col1[o3] = this.col1[i3];
      this.col1[o3 + 1] = this.col1[i3 + 1];
      this.col1[o3 + 2] = this.col1[i3 + 2];
      this.a0[w] = this.a0[i];
      this.drag[w] = this.drag[i];
      this.dragY[w] = this.dragY[i];
      this.grav[w] = this.grav[i];
      this.fadeIn[w] = this.fadeIn[i];
      this.baseY[w] = this.baseY[i];
      this.shear[w] = this.shear[i];
      this.windMin[w] = this.windMin[i];
      w++;
    }
    this.count = w;
    const P = this.aPos.array;
    const SR = this.aSR.array;
    const C = this.aCol.array;
    const plume = this.plume;
    const fp = this.fadePow;
    for (let i = 0; i < w; i++) {
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      const i3 = i * 3;
      P[i3] = this.p[i3];
      P[i3 + 1] = this.p[i3 + 1];
      P[i3 + 2] = this.p[i3 + 2];
      // 크기: 빠르게 커졌다가 천천히 (기둥 연기는 꾸준히 넓어짐)
      const g = plume ? Math.pow(t, 0.75) : 1 - (1 - t) * (1 - t);
      SR[i * 2] = this.s0[i] + (this.s1[i] - this.s0[i]) * g;
      SR[i * 2 + 1] = this.rot[i];
      const fi = this.fadeIn[i] > 0 ? Math.min(1, t / this.fadeIn[i]) : 1;
      const a = this.a0[i] * fi * Math.pow(1 - t, fp);
      const c0 = 1 - t;
      C[i * 4] = this.col[i3] * c0 + this.col1[i3] * t;
      C[i * 4 + 1] = this.col[i3 + 1] * c0 + this.col1[i3 + 1] * t;
      C[i * 4 + 2] = this.col[i3 + 2] * c0 + this.col1[i3 + 2] * t;
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

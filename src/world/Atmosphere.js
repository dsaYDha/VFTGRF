// 흐린 늦가을 하늘·안개·조명
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export class Atmosphere {
  constructor(scene) {
    const A = CONFIG.atmosphere;
    this.scene = scene;
    scene.fog = new THREE.FogExp2(A.fogColor, A.fogDensity);
    scene.background = new THREE.Color(A.fogColor);

    // 하늘 돔: 지평선은 안개색, 위로 갈수록 어두운 회색 + 낮게 깔린 구름 무늬
    const skyGeo = new THREE.SphereGeometry(2300, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(A.skyZenith) },
        uHorizon: { value: new THREE.Color(A.skyHorizon) },
        uContrast: { value: A.cloudContrast },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * p;
          gl_Position.z = gl_Position.w; // 항상 가장 뒤
        }`,
      fragmentShader: `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uContrast; uniform float uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += noise(p) * a; p *= 2.03; a *= 0.5; } return s; }
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          float t = pow(h, 0.55);
          vec3 col = mix(uHorizon, uZenith, t);
          vec2 uv = vDir.xz / (vDir.y + 0.25) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
          float c = fbm(uv);
          col *= 1.0 + (c - 0.5) * uContrast * 2.0 * smoothstep(0.0, 0.25, h);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(A.hemiSky, A.hemiGround, A.hemiIntensity);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(A.sunColor, A.sunIntensity);
    this.sunDir = new THREE.Vector3(...A.sunDirection).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    const R = CONFIG.render;
    if (R.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(R.shadowMapSize, R.shadowMapSize);
      const e = R.shadowHalfExtent;
      const cam = this.sun.shadow.camera;
      cam.left = -e;
      cam.right = e;
      cam.top = e;
      cam.bottom = -e;
      cam.near = 10;
      cam.far = 600;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 3;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  update(dt, camPos, forward) {
    this.sky.position.copy(camPos);
    this.sky.material.uniforms.uTime.value += dt;
    // 그림자 영역은 플레이어 앞쪽(북쪽)으로 치우치게
    const cx = camPos.x + forward.x * 60;
    const cz = camPos.z + forward.z * 60;
    // 텍셀 단위로 정렬해 그림자 떨림 방지
    const texel = (CONFIG.render.shadowHalfExtent * 2) / CONFIG.render.shadowMapSize;
    const sx = Math.round(cx / texel) * texel;
    const sz = Math.round(cz / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 250, this.sunDir.y * 250, sz + this.sunDir.z * 250);
    this.sun.target.updateMatrixWorld();
  }
}

// =============================================================================
// Vegetation — 말라 죽은 해바라기밭, 마른 풀 군락, 수로 바닥 갈대 (InstancedMesh)
//  해바라기: 근거리(약 40m) = 저폴리 3D (줄기·고개 숙인 꽃판·처진 잎), 그 밖 = 교차 빌보드 (덮는 비율을 지키는 밉맵),
//            원거리(약 125m 밖) = 밭 띠: 3m 칸마다 카메라를 향하는 카드 1장 (포기 여럿이 겹친 덩어리 그림 — 낱개 꽃판이
//            검은 점으로 깜박이지 않고 윗선이 들쭉날쭉한 높이감 있는 띠). 전환은 화면 디더 없이 포기·칸 단위로 통째로 바뀐다.
//            줄 간격·방향은 지형 고랑과 같다 (이랑 마루에 심음). 차량이 밀고 간 띠·구덩이 둘레 쓰러진 줄기·빈 구간,
//            구역마다 다른 키·함께 기운 줄기, 가장자리는 노이즈로 들쭉날쭉하게 듬성듬성해지고 밖에 남은 줄기가 흩어진다.
//  풀: 노이즈 군락 (일직선 띠 없음). 지면 종류·차량 바닥 마스크로 길·구조물·수로·참호 위는 비운다.
//  LOD: 카메라 둘레 칸만 동적 인스턴스 버퍼에 모아 그리고 (종류마다 드로우콜 1개), 정점 셰이더가 거리로 디더 전환·축소한다.
//       고르는 일은 렌더러가 THREE.LOD 처럼 부르는 update(camera) 에서 한다 (그 프레임 인스턴스 업로드 전에 불린다).
//  탄은 그대로 통과하고, 시야만 가리는 은폐 볼륨을 CollisionWorld 에 등록한다 (은폐만).
// =============================================================================
import * as THREE from 'three';
import { CONFIG, SURFACES } from '../config.js';
import { MAP } from './mapData.js';
import { sunflowerCardTexture, sunflowerBandTexture, grassTuftTexture, reedTexture } from './textures.js';
import { polylineDistance, smoothstep, clamp, lerp } from '../core/mathUtils.js';
import { Random } from '../core/Random.js';

// 바람 시간 (World.update 가 올린다)
export const windUniforms = { uTime: { value: 0 } };
// LOD 거리 (applyConfig 가 갱신): 해바라기 (near, nearBand, far, farBand), 원거리 띠 (칸 크기, 그릴 밀도), 풀 (far, band), 바람 방향
const vegUniforms = {
  uSunLod: { value: new THREE.Vector4(40, 8, 125, 30) },
  uSunBand: { value: new THREE.Vector2(3, 1) },
  uGrassLod: { value: new THREE.Vector2(110, 25) },
  uWind: { value: new THREE.Vector3(1, 0, 0) },
};

// 말라 죽은 해바라기 모형 (단위 m, +x = 꽃판이 숙인 쪽). 인스턴스 세로 배수 = 실제 높이 / height.
//  stem: [x, y, 반지름] (세모 관), neckStart 번째 점부터 목 (꽃판이 떨어진 줄기는 목·꽃판을 그 앞 점으로 접는다)
//  head: 꽃판 중심·반지름·얼굴이 수평 아래로 숙인 각·두께, leaves: 붙은 높이·방위(도)·길이
export const SUNFLOWER_SHAPE = {
  height: 1.7,
  stem: [
    [0, 0, 0.0135],
    [0.03, 1.55, 0.0092],
    [0.06, 1.675, 0.008],
    [0.105, 1.705, 0.0072],
    [0.142, 1.665, 0.0068],
  ],
  neckStart: 2,
  // 꽃판: 목 끝에 뒤통수가 붙어 얼굴이 거의 땅을 향해 숙인다 (thick = 뒤쪽 둥근 등의 깊이)
  head: { x: 0.19, y: 1.615, radius: 0.115, tiltDeg: 45, thick: 0.07 },
  leaves: [
    { y: 0.62, az: 35, len: 0.26 },
    { y: 0.9, az: 165, len: 0.24 },
    { y: 1.16, az: 280, len: 0.22 },
  ],
  leafWidth: 0.05,
};
const CARD = { w: 0.925, h: 1.85, bottom: 0.05, variants: 4 };

const SID = Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, v.id]));
// 풀이 나지 않는 지면: 길·진흙(배수로·수로 바닥·비탈)·잔해·참호(수로 사격 발판 포함)·구덩이 안·물·콘크리트·하층토(흉벽·둔덕·분출물)
const NO_GRASS = new Uint8Array(64);
for (const k of ['road', 'wetMud', 'rubble', 'trench', 'crater', 'water', 'concrete', 'subsoil']) if (SID[k] !== undefined) NO_GRASS[SID[k]] = 1;

// ---------------------------------------------------------------------------- 셰이더 조각
const GLSL_VERT = `
uniform float uTime;
uniform vec3 uWind;
float vegHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 사인 없는 해시: 셰이더(근거리 3D·빌보드)마다 같은 위치에서 같은 값 → 포기마다 같은 전환 문턱
float vegHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// 바람: 월드 바람 방향 변위(높이² × 세기 m)를 인스턴스 로컬 좌표로 (회전·비균등 배율을 거꾸로). 쓰러진 줄기는 거의 안 흔들림
vec3 vegWind(vec3 ip, float hk, float amp) {
  float ph = dot(ip.xz, vec2(0.37, 0.23));
  float gust = 0.55 + 0.45 * sin(uTime * 0.53 + ph * 0.13);
  float w = gust * (0.65 + 0.35 * sin(uTime * 1.9 + ph));
  vec3 c0 = instanceMatrix[0].xyz;
  vec3 c1 = instanceMatrix[1].xyz;
  vec3 c2 = instanceMatrix[2].xyz;
  vec3 D = vec3(uWind.x, 0.0, uWind.z) * (w * hk * amp * clamp(c1.y / max(length(c1), 1e-4), 0.0, 1.0));
  return vec3(dot(c0, D) / dot(c0, c0), dot(c1, D) / dot(c1, c1), dot(c2, D) / dot(c2, c2));
}
`;
// 해바라기 원거리 띠 칸 (빌보드와 띠가 같은 식): 칸 번호 → 전환 문턱 거리 (far - farBand × 칸마다 고르게 흩어진 값), dc = 칸 중심까지 수평 거리
const GLSL_SUN_BAND = `
uniform vec4 uSunLod;
uniform vec2 uSunBand;
float sunBandSwitch(vec2 p, out float dc) {
  vec2 ci = floor(p / uSunBand.x);
  dc = length((ci + 0.5) * uSunBand.x - cameraPosition.xz);
  return uSunLod.z - uSunLod.w * fract(dot(ci, vec2(0.7548776662, 0.5698402910)) + 0.5);
}
`;
const glf = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
// 알파 문턱 (빌보드·원거리 띠): MSAA 면 알파를 문턱 0.5 를 가운데로 한 화소 폭(fwidth)에 걸쳐 표본 덮개로 바꾼다.
// three 기본(문턱 위쪽으로만 램프)은 덮는 비율이 문턱 언저리에서 절반쯤 줄어, 덮는 비율을 지키는 밉맵의 가는 줄기가 사라지고
// 꽃판만 검은 점으로 남는다 → 가운데 맞춤으로 평균 덮는 비율을 지킨다. MSAA 가 없으면 그냥 문턱
const ALPHA_CHUNK = `
#ifdef ALPHA_TO_COVERAGE
  diffuseColor.a = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);
  if (diffuseColor.a < 0.01) discard;
#else
  if (diffuseColor.a < alphaTest) discard;
#endif`;

// 양면 카드: 뒷면 법선을 뒤집지 않아 양쪽이 같은 밝기
const NORMAL_FIX = ['#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);'];

// 근거리 3D 해바라기: 꽃판 없는 줄기·잎 2장 처리, 포기마다 near - nearBand × 해시 거리 밖이면 접는다 (빌보드가 같은 문턱으로 이어받음)
function patchSunflower3D(mat) {
  const SH = SUNFLOWER_SHAPE;
  const top = SH.stem[SH.neckStart - 1];
  const amp = CONFIG.vegetation.sunflower.wind;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: windUniforms.uTime, uWind: vegUniforms.uWind, uSunLod: vegUniforms.uSunLod });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VERT}\nuniform vec4 uSunLod;\nattribute float aPart;\nattribute float aInfo;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float headless = mod(aInfo, 2.0);
          float noLeaf3 = mod(floor(aInfo * 0.5 + 0.01), 2.0);
          // aPart: 0 줄기, 1 꽃판, 2 셋째 잎, 3 목
          if (headless > 0.5 && (abs(aPart - 1.0) < 0.5 || aPart > 2.5)) transformed = vec3(${glf(top[0])}, ${glf(top[1])}, 0.0);
          if (noLeaf3 > 0.5 && abs(aPart - 2.0) < 0.5) transformed = vec3(0.0, 1.0, 0.0);
          float hk = transformed.y * ${glf(1 / SH.height)};
          transformed += vegWind(ip, hk * hk, ${glf(amp)});
          if (distance(ip, cameraPosition) >= uSunLod.x - uSunLod.y * vegHash12(ip.xz)) transformed = vec3(0.0);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'vegSunflower3D';
}

// 해바라기 교차 빌보드: 변형 칸 고르기. 근거리 3D 와 포기마다 같은 문턱, 원거리 띠와 칸마다 같은 문턱으로 통째로 접는다 (화면 디더 없음)
function patchSunflowerCard(mat) {
  const SH = SUNFLOWER_SHAPE;
  const S = CONFIG.vegetation.sunflower;
  const amp = S.wind;
  const tiles = CARD.variants * 2;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: windUniforms.uTime,
      uWind: vegUniforms.uWind,
      uSunLod: vegUniforms.uSunLod,
      uSunBand: vegUniforms.uSunBand,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VERT}\n${GLSL_SUN_BAND}\nattribute float aInfo;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n  vMapUv.x = (uv.x + 2.0 * floor(aInfo * 0.25 + 0.01)) * ${glf(1 / tiles)};`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float dc;
          float farT = sunBandSwitch(ip.xz, dc);
          float hk = transformed.y * ${glf(1 / SH.height)};
          transformed += vegWind(ip, hk * hk, ${glf(amp)});
          if (distance(ip, cameraPosition) < uSunLod.x - uSunLod.y * vegHash12(ip.xz) || dc >= farT) transformed = vec3(0.0);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', ALPHA_CHUNK).replace(NORMAL_FIX[0], NORMAL_FIX[1]);
  };
  mat.customProgramCacheKey = () => 'vegSunflowerCard';
}

// 원거리 밭 띠: 세로축으로 카메라를 향하는 카드 (인스턴스 행렬 = 위치만). aBand = (키 배수, 칸의 선 줄기 수).
// 그릴 줄기 수(수 × 밀도)에 가까운 그림 칸을 고르고 (같은 수의 칸이 여럿이면 해시로), 너무 적으면 접는다. 빌보드와 칸마다 같은 문턱
function patchSunflowerBand(mat) {
  const B = CONFIG.vegetation.sunflower.band;
  const n = B.counts.length;
  // 그림 칸 묶음 (같은 포기 수, 오름차순): 이웃 묶음 수의 가운데에서 다음 묶음으로
  const groups = [];
  B.counts.forEach((c, i) => {
    const g = groups.find((e) => e.c === c);
    if (g) g.n++;
    else groups.push({ c, start: i, n: 1 });
  });
  let pick = `float tile = ${glf(groups[0].start)} + floor(h * ${glf(groups[0].n)});`;
  for (let i = 1; i < groups.length; i++) {
    pick += `\n          if (cnt >= ${glf((groups[i - 1].c + groups[i].c) / 2)}) tile = ${glf(groups[i].start)} + floor(h * ${glf(groups[i].n)});`;
  }
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSunLod: vegUniforms.uSunLod, uSunBand: vegUniforms.uSunBand });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VERT}\n${GLSL_SUN_BAND}\nattribute vec2 aBand;`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        {
          vec2 tn = cameraPosition.xz - instanceMatrix[3].xz;
          tn /= max(length(tn), 1e-3);
          objectNormal = vec3(tn.x, 0.32, tn.y);
        }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          vec2 tc = cameraPosition.xz - ip.xz;
          tc /= max(length(tc), 1e-3);
          transformed = vec3(tc.y * position.x, position.y * aBand.x, -tc.x * position.x);
          float cnt = aBand.y * uSunBand.y;
          float h = vegHash12(ip.xz + 7.0) * 0.999;
          ${pick}
          vMapUv.x = (uv.x + tile) * ${glf(1 / n)};
          float dc;
          float farT = sunBandSwitch(ip.xz, dc);
          if (dc < farT || cnt < ${glf(B.minPlants)}) transformed = vec3(0.0);
        }`,
      );
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', ALPHA_CHUNK);
  };
  mat.customProgramCacheKey = () => 'vegSunflowerBand';
}

// 풀·갈대 카드: 칸 2개 중 하나, 바람, (풀) far 에서 땅속으로 줄어 사라짐
function patchCards(mat, { amp, lod, key }) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: windUniforms.uTime, uWind: vegUniforms.uWind, uGrassLod: vegUniforms.uGrassLod });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_VERT}\nuniform vec2 uGrassLod;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv.x = uv.x * 0.5 + 0.5 * step(0.5, vegHash(instanceMatrix[3].xz + 3.1));')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          transformed += vegWind(ip, transformed.y * transformed.y, ${glf(amp)});
          ${lod ? 'transformed *= 1.0 - smoothstep(uGrassLod.x - uGrassLod.y, uGrassLod.x, distance(ip, cameraPosition));' : ''}
        }`,
      );
    sh.fragmentShader = sh.fragmentShader.replace(NORMAL_FIX[0], NORMAL_FIX[1]);
  };
  mat.customProgramCacheKey = () => key;
}

// ---------------------------------------------------------------------------- 기하
// 정점 모음 + 삼각형 (감김 방향은 정점 법선 합과 맞춘다: 양면 재질에서 앞뒤 판정·조명이 맞게)
class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.part = [];
    this.uv = [];
    this.idx = [];
  }

  v(p, n, c = null, part = 0, uv = null) {
    this.pos.push(p.x, p.y, p.z);
    const l = Math.hypot(n.x, n.y, n.z) || 1;
    this.nor.push(n.x / l, n.y / l, n.z / l);
    if (c) this.col.push(c.r, c.g, c.b);
    this.part.push(part);
    if (uv) this.uv.push(uv[0], uv[1]);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    const P = this.pos;
    const N = this.nor;
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3];
    const wy = P[c * 3 + 1] - P[a * 3 + 1];
    const wz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * wz - uz * wy;
    const fy = uz * wx - ux * wz;
    const fz = ux * wy - uy * wx;
    const rx = N[a * 3] + N[b * 3] + N[c * 3];
    const ry = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
    const rz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * rx + fy * ry + fz * rz >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  build({ color = false, part = false, uv = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (part) g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// 근거리 해바라기 한 그루: 줄기 = 세모 관(목이 꺾여 내려옴), 꽃판 = 들쭉날쭉한 원판(얼굴) + 낮은 원뿔(뒤),
// 말라 오그라든 잎 3장 (가운데가 접힌 띠, 아래로 늘어짐). 48 삼각형, 정점색 + aPart
function sunflowerGeometry() {
  const SH = SUNFLOWER_SHAPE;
  const C = CONFIG.vegetation.sunflower.colors;
  const gb = new GeoBuilder();
  const cStem = new THREE.Color(C.stem);
  const cTop = new THREE.Color(C.stemTop);
  const cFace = new THREE.Color(C.face);
  const cBack = new THREE.Color(C.back);
  const cLeaf = new THREE.Color(C.leaf);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // 줄기
  const st = SH.stem;
  const rings = [];
  for (let i = 0; i < st.length; i++) {
    const a = st[Math.max(0, i - 1)];
    const b = st[Math.min(st.length - 1, i + 1)];
    const T = V(b[0] - a[0], b[1] - a[1], 0).normalize();
    const N1 = V(0, 0, 1);
    const N2 = V(0, 0, 0).crossVectors(T, N1).normalize();
    const c = cStem.clone().lerp(cTop, clamp(st[i][1] / SH.height, 0, 1));
    const ring = [];
    for (let j = 0; j < 3; j++) {
      const ang = (j / 3) * Math.PI * 2 + 0.4;
      const n = N1.clone().multiplyScalar(Math.cos(ang)).addScaledVector(N2, Math.sin(ang));
      ring.push(gb.v(V(st[i][0], st[i][1], 0).addScaledVector(n, st[i][2]), n, c, i >= SH.neckStart ? 3 : 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      gb.tri(rings[i][j], rings[i][j1], rings[i + 1][j]);
      gb.tri(rings[i][j1], rings[i + 1][j1], rings[i + 1][j]);
    }
  }
  // 꽃판: 얼굴 법선 n (수평 아래로 tilt), 원판 평면 = (p, z)
  const H = SH.head;
  const t = (H.tiltDeg * Math.PI) / 180;
  const n = V(Math.cos(t), -Math.sin(t), 0);
  const p = V(Math.sin(t), Math.cos(t), 0);
  const zA = V(0, 0, 1);
  const ctr = V(H.x, H.y, 0);
  const rim = 8;
  const face = gb.v(ctr.clone().addScaledVector(n, H.thick * 0.18), n, cFace, 1);
  const back = gb.v(ctr.clone().addScaledVector(n, -H.thick), n.clone().negate(), cBack, 1);
  const fr = [];
  const br = [];
  for (let k = 0; k < rim; k++) {
    const a = (k / rim) * Math.PI * 2;
    const r = H.radius * (k % 2 ? 0.91 : 1.0);
    const dir = p.clone().multiplyScalar(Math.cos(a)).addScaledVector(zA, Math.sin(a));
    const q = ctr.clone().addScaledVector(n, H.thick * 0.05).addScaledVector(dir, r);
    fr.push(gb.v(q, n, cFace, 1));
    br.push(gb.v(q, dir.clone().addScaledVector(n, -0.6), cBack, 1));
  }
  for (let k = 0; k < rim; k++) {
    const k1 = (k + 1) % rim;
    gb.tri(face, fr[k], fr[k1]);
    gb.tri(back, br[k1], br[k]);
  }
  // 잎: 줄기에서 잎자루로 조금 나와 아래로 늘어진 오그라든 잎 (밑동 1점 → 가운데 줄 3점(접힘) → 끝 1점)
  const stemXAt = (y) => {
    for (let i = 0; i < st.length - 1; i++) {
      if (y <= st[i + 1][1]) return st[i][0] + ((st[i + 1][0] - st[i][0]) * (y - st[i][1])) / Math.max(1e-6, st[i + 1][1] - st[i][1]);
    }
    return st[st.length - 1][0];
  };
  SH.leaves.forEach((lf, li) => {
    const az = (lf.az * Math.PI) / 180;
    const d = V(Math.cos(az), 0, Math.sin(az));
    const q = V(-Math.sin(az), 0, Math.cos(az));
    const S = V(stemXAt(lf.y), lf.y, 0);
    const part = li === 2 ? 2 : 0;
    const c = cLeaf.clone().multiplyScalar(0.9 + 0.1 * li);
    // 잎자루 끝에서 거의 수직으로 늘어지고 끝은 줄기 쪽으로 오그라든다
    const b0 = S.clone().addScaledVector(d, 0.03).add(V(0, 0.012, 0));
    const m = S.clone().addScaledVector(d, 0.085).add(V(0, -lf.len * 0.35, 0));
    const tip = S.clone().addScaledVector(d, 0.06).add(V(0, -lf.len, 0));
    const along = tip.clone().sub(b0).normalize();
    const bn = V(0, 0, 0).crossVectors(q, along).normalize();
    const w = SH.leafWidth * 0.5;
    const iB = gb.v(b0, bn, c, part);
    const iL = gb.v(m.clone().addScaledVector(q, -w).addScaledVector(bn, w * 0.7), bn, c, part);
    const iM = gb.v(m, bn, c, part);
    const iR = gb.v(m.clone().addScaledVector(q, w).addScaledVector(bn, w * 0.7), bn, c, part);
    const iT = gb.v(tip, bn, c, part);
    gb.tri(iB, iL, iM);
    gb.tri(iB, iM, iR);
    gb.tri(iL, iT, iM);
    gb.tri(iM, iT, iR);
  });
  return gb.build({ color: true, part: true });
}

// 해바라기 빌보드: 십자로 교차한 카드 2장 (옆모습 = x-y 평면 u 0..1, 앞모습 = z-y 평면 u 1..2), 법선은 약간 위로
function sunflowerCardGeometry() {
  const gb = new GeoBuilder();
  const W = CARD.w / 2;
  const y0 = -CARD.bottom;
  const y1 = CARD.h - CARD.bottom;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let plane = 0; plane < 2; plane++) {
    const n = plane === 0 ? V(0, 0.32, 1) : V(1, 0.32, 0);
    const P = (s, y) => (plane === 0 ? V(s, y, 0) : V(0, y, s));
    const a = gb.v(P(-W, y0), n, null, 0, [plane, 0]);
    const b = gb.v(P(W, y0), n, null, 0, [plane + 1, 0]);
    const c = gb.v(P(W, y1), n, null, 0, [plane + 1, 1]);
    const d = gb.v(P(-W, y1), n, null, 0, [plane, 1]);
    gb.tri(a, b, c);
    gb.tri(a, c, d);
  }
  return gb.build({ uv: true });
}

// 풀 포기·갈대 군락: 단위 크기(폭 1, 높이 1) 카드 count 장을 같은 각도로 교차
function crossCardGeometry(count, upNormal) {
  const gb = new GeoBuilder();
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI;
    const cx = Math.cos(a) * 0.5;
    const cz = Math.sin(a) * 0.5;
    const n = upNormal ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(-Math.sin(a), 0.6, Math.cos(a));
    const i0 = gb.v(new THREE.Vector3(-cx, 0, -cz), n, null, 0, [0, 0]);
    const i1 = gb.v(new THREE.Vector3(cx, 0, cz), n, null, 0, [1, 0]);
    const i2 = gb.v(new THREE.Vector3(cx, 1, cz), n, null, 0, [1, 1]);
    const i3 = gb.v(new THREE.Vector3(-cx, 1, -cz), n, null, 0, [0, 1]);
    gb.idx.push(i0, i1, i2, i0, i2, i3);
  }
  return gb.build({ uv: true });
}

// ---------------------------------------------------------------------------- 칸별 인스턴스 데이터
// 칸 안은 솎는 순서(무작위 keep)로 정렬해 둔다 → 밀도 배수 = 칸마다 앞쪽 일부를 통째로 복사
class CellStore {
  constructor(size, withInfo) {
    this.size = size;
    this.withInfo = withInfo;
    this.map = new Map();
    this.cells = [];
    this.total = 0;
  }

  push(x, z, keep, m, r, g, b, info = 0) {
    const i = Math.floor(x / this.size);
    const j = Math.floor(z / this.size);
    const key = (i + 1000) * 4096 + (j + 1000);
    let c = this.map.get(key);
    if (!c) {
      c = { cx: (i + 0.5) * this.size, cz: (j + 0.5) * this.size, keep: [], m: [], c: [], info: [], n: 0, d: 0 };
      this.map.set(key, c);
      this.cells.push(c);
    }
    c.keep.push(keep);
    for (let k = 0; k < 16; k++) c.m.push(m[k]);
    c.c.push(r, g, b);
    c.info.push(info);
  }

  pack() {
    for (const c of this.cells) {
      const n = c.keep.length;
      const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => c.keep[a] - c.keep[b]);
      c.n = n;
      c.mat = new Float32Array(n * 16);
      c.col = new Float32Array(n * 3);
      if (this.withInfo) c.info2 = new Float32Array(n);
      order.forEach((o, k) => {
        for (let e = 0; e < 16; e++) c.mat[k * 16 + e] = c.m[o * 16 + e];
        c.col[k * 3] = c.c[o * 3];
        c.col[k * 3 + 1] = c.c[o * 3 + 1];
        c.col[k * 3 + 2] = c.c[o * 3 + 2];
        if (this.withInfo) c.info2[k] = c.info[o];
      });
      c.info = this.withInfo ? c.info2 : null;
      c.info2 = c.keep = c.m = c.c = undefined;
      this.total += n;
    }
    this.map = null;
  }
}

// 동적 InstancedMesh (용량 cap, 매 갱신 count 만큼만 업로드)
function makeInstanced(geo, mat, cap, withInfo) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  if (withInfo) {
    const info = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap)), 1);
    info.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', info);
  }
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// 고른 칸들의 앞쪽 (density 비율) 을 버퍼에 복사 (용량을 넘으면 먼 칸은 버린다 — 칸은 가까운 순으로 넘긴다)
function fillInstances(mesh, cells, density) {
  const M = mesh.instanceMatrix;
  const C = mesh.instanceColor;
  const I = mesh.geometry.attributes.aInfo || null;
  const cap = M.count;
  let n = 0;
  for (const c of cells) {
    let k = Math.min(c.n, Math.round(c.n * density));
    if (n + k > cap) k = cap - n;
    if (k <= 0) continue;
    M.array.set(c.mat.subarray(0, k * 16), n * 16);
    C.array.set(c.col.subarray(0, k * 3), n * 3);
    if (I && c.info) I.array.set(c.info.subarray(0, k), n);
    n += k;
    if (n >= cap) break;
  }
  mesh.count = n;
  for (const a of I ? [M, C, I] : [M, C]) {
    a.clearUpdateRanges();
    if (n > 0) a.addUpdateRange(0, n * a.itemSize);
    a.needsUpdate = true;
  }
  return n;
}

// 렌더러가 THREE.LOD 처럼 매 프레임 update(camera) 를 불러 주는 묶음 (그 프레임 인스턴스 업로드 전)
class VegetationRoot extends THREE.Object3D {
  constructor(owner) {
    super();
    this.owner = owner;
    this.isLOD = true;
    this.autoUpdate = true;
    this.name = 'vegetation';
  }

  update(camera) {
    this.owner.updateLod(camera);
  }
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _poly = {};

// 위치·방향(yaw: 로컬 +x 가 향할 각, three Y 회전)·기울기(쓰러지는 방향 fx,fz 로 tilt rad)·배율 → 행렬 원소 16
function plantMatrix(x, y, z, yaw, tilt, fx, fz, sx, sy, sz) {
  _q.setFromAxisAngle(_up, yaw);
  if (tilt > 1e-4) {
    const l = Math.hypot(fx, fz) || 1;
    // up × 쓰러지는 방향 축으로 돌리면 줄기 끝이 그 방향으로 눕는다
    _ax.set(fz / l, 0, -fx / l);
    _qt.setFromAxisAngle(_ax, tilt);
    _q.premultiply(_qt);
  }
  _m4.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  return _m4.elements;
}

export class Vegetation {
  constructor({ terrain, col }) {
    this.terrain = terrain;
    this.col = col;
    this.root = new VegetationRoot(this);
    this.group = this.root;
    this.sunNear = null;
    this.sunCards = null;
    this.grassMesh = null;
    this.sunState = { x: 0, z: 0, fx: 0, fz: -1, wedge: 0, valid: false };
    this.grassState = { x: 0, z: 0, valid: false };
    this.stats = {};
    this.uniforms = vegUniforms; // 점검용 (LOD 거리 등을 실행 중에 바꿔 볼 때)
  }

  build() {
    const V = CONFIG.vegetation;
    const w = CONFIG.atmosphere.windDirection;
    const wl = Math.hypot(w[0], w[2]) || 1;
    vegUniforms.uWind.value.set(w[0] / wl, 0, w[2] / wl);
    this.buildSunflowers();
    this.buildGrass();
    this.buildReeds();
    this.density = -1;
    this.applyConfig();
    this.stats.density = V.density;
    return this.root;
  }

  // ------------------------------------------------------------------ 품질 프리셋
  // CONFIG.vegetation.density / lodScale / sunflower.lod / grass.lod 를 다시 읽어 적용 (다음 프레임에 다시 고른다)
  applyConfig() {
    const V = CONFIG.vegetation;
    const k = V.lodScale ?? 1;
    const SL = V.sunflower.lod;
    const GL = V.grass.lod;
    this.sunLod = { near: SL.near * k, nearBand: SL.nearBand, far: SL.far * k, farBand: SL.farBand * k };
    this.grassFar = GL.far * k;
    vegUniforms.uSunLod.value.set(this.sunLod.near, this.sunLod.nearBand, this.sunLod.far, this.sunLod.farBand);
    vegUniforms.uSunBand.value.x = V.sunflower.band.cell;
    vegUniforms.uGrassLod.value.set(this.grassFar, GL.band * k);
    this.setDensity(V.density);
    this.sunState.valid = false;
    this.grassState.valid = false;
  }

  setDensity(mul) {
    const d = clamp(mul, 0.02, 1);
    if (d === this.density) return;
    this.density = d;
    // 원거리 띠: 칸의 줄기 수 × 밀도로 그림 칸을 고른다 (셰이더)
    vegUniforms.uSunBand.value.y = d;
    // 빌보드 (해바라기 전체): 정적 버퍼를 다시 채운다 (수로 쪽에서 가까운 칸부터: 앞에서 뒤로 그려 겹침 비용을 줄임)
    if (this.sunCards) {
      this.stats.sunflowerCards = 0;
      for (const mesh of this.sunCards) {
        this.stats.sunflowerCards += fillInstances(mesh, mesh.userData.cells, d);
        mesh.computeBoundingSphere();
      }
    }
    this.sunState.valid = false;
    this.grassState.valid = false;
  }

  setLodScale(k) {
    CONFIG.vegetation.lodScale = k;
    this.applyConfig();
  }

  // ------------------------------------------------------------------ 매 프레임 (렌더러가 부름)
  updateLod(camera) {
    const e = camera.matrixWorld.elements;
    const cx = e[12];
    const cz = e[14];
    let fx = -e[8];
    let fz = -e[10];
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-4) {
      fx /= fl;
      fz /= fl;
    } else {
      fx = 0;
      fz = -1;
    }
    const pitch = Math.asin(clamp(-e[9], -1, 1));
    const hh = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * (camera.aspect || 1.6));
    if (this.sunNear) this.updateSunNear(cx, cz, fx, fz, hh, pitch);
    if (this.grassMesh) this.updateGrass(cx, cz);
  }

  updateSunNear(cx, cz, fx, fz, hh, pitch) {
    const SL = CONFIG.vegetation.sunflower.lod;
    const L = this.sunLod;
    const st = this.sunState;
    const B = this.sunBounds;
    const half = SL.cell * 0.7072;
    const R = L.near + half + SL.refreshMove;
    const out = Math.hypot(Math.max(B.x0 - cx, cx - B.x1, 0), Math.max(B.z0 - cz, cz - B.z1, 0));
    if (out > R) {
      if (this.sunNear.count) fillInstances(this.sunNear, [], 1);
      st.valid = false;
      return;
    }
    // 시야 쐐기: 가로 시야각 + 여유 (+ 내려다볼 때 넓힘)
    const wedge = hh + (SL.wedgeMarginDeg * Math.PI) / 180 + Math.max(0, -pitch);
    const turn = Math.acos(clamp(fx * st.fx + fz * st.fz, -1, 1));
    if (
      st.valid &&
      Math.hypot(cx - st.x, cz - st.z) < SL.refreshMove &&
      turn < (SL.refreshTurnDeg * Math.PI) / 180 &&
      Math.abs(wedge - st.wedge) < 0.08
    ) {
      return;
    }
    const list = [];
    for (const c of this.sunCells) {
      const dx = c.cx - cx;
      const dz = c.cz - cz;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      if (d > half + SL.refreshMove + 2) {
        const a = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
        if (a > wedge + Math.atan(half / d)) continue;
      }
      c.d = d;
      list.push(c);
    }
    list.sort((a, b) => a.d - b.d);
    // 포기마다 거리·쐐기 검사 (near + 다시 고르기 전 이동 여유 안, 시야 쐐기 안) → 3D 삼각형 수를 줄인다
    const mesh = this.sunNear;
    const M = mesh.instanceMatrix.array;
    const C = mesh.instanceColor.array;
    const I = mesh.geometry.attributes.aInfo.array;
    const cap = mesh.instanceMatrix.count;
    const Rp = L.near + SL.refreshMove + 0.5;
    const R2 = Rp * Rp;
    const close2 = (SL.refreshMove + 2.5) ** 2;
    const cosW = wedge >= Math.PI ? -2 : Math.cos(wedge);
    let n = 0;
    for (const c of list) {
      const k = Math.min(c.n, Math.round(c.n * this.density));
      const m = c.mat;
      for (let i = 0; i < k && n < cap; i++) {
        const o = i * 16;
        const dx = m[o + 12] - cx;
        const dz = m[o + 14] - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        if (d2 > close2 && dx * fx + dz * fz < cosW * Math.sqrt(d2)) continue;
        const w = n * 16;
        for (let e = 0; e < 16; e++) M[w + e] = m[o + e];
        C[n * 3] = c.col[i * 3];
        C[n * 3 + 1] = c.col[i * 3 + 1];
        C[n * 3 + 2] = c.col[i * 3 + 2];
        I[n] = c.info[i];
        n++;
      }
    }
    mesh.count = n;
    for (const a of [mesh.instanceMatrix, mesh.instanceColor, mesh.geometry.attributes.aInfo]) {
      a.clearUpdateRanges();
      if (n > 0) a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
    this.stats.sunflowerNear = n;
    const bs = this.sunNear.boundingSphere || (this.sunNear.boundingSphere = new THREE.Sphere());
    bs.center.set(cx, this.terrain.heightAt(cx, cz) + 1, cz);
    bs.radius = R + 3;
    Object.assign(st, { x: cx, z: cz, fx, fz, wedge, valid: true });
  }

  updateGrass(cx, cz) {
    const GL = CONFIG.vegetation.grass.lod;
    const st = this.grassState;
    if (st.valid && Math.hypot(cx - st.x, cz - st.z) < GL.refreshMove) return;
    const half = GL.cell * 0.7072;
    const R = this.grassFar + half + GL.refreshMove;
    const list = [];
    for (const c of this.grassCells) {
      const d = Math.hypot(c.cx - cx, c.cz - cz);
      if (d > R) continue;
      c.d = d;
      list.push(c);
    }
    list.sort((a, b) => a.d - b.d);
    this.stats.grassDrawn = fillInstances(this.grassMesh, list, this.density);
    const bs = this.grassMesh.boundingSphere || (this.grassMesh.boundingSphere = new THREE.Sphere());
    bs.center.set(cx, this.terrain.heightAt(cx, cz), cz);
    bs.radius = R + 2;
    Object.assign(st, { x: cx, z: cz, valid: true });
  }

  // ------------------------------------------------------------------ 해바라기
  buildSunflowers() {
    const S = CONFIG.vegetation.sunflower;
    const t = this.terrain;
    const nz = t.noise;
    const rng = new Random(CONFIG.world.seed + 311);
    const store = new CellStore(S.lod.cell, true);
    const SH = SUNFLOWER_SHAPE;
    const cTmp = { count: new Map() };
    const conceal = S.conceal;
    const LP = S.leanPatch;
    const HP = S.heightPatch;
    const BC = S.band;
    const band = new Map();
    const bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    let fallenN = 0;
    for (const f of MAP.fields.sunflower) {
      bounds.x0 = Math.min(bounds.x0, f.x0);
      bounds.x1 = Math.max(bounds.x1, f.x1);
      bounds.z0 = Math.min(bounds.z0, f.z0);
      bounds.z1 = Math.max(bounds.z1, f.z1);
      const P = t.parcels.find((p) => p && p.kind === 'sunflower' && p.x0 === f.x0 && p.z0 === f.z0);
      const fa = ((f.furrowDeg ?? 0) * Math.PI) / 180;
      const dirX = P ? P.dirX : Math.sin(fa);
      const dirZ = P ? P.dirZ : -Math.cos(fa);
      const spacing = f.spacing ?? 0.7;
      // 지형 셰이더의 고랑 좌표: s = dot(위치, (dirZ, -dirX)) / spacing, 이랑 마루 = s 의 소수부 0.5
      const px = dirZ;
      const pz = -dirX;
      let sMin = Infinity;
      let sMax = -Infinity;
      let tMin = Infinity;
      let tMax = -Infinity;
      for (const [x, z] of [
        [f.x0, f.z0],
        [f.x1, f.z0],
        [f.x0, f.z1],
        [f.x1, f.z1],
      ]) {
        const s = (x * px + z * pz) / spacing;
        const tt = x * dirX + z * dirZ;
        sMin = Math.min(sMin, s);
        sMax = Math.max(sMax, s);
        tMin = Math.min(tMin, tt);
        tMax = Math.max(tMax, tt);
      }
      // 밭을 지나는 차량 자국 (궤도 차량 = 지면 자국과 같은 선) + 바퀴 차량이 밀고 간 띠
      const swaths = [];
      for (const tr of MAP.vehicleTracks || []) {
        if (tr.points.some(([x, z]) => x > f.x0 - 10 && x < f.x1 + 10 && z > f.z0 - 10 && z < f.z1 + 10)) {
          swaths.push({ points: tr.points, half: Math.max(S.swathHalf, tr.gauge / 2 + 0.8) });
        }
      }
      for (const sw of f.swaths || []) swaths.push({ points: sw.points, half: sw.half ?? S.swathHalf });
      // 선분별 경계 상자 (먼 포기는 거리 계산을 건너뛴다)
      for (const sw of swaths) {
        const e = sw.half + S.swathEdge + 0.5;
        sw.boxes = [];
        for (let i = 0; i < sw.points.length - 1; i++) {
          const [ax, az] = sw.points[i];
          const [bx, bz] = sw.points[i + 1];
          sw.boxes.push(Math.min(ax, bx) - e, Math.max(ax, bx) + e, Math.min(az, bz) - e, Math.max(az, bz) + e);
        }
      }
      const craters = t.craters.filter((c) => c.x > f.x0 - 12 && c.x < f.x1 + 12 && c.z > f.z0 - 12 && c.z < f.z1 + 12);
      const E = S.edgeNoise;
      const GN = S.gapNoise;
      for (let k = Math.floor(sMin); k <= Math.ceil(sMax); k++) {
        const off = (k + 0.5) * spacing;
        let tt = tMin + rng.next() * S.plantSpacing[1];
        while (tt < tMax) {
          tt += rng.range(S.plantSpacing[0], S.plantSpacing[1]);
          const across = rng.range(-0.035, 0.035);
          const x = px * (off + across) + dirX * tt;
          const z = pz * (off + across) + dirZ * tt;
          if (x < f.x0 - 8 || x > f.x1 + 8 || z < f.z0 - 8 || z > f.z1 + 8) continue;
          // 지형이 칠한 밭 구획 안 (가장자리 노이즈 포함). 밖은 머리땅에 드문드문 남은 줄기만
          const inRect = Math.min(x - f.x0, f.x1 - x, z - f.z0, f.z1 - z);
          const inParcel = P ? t.parcelAt(x, z) === P.index : inRect >= 0;
          // 가장자리 노이즈 -1..1: 낮은 곳은 경계가 안쪽으로 파고들어 비고(bite), 빽빽해지는 폭도 곳마다 다르다
          //  (노이즈 값은 대략 ±0.5 → 그 폭을 -1..1 로)
          const eN = clamp((nz.noise(x / E.size + 41.3, z / E.size - 17.2) * E.amp + nz.noise(x / E.detailSize - 8.1, z / E.detailSize + 3.7) * E.detailAmp) / (0.5 * (E.amp + E.detailAmp)), -1, 1);
          const bite = Math.max(0, -eN) * S.edgeBite;
          let edgeK = 0;
          if (!inParcel) {
            const out = Math.max(0, -inRect);
            if (out > S.straggle.dist) continue;
            if (rng.next() > S.straggle.chance * (1 - out / S.straggle.dist) ** 1.5 * (1 - (0.7 * bite) / Math.max(1e-3, S.edgeBite))) continue;
            const pk = t.parcelAt(x, z);
            if (pk && (!P || pk !== P.index) && t.parcels[pk].kind !== 'stubble') continue;
            if (NO_GRASS[t.surfaceAt(x, z)]) continue;
          } else {
            // 경계(구획 노이즈 1.5m 바깥부터)에서 edgeMin 밀도로 시작해 폭 edgeWidth × (1 ± edgeVar) 에 걸쳐 빽빽해짐.
            // 파고든 곳(bite) 안은 edgeMin 에서 0 으로 줄어든다 → 밭 끝이 일직선으로 끊기지 않고 성기게 풀어진다
            const w = S.edgeWidth * (1 + S.edgeVar * eN);
            const r = (inRect + 1.5 - bite) / w;
            if (r < 0) {
              if (rng.next() > S.edgeMin * clamp(1 + (r * w) / 2.5, 0, 1)) continue;
            } else {
              edgeK = smoothstep(0, 1, r);
              if (rng.next() > S.edgeMin + (1 - S.edgeMin) * edgeK) continue;
            }
          }
          const keepR = rng.next();
          // 비어 있는 구간
          const gn = nz.noise(x / GN.size + 71.3, z / GN.size - 18.9) + 0.45 * nz.noise(x / GN.detail - 5.1, z / GN.detail + 9.7);
          if (gn < GN.threshold && rng.next() > smoothstep(GN.threshold - GN.soft, GN.threshold, gn)) continue;
          if (rng.next() < S.missingChance) continue;
          let tilt = rng.next() * S.tilt;
          let fdx = rng.next() - 0.5;
          let fdz = rng.next() - 0.5;
          // 구역마다 한쪽으로 함께 기운 줄기 (차량 띠·구덩이 둘레는 아래에서 덮어씀)
          const lpn = nz.noise(x / LP.size + 33.3, z / LP.size - 61.7);
          if (lpn > LP.threshold) {
            const la = nz.noise(x / LP.dirSize - 5.5, z / LP.dirSize + 12.2) * Math.PI * 2;
            tilt = Math.max(tilt, LP.max * smoothstep(LP.threshold, LP.threshold + 0.3, lpn) * rng.range(0.75, 1.1));
            fdx = Math.cos(la) + rng.range(-0.3, 0.3);
            fdz = Math.sin(la) + rng.range(-0.3, 0.3);
          }
          let headless = rng.next() < S.headlessChance;
          // 구역마다 다른 키 (큰 얼룩 + 작은 얼룩) → 윗선이 높낮이를 갖는다. 가장자리는 조금 작다
          const patchMul = 1 + HP.amp * nz.noise(x / HP.size - 13.7, z / HP.size + 27.1) + HP.detailAmp * nz.noise(x / HP.detailSize + 6.1, z / HP.detailSize - 2.3);
          let hMul = S.edgeHeight + (1 - S.edgeHeight) * edgeK;
          let skip = false;
          // 차량이 밀고 간 띠: 진행 방향으로 납작하게 쓰러짐, 띠 가장자리는 바깥으로 기울어짐
          for (const sw of swaths) {
            const bx = sw.boxes;
            let near = false;
            for (let i = 0; i < bx.length; i += 4) if (x > bx[i] && x < bx[i + 1] && z > bx[i + 2] && z < bx[i + 3]) near = true;
            if (!near) continue;
            const d = polylineDistance(sw.points, x, z, _poly);
            if (d > sw.half + S.swathEdge) continue;
            const a = sw.points[_poly.index];
            const b = sw.points[_poly.index + 1];
            if (d < sw.half) {
              if (rng.next() < S.swathMissing) {
                skip = true;
                break;
              }
              const fwd = rng.next() < 0.8 ? 1 : -1;
              const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + rng.range(-0.45, 0.45);
              fdx = Math.cos(ang) * fwd;
              fdz = Math.sin(ang) * fwd;
              tilt = rng.range(1.32, 1.53);
              headless = headless || rng.next() < 0.3;
            } else {
              const sgn = _poly.side >= 0 ? 1 : -1;
              fdx = _poly.nx * sgn + rng.range(-0.3, 0.3);
              fdz = _poly.nz * sgn + rng.range(-0.3, 0.3);
              tilt = Math.max(tilt, rng.range(0.25, 0.9) * (1 - (d - sw.half) / S.swathEdge));
            }
          }
          if (skip) continue;
          // 포탄 구덩이 둘레: 안은 비고, 둘레는 바깥으로 꺾이고 쓰러짐
          for (const c of craters) {
            const dx = x - c.x;
            const dz = z - c.z;
            const r = Math.hypot(dx, dz);
            if (r > c.r * S.craterFall) continue;
            if (r < c.r * S.craterClear) {
              skip = true;
              break;
            }
            const fk = (r / c.r - S.craterClear) / (S.craterFall - S.craterClear);
            fdx = dx / r;
            fdz = dz / r;
            if (rng.next() < (1 - fk) * 0.85) {
              tilt = Math.max(tilt, rng.range(0.9, 1.5) * (1 - 0.4 * fk));
              headless = headless || rng.next() < 0.4;
              hMul *= rng.range(0.6, 1);
            } else tilt = Math.max(tilt, rng.range(0.1, 0.45));
          }
          if (skip) continue;
          if (tilt < 0.5) {
            const roll = rng.next();
            if (roll < S.fallenChance) tilt = rng.range(1.2, 1.5);
            else if (roll < S.fallenChance + S.leanChance) tilt = rng.range(S.leanAngle[0], S.leanAngle[1]);
          }
          const h = clamp(rng.range(S.height[0], S.height[1]) * patchMul, HP.clamp[0], HP.clamp[1]) * hMul;
          const ws = rng.range(S.widthScale[0], S.widthScale[1]);
          const bearing = ((S.headBearingDeg[0] + rng.range(-1, 1) * S.headBearingDeg[1]) * Math.PI) / 180;
          const yaw = Math.PI / 2 - bearing;
          const fallen = tilt > 1.0;
          if (fallen) fallenN++;
          const y = t.heightAt(x, z) - (fallen ? -0.02 : 0.05);
          const m = plantMatrix(x, y, z, yaw, tilt, fdx, fdz, ws, h / SH.height, ws * rng.range(0.9, 1.1));
          const b = rng.range(S.tint[0], S.tint[1]) * (fallen ? 1.08 : 1);
          const variant = headless ? 3 : Math.floor(rng.next() * 3);
          const info = (headless ? 1 : 0) + (rng.next() < S.thirdLeafChance ? 0 : 2) + variant * 4;
          store.push(x, z, keepR, m, b, b * 0.97, b * 0.94, info);
          // 은폐 볼륨·원거리 띠용: 선 줄기 수
          if (tilt < 0.7) {
            const ck = `${Math.floor(x / conceal.cell)}_${Math.floor(z / conceal.cell)}`;
            cTmp.count.set(ck, (cTmp.count.get(ck) || 0) + 1);
            const bk = (Math.floor(x / BC.cell) + 4096) * 8192 + (Math.floor(z / BC.cell) + 4096);
            let e = band.get(bk);
            if (!e) band.set(bk, (e = { n: 0, x: 0, z: 0, y: 0, h: 0, b: 0 }));
            e.n++;
            e.x += x;
            e.z += z;
            e.y += y;
            e.h += h * Math.cos(tilt);
            e.b += b;
          }
        }
      }
    }
    store.pack();
    this.sunCells = store.cells;
    this.sunBounds = bounds;
    this.stats.sunflowers = store.total;
    this.stats.sunflowerFallen = fallenN;
    if (!store.total) return;
    // 빌보드 정적 버퍼: 시작 위치(수로)에서 가까운 칸부터 → 앞에서 뒤로 그려 깊이 검사로 겹침 비용을 줄인다
    const sp = MAP.playerSpawn;
    this.sunCellsByRef = [...store.cells].sort((a, b) => Math.hypot(a.cx - sp.x, a.cz - sp.z) - Math.hypot(b.cx - sp.x, b.cz - sp.z));
    const C = CONFIG.vegetation.sunflower;
    const nearMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    patchSunflower3D(nearMat);
    this.sunNear = makeInstanced(sunflowerGeometry(), nearMat, Math.min(store.total, C.lod.nearCapacity), true);
    this.sunNear.name = 'sunflowerNear';
    this.sunNear.frustumCulled = true;
    this.sunNear.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const cardMat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(C.cardShade),
      map: sunflowerCardTexture(SH, { cardW: CARD.w, cardH: CARD.h, bottom: CARD.bottom, variants: CARD.variants }),
      alphaTest: 0.5,
      // 알파 → 표본 덮개는 MSAA 문맥에서만 (없으면 셰이더가 그냥 문턱으로)
      alphaToCoverage: !!CONFIG.render.antialias,
      side: THREE.DoubleSide,
    });
    patchSunflowerCard(cardMat);
    // 밭을 4등분해 따로 그린다 (보이지 않는 쪽은 절두체 컬링)
    const mx = (bounds.x0 + bounds.x1) / 2;
    const mz = (bounds.z0 + bounds.z1) / 2;
    const parts = [[], [], [], []];
    for (const c of this.sunCellsByRef) parts[(c.cx > mx ? 1 : 0) + (c.cz > mz ? 2 : 0)].push(c);
    this.sunCards = [];
    this.root.add(this.sunNear);
    for (const cells of parts) {
      const n = cells.reduce((a, c) => a + c.n, 0);
      if (!n) continue;
      const mesh = makeInstanced(sunflowerCardGeometry(), cardMat, n, true);
      mesh.name = 'sunflowerCards';
      mesh.userData.cells = cells;
      this.sunCards.push(mesh);
      this.root.add(mesh);
    }
    this.buildSunflowerBand(band, bounds);
    this.buildSunflowerConcealers(cTmp.count);
  }

  // 원거리 밭 띠: 선 줄기가 있는 칸마다 카드 1장 (칸 중심 = 줄기 평균 위치, 키 = 평균 키, 색 = 평균 밝기). 정적 버퍼, 드로우콜 1개
  buildSunflowerBand(cells, bounds) {
    const S = CONFIG.vegetation.sunflower;
    const B = S.band;
    const meanH = (S.height[0] + S.height[1]) / 2;
    const sp = MAP.playerSpawn;
    const list = [...cells.values()].filter((e) => e.n > 0);
    // 시작 위치(수로)에서 가까운 칸부터 (앞에서 뒤로 그려 겹침 비용을 줄임)
    for (const e of list) {
      e.x /= e.n;
      e.z /= e.n;
      e.d = Math.hypot(e.x - sp.x, e.z - sp.z);
    }
    list.sort((a, b) => a.d - b.d);
    this.stats.sunflowerBand = list.length;
    if (!list.length) return;
    // 카드: 폭 tileW, 높이 tileH (아래 끝 = 지면 아래 CARD.bottom), 앞면 +z (셰이더가 카메라 쪽으로 돌린다)
    const gb = new GeoBuilder();
    const W = B.tileW / 2;
    const y0 = -CARD.bottom;
    const y1 = B.tileH - CARD.bottom;
    const n0 = new THREE.Vector3(0, 0.32, 1);
    const a = gb.v(new THREE.Vector3(-W, y0, 0), n0, null, 0, [0, 0]);
    const b = gb.v(new THREE.Vector3(W, y0, 0), n0, null, 0, [1, 0]);
    const c = gb.v(new THREE.Vector3(W, y1, 0), n0, null, 0, [1, 1]);
    const d = gb.v(new THREE.Vector3(-W, y1, 0), n0, null, 0, [0, 1]);
    gb.tri(a, b, c);
    gb.tri(a, c, d);
    const geo = gb.build({ uv: true });
    const aBand = new Float32Array(list.length * 2);
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(S.cardShade * B.shade),
      map: sunflowerBandTexture(
        SUNFLOWER_SHAPE,
        { cardW: CARD.w, cardH: CARD.h, bottom: CARD.bottom, variants: CARD.variants },
        { tile: B.tilePx, w: B.tileW, h: B.tileH, bottom: CARD.bottom, counts: B.counts, spread: B.spread, height: S.height },
      ),
      alphaTest: 0.5,
      alphaToCoverage: !!CONFIG.render.antialias,
    });
    patchSunflowerBand(mat);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const col = new THREE.Color();
    const rng = new Random(CONFIG.world.seed + 313);
    list.forEach((e, i) => {
      _m4.makeTranslation(e.x, e.y / e.n, e.z);
      mesh.setMatrixAt(i, _m4);
      const k = e.b / e.n;
      mesh.setColorAt(i, col.setRGB(k, k * 0.97, k * 0.94));
      aBand[i * 2] = (e.h / e.n / meanH) * (1 + B.heightJitter * rng.range(-1, 1));
      aBand[i * 2 + 1] = e.n;
    });
    geo.setAttribute('aBand', new THREE.InstancedBufferAttribute(aBand, 2));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((bounds.x0 + bounds.x1) / 2, this.terrain.heightAt((bounds.x0 + bounds.x1) / 2, (bounds.z0 + bounds.z1) / 2) + 1, (bounds.z0 + bounds.z1) / 2),
      Math.hypot(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 + 15,
    );
    mesh.name = 'sunflowerBand';
    this.sunBand = mesh;
    this.root.add(mesh);
  }

  // 선 줄기가 충분히 빽빽한 칸만 은폐 볼륨 (같은 줄 이웃 칸은 띠로 합침) — 빈 구간·쓰러진 띠·구덩이 둘레는 은폐가 없다
  buildSunflowerConcealers(counts) {
    const S = CONFIG.vegetation.sunflower;
    const K = S.conceal;
    const t = this.terrain;
    const full = (K.cell * K.cell) / (0.7 * 0.5 * (S.plantSpacing[0] + S.plantSpacing[1]));
    const rows = new Map();
    for (const [key, n] of counts) {
      if (n / full < K.minFill) continue;
      const [i, j] = key.split('_').map(Number);
      if (!rows.has(j)) rows.set(j, []);
      rows.get(j).push(i);
    }
    let made = 0;
    for (const [j, list] of rows) {
      list.sort((a, b) => a - b);
      let s = 0;
      while (s < list.length) {
        let e = s;
        while (e + 1 < list.length && list[e + 1] === list[e] + 1 && (list[e + 1] - list[s] + 1) * K.cell <= K.maxStrip) e++;
        const x0 = list[s] * K.cell;
        const x1 = (list[e] + 1) * K.cell;
        const cx = (x0 + x1) / 2;
        const cz = (j + 0.5) * K.cell;
        let hs = 0;
        let hn = 0;
        for (let x = x0 + 1; x < x1; x += 4) {
          for (const dz of [-K.cell * 0.3, 0, K.cell * 0.3]) {
            hs += t.heightAt(x, cz + dz);
            hn++;
          }
        }
        const y = hs / hn;
        this.col.addConcealer(cx, y + K.height / 2 - 0.1, cz, (x1 - x0) / 2, K.height / 2, K.cell / 2, 0, 'sunflower');
        made++;
        s = e + 1;
      }
    }
    this.stats.sunflowerConcealers = made;
  }

  // ------------------------------------------------------------------ 마른 풀
  buildGrass() {
    const G = CONFIG.vegetation.grass;
    const t = this.terrain;
    const nz = t.noise;
    const rng = new Random(CONFIG.world.seed + 331);
    const PA = CONFIG.world.playArea;
    const half = t.half;
    // 플레이어가 갈 수 있는 구역에서 보이는 거리 안만 만든다
    const reach = G.lod.far * 1.25 + 15;
    const x0 = Math.max(-half + 0.5, PA.minX - reach);
    const x1 = Math.min(half - 0.5, PA.maxX + reach);
    const z0 = Math.max(-half + 0.5, PA.minZ - reach);
    const z1 = Math.min(half - 0.5, PA.maxZ + reach);
    const store = new CellStore(G.lod.cell, false);
    const cStraw = new THREE.Color(G.straw);
    const cGG = new THREE.Color(G.greyGreen);
    const g = {};
    const pads = t.vehiclePads.map((p) => ({ ...p, r: Math.hypot(p.hx, p.hz) + G.padMargin + 0.5 }));
    const lines = MAP.trench.lines.map((line) => {
      let bx0 = Infinity;
      let bx1 = -Infinity;
      let bz0 = Infinity;
      let bz1 = -Infinity;
      for (const [x, z] of line) {
        bx0 = Math.min(bx0, x);
        bx1 = Math.max(bx1, x);
        bz0 = Math.min(bz0, z);
        bz1 = Math.max(bz1, z);
      }
      const e = G.lowNearLines.trench;
      return { line, x0: bx0 - e, x1: bx1 + e, z0: bz0 - e, z1: bz1 + e };
    });
    const fCraters = t.craters.filter((c) => c.tag);
    const K = G.conceal;
    const concealCells = new Map();
    const cl = G.clump;
    let count = 0;
    for (let z = Math.floor(z0); z < z1; z++) {
      for (let x = Math.floor(x0); x < x1; x++) {
        const cx = x + 0.5;
        const cz = z + 0.5;
        if (NO_GRASS[t.surfaceAt(cx, cz)]) continue;
        t.groundAt(cx, cz, g);
        const field = g.plowed;
        const base = smoothstep(0.15, 0.8, g.grass) + g.stubble * G.stubbleDensity + field * G.weedDensity;
        if (base < 0.01) continue;
        let cn = cl.amps[0] * nz.noise(cx / cl.sizes[0] + 13.1, cz / cl.sizes[0] - 7.7) + cl.amps[1] * nz.noise(cx / cl.sizes[1] - 3.3, cz / cl.sizes[1] + 21.4);
        if (cn + cl.amps[2] <= cl.lo) continue;
        cn += cl.amps[2] * nz.noise(cx / cl.sizes[2] + 9.9, cz / cl.sizes[2] + 4.2);
        const clump = smoothstep(cl.lo, cl.hi, cn);
        if (clump <= 0) continue;
        let dens = G.density * Math.min(1.2, base) * clump;
        let maxH = G.height[1];
        // 수로 북쪽: 둔덕·사격 홈에서 앞이 트이게 낮고 드문 풀만
        const dn = t.canalZ(cx) - cz;
        if (dn > -3 && dn < G.canalClear[1]) {
          const k = smoothstep(G.canalClear[0], G.canalClear[1], dn);
          maxH = lerp(G.canalMaxH, maxH, k);
          dens *= lerp(G.canalDensity, 1, k);
        }
        for (const L of lines) {
          if (cx < L.x0 || cx > L.x1 || cz < L.z0 || cz > L.z1) continue;
          if (polylineDistance(L.line, cx, cz) < G.lowNearLines.trench) maxH = Math.min(maxH, G.lowNearLines.maxH);
        }
        for (const c of fCraters) if (Math.hypot(cx - c.x, cz - c.z) < c.r + G.lowNearLines.crater) maxH = Math.min(maxH, G.lowNearLines.maxH);
        const n = Math.floor(dens + rng.next());
        for (let i = 0; i < n; i++) {
          const px = x + rng.next();
          const pz = z + rng.next();
          if (NO_GRASS[t.surfaceAt(px, pz)]) continue;
          let onPad = false;
          for (const p of pads) {
            const dx = px - p.x;
            const dz = pz - p.z;
            if (Math.abs(dx) > p.r || Math.abs(dz) > p.r) continue;
            const lx = dx * p.c - dz * p.s;
            const lz = dx * p.s + dz * p.c;
            if (Math.abs(lx) < p.hx + G.padMargin && Math.abs(lz) < p.hz + G.padMargin) onPad = true;
          }
          if (onPad) continue;
          let h;
          if (field > 0.5) h = rng.range(G.weedHeight[0], G.weedHeight[1]);
          else {
            const hn = smoothstep(-0.35, 0.55, nz.noise(px / G.heightNoise - 4.4, pz / G.heightNoise + 8.8));
            h = lerp(G.height[0], G.height[1], hn * (0.55 + 0.45 * clump)) * rng.range(0.82, 1.15);
          }
          h = clamp(h, 0.08, maxH * rng.range(0.82, 1));
          const w = h * rng.range(G.widthMul[0], G.widthMul[1]);
          const m = plantMatrix(px, t.heightAt(px, pz) - 0.03, pz, rng.next() * Math.PI * 2, rng.next() * 0.14, rng.next() - 0.5, rng.next() - 0.5, w, h, w * rng.range(0.8, 1.2));
          const gg = rng.next() < clamp(G.greyGreenShare + 0.4 * nz.noise(px / 9 + 50.5, pz / 9 - 50.5), 0, 1);
          const c = gg ? cGG : cStraw;
          const b = rng.range(G.brightness[0], G.brightness[1]);
          store.push(px, pz, rng.next(), m, c.r * b, c.g * b, c.b * b);
          count++;
          // 은폐 볼륨용 (플레이어가 갈 수 있는 구역 근처의 키 큰 포기)
          const dc = t.canalZ(px) - pz;
          if (h >= K.minHeight && px > PA.minX - 20 && px < PA.maxX + 20 && pz > PA.minZ - 20 && pz < PA.maxZ + 20 && (dc < -6 || dc > K.canalClear)) {
            const ck = `${Math.floor(px / K.cell)}_${Math.floor(pz / K.cell)}`;
            const e = concealCells.get(ck) || { n: 0, hs: 0, ys: 0 };
            e.n++;
            e.hs += h;
            e.ys += t.heightAt(px, pz);
            concealCells.set(ck, e);
          }
        }
      }
    }
    store.pack();
    this.grassCells = store.cells;
    this.stats.grass = store.total;
    if (!count) return;
    // 용량: 맵 위 여러 위치에서 고를 수 있는 최대 포기 수 (+여유)
    const GL = G.lod;
    const R = GL.far * 1.25 + GL.cell * 0.7072 + GL.refreshMove;
    let cap = 0;
    for (let z = z0; z <= z1; z += GL.cell) {
      for (let x = x0; x <= x1; x += GL.cell) {
        let s = 0;
        for (const c of store.cells) if (Math.hypot(c.cx - x, c.cz - z) <= R) s += c.n;
        cap = Math.max(cap, s);
      }
    }
    cap = Math.min(store.total, Math.ceil(cap * 1.1) + 64);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: grassTuftTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    patchCards(mat, { amp: G.wind, lod: true, key: 'vegGrass' });
    this.grassMesh = makeInstanced(crossCardGeometry(3, true), mat, cap, false);
    this.grassMesh.name = 'grass';
    this.grassMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.stats.grassCapacity = cap;
    this.root.add(this.grassMesh);
    this.buildGrassConcealers(concealCells);
  }

  // 키 큰 풀이 빽빽한 칸만 낮은 은폐 볼륨 (엎드린 사람을 가리는 높이), 같은 줄 이웃 칸은 띠로 합침
  buildGrassConcealers(cells) {
    const K = CONFIG.vegetation.grass.conceal;
    const rows = new Map();
    for (const [key, e] of cells) {
      if (e.n < K.minCount) continue;
      const [i, j] = key.split('_').map(Number);
      if (!rows.has(j)) rows.set(j, []);
      rows.get(j).push({ i, e });
    }
    let made = 0;
    for (const [j, list] of rows) {
      list.sort((a, b) => a.i - b.i);
      let s = 0;
      while (s < list.length) {
        let e = s;
        while (e + 1 < list.length && list[e + 1].i === list[e].i + 1 && (list[e + 1].i - list[s].i + 1) * K.cell <= K.maxStrip) e++;
        let n = 0;
        let hs = 0;
        let ys = 0;
        for (let k = s; k <= e; k++) {
          n += list[k].e.n;
          hs += list[k].e.hs;
          ys += list[k].e.ys;
        }
        const h = hs / n;
        const x0 = list[s].i * K.cell;
        const x1 = (list[e].i + 1) * K.cell;
        this.col.addConcealer((x0 + x1) / 2, ys / n + h * 0.45, (j + 0.5) * K.cell, (x1 - x0) / 2, h * 0.5, K.cell / 2, 0, 'grass');
        made++;
        s = e + 1;
      }
    }
    this.stats.grassConcealers = made;
  }

  // ------------------------------------------------------------------ 갈대 (수로 바닥 물가)
  buildReeds() {
    const R = CONFIG.vegetation.reeds;
    const C = MAP.canal;
    const t = this.terrain;
    const rng = new Random(CONFIG.world.seed + 347);
    const list = [];
    const base = new THREE.Color(R.color);
    for (const clump of C.reeds || []) {
      const a = clump.x - clump.len / 2;
      const b = clump.x + clump.len / 2;
      let ys = 0;
      let yn = 0;
      for (let x = a - 0.6; x <= b + 0.6; x += R.spacing * rng.range(0.7, 1.3)) {
        // 군락 끝은 듬성듬성 (일직선으로 끊기지 않게)
        const e = Math.min(x - a, b - x) / Math.max(0.5, clump.len * 0.5);
        if (rng.next() > smoothstep(-0.25, 0.4, e)) continue;
        const rows = rng.next() < 0.6 ? 2 : 1;
        for (let r = 0; r < rows; r++) {
          const d = rng.range(R.band[0], R.band[1]);
          const z = t.canalZ(x) + clump.side * d;
          const px = x + rng.range(-0.12, 0.12);
          const h = rng.range(R.height[0], R.height[1]) * (0.8 + 0.2 * smoothstep(-0.2, 0.5, e));
          const w = rng.range(R.width[0], R.width[1]);
          const y = t.heightAt(px, z) - 0.06;
          ys += y;
          yn++;
          const m = plantMatrix(px, y, z, rng.next() * Math.PI, rng.next() * 0.12, rng.next() - 0.5, -clump.side * 0.3, w, h, w);
          const k = rng.range(R.brightness[0], R.brightness[1]);
          list.push({ m: m.slice(), r: base.r * k, g: base.g * k, b: base.b * k });
        }
      }
      // 은폐만: 군락을 덮는 상자 (탄 통과, 시야만 가림)
      if (yn) {
        const zc = t.canalZ(clump.x) + clump.side * (R.band[0] + R.band[1]) * 0.5;
        const hh = R.height[1] * 0.5;
        this.col.addConcealer(clump.x, ys / yn + hh, zc, clump.len / 2 + 0.3, hh, (R.band[1] - R.band[0]) * 0.5 + 0.15, 0, 'grass');
      }
    }
    this.stats.reeds = list.length;
    if (!list.length) return;
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: reedTexture(), alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    patchCards(mat, { amp: R.wind, lod: false, key: 'vegReed' });
    const mesh = new THREE.InstancedMesh(crossCardGeometry(2, false), mat, list.length);
    const col = new THREE.Color();
    list.forEach((it, i) => {
      mesh.instanceMatrix.array.set(it.m, i * 16);
      mesh.setColorAt(i, col.setRGB(it.r, it.g, it.b));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = 'reeds';
    this.root.add(mesh);
  }
}

// =============================================================================
// 지형 셰이더 조각 — MeshStandardMaterial.onBeforeCompile 로 끼워 넣는다.
// 조명·그림자·안개·톤매핑은 Three.js 표준 경로(lights/fog 청크)를 그대로 쓰고, 여기서는
//  1) 혼합 마스크(0.5m)에서 재질 비율·길/궤도 거리장·밭 구획을 읽고
//  2) 비율이 가장 큰 두 재질만 텍스처(배열 텍스처 층)를 읽어 높이 기반으로 섞고
//     (가까운 곳만 반복 깨기 두 번째 샘플·근거리 디테일, 픽셀당 텍스처 읽기 수를 묶어 둔다.
//      밭 재질은 고랑마다 고랑 방향 좌표를 엇갈려 타일 반복이 고랑을 가로지르는 바둑판 무늬로 줄지어 보이지 않게 한다)
//  3) 밭 고랑은 해석적 노멀·어둡기(화면에서 가늘어지면 평균으로 흐림)로 그리고
//  4) 큰 규모 색 변화·물(고랑에 고인 물, 진흙 물기)의 하늘 반사를 더한다.
// 변형: T_FAR = 원거리 LOD (노멀맵·디테일·반복 깨기 없음, 텍스처 읽기 5~6회),
//       T_RIDGE = 근거리 고랑 실제 형상(얕은 골판 메시). 정점에서 화면 간격에 맞춰 높이를 줄인다.
// 결과: 알베도(diffuseColor 에 곱함), 월드 법선, 거칠기, 하늘 반사(자체 발광으로 더함).
// =============================================================================
import { CONFIG } from '../config.js';

export const ROAD_RANGE = 8; // 마스크에 저장하는 길 중심 거리 범위 (m)
export const TRACK_RANGE = 4; // 가장 가까운 궤도 자국 띠 중심까지 거리 범위 (m)
export const MAX_PARCELS = 16; // 밭 구획 수 상한 (0 = 구획 없음)
export const MAX_TRACK_SEGS = 16; // 궤도 자국 선분 수 상한 (궤도판 무늬 방향용)

const f = (v) => {
  const s = Number(v).toFixed(5);
  return s.includes('.') ? s : s + '.0';
};
const farr = (a) => `float[${a.length}](${a.map(f).join(', ')})`;

// variant: 'near' | 'far' | 'ridge'
export function terrainShaderParts({ maskN, half, variant = 'near' }) {
  const G = CONFIG.ground;
  const T = CONFIG.terrain;
  const R = T.road;
  const RG = T.furrow.ridge;
  const defines = `
${variant === 'far' ? '#define T_FAR' : ''}
${variant === 'ridge' ? '#define T_RIDGE' : ''}
#define T_MASK_N ${maskN}
#define T_HALF ${f(half)}
#define T_ROAD_RANGE ${f(ROAD_RANGE)}
#define T_TRACK_RANGE ${f(TRACK_RANGE)}
#define T_RUT_OFF ${f(R.rutOffset)}
#define T_RUT_IN ${f(R.rutFlat * 0.7)}
#define T_RUT_OUT ${f(R.rutFlat + R.rutWall * 0.55)}
#define T_TB_IN ${f(T.tracks.bandHalf * 0.55)}
#define T_TB_OUT ${f(T.tracks.bandHalf)}
#define T_DETAIL_TILE ${f(G.detailTile)}
#define T_DETAIL_F0 ${f(G.detailFade[0])}
#define T_DETAIL_F1 ${f(G.detailFade[1])}
#define T_DETAIL_STR ${f(G.detailStrength)}
#define T_ANTI_TILE ${f(G.antiTileScale)}
#define T_ANTI_DIST ${f(G.antiTileDistance)}
#define T_MAC_A ${f(G.macroSizes[0])}
#define T_MAC_B ${f(G.macroSizes[1])}
#define T_MAC_FAR ${f(G.macroSizes[2])}
#define T_MAC_SA ${f(G.macroStrength[0])}
#define T_MAC_SB ${f(G.macroStrength[1])}
#define T_HB ${f(G.heightBlend)}
#define T_WATER_F ${f(G.waterInFurrows)}
#define T_FURROW_REF ${f(T.furrow.depth)}
#define T_MAX_PARCELS ${MAX_PARCELS}
#define T_STEEP0 ${f(G.steepBlend[0])}
#define T_STEEP1 ${f(G.steepBlend[1])}
#define T_ROUGH_MIN ${f(G.roughnessMin)}
#define T_WATER_ROUGH ${f(G.waterRoughness)}
#define T_SUN_SPEC ${f(G.sunSpecular)}
#define T_SPEC_CAP ${f(G.sunSpecularCap)}
#define T_WATER_SPEC ${f(G.waterSunSpecular)}
#define T_WATER_REFL ${f(G.waterReflect)}
#define T_TRACK_TREAD ${f(T.tracks.treadPitch)}
#define T_TRACK_TREAD_STR ${f(T.tracks.treadStrength)}
#define T_TRACK_TREAD_JIT ${f(T.tracks.treadJitter)}
#define T_TRACK_TREAD_SHADE ${f(T.tracks.treadShade)}
#define T_TRACK_MUD ${f(T.tracks.mud)}
#define T_TRACK_ALB ${f(T.tracks.albedo)}
#define T_TRACK_SHEEN ${f(T.tracks.sheen)}
#define T_TRACK_WATER ${f(T.tracks.water)}
#define T_TRACK_ROUGH ${f(T.tracks.roughness)}
#define T_TRACK_SPEC ${f(T.tracks.sunSpecular)}
#define T_NTRACK ${MAX_TRACK_SEGS}
#define T_FIELD_ANTI_ROT ${f((G.fieldAntiTileRotDeg * Math.PI) / 180)}
`;

  // ---------------------------------------------------------------- 정점
  const vertPars = `${defines}
varying vec3 vTWPos;
varying vec3 vTWNrm;
varying float vTDist;
#ifdef T_RIDGE
// x: 고랑 바닥 위로 솟는 높이(m, 전체 진폭) y: 정점색 배수(바닥 어둡게·마루 밝게) zw: 비탈 기울기 (월드 xz)
attribute vec4 aRidge;
// 고랑 위상 기울기 = 고랑 가로 방향 / 간격 (월드 xz, 1m 당 고랑 수)
attribute vec2 aRidgeG;
uniform float uHalfH; // 화면 높이의 절반 (px) — 초점 거리(px) = projectionMatrix[1][1] * uHalfH
varying float vTRFade;
#endif
`;
  // 고랑 형상은 화면에서 고랑 간격이 2~4px 아래로 좁아지면(낮은 시선의 먼 곳) 바닥 높이로 눌러 모아레를 막는다
  const vertNormal = `
#ifdef T_RIDGE
float tRFade;
{
  vec3 wq = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 tv = wq - cameraPosition;
  float d = max(length(tv.xz), 0.3);
  vec2 fw = tv.xz / d;
  vec2 sd = vec2(-fw.y, fw.x);
  float hRel = max(cameraPosition.y - wq.y, 0.12);
  float fpx = projectionMatrix[1][1] * uHalfH;
  float ph = d / fpx * abs(dot(aRidgeG, sd));
  float pv = d * d / (hRel * fpx) * abs(dot(aRidgeG, fw));
  tRFade = (1.0 - smoothstep(${f(RG.fadePhase[0])}, ${f(RG.fadePhase[1])}, length(vec2(ph, pv))))
    * (1.0 - smoothstep(${f(RG.fadeDistance[0])}, ${f(RG.fadeDistance[1])}, d));
}
objectNormal = normalize(objectNormal - vec3(aRidge.z, 0.0, aRidge.w) * tRFade);
#endif
`;
  const vertBegin = `
#ifdef T_RIDGE
transformed.y += aRidge.x * tRFade;
vTRFade = tRFade;
#ifdef USE_COLOR
vColor *= mix(1.0, aRidge.y, tRFade);
#endif
#endif
vTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;
  const vertProject = `
vTDist = -mvPosition.z;
`;

  // ---------------------------------------------------------------- 픽셀
  const fragPars = `${defines}
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2DArray tGAlb;
uniform sampler2DArray tGAlbLo; // 같은 알베도의 낮은 이방성 사본 (두 번째 층)
uniform sampler2DArray tGNrm;
uniform sampler2D tMacro;
uniform vec4 uParcel[T_MAX_PARCELS];
uniform vec4 uTrackSeg[T_NTRACK]; // 궤도 자국 중심선 선분 (ax, az, bx, bz), 빈 칸은 멀리
uniform vec3 uSkyRefl;
varying vec3 vTWPos;
varying vec3 vTWNrm;
varying float vTDist;
#ifdef T_RIDGE
varying float vTRFade;
#endif

const float T_TILE[6] = ${farr(G.layerTile)};
const float T_ROUGH[6] = ${farr(G.roughness)};
const float T_SHEEN[6] = ${farr(G.wetSheen)};

float tHash(float n) {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

// 가파른 면(수로 비탈 위쪽·둔덕 앞면·사격 홈 벽·구덩이 벽)의 수직 투영: terrainSurface 가 픽셀마다 채운다.
// tVW = (수직 투영 몫, (x,y) 평면 몫, (z,y) 평면 몫, 0). 수평 투영(xz)만 쓰면 45° 넘는 면에서 텍스처가 세로로 늘어난다
vec3 tVP;
vec4 tVW;
vec2 tVS;
// 밭 재질의 고랑 방향 반복 엇갈림 (terrainSurface 가 픽셀마다 채운다): x = 흑토 층(0) 띠 폭, y = 그루터기 층(1) 띠 폭 (m, 0 = 엇갈리지 않음),
// z = 구획 난수. 고랑 방향 좌표를 띠(고랑 한 줄)마다 다른 양만큼 밀어, 텍스처 반복이 모든 고랑에서 같은 위상으로 줄지어
// 고랑을 가로지르는 가로 띠(바둑판 무늬)가 되지 않게 한다. 띠 경계는 고랑 바닥(어두운 선)이라 이음매가 묻힌다
vec3 tFB;

// 고랑 단면 (s = 고랑 간격 단위 좌표). 0 = 고랑 바닥, 1 안팎 = 이랑 마루.
// 쟁기가 흙을 한쪽으로 넘겨 약간 비대칭, 이랑마다 높이가 조금씩 다르다 (바닥에서 이어지게).
float tFurrow(float s) {
  float fr = fract(s);
  fr += 0.06 * sin(6.2831853 * fr);
  float c = 0.5 - 0.5 * cos(6.2831853 * fr);
  return pow(c, 0.7) * (0.82 + 0.32 * tHash(floor(s)));
}

// 재질 한 층 읽기. 밭 재질(0·1)은 고랑 방향 좌표, 나머지는 월드 좌표.
// anti > 0 이면 크기·회전이 다른 두 번째 샘플과 섞어 타일 반복을 깬다 (가까운 곳만).
// 반환 n.xy = 월드 x·z 기울기 성분(부호 있음), n.z = 높이(0..1), a.a = 거칠기 배수
// 텍스처는 암시적 미분(texture)으로 읽는다 (textureGrad 는 GPU·소프트웨어 렌더러에서 훨씬 느림).
// 분기 안에서 읽는 샘플은 분기 경계에서 섞는 몫이 0 이 되도록 짜여 있어 경계의 미분 오차가 보이지 않는다.
void tLayer(sampler2DArray tAlb, int li, float anti, vec2 wp, vec2 fperp, vec2 fdir, out vec4 a, out vec4 n) {
  bool fr = li < 2;
  vec2 uv = fr ? vec2(dot(wp, fperp), dot(wp, fdir)) : wp;
  float k = 1.0 / T_TILE[li];
  float l = float(li);
  if (fr) {
    // 고랑(띠)마다 고랑 방향 좌표를 엇갈리게 (tFB 설명 참고)
    float bw = li == 0 ? tFB.x : tFB.y;
    if (bw > 0.0) uv.y += tHash(floor(uv.x / bw) + tFB.z) * T_TILE[li];
  }
  a = vec4(0.0);
  n = vec4(0.0);
  if (anti < 0.996) {
    vec3 c1 = vec3(uv * k, l);
    a = texture(tAlb, c1);
#ifndef T_FAR
    n = texture(tGNrm, c1);
#endif
  }
#ifndef T_FAR
  if (anti > 0.004) {
    float k2 = k / T_ANTI_TILE;
    // 밭 재질은 흙덩이 결(고랑 방향)이 크게 돌지 않게 조금만 돌리고, 구획마다 다른 자리에서 읽는다
    mat2 rm = fr ? mat2(cos(T_FIELD_ANTI_ROT), sin(T_FIELD_ANTI_ROT), -sin(T_FIELD_ANTI_ROT), cos(T_FIELD_ANTI_ROT)) : mat2(0.8, 0.6, -0.6, 0.8);
    vec3 c2 = vec3(rm * uv * k2 + vec2(0.37, 0.71) + (fr ? vec2(0.29, 0.53) * tFB.z : vec2(0.0)), l);
    vec4 a2 = texture(tAlb, c2);
    vec4 n2 = texture(tGNrm, c2);
    n2.xy = transpose(rm) * (n2.xy * 2.0 - 1.0) * 0.5 + 0.5;
    a = mix(a, a2, anti);
    n = mix(n, n2, anti);
  }
  vec2 nxy = n.xy * 2.0 - 1.0;
  // 밭 재질의 탄젠트 공간(고랑 가로·세로) → 월드 x·z
  if (fr) nxy = nxy.x * fperp + nxy.y * fdir;
  n = vec4(nxy, n.b, 1.0);
  // 가파른 면: 수직 투영(바이플래너)과 섞는다. 노멀 x·y 는 terrainSurface 의 탄젠트 축(Tg·Bg)에 맞춘 좌표라 그대로 더한다
  // (Tg = 월드 X 를 면에 투영, Bg = Tg × N → (x,y) 평면은 v = -sign(N.z)·y, (z,y) 평면은 u = -sign(N.x)·y, v = z)
  if (tVW.x > 0.004) {
    vec4 av = vec4(0.0);
    vec4 nv = vec4(0.0);
    if (tVW.y > 0.02) {
      vec3 c = vec3(vec2(tVP.x, tVS.y * tVP.y) * k, l);
      av += texture(tAlb, c) * tVW.y;
      nv += texture(tGNrm, c) * tVW.y;
    }
    if (tVW.z > 0.02) {
      vec3 c = vec3(vec2(tVS.x * tVP.y, tVP.z) * k, l);
      av += texture(tAlb, c) * tVW.z;
      nv += texture(tGNrm, c) * tVW.z;
    }
    float ws = max(tVW.y + tVW.z, 1e-4);
    av /= ws;
    nv /= ws;
    a = mix(a, av, tVW.x);
    n = mix(n, vec4(nv.xy * 2.0 - 1.0, nv.b, 1.0), tVW.x);
  }
#else
  n = vec4(0.0, 0.0, 0.5, 1.0);
#endif
}

void terrainSurface(inout vec3 col, out vec3 nW, out float rough, out vec3 emis, out float specK) {
  vec3 P = vTWPos;
  vec3 Nb = normalize(vTWNrm);
  vec3 V = normalize(P - cameraPosition);
  float dist = vTDist;
  vec2 wp = P.xz;
  // 가파른 면의 수직 투영 몫 (tLayer·근거리 디테일이 쓴다)
  tVP = P;
  tVS = vec2(Nb.x >= 0.0 ? -1.0 : 1.0, Nb.z >= 0.0 ? -1.0 : 1.0);
#ifndef T_FAR
  {
    float wx = Nb.z * Nb.z;
    float wz = Nb.x * Nb.x;
    float ws = max(wx + wz, 1e-5);
    tVW = vec4(1.0 - smoothstep(T_STEEP1, T_STEEP0, Nb.y), wx / ws, wz / ws, 0.0);
  }
#else
  tVW = vec4(0.0);
#endif

  // ---- 혼합 마스크 (맵 밖은 큰 노이즈로 밭/풀밭 얼룩)
  vec2 suv = (wp + T_HALF) / (2.0 * T_HALF);
  vec2 suvC = clamp(suv, vec2(0.0), vec2(1.0));
  vec4 sA = texture(tSplatA, suvC);
  vec4 sB = texture(tSplatB, suvC);
  ivec2 ti = clamp(ivec2(suvC * float(T_MASK_N)), ivec2(0), ivec2(T_MASK_N - 1));
  int parcel = int(texelFetch(tSplatB, ti, 0).a * 255.0 + 0.5);
  // 큰 규모 색 변화 (r: 큰 얼룩, b: 중간 얼룩)
  vec4 macA = texture(tMacro, wp / T_MAC_A);
  if (suv != suvC) {
    float farM = texture(tMacro, wp / T_MAC_FAR).r;
    sA = vec4(smoothstep(0.56, 0.62, farM), (1.0 - smoothstep(0.38, 0.44, farM)) * 0.9, 0.0, 0.0);
    sB = vec4(0.0, 1.0, 1.0, 0.0);
    parcel = 0;
  }
  parcel = clamp(parcel, 0, T_MAX_PARCELS - 1);
  float wPl = sA.r;
  float wSt = sA.g;
  float wMud = sA.b;
  float wSub = sA.a;
  float wGrv = sB.r;
  float roadD = sB.g * T_ROAD_RANGE;
  float trackD = sB.b * T_TRACK_RANGE;

  // ---- 바퀴 자국·궤도 자국: 거리장에서 날카롭게, 화면에서 가늘어지면 평균으로
  float fwR = fwidth(roadD);
  float rut = (1.0 - smoothstep(T_RUT_IN, T_RUT_OUT + fwR, abs(roadD - T_RUT_OFF))) * mix(1.0, 0.45, smoothstep(0.2, 0.6, fwR));
  float fwT = fwidth(trackD);
  float band = (1.0 - smoothstep(T_TB_IN, T_TB_OUT + fwT, trackD)) * mix(1.0, 0.4, smoothstep(0.2, 0.6, fwT));
  float wetHollow = smoothstep(0.3, 0.6, wMud) * smoothstep(0.3, 0.6, wPl);
  wMud = max(wMud, rut * 0.95);
  wGrv *= 1.0 - rut * 0.9;
  wMud = max(wMud, band * T_TRACK_MUD);
  float wGr = max(0.0, 1.0 - wPl - wSt - wMud - wSub - wGrv);

  // ---- 밭 구획: 고랑 방향·간격·깊이 → 해석적 고랑 (노멀 + 어둡기). 화면에서 고랑이 1~2px 로 좁아지면 평균으로
  vec4 PP = uParcel[parcel];
  vec2 fdir = parcel > 0 ? PP.xy : vec2(0.0, 1.0);
  vec2 fperp = vec2(fdir.y, -fdir.x);
  float spacing = parcel > 0 ? PP.z : 1.0;
  float fDepth = (parcel > 0 ? PP.w : 0.0) * smoothstep(0.3, 0.75, wPl) * (1.0 - band) * (1.0 - rut);
  float s0 = dot(wp, fperp) / spacing;
  // 밭 재질 반복 엇갈림 띠: 고랑 진 밭(흑토·해바라기) = 고랑 한 줄 (경계 = 고랑 바닥), 그루터기 밭 = 그루터기 3줄 (경계 = 줄 사이,
  // 그루터기 텍스처는 한 장에 12줄), 그루터기 밭의 흑토 얼룩과 구획 밖은 엇갈리지 않는다
  tFB = parcel > 0 ? (PP.w > 0.0 ? vec3(spacing, spacing, float(parcel) * 17.31) : vec3(0.0, T_TILE[1] * 0.25, float(parcel) * 17.31)) : vec3(0.0);
  float aa = 1.0 - smoothstep(0.22, 0.6, fwidth(s0));
#ifdef T_RIDGE
  // 실제 고랑 형상이 있는 곳은 형상이 음영을 맡는다
  aa *= 1.0 - vTRFade;
#endif
  float prof = tFurrow(s0);
  float dprof = (tFurrow(s0 + 0.03) - tFurrow(s0 - 0.03)) / 0.06;
  vec2 fGrad = fperp * (fDepth * aa * dprof / spacing); // 고랑 요철의 높이 기울기 (월드 xz)
  float fk = clamp(fDepth / (T_FURROW_REF * 0.6), 0.0, 1.0);
  float furrowAO = mix(1.0, mix(0.86, mix(0.6, 1.07, prof), aa), fk);
  float furrowWater = wetHollow * fk * mix(0.27, 1.0 - smoothstep(T_WATER_F - 0.05, T_WATER_F + 0.02, prof), aa);

  // ---- 재질: 비율이 가장 큰 두 층만 읽는다
  float w[6] = float[6](wPl, wSt, wGr, wMud, wSub, wGrv);
  int i1 = 0;
  int i2 = 1;
  if (w[1] > w[0]) {
    i1 = 1;
    i2 = 0;
  }
  for (int i = 2; i < 6; i++) {
    if (w[i] > w[i1]) {
      i2 = i1;
      i1 = i;
    } else if (w[i] > w[i2]) {
      i2 = i;
    }
  }
  float w1 = w[i1];
  float w2 = w[i2];
#ifndef T_FAR
  // 반복 깨기 섞기 비율 (9.5m 얼룩), 먼 곳은 밉맵이 평균을 내므로 생략
  vec4 macB = texture(tMacro, wp / T_MAC_B + vec2(0.37, 0.11));
  float mixT = smoothstep(0.42, 0.58, macB.g) * (1.0 - smoothstep(T_ANTI_DIST * 0.7, T_ANTI_DIST, dist));
#else
  float mixT = 0.0;
#endif
  vec4 a1;
  vec4 n1;
  tLayer(tGAlb, i1, mixT, wp, fperp, fdir, a1, n1);
  vec4 a2 = a1;
  vec4 n2 = n1;
  // 두 번째 층: 높이 기반 혼합에서 몫이 0 이 될 수밖에 없으면 (비율 차 >= 0.22 + 높이 혼합) 읽지 않는다
  bool two = w2 > 0.05 && w1 - w2 < 0.22 + T_HB;
  if (two) tLayer(tGAlbLo, i2, 0.0, wp, fperp, fdir, a2, n2);
#ifndef T_FAR
  // 높이 기반 혼합: 경계에서 돌·풀 포기처럼 높은 쪽이 이긴다
  float sc1 = w1 + T_HB * n1.z;
  float sc2 = two ? w2 + T_HB * n2.z : -1.0;
  float mx = max(sc1, sc2);
  float b1 = max(sc1 - (mx - 0.22), 0.0);
  float b2 = max(sc2 - (mx - 0.22), 0.0);
#else
  float b1 = w1;
  float b2 = two ? w2 * (1.0 - smoothstep(0.1, 0.22 + T_HB, w1 - w2)) : 0.0;
#endif
  float bs = max(b1 + b2, 1e-4);
  b1 /= bs;
  b2 /= bs;
  vec3 alb = a1.rgb * b1 + a2.rgb * b2;
  vec2 nxz = n1.xy * b1 + n2.xy * b2;
  rough = T_ROUGH[i1] * a1.a * b1 + T_ROUGH[i2] * a2.a * b2;
  float sheen = T_SHEEN[i1] * b1 + T_SHEEN[i2] * b2;
  float bMud = (i1 == 3 ? b1 : 0.0) + (i2 == 3 ? b2 : 0.0);
  float hMud = i1 == 3 ? n1.z : n2.z;
#ifndef T_FAR
  // 진흙 물기: 타일 텍스처 높이만 쓰면 3m 격자 무늬가 되므로 월드 좌표 노이즈로 흩뜨린다
  hMud += (macB.r - 0.5) * 0.45;
#endif

#ifndef T_FAR
  // ---- 근거리 디테일 (흙 알갱이)
  if (dist < T_DETAIL_F1) {
    float dF = (1.0 - smoothstep(T_DETAIL_F0, T_DETAIL_F1, dist)) * T_DETAIL_STR;
    vec2 ud = wp / T_DETAIL_TILE;
    vec4 dn = texture(tGNrm, vec3(ud, 6.0));
    if (tVW.x > 0.004) {
      // 가파른 면: 면에 가까운 수직 평면으로 읽어 섞는다
      vec2 uv2 = (tVW.y >= tVW.z ? vec2(P.x, tVS.y * P.y) : vec2(tVS.x * P.y, P.z)) / T_DETAIL_TILE;
      dn = mix(dn, texture(tGNrm, vec3(uv2, 6.0)), tVW.x);
    }
    alb *= 1.0 + (dn.b - 0.5) * 0.9 * dF;
    nxz += (dn.xy * 2.0 - 1.0) * dF;
  }
#endif

#ifndef T_FAR
  // ---- 궤도 자국 바닥의 궤도판 무늬: 가장 가까운 자국 선분을 따라가는 좌표로 가로 줄 (근거리만, 화면에서 좁아지면 사라짐)
  if (band > 0.02 && dist < 45.0) {
    float bd = 1e4;
    vec2 tdir = vec2(1.0, 0.0);
    float ts = 0.0;
    for (int i = 0; i < T_NTRACK; i++) {
      vec4 sg = uTrackSeg[i];
      vec2 ab = sg.zw - sg.xy;
      float l2 = max(dot(ab, ab), 1e-3);
      float tt = clamp(dot(wp - sg.xy, ab) / l2, 0.0, 1.0);
      float dd = length(wp - sg.xy - ab * tt);
      if (dd < bd) {
        bd = dd;
        tdir = ab * inversesqrt(l2);
        ts = dot(wp - sg.xy, tdir);
      }
    }
    // 궤도판 간격을 조금씩 흔들고(미끄러짐·진흙에 뭉개짐, 띠를 가로질러 살짝 비뚤게) 또렷한 구간과 뭉개진 구간이 번갈아 나오게 한다
    // (일정한 가로 줄이 사다리·판자 길처럼 읽히지 않게)
    float ph = ts / T_TRACK_TREAD + T_TRACK_TREAD_JIT * (sin(ts * 0.83 + 1.7 * sin(ts * 0.29)) + 0.5 * sin(ts * 2.3 + bd * 3.0));
    float keep = smoothstep(0.15, 0.75, 0.5 + 0.35 * sin(ts * 0.37 + 2.0 * sin(ts * 0.11)) + 0.25 * sin(ts * 1.13 + bd));
    float taa = band * keep * (1.0 - smoothstep(0.25, 0.6, fwidth(ph)));
    float cs = cos(6.2831853 * ph);
    alb *= 1.0 - T_TRACK_TREAD_SHADE * taa * (0.5 + 0.5 * cs);
    nxz += tdir * (sin(6.2831853 * ph) * T_TRACK_TREAD_STR * taa);
  }
#endif

  // ---- 궤도 자국 띠: 눌려 다져진 젖은 진흙 — 주변 흙보다 어둡고, 하늘 윤기·진흙 물기는 거의 없다
  // (밝은 물은 띠 바닥 물웅덩이 메시에만. 띠 전체가 밝은 회색 판자 길처럼 보이지 않게)
  alb *= mix(1.0, T_TRACK_ALB, band);
  sheen *= mix(1.0, T_TRACK_SHEEN, band);
  // 다져진 자국 바닥은 거칠어 해 쪽을 봐도 번들거리지 않는다 (궤도판 무늬가 윤기 줄무늬로 튀지 않게)
  rough = mix(rough, T_TRACK_ROUGH, band);

  // ---- 큰 규모 색 변화 (타일 반복이 보이지 않게)
  alb *= (1.0 - 0.5 * T_MAC_SA + T_MAC_SA * macA.r) * (1.0 - 0.5 * T_MAC_SB + T_MAC_SB * macA.b);
  alb *= furrowAO;
  col *= alb;

  // ---- 물: 젖은 저지대 고랑에 고인 물 + 진흙의 오목한 곳 물기 (궤도 자국 띠 안은 거의 없음)
  float water = max(furrowWater, bMud * (1.0 - smoothstep(0.17, 0.27, hMud)) * 0.85 * smoothstep(0.45, 0.8, wMud) * mix(1.0, T_TRACK_WATER, band));
  water = clamp(water, 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
  col = mix(col, col * 0.3, water);
  // 흐린 날: 물·젖은 흙은 하늘 반사(프레넬, 자체 발광 — 지평선 색을 넘지 않는다)로만 밝아지고,
  // 해(방향광) 반사는 거칠기 하한 + 배수로 넓고 약한 윤기만 남긴다 (좁고 하얀 번쩍임 방지)
  rough = max(mix(rough, T_WATER_ROUGH, water), T_ROUGH_MIN);
  specK = T_SUN_SPEC * mix(1.0, T_WATER_SPEC, water) * mix(1.0, T_TRACK_SPEC, band);
  emis = uSkyRefl * fres * (water * T_WATER_REFL + sheen * (1.0 - water));

  // ---- 법선: 텍스처 + 고랑 요철 → 기하 법선 기준 탄젠트 공간 (x = 월드 X, y = 월드 Z)
  vec2 pxz = mix(nxz - fGrad, vec2(0.0), water);
  vec3 nT = normalize(vec3(pxz, 1.0));
  vec3 Tg = normalize(vec3(1.0, 0.0, 0.0) - Nb * Nb.x);
  vec3 Bg = cross(Tg, Nb);
  nW = normalize(Tg * nT.x + Bg * nT.y + Nb * nT.z);
  rough = clamp(rough, 0.04, 1.0);
}
`;

  const fragMain = `
vec3 tN;
float tRough;
vec3 tEmis;
float tSpecK;
terrainSurface(diffuseColor.rgb, tN, tRough, tEmis, tSpecK);
`;
  // 조명 계산 뒤: 해(방향광) 반사 배수 (물·젖은 흙이 하늘보다 밝게 번쩍이지 않게)
  const fragLights = `
reflectedLight.directSpecular = min(reflectedLight.directSpecular * tSpecK, uSkyRefl * T_SPEC_CAP);
`;
  return { vertPars, vertNormal, vertBegin, vertProject, fragPars, fragMain, fragLights };
}

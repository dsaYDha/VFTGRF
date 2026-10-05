// =============================================================================
// 지형 셰이더 조각 — MeshStandardMaterial.onBeforeCompile 로 끼워 넣는다.
// 조명·그림자·안개·톤매핑은 Three.js 표준 경로(lights/fog 청크)를 그대로 쓰고, 여기서는
//  1) 혼합 마스크(0.5m)에서 재질 비율·길/궤도 거리장·밭 구획을 읽고
//  2) 비율이 가장 큰 두 재질만 텍스처(배열 텍스처 층)를 읽어 높이 기반으로 섞고
//     (가까운 곳만 반복 깨기 두 번째 샘플·근거리 디테일, 픽셀당 텍스처 읽기 수를 묶어 둔다)
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
void tLayer(sampler2DArray tAlb, int li, float anti, vec2 wp, vec2 dWx, vec2 dWy, vec2 fperp, vec2 fdir, out vec4 a, out vec4 n) {
  bool fr = li < 2;
  vec2 uv = fr ? vec2(dot(wp, fperp), dot(wp, fdir)) : wp;
  vec2 gx = fr ? vec2(dot(dWx, fperp), dot(dWx, fdir)) : dWx;
  vec2 gy = fr ? vec2(dot(dWy, fperp), dot(dWy, fdir)) : dWy;
  float k = 1.0 / T_TILE[li];
  float l = float(li);
  a = vec4(0.0);
  n = vec4(0.0);
  if (anti < 0.996) {
    vec3 c1 = vec3(uv * k, l);
    a = textureGrad(tAlb, c1, gx * k, gy * k);
#ifndef T_FAR
    n = textureGrad(tGNrm, c1, gx * k, gy * k);
#endif
  }
#ifndef T_FAR
  if (anti > 0.004) {
    float k2 = k / T_ANTI_TILE;
    mat2 rm = fr ? mat2(1.0) : mat2(0.8, 0.6, -0.6, 0.8);
    vec3 c2 = vec3(rm * uv * k2 + vec2(0.37, 0.71), l);
    vec4 a2 = textureGrad(tAlb, c2, rm * gx * k2, rm * gy * k2);
    vec4 n2 = textureGrad(tGNrm, c2, rm * gx * k2, rm * gy * k2);
    n2.xy = transpose(rm) * (n2.xy * 2.0 - 1.0) * 0.5 + 0.5;
    a = mix(a, a2, anti);
    n = mix(n, n2, anti);
  }
  vec2 nxy = n.xy * 2.0 - 1.0;
  // 밭 재질의 탄젠트 공간(고랑 가로·세로) → 월드 x·z
  if (fr) nxy = nxy.x * fperp + nxy.y * fdir;
  n = vec4(nxy, n.b, 1.0);
#else
  n = vec4(0.0, 0.0, 0.5, 1.0);
#endif
}

void terrainSurface(inout vec3 col, out vec3 nW, out float rough, out vec3 emis) {
  vec3 P = vTWPos;
  vec3 Nb = normalize(vTWNrm);
  vec3 V = normalize(P - cameraPosition);
  float dist = vTDist;
  vec2 wp = P.xz;
  vec2 dWx = dFdx(wp);
  vec2 dWy = dFdy(wp);

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
    float farM = textureGrad(tMacro, wp / T_MAC_FAR, dWx / T_MAC_FAR, dWy / T_MAC_FAR).r;
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
  wMud = max(wMud, band * 0.55);
  float wGr = max(0.0, 1.0 - wPl - wSt - wMud - wSub - wGrv);

  // ---- 밭 구획: 고랑 방향·간격·깊이 → 해석적 고랑 (노멀 + 어둡기). 화면에서 고랑이 1~2px 로 좁아지면 평균으로
  vec4 PP = uParcel[parcel];
  vec2 fdir = parcel > 0 ? PP.xy : vec2(0.0, 1.0);
  vec2 fperp = vec2(fdir.y, -fdir.x);
  float spacing = parcel > 0 ? PP.z : 1.0;
  float fDepth = (parcel > 0 ? PP.w : 0.0) * smoothstep(0.3, 0.75, wPl) * (1.0 - band) * (1.0 - rut);
  float s0 = dot(wp, fperp) / spacing;
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
  tLayer(tGAlb, i1, mixT, wp, dWx, dWy, fperp, fdir, a1, n1);
  vec4 a2 = a1;
  vec4 n2 = n1;
  // 두 번째 층: 높이 기반 혼합에서 몫이 0 이 될 수밖에 없으면 (비율 차 >= 0.22 + 높이 혼합) 읽지 않는다
  bool two = w2 > 0.05 && w1 - w2 < 0.22 + T_HB;
  if (two) tLayer(tGAlbLo, i2, 0.0, wp, dWx, dWy, fperp, fdir, a2, n2);
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
  // ---- 근거리 디테일 (흙 알갱이)
  if (dist < T_DETAIL_F1) {
    float dF = (1.0 - smoothstep(T_DETAIL_F0, T_DETAIL_F1, dist)) * T_DETAIL_STR;
    vec2 ud = wp / T_DETAIL_TILE;
    vec4 dn = textureGrad(tGNrm, vec3(ud, 6.0), dWx / T_DETAIL_TILE, dWy / T_DETAIL_TILE);
    alb *= 1.0 + (dn.b - 0.5) * 0.9 * dF;
    nxz += (dn.xy * 2.0 - 1.0) * dF;
  }
#endif

  // ---- 큰 규모 색 변화 (타일 반복이 보이지 않게)
  alb *= (1.0 - 0.5 * T_MAC_SA + T_MAC_SA * macA.r) * (1.0 - 0.5 * T_MAC_SB + T_MAC_SB * macA.b);
  alb *= furrowAO;
  col *= alb;

  // ---- 물: 젖은 저지대 고랑에 고인 물 + 진흙의 오목한 곳 물기
  float water = max(furrowWater, bMud * (1.0 - smoothstep(0.17, 0.27, hMud)) * 0.85 * smoothstep(0.45, 0.8, wMud));
  water = clamp(water, 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
  col = mix(col, col * 0.3, water);
  rough = mix(rough, 0.06, water);
  emis = uSkyRefl * fres * (water * 0.9 + sheen * (1.0 - water));

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
terrainSurface(diffuseColor.rgb, tN, tRough, tEmis);
`;
  return { vertPars, vertNormal, vertBegin, vertProject, fragPars, fragMain };
}

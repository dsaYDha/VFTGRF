// =============================================================================
// 지형 셰이더 조각 — MeshStandardMaterial.onBeforeCompile 로 끼워 넣는다.
// 조명·그림자·안개·톤매핑은 Three.js 표준 경로(lights/fog 청크)를 그대로 쓰고, 여기서는
//  1) 혼합 마스크(0.5m)에서 재질 비율·길/궤도 거리장·밭 구획을 읽고
//  2) 밭 고랑은 시차 매핑(가까운 곳) / 해석적 노멀(먼 곳, 화면 크기에 맞춰 흐림)으로 그리고
//  3) 재질별 텍스처(배열 텍스처 층)를 반복 깨기 + 높이 기반 혼합으로 섞고
//  4) 근거리 디테일·큰 규모 색 변화·물(고랑에 고인 물, 진흙 물기)의 하늘 반사를 더한다.
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

export function terrainShaderParts({ maskN, half }) {
  const G = CONFIG.ground;
  const T = CONFIG.terrain;
  const R = T.road;
  const defines = `
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
#define T_MAC_A ${f(G.macroSizes[0])}
#define T_MAC_B ${f(G.macroSizes[1])}
#define T_MAC_C ${f(G.macroSizes[2])}
#define T_MAC_SA ${f(G.macroStrength[0])}
#define T_MAC_SB ${f(G.macroStrength[1])}
#define T_HB ${f(G.heightBlend)}
#define T_WATER_F ${f(G.waterInFurrows)}
#define T_FURROW_REF ${f(T.furrow.depth)}
#define T_MAX_PARCELS ${MAX_PARCELS}
`;

  const vertPars = `
varying vec3 vTWPos;
varying vec3 vTWNrm;
varying float vTDist;
`;
  const vertBegin = `
vTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;
  const vertProject = `
vTDist = -mvPosition.z;
`;

  const fragPars = `${defines}
uniform sampler2D tSplatA;
uniform sampler2D tSplatB;
uniform sampler2DArray tGAlb;
uniform sampler2DArray tGNrm;
uniform sampler2D tMacro;
uniform vec4 uParcel[T_MAX_PARCELS];
uniform vec3 uSkyRefl;
uniform float uPomDist;
varying vec3 vTWPos;
varying vec3 vTWNrm;
varying float vTDist;

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

// 시차 매핑: 고랑 평균면(=메시, heightAt) 위아래 ±depth/2 의 1차원 요철과 시선의 첫 교차점
// vy: 시선의 y 성분(아래 음수), s0: 메시 위치의 고랑 좌표, ds: 시선 1m 당 고랑 좌표 변화
float tPom(float vy, float s0, float ds, float depth, out float tHit) {
  vy = min(vy, -0.015);
  float span = min(0.5 * depth / -vy, 3.5);
  float t0 = -span;
  float t1 = span;
  float cross = abs(ds) * (t1 - t0);
  float n = clamp(cross * 5.0 + 4.0, 4.0, 40.0);
  float dt = (t1 - t0) / n;
  float prevT = t0;
  float t = t0;
  for (int i = 0; i <= 40; i++) {
    if (float(i) > n) break;
    float s = s0 + ds * t;
    float r = depth * (tFurrow(s) - 0.5);
    if (vy * t <= r) {
      float lo = prevT;
      float hi = t;
      for (int k = 0; k < 5; k++) {
        float m = 0.5 * (lo + hi);
        float sm = s0 + ds * m;
        if (vy * m <= depth * (tFurrow(sm) - 0.5)) hi = m;
        else lo = m;
      }
      tHit = hi;
      return s0 + ds * hi;
    }
    prevT = t;
    t += dt;
  }
  tHit = t1;
  return s0 + ds * t1;
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
  float farM = texture(tMacro, wp / 530.0).r;
  float inMap = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
  if (inMap < 0.5) {
    sA = vec4(smoothstep(0.56, 0.62, farM), smoothstep(0.44, 0.38, farM) * 0.9, 0.0, 0.0);
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

  // ---- 밭 구획: 고랑 방향·간격·깊이
  vec4 PP = uParcel[parcel];
  vec2 fdir = parcel > 0 ? PP.xy : vec2(0.0, 1.0);
  vec2 fperp = vec2(fdir.y, -fdir.x);
  float spacing = parcel > 0 ? PP.z : 1.0;
  float fDepth = (parcel > 0 ? PP.w : 0.0) * smoothstep(0.3, 0.75, wPl) * (1.0 - band) * (1.0 - rut);
  float s0 = dot(wp, fperp) / spacing;
  float fwS = length(vec2(dFdx(s0), dFdy(s0)));
  float aa = 1.0 - smoothstep(0.22, 0.6, fwS); // 고랑 줄무늬를 화면에 그릴 수 있는 정도
  float pomK = (1.0 - smoothstep(uPomDist * 0.6, uPomDist, dist)) * aa;
  float sHit = s0;
  vec2 wpH = wp;
  if (fDepth > 0.004 && pomK > 0.02) {
    float tH;
    sHit = tPom(V.y, s0, dot(V.xz, fperp) / spacing, fDepth * pomK, tH);
    wpH = wp + V.xz * tH;
  }
  float prof = tFurrow(sHit);
  float dprof = (tFurrow(sHit + 0.02) - tFurrow(sHit - 0.02)) / 0.04;
  vec2 fGrad = fperp * (fDepth * aa * dprof / spacing); // 고랑 요철의 높이 기울기 (월드 xz)
  float fk = clamp(fDepth / (T_FURROW_REF * 0.6), 0.0, 1.0);
  float furrowAO = mix(1.0, mix(0.86, mix(0.6, 1.07, prof), aa), fk);
  float furrowWater = wetHollow * fk * mix(0.27, 1.0 - smoothstep(T_WATER_F - 0.05, T_WATER_F + 0.02, prof), aa);

  // ---- 재질 텍스처 (밭 재질 0·1 은 고랑 방향 좌표, 나머지는 월드 좌표)
  vec2 uvF = vec2(dot(wpH, fperp), dot(wpH, fdir));
  vec2 gFx = vec2(dot(dWx, fperp), dot(dWx, fdir));
  vec2 gFy = vec2(dot(dWy, fperp), dot(dWy, fdir));
  vec4 macA = texture(tMacro, wp / T_MAC_A);
  vec4 macB = texture(tMacro, wp / T_MAC_B + vec2(0.37, 0.11));
  vec4 macC = texture(tMacro, wp / T_MAC_C + vec2(0.71, 0.53));
  float mixT = smoothstep(0.36, 0.64, macB.g);
  const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);
  float w[6] = float[6](wPl, wSt, wGr, wMud, wSub, wGrv);
  vec3 A[6];
  vec3 NT[6];
  float H[6];
  float RG[6];
  float mx = -1.0;
  float sc[6];
  for (int i = 0; i < 6; i++) {
    A[i] = vec3(0.0);
    NT[i] = vec3(0.0, 0.0, 1.0);
    H[i] = 0.5;
    RG[i] = 1.0;
    sc[i] = -1.0;
    if (w[i] > 0.004) {
      bool fr = i < 2;
      vec2 uv = fr ? uvF : wpH;
      vec2 gx = fr ? gFx : dWx;
      vec2 gy = fr ? gFy : dWy;
      float tile = T_TILE[i];
      float li = float(i);
      vec4 a = vec4(0.0);
      vec4 n = vec4(0.0);
      if (mixT < 0.995) {
        vec3 c1 = vec3(uv / tile, li);
        a += (1.0 - mixT) * textureGrad(tGAlb, c1, gx / tile, gy / tile);
        n += (1.0 - mixT) * textureGrad(tGNrm, c1, gx / tile, gy / tile);
      }
      if (mixT > 0.005) {
        float k = 1.0 / (tile * T_ANTI_TILE);
        mat2 rm = fr ? mat2(1.0) : ROT;
        vec3 c2 = vec3(rm * uv * k + vec2(0.37, 0.71), li);
        vec4 a2 = textureGrad(tGAlb, c2, rm * gx * k, rm * gy * k);
        vec4 n2 = textureGrad(tGNrm, c2, rm * gx * k, rm * gy * k);
        n2.xy = transpose(rm) * (n2.xy * 2.0 - 1.0) * 0.5 + 0.5;
        a += mixT * a2;
        n += mixT * n2;
      }
      vec2 nxy = n.xy * 2.0 - 1.0;
      // 밭 재질의 탄젠트 공간(고랑 가로·세로) → 월드 x·z
      if (fr) nxy = nxy.x * fperp + nxy.y * fdir;
      A[i] = a.rgb;
      NT[i] = vec3(nxy, sqrt(max(0.05, 1.0 - dot(nxy, nxy))));
      H[i] = n.b;
      RG[i] = a.a;
      sc[i] = w[i] + T_HB * n.b;
      mx = max(mx, sc[i]);
    }
  }
  // 높이 기반 혼합: 경계에서 돌·풀 포기처럼 높은 쪽이 이긴다
  float bsum = 0.0;
  float bw[6];
  for (int i = 0; i < 6; i++) {
    bw[i] = max(sc[i] - (mx - 0.22), 0.0);
    bsum += bw[i];
  }
  vec3 alb = vec3(0.0);
  vec2 nxz = vec2(0.0);
  float nz = 0.0;
  rough = 0.0;
  float sheen = 0.0;
  float hMud = 0.5;
  for (int i = 0; i < 6; i++) {
    float b = bw[i] / max(bsum, 1e-4);
    alb += A[i] * b;
    nxz += NT[i].xy * b;
    nz += NT[i].z * b;
    rough += T_ROUGH[i] * RG[i] * b;
    sheen += T_SHEEN[i] * b;
  }
  float bMud = bw[3] / max(bsum, 1e-4);
  hMud = H[3];

  // ---- 근거리 디테일 (흙 알갱이)
  float dF = (1.0 - smoothstep(T_DETAIL_F0, T_DETAIL_F1, dist)) * T_DETAIL_STR;
  if (dF > 0.01) {
    vec2 ud = wpH / T_DETAIL_TILE;
    vec4 dn = textureGrad(tGNrm, vec3(ud, 6.0), dWx / T_DETAIL_TILE, dWy / T_DETAIL_TILE);
    alb *= 1.0 + (dn.b - 0.5) * 0.9 * dF;
    nxz += (dn.xy * 2.0 - 1.0) * dF;
  }

  // ---- 큰 규모 색 변화 (타일 반복이 보이지 않게)
  alb *= (1.0 - 0.5 * T_MAC_SA + T_MAC_SA * macA.r) * (1.0 - 0.5 * T_MAC_SB + T_MAC_SB * macC.b);
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
  vec3 nT = normalize(vec3(pxz, max(nz, 0.3)));
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
  return { vertPars, vertBegin, vertProject, fragPars, fragMain };
}

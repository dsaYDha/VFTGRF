// =============================================================================
// Atmosphere — 흐린 늦가을 하늘·안개·조명·색감
//  - 안개: Three.js fog 셰이더 청크를 이 모듈의 식으로 바꿔 끼운다 → 표준 재질, onBeforeCompile 로 고친 재질
//    (지형 스플랫, 식생 인스턴스), fog 를 켠 ShaderMaterial(파티클) 이 모두 같은 안개를 받는다.
//    거리 = 카메라에서의 실제 거리, 높이 안개(위로 갈수록 옅음), 먼 곳 실루엣 몫 (CONFIG.atmosphere.fog)
//    가까운 지수형 투과율과 먼 곳 몫은 부드러운 최댓값으로 합친다 → 600m 에서 거의 안개색, 3km 너머 지평선은 안개에 녹는다
//    + 지면 연무 (CONFIG.atmosphere.groundHaze): 땅을 스치는 긴 시선만 더 뿌옇게 → 지면이 지평선 쪽으로 서서히 밝아져 안개 띠로 이어진다
//  - 하늘: 절차적 흐린 하늘 돔. 층운 두께 텍스처 두 겹이 바람 방향으로 아주 천천히 흐르고,
//    지평선 연무 띠가 안개색과 정확히 같은 색으로 이어진다 (톤매핑 없이 화면 값 그대로).
//  - 조명: 반구광 + 구름 뒤 해(약한 방향광). 그림자는 플레이어 주변만 옅고 부드럽게, 가장자리에서 사라진다.
//  - 색감: ACESFilmic + 채도·색조 보정 + 어두운 쪽 들어 올림(흑토·풀밭이 검게 뭉개지지 않게)을 CustomToneMapping 으로 (후처리 패스 없음)
// 셰이더 청크 교체는 이 모듈을 불러올 때 한 번 (어떤 재질도 컴파일되기 전).
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { cloudTexture } from './textures.js';

const glf = (v) => {
  const s = Number(v).toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};
const glc = (hex) => {
  const c = new THREE.Color(hex);
  return `vec3(${glf(c.r)}, ${glf(c.g)}, ${glf(c.b)})`;
};

// ---------------------------------------------------------------------------- 안개 식 (JS 판, 점검·보고용)
// d: 카메라에서의 거리(m), dy: 카메라 기준 높이차(m), camY: 카메라 월드 높이 (생략하면 연무층 바닥 + 1.6m, 선 눈높이).
// 반환: 안개 비율 0..1
export function fogFactorAt(d, dy = 0, camY = null) {
  const F = CONFIG.atmosphere.fog;
  let k = Math.max(-1.5, Math.min(12, dy / F.hazeHeight));
  const hf = Math.abs(k) < 1e-3 ? 1 : (1 - Math.exp(-k)) / k;
  const cy = camY === null ? (CONFIG.atmosphere.groundHaze?.ref ?? 0) + 1.6 : camY;
  return 1 - fogTransmit(d * hf, groundHazeTau(d, cy, cy + dy));
}

// 지면 연무가 더하는 광학 깊이 (GLSL atmoGroundHaze 와 같은 식). hc / hp: 카메라 / 물체의 월드 높이
function groundHazeTau(d, hc, hp) {
  const G = CONFIG.atmosphere.groundHaze;
  if (!G || !(G.tau > 0)) return 0;
  const a = Math.max(hc - G.ref, 0);
  const b = Math.max(hp - G.ref, 0);
  const ea = Math.exp(-a / G.height);
  const eb = Math.exp(-b / G.height);
  const m = Math.abs(b - a) < 0.02 ? 0.5 * (ea + eb) : (G.height * (ea - eb)) / (b - a);
  return G.tau * m * (1 - Math.exp(-d / G.length));
}

// 높이 보정한 거리 dd 의 투과율: 가까운 지수형 A 와 먼 곳 실루엣 몫 B 의 부드러운 최댓값 (p-노름, 거리에 따라 단조 감소)
// extra: 더할 광학 깊이 (지면 연무)
function fogTransmit(dd, extra = 0) {
  const F = CONFIG.atmosphere.fog;
  const tau = F.linear * dd + F.quad * F.quad * dd * dd + extra;
  const a = Math.max(Math.exp(-tau), 1e-6);
  const b = Math.max(F.farResidual * Math.exp(-dd / F.farLength), 1e-6);
  const p = F.blendPow;
  return Math.pow(Math.pow(a, p) + Math.pow(b, p), 1 / p);
}

// GLSL 판 (dd, tau 가 이미 있는 자리에 넣는 식). 밀도 항 계수는 호출하는 쪽이 tau 에 넣는다
function glslTransmit(tau, dd) {
  const F = CONFIG.atmosphere.fog;
  const p = glf(F.blendPow);
  return `pow( pow( max( exp( -( ${tau} ) ), 1e-6 ), ${p} ) + pow( max( ${glf(F.farResidual)} * exp( -( ${dd} ) / ${glf(F.farLength)} ), 1e-6 ), ${p} ), ${glf(1 / F.blendPow)} )`;
}

// ---------------------------------------------------------------------------- 톤매핑 (JS 판)
// GLSL CustomToneMapping 과 같은 식: 노출 → ACESFilmic(Three.js 적합식) → 채도·색조. 입력·출력 모두 선형
const ACES_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const ACES_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const rrt = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const sat01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function toneMapLinear(rgb) {
  const R = CONFIG.render;
  const e = R.exposure / 0.6;
  const c = rgb.map((v) => v * e);
  const a = ACES_IN.map((r) => rrt(r[0] * c[0] + r[1] * c[1] + r[2] * c[2]));
  const o = ACES_OUT.map((r) => sat01(r[0] * a[0] + r[1] * a[1] + r[2] * a[2]));
  const l = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
  const G = R.grade;
  const g = o.map((v, i) => sat01((l + (v - l) * G.saturation) * G.tint[i]));
  // 어두운 쪽 들어 올림 (GLSL 판과 같은 식)
  const Lf = G.lift;
  if (!Lf || !(Lf.amount > 0)) return g;
  const l2 = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  const t = Math.max(1 - l2 / Lf.end, 0);
  const add = (Lf.amount * l2 * t * t) / (l2 + Lf.knee);
  const r = (l2 + add) / Math.max(l2, 1e-5);
  return g.map((v) => sat01(v * r * (1 - Lf.neutral) + (v + add) * Lf.neutral));
}

// 화면에 이 색(sRGB hex)으로 보여야 하는 장면 쪽(톤매핑 전) 선형 색. 물·젖은 흙에 비치는 하늘처럼
// 톤매핑을 받는 재질이 톤매핑 없이 그려지는 하늘과 같은 밝기로 보이게 할 때 쓴다
export function sceneColorForDisplay(hex, out = new THREE.Color()) {
  const t = new THREE.Color(hex); // 선형
  const target = [t.r, t.g, t.b];
  let L = target.slice();
  for (let it = 0; it < 48; it++) {
    const cur = toneMapLinear(L);
    L = L.map((v, i) => v * Math.pow(target[i] / Math.max(cur[i], 1e-5), 0.85));
  }
  return out.setRGB(L[0], L[1], L[2]);
}

// ---------------------------------------------------------------------------- 셰이더 청크 교체
function installShaderChunks() {
  const SC = THREE.ShaderChunk;
  const F = CONFIG.atmosphere.fog;
  if (SC.fog_fragment.includes('atmoFogFactor')) return; // 핫 리로드 등으로 두 번 불릴 때
  // 정점: 깊이 대신 실제 거리 + 카메라 기준 월드 높이차 (높이 안개용)
  SC.fog_pars_vertex = `
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogDY;
#endif
`;
  SC.fog_vertex = `
#ifdef USE_FOG
	vFogDepth = length( mvPosition.xyz );
	vFogDY = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).y;
#endif
`;
  // 조각: 광학 깊이 tau = linear·d + (밀도·d)² + 지면 연무, 투과율 = (e^-tau ^p + (r·e^(-d/L))^p)^(1/p), 높이 안개 배수 hf
  // 지면 연무: 연무층 밀도 e^(-h/height) 를 카메라→물체 시선 위에서 평균 (h = 월드 높이 - ref, 0 아래는 최대 밀도).
  // cameraPosition 은 Three.js 가 모든 (Raw 가 아닌) 재질의 조각 셰이더 머리에 넣어 둔다
  const GH = CONFIG.atmosphere.groundHaze;
  const ghGlsl =
    GH && GH.tau > 0
      ? `
		float atmoGroundHaze( float d, float dy ) {
			float a = max( cameraPosition.y - ${glf(GH.ref)}, 0.0 );
			float b = max( cameraPosition.y + dy - ${glf(GH.ref)}, 0.0 );
			float ea = exp( -a / ${glf(GH.height)} );
			float eb = exp( -b / ${glf(GH.height)} );
			float m = abs( b - a ) < 0.02 ? 0.5 * ( ea + eb ) : ${glf(GH.height)} * ( ea - eb ) / ( b - a );
			return ${glf(GH.tau)} * m * ( 1.0 - exp( -d / ${glf(GH.length)} ) );
		}`
      : `
		float atmoGroundHaze( float d, float dy ) { return 0.0; }`;
  SC.fog_pars_fragment = `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogDY;
	#ifdef FOG_EXP2
		uniform float fogDensity;${ghGlsl}
		float atmoFogFactor( float d, float dy ) {
			float k = clamp( dy / ${glf(F.hazeHeight)}, -1.5, 12.0 );
			float hf = abs( k ) < 1e-3 ? 1.0 : ( 1.0 - exp( -k ) ) / k;
			float dd = d * hf;
			float tau = ${glf(F.linear)} * dd + fogDensity * fogDensity * dd * dd + atmoGroundHaze( d, dy );
			return 1.0 - ${glslTransmit('tau', 'dd')};
		}
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
  SC.fog_fragment = `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = atmoFogFactor( vFogDepth, vFogDY );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

  // 그림자: 그림자 영역(플레이어 주변 원) 가장자리에서 서서히 사라지게 (방향광 2D 그림자 함수 3종만)
  const R = CONFIG.render;
  const fade = `{
				vec2 sEdge = ( shadowCoord.xy - 0.5 ) * 2.0;
				float sFade = 1.0 - smoothstep( ${glf(R.shadowFadeStart)}, 1.0, length( sEdge ) );
				return mix( 1.0, shadow, shadowIntensity * sFade );
			}`;
  let n = 0;
  SC.shadowmap_pars_fragment = SC.shadowmap_pars_fragment.replace(/return mix\( 1\.0, shadow, shadowIntensity \);/g, (m) =>
    n++ < 3 ? fade : m,
  );

  // 톤매핑: ACESFilmic → 채도 낮춤 + 차가운 색조 → 어두운 쪽 들어 올림 (renderer.toneMapping = CustomToneMapping)
  const G = R.grade;
  const Lf = G.lift && G.lift.amount > 0 ? G.lift : null;
  // 들어 올림: 밝기 l 에 amount·l/(l+knee)·(1-l/end)² 를 더한다. 색조 유지 몫(배율)과 회색 몫(더하기)을 neutral 로 섞는다
  const liftGlsl = Lf
    ? `
	float l2 = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	float lt = max( 1.0 - l2 / ${glf(Lf.end)}, 0.0 );
	float la = ${glf(Lf.amount)} * l2 * lt * lt / ( l2 + ${glf(Lf.knee)} );
	c = mix( c * ( ( l2 + la ) / max( l2, 1e-5 ) ), c + la, ${glf(Lf.neutral)} );`
    : '';
  SC.tonemapping_pars_fragment = SC.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    `vec3 CustomToneMapping( vec3 color ) {
	vec3 c = ACESFilmicToneMapping( color );
	float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
	c = mix( vec3( l ), c, ${glf(G.saturation)} ) * vec3( ${glf(G.tint[0])}, ${glf(G.tint[1])}, ${glf(G.tint[2])} );
	c = saturate( c );${liftGlsl}
	return saturate( c );
}`,
  );
}
installShaderChunks();

// ---------------------------------------------------------------------------- 하늘 돔
function createSkyMaterial() {
  const A = CONFIG.atmosphere;
  const S = A.sky;
  const F = A.fog;
  const tex = cloudTexture(S.textureSize);
  const sunDir = sunDirection();
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uCloud: { value: tex },
      uOff: { value: new THREE.Vector4() },
      uSunDir: { value: sunDir },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // 항상 가장 뒤
      }`,
    // 색은 모두 화면 출력값(sRGB hex)을 선형으로 바꿔 넣고 colorspace 변환만 거친다 → 지평선 = 안개색 정확히 일치
    fragmentShader: `
      uniform sampler2D uCloud;
      uniform vec4 uOff;
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        // 층운 구름판 투영 (지평선 쪽은 멀어서 무늬가 잘아지고, 밉맵이 평균을 내 고르게 흐려진다)
        vec2 p = d.xz / (h + 0.06) * ${glf(S.layerHeight)};
        // 바람 방향 정렬 (텍스처 u = 바람 방향으로 길게 늘어진 무늬)
        vec2 q = vec2(dot(p, vec2(${glf(windDir2().x)}, ${glf(windDir2().y)})), dot(p, vec2(${glf(-windDir2().y)}, ${glf(windDir2().x)})));
        float big = texture2D(uCloud, q / ${glf(S.tileSize[0])} + uOff.xy).r;
        float det = texture2D(uCloud, q.yx / ${glf(S.tileSize[1])} + uOff.zw).r;
        float dens = big + (det - 0.5) * ${glf(S.detail)};
        float th = smoothstep(${glf(S.cover - S.softness)}, ${glf(S.cover + S.softness)}, dens);
        vec3 col = mix(${glc(S.cloudLit)}, ${glc(S.cloudDark)}, th);
        col *= mix(1.0, ${glf(S.zenithShade)}, h * h);
        // 구름 뒤 해: 얇은 곳이 조금 더 밝게 비친다
        float sg = pow(max(dot(d, uSunDir), 0.0), ${glf(S.sunGlowPower)});
        col += ${glc(S.sunGlow)} * sg * (1.0 - 0.65 * th);
        // 지평선 연무 띠: 땅 위 물체와 같은 안개 식을 이 방향 무한 시선에 적용 (높이 안개를 끝까지 적분하면
        // 유효 거리 = hazeHeight / sin(고도)) → 지평선에서 정확히 안개색, 먼 연기·언덕은 뒤 하늘보다 조금 어둡게 남는다
        float dd = ${glf(F.hazeHeight * S.hazeMul)} / max(h, 1e-4);
        float tau = ${glf(F.linear)} * dd + ${glf(F.quad * F.quad)} * dd * dd;
        float T = ${glslTransmit('tau', 'dd')};
        col = mix(col, ${glc(A.fogColor)}, 1.0 - T);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// 해 방향 (빛이 오는 쪽, 월드 단위벡터): 방위각 0 = 북(-Z), 시계방향
export function sunDirection(out = new THREE.Vector3()) {
  const A = CONFIG.atmosphere;
  const az = (A.sunAzimuthDeg * Math.PI) / 180;
  const el = (A.sunElevationDeg * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

function windDir2() {
  const w = CONFIG.atmosphere.windDirection;
  const l = Math.hypot(w[0], w[2]) || 1;
  return new THREE.Vector2(w[0] / l, w[2] / l);
}

export class Atmosphere {
  constructor(scene, renderer = null) {
    const A = CONFIG.atmosphere;
    const R = CONFIG.render;
    this.scene = scene;
    this.renderer = renderer;
    scene.fog = new THREE.FogExp2(A.fogColor, A.fog.quad);
    scene.background = new THREE.Color(A.fogColor);

    // 하늘 돔 (반지름은 원거리 클리핑 안쪽, 깊이는 항상 가장 뒤)
    const skyGeo = new THREE.SphereGeometry(R.far * 0.85, 48, 24);
    this.sky = new THREE.Mesh(skyGeo, createSkyMaterial());
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    scene.add(this.sky);
    this.cloudOff = this.sky.material.uniforms.uOff.value;
    // 구름 이동: 텍스처 u = 바람 방향 → 큰 층은 u 로, 작은 층(축을 바꿔 읽음)은 v 로
    const S = A.sky;
    this.cloudSpeed = [S.speed[0] / S.tileSize[0], S.speed[1] / S.tileSize[1]];

    // 조명: 반구광 (하늘 회백색 / 땅 어두운 갈색) + 구름 뒤 해
    this.hemi = new THREE.HemisphereLight(A.hemiSky, A.hemiGround, A.hemiIntensity);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(A.sunColor, A.sunIntensity);
    this.sunDir = sunDirection();
    this.sun.position.copy(this.sunDir).multiplyScalar(250);
    this.shadowCenter = new THREE.Vector3(1e9, 0, 1e9);
    this.shadowTimer = 0;
    this.sun.shadow.intensity = A.shadowIntensity;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.applyShadowSettings();
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  // 그림자 설정 적용 (CONFIG.render: shadows, shadowMapSize, shadowHalfExtent, shadowRadius).
  // 그래픽 품질 프리셋이 CONFIG.render 를 바꾼 뒤 다시 불러도 된다 (켜고 끄면 재질이 다시 컴파일된다)
  applyShadowSettings() {
    const R = CONFIG.render;
    const sun = this.sun;
    const on = !!R.shadows;
    if (this.renderer) {
      this.renderer.shadowMap.enabled = on;
      // 정적인 장면이 대부분이므로 그림자 맵은 필요할 때만 다시 그린다 (update 참고)
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = on;
    }
    sun.castShadow = on;
    if (!on) {
      // 그림자를 끄면 그림자 맵 메모리도 돌려준다 (다시 켜면 새로 만든다)
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
      return;
    }
    if (sun.shadow.mapSize.x !== R.shadowMapSize && sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.mapSize.set(R.shadowMapSize, R.shadowMapSize);
    sun.shadow.radius = R.shadowRadius;
    const e = R.shadowHalfExtent;
    // 그림자 카메라의 위아래 축은 지면에서 해 방위 쪽으로 1/sin(고도) 배 늘어난다 → 지면 기준 반경 e 의 원을 덮게 줄인다
    const ev = e * Math.max(0.2, this.sunDir.y) + 6;
    const cam = sun.shadow.camera;
    cam.left = -e;
    cam.right = e;
    cam.top = ev;
    cam.bottom = -ev;
    cam.near = 1;
    cam.far = 520;
    cam.updateProjectionMatrix();
    this.texel = Math.max((2 * e) / R.shadowMapSize, (2 * ev) / R.shadowMapSize);
    this.shadowCenter.set(1e9, 0, 1e9); // 다음 update 에서 다시 맞춘다
  }

  // 안개 비율 (거리 m, 높이차 m) — 점검·다른 모듈용
  fogAt(d, dy = 0) {
    return fogFactorAt(d, dy);
  }

  // 월드가 다 만들어진 뒤: 톤매핑을 받는 반사(지형의 젖은 흙·고랑 물, 물웅덩이)가 비추는 하늘색을
  // 톤매핑 전 값으로 바꿔 넣는다 → 반사된 하늘이 실제 하늘(톤매핑 없음)보다 밝거나 어둡게 튀지 않는다
  applyToWorld(world) {
    const A = CONFIG.atmosphere;
    const tu = world.terrainMaterial && world.terrainMaterial.userData.terrainUniforms;
    if (tu && tu.uSkyRefl) sceneColorForDisplay(A.skyHorizon, tu.uSkyRefl.value);
    const pud = this.scene.getObjectByName('puddles');
    const pu = pud && pud.material && pud.material.userData.puddleUniforms;
    if (pu) {
      if (pu.uHorizon) sceneColorForDisplay(A.skyHorizon, pu.uHorizon.value);
      if (pu.uZenith) sceneColorForDisplay(A.skyZenith, pu.uZenith.value);
    }
    this.ensureFog();
  }

  // 월드 물체는 모두 같은 안개를 받아야 한다: fog 를 끈 표준 재질은 켜고(원경 실루엣 포함),
  // 안개 청크가 없는 ShaderMaterial 은 경고만 (하늘 돔은 안개의 기준이라 제외). 디버그 표시는 이보다 나중에 생긴다
  ensureFog() {
    const fixed = new Set();
    this.scene.traverse((o) => {
      if (o === this.sky || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.fog !== false || fixed.has(m)) continue;
        if (m.isShaderMaterial) {
          console.warn(`[Atmosphere] '${o.name || m.name || m.type}' 재질이 안개를 받지 않습니다 (ShaderMaterial fog:false)`);
        } else {
          m.fog = true;
          m.needsUpdate = true;
          fixed.add(m);
          console.info(`[Atmosphere] '${o.name || m.name || m.type}' 재질에 안개를 켰습니다`);
        }
      }
    });
  }

  update(dt, camPos) {
    const R = CONFIG.render;
    this.sky.position.copy(camPos);
    // 구름이 바람 방향으로 아주 천천히 흐른다 (텍스처 좌표는 0..1 로 감아 정밀도 유지)
    const o = this.cloudOff;
    o.x = (o.x - this.cloudSpeed[0] * dt) % 1;
    o.w = (o.w - this.cloudSpeed[1] * dt) % 1;
    if (!R.shadows) return;
    // 그림자 영역은 플레이어 중심. 많이 움직였을 때만 다시 맞추고(텍셀 격자에 맞춰 떨림 방지),
    // 그 밖에는 shadowRefreshTime 간격으로만 다시 그린다 (움직이는 병사)
    this.shadowTimer += dt;
    const moved = Math.hypot(camPos.x - this.shadowCenter.x, camPos.z - this.shadowCenter.z);
    let refresh = this.shadowTimer >= R.shadowRefreshTime;
    if (moved > R.shadowRecenter) {
      const t = this.texel;
      this.shadowCenter.set(Math.round(camPos.x / t) * t, camPos.y, Math.round(camPos.z / t) * t);
      const c = this.shadowCenter;
      this.sun.target.position.set(c.x, c.y - 1.5, c.z);
      this.sun.position.set(c.x + this.sunDir.x * 250, c.y - 1.5 + this.sunDir.y * 250, c.z + this.sunDir.z * 250);
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();
      refresh = true;
    }
    if (refresh && this.renderer) {
      this.shadowTimer = 0;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }
}

// =============================================================================
// config.js — 게임의 모든 조정 가능한 수치를 모은 곳
// 단위: 거리 m, 시간 s, 속도 m/s, 각도는 이름에 Deg/Mrad가 붙지 않으면 rad.
// 무기·탄약·병사 종류·재질은 여기의 데이터 정의만 추가하면 새 종류가 생긴다.
// 맵 배치(좌표)는 world/mapData.js 에 있다.
// =============================================================================

export const CONFIG = {
  // ---------------------------------------------------------------- 렌더링
  // (pixelRatioMax·antialias·shadows·shadowMapSize·shadowRadius 는 시작할 때 그래픽 품질 프리셋(quality.presets)이 덮어쓴다)
  render: {
    pixelRatioMax: 1.5,
    // 프레임이 떨어지면 렌더 해상도를 자동으로 낮춘다 (일반 노트북 60fps 목표)
    dynamicResolution: true,
    pixelRatioMin: 0.65,
    targetFps: 58,
    antialias: true,
    // 흐린 날: 아주 옅고 부드러운 그림자를 플레이어 주변에만 쓴다 (그 밖은 접지 그림자 데칼 — contactShadows)
    shadows: true,
    shadowMapSize: 2048,
    shadowHalfExtent: 80, // 그림자 반경 (플레이어 중심, 지면 기준 m)
    shadowFadeStart: 0.7, // 반경 대비 이 비율부터 가장자리까지 그림자가 서서히 사라진다
    shadowRadius: 4, // PCF 흐림 반경 (텍셀) — 클수록 부드럽다
    shadowRecenter: 8, // 플레이어가 이만큼 움직이면 그림자 영역을 다시 맞추고 다시 굽는다 (m)
    shadowRefreshTime: 0.25, // 그 밖에는 이 간격으로만 그림자 맵을 다시 그린다 (움직이는 병사용, s)
    fovDeg: 62, // 기본 수직 시야각
    adsZoom: 1.3, // 가늠자 조준 시 확대 배율
    adsTransitionTime: 0.22,
    near: 0.08,
    far: 6000, // 원경 지형·먼 마을(distant.maxRange 4.8km)까지 담는다. 하늘 돔 반지름 = far × 0.85
    // 색감: ACESFilmic 톤매핑 뒤에 채도·색조 보정 (후처리 패스 없이 각 재질 셰이더 안에서, Atmosphere.js)
    // grade.saturation 1 / tint [1,1,1] 이면 순수 ACESFilmic. 하늘·안개색·파티클은 톤매핑을 받지 않는다 (화면 값 그대로)
    exposure: 1.6,
    // lift: 흐린 날 산란광처럼 어두운 쪽만 들어 올린다 (ACES 발끝이 흑토·풀밭을 검게 뭉개지 않게, 하늘·밝은 벽은 거의 그대로).
    //  화면 출력(선형) 밝기 l 에 amount·l/(l+knee)·(1 - l/end)² 를 더한다 (knee: 아주 검은 곳은 덜 올림, end: 이 밝기부터는 그대로).
    //  neutral: 더한 빛 중 회색(색조 없음)으로 더하는 몫 — 나머지는 원래 색조를 유지하며 밝힌다. amount 0 이면 끈다
    //  현재 값 (화면 밝기 0~255, 예전 노출 1.55·lift 없음 기준) → 15→34, 26→48(가까운 흑토), 36→58, 55→75(마른 풀밭), 80→94, 120→126, 135→139
    grade: { saturation: 0.74, tint: [0.955, 0.99, 1.055], lift: { amount: 0.055, knee: 0.02, end: 0.4, neutral: 0.3 } },
  },

  // ---------------------------------------------------------------- 그래픽 품질 프리셋 (낮음 / 보통 / 높음)
  // 일시정지 메뉴(브리핑 화면에도 있음)에서 고르면 실행 중 바로 적용되고, 고른 값은 브라우저(localStorage)에 기억된다
  // (저장소를 못 쓰는 환경이면 매번 default). 시작할 때 고른 프리셋이 아래 원래 설정 키를 덮어쓴다:
  //  vegetationDensity → vegetation.density   해바라기·풀을 생성한 양에서 그리는 비율 (은폐 판정은 프리셋과 무관하게 그대로)
  //  vegetationLod     → vegetation.lodScale  식생 거리 배수: 해바라기 3D↔빌보드 전환 40m·빌보드↔원거리 밭 띠 125m, 풀 보이는 거리 110m 에 곱한다
  //  terrainLod        → terrain.mesh.lodDistance  100m 지형 묶음이 고해상도 메시를 쓰는 거리 (m, 묶음 중심 기준 — 75 아래로 내리면 서 있는 묶음까지 거칠어진다)
  //  shadows, shadowMapSize, shadowRadius → render.*  플레이어 주변 옅은 그림자 (켜고 끌 때 재질이 한 번 다시 컴파일되어 잠깐 멈칫한다)
  //  distantRange      → distant.range        맵 밖 원경 지형·먼 마을·송전선을 그리는 거리 (맵 중심에서 m)
  //  pixelRatioMax     → render.pixelRatioMax 고해상도(배율 125%·150%) 화면의 렌더 해상도 상한. 동적 해상도는 그 아래에서 조절
  //  antialias         → render.antialias     MSAA — WebGL 문맥을 만들 때만 정해지므로 페이지를 새로 고쳐야 적용된다
  // 보통 = 기본값 (내장 그래픽 노트북 기준). 높음 = 프리셋을 넣기 전의 수치 (식생 전부·그림자 2048·원경 4.5km). 보통에서 60fps 가 안 나오면 보통 수치를 낮춘다
  quality: {
    default: 'medium',
    storageKey: 'suppressfps.quality',
    presets: {
      low: { label: '낮음', vegetationDensity: 0.45, vegetationLod: 0.72, terrainLod: 90, shadows: false, shadowMapSize: 1024, shadowRadius: 2, distantRange: 2000, pixelRatioMax: 1.0, antialias: false },
      medium: { label: '보통', vegetationDensity: 0.7, vegetationLod: 0.85, terrainLod: 120, shadows: true, shadowMapSize: 1024, shadowRadius: 2.5, distantRange: 3500, pixelRatioMax: 1.25, antialias: true },
      high: { label: '높음', vegetationDensity: 1.0, vegetationLod: 1.0, terrainLod: 150, shadows: true, shadowMapSize: 2048, shadowRadius: 4, distantRange: 4500, pixelRatioMax: 1.5, antialias: true },
    },
  },

  // ---------------------------------------------------------------- 대기·조명
  atmosphere: {
    // 안개색 = 하늘 지평선 색 (화면 출력 sRGB 값 그대로). 하늘 돔 지평선·배경·파티클 안개가 모두 이 색으로 녹아든다
    fogColor: 0x8d9192,
    // 적 AI 시야 감쇠(Perception)에 쓰는 FogExp2 밀도 — 렌더 안개(fog)와 별개 (바꾸면 적 발견률이 바뀐다)
    fogDensity: 0.0029,
    // 렌더 안개: 지형·식생(인스턴스 포함)·구조물·파티클·원경이 모두 같은 식 (Atmosphere.js 가 Three.js fog 청크를 바꿔 끼운다)
    //  광학 깊이 tau = linear·d + (quad·d)²,  가까운 투과율 A = e^-tau,  먼 곳 몫 B = farResidual·e^(-d/farLength)
    //  → 투과율 T = (A^p + B^p)^(1/p)  (p = blendPow: 둘 중 큰 쪽을 부드럽게 고름 → 거리에 따라 항상 짙어지고 꺾임이 없다)
    //  d = 카메라에서의 실제 거리 (화면 깊이가 아니라서 고개를 돌려도 안개가 같다)
    //  linear 항: 가까운 곳부터 대기 원근감, quad 항: 시정 600m 근처에서 빠르게 짙어짐 (600m 에서 거의 안개색)
    //  farResidual·farLength: 600m~1.5km 마을·송전탑·언덕이 희미한 실루엣(대비 4~5%)으로 남는 몫. 3km 너머에서는 이것도
    //   사라져 지평선이 칼 같은 선 없이 안개 속으로 녹아든다 (예전: 0.09·6000m → 원경 끝까지 대비 5~8% 가 남아 지평선이 선으로 보였다)
    //  hazeHeight: 높이 안개 (지면 연무가 위로 갈수록 옅어짐, 높이 오른 연기·탑 끝이 덜 묻힌다), m
    //   → 먼 실루엣은 지면 쪽 몫 대신 이 항으로 읽히게 한다 (1.1~1.6km 원경 연기 200m 높이: 안개 67~88%)
    //  현재 값 (지면 높이) → 50m 5%, 100m 13%, 200m 33%, 300m 55%, 400m 73%, 600m 92%, 1km 95%, 2km 97%, 3km 98%, 4.5km 99%
    fog: { linear: 0.00075, quad: 0.0025, farResidual: 0.08, farLength: 2200, blendPow: 4, hazeHeight: 70 },
    // 지면 연무: 땅에 붙은 얇은 연무층 (밀도 ∝ e^(-지면 기준 높이/height)). 위 안개의 광학 깊이에 더한다 (같은 셰이더 식)
    //  더하는 양 = tau · M · (1 - e^(-d/length)),  M = 카메라→물체 시선이 지나는 높이에서 연무층 밀도의 평균 (0..1)
    //  → 땅을 스치는 긴 시선(눈높이에서 50~250m 지면)만 더 뿌옇게: 지면이 지평선 쪽으로 서서히 밝아져 안개 띠와 칼 같은 선 없이 이어진다.
    //   높이 솟은 것(저장탑 끝·먼 언덕 마루·연기 기둥)은 M 이 작아 거의 그대로. 낮은 땅(수로·움푹한 곳)은 연무가 조금 더 짙다.
    //  ref: 연무층 바닥 월드 높이 (m, 맵 지면 중간값 근처 — 그 아래는 최대 밀도). length: 이 거리 안에서 차오르고 그 너머는 더 늘지 않는다
    //   (먼 곳은 위 대기 안개가 이미 덮는다). tau 0 이면 끈다. 렌더링만 바꾼다 — 적 AI 시야(fogDensity)와는 무관
    //  위 fog 와 합친 지면 안개 (선 눈높이에서 지면) → 50m 11%, 100m 22%, 150m 32%, 200m 43%, 250m 53%, 300m 62%, 400m 78%, 600m 93%
    //   (서 있는 1m 높이 병사 200m 41%, 축사 벽 3m 높이 38%, 저장탑 끝 20m 30%, 지면 연무 없이 33%)
    //  lowland: 수로 남쪽 저지대 연무 (아군 후방 — 땅이 남쪽으로 낮아지며 늦가을 연무가 더 짙게 깔린다, world.northRiseSlope).
    //   수로 남쪽은 100m 안팎의 낮은 둔덕 너머로 땅이 1~2m 꺼져 그 골짜기가 가려진다 → 둔덕 마루(안개 22%) 바로 위에
    //   먼 골짜기(52%)가 붙어 남쪽 지평선이 곧은 선으로 보였다. 저지대 안 지면이 둔덕까지 서서히 연무에 묻히게 해 그 선을 녹인다.
    //   밀도: 수로 중심에서 남쪽 start m 에서 0 → ramp m 에 걸쳐 1. 더하는 양 = M · tau · (1 - e^(-L/length)), L = 시선이 저지대 안을
    //   지나는 길이(밀도 가중). 북쪽 적 진지·중간 지대 쪽 시선과 수로를 따라 동서로 보는 시선은 그대로 (L = 0).
    //   남쪽 지면 (수로 남쪽 둑에서 선 눈높이) → 25m 12%, 50m 34%, 100m 55%, 250m 76% (lowland 없이 6 / 12 / 22 / 53%).
    //   → 시점 5 지평선: 안개 띠(139)에서 지면(약 95)까지 9px 안의 계단 대신 20px 넘게 서서히 어두워진다 (720p).
    //   저지대 안(수로 남쪽 50m 너머)에 서 있으면 사방이 조금 더 뿌옇다. 더 짙게 = tau ↑, 더 가까이서부터 = start·length ↓. tau 0 이면 끈다
    groundHaze: { tau: 0.22, length: 110, height: 3.5, ref: 0.5, lowland: { tau: 0.8, start: 13, ramp: 35, length: 45 } },
    skyZenith: 0x5e6367, // 물웅덩이·젖은 흙 반사용 하늘 위쪽 색
    skyHorizon: 0x8d9192, // = fogColor (물웅덩이·젖은 흙 반사용)
    // 절차적 흐린 하늘 돔: 층운 구름판의 명암 얼룩 (두꺼운 곳 = 구름 아래쪽이 더 어두운 회색), 아주 천천히 흐른다
    sky: {
      cloudLit: 0x868a8e, // 얇은 곳 (빛이 비쳐 밝은 회색)
      cloudDark: 0x64686c, // 두꺼운 구름 아래쪽
      zenithShade: 0.94, // 머리 위로 갈수록 이 배수까지 어두워짐
      cover: 0.48, // 구름 두께 문턱 (높을수록 밝은 틈이 많다)
      softness: 0.34, // 명암 경계 부드러움 (층운: 넓게 번진 얼룩)
      detail: 0.32, // 작은 구름 무늬 세기
      layerHeight: 1200, // 가상의 구름판 높이 (m) — 무늬 크기·이동 속도 환산용
      tileSize: [5200, 1500], // 큰 층 / 작은 층 텍스처 한 장이 덮는 크기 (m)
      speed: [7, 11], // 큰 층 / 작은 층 이동 속도 (m/s, 바람 방향) — 화면에선 아주 천천히
      // 지평선 연무 띠 두께 배수 (유효 거리 = hazeHeight·hazeMul / sin(고도), 지평선은 항상 정확히 안개색)
      //  1.15 → 고도 1° 99%, 5° 95%, 10° 약 81%, 20° 41%, 머리 위 10% (hazeHeight 를 90 → 70 으로 줄인 만큼 띠를 예전 두께로 맞춤)
      hazeMul: 1.15,
      sunGlow: 0x1c1a16, // 구름 뒤 해 쪽 하늘이 밝아지는 양 (더하는 색)
      sunGlowPower: 5,
      textureSize: 256,
    },
    // 조명: 반구광(하늘 회백색 / 땅 어두운 갈색) + 구름 뒤 해를 흉내 낸 약한 방향광
    hemiSky: 0xd2d6d9,
    hemiGround: 0x3d352d,
    hemiIntensity: 2.2,
    sunColor: 0xefe7db,
    sunIntensity: 1.0,
    sunAzimuthDeg: 235, // 해 방위각 (0 = 북, 시계방향) — 늦가을 오후, 남서쪽 낮은 해
    sunElevationDeg: 22,
    shadowIntensity: 0.7, // 그림자 진하기 (흐린 날이라 해 자체가 약해 실제로는 바닥이 10% 남짓 어두워질 뿐, 0..1)
    windDirection: [1, 0, -0.35],
    windSpeed: 4.5,
  },

  // ---------------------------------------------------------------- 접지 그림자 데칼 (차량·잔해·건물 아래, 한 메시)
  // 실제 그림자는 플레이어 주변 render.shadowHalfExtent 안에서만 옅게 쓰고, 물체가 땅에 붙어 보이게 하는 건 이 데칼이 맡는다.
  // soft: 발자국 바깥으로 번지는 폭(m), strength: 어둡기(0..1), inner: 발자국 안쪽 깊은 곳 어둡기 배수 (지붕 없는 건물 바닥 등)
  contactShadows: {
    color: 0x0c0b0a,
    lift: 0.05, // 지형 위로 띄우는 높이 (m)
    gridStep: 1.25, // 지형을 따라 휘는 격자 간격 (m)
    innerWidth: 1.6, // 발자국 가장자리에서 안쪽으로 이 폭까지는 strength 그대로, 그 안은 inner 배
    vehicle: { soft: 1.3, strength: 0.72, inner: 1 },
    building: { soft: 1.5, strength: 0.5, inner: 0.45 },
    rubble: { soft: 1.2, strength: 0.42, inner: 0.85 },
    small: { soft: 0.7, strength: 0.4, inner: 1 },
  },

  // ---------------------------------------------------------------- 연기 기둥 (파티클, 위치는 MAP.smokeSources / MAP.distantSmoke)
  // 지면 근처 발원점에서 짙게 시작해 올라가며 넓어지고 옅어진다. bendHeight 위에서 바람을 받아 휘어 길게 흘러간다.
  // 부드러운 원형 스프라이트 수십 장이 각각 아주 천천히 돌고 커진다 (한 덩어리 풍선이 아니라 기둥).
  smoke: {
    maxParticles: 1000,
    shade: 0.28, // 스프라이트 위쪽 밝게·아래쪽 어둡게 (하늘빛을 받는 부피감)
    // 건물 화재: 가는 기둥, 회색~검정
    fire: {
      rate: 5, // 초당 스프라이트 수
      life: [26, 34],
      rise: [1.5, 2.3], // 초기 상승 속도 (m/s)
      riseDrag: 0.045, // 상승 감쇠 (1/s) → 최종 높이 ≈ rise / riseDrag
      windDrag: 0.09, // 바람에 실려 가는 정도 (1/s)
      bendHeight: 14, // 이 높이(발원점 기준)에서 바람을 다 받는다 (그 아래는 바람이 약해 곧게 선다)
      windMin: 0.12, // 발원점 바로 위에서 받는 바람 비율
      size: [1.2, 2.1], // 처음 크기
      grow: [10, 16], // 수명 끝 크기
      spread: 0.5, // 발원점 퍼짐 반경 (m)
      alpha: 0.36,
      colorNear: [0x1d1b1a, 0x2a2826], // 발원점 근처 (검정에 가까움)
      colorFar: [0x4a4a4a, 0x5d5e5f], // 흩어진 위쪽 (회색)
      prewarm: 40, // 시작할 때 미리 흘려 두는 시간 (s)
    },
    // 원경 연기 기둥: 크고 느리다, 안개색에 섞여 옅게 보인다
    // (발원점 근처는 지면 연무에 거의 묻히고, 200m 이상 올라간 부분이 하늘에 희미한 기둥으로 드러난다)
    distant: {
      rate: 1.1,
      life: [100, 130],
      rise: [7, 9],
      riseDrag: 0.03, // 최종 높이 약 270m
      windDrag: 0.03,
      bendHeight: 150,
      windMin: 0.1,
      size: [16, 26],
      grow: [120, 180],
      spread: 6,
      // 발원점(어린 연기)만 짙은 회갈색, 흩어진 위쪽은 안개색(atmosphere.fogColor)에 가까운 옅은 회색 → 먼 기둥이 검은 띠로 튀지 않는다
      alpha: 0.4,
      colorNear: [0x302e2b, 0x3a3835],
      colorFar: [0x75787a, 0x7f8284],
      prewarm: 160,
    },
  },

  // ---------------------------------------------------------------- 지형·맵
  world: {
    halfSize: 300, // 맵 600x600m (원점 중심, 북쪽 = -Z, 동쪽 = +X)
    heightRes: 0.5, // 높이 격자 해상도
    surfaceRes: 1.0,
    skirtDepth: 0.6,
    seed: 1987,
    northRiseSlope: 0.006, // 남→북으로 완만히 높아짐 (적 진지가 약간 높다)
    // 이동 가능 구역 (플레이어)
    playArea: { minX: -255, maxX: 255, minZ: 30, maxZ: 265 },
    boundaryWarnMargin: 6, // 경계 이 거리 안쪽부터 경고
    boundaryReturnTime: 4, // 경계 밖에 이 시간 이상 있으면 되돌림
  },

  // ---------------------------------------------------------------- 지형 형태 (기복·고랑·구덩이·농로·메시)
  terrain: {
    // 맵 전체의 완만한 기복: 노이즈 크기(m)·진폭(m). 파장 50~150m, 높이차 0.5~1.5m
    undulation: {
      large: { size: 80, amp: 0.72 },
      medium: { size: 34, amp: 0.26 },
      fine: { size: 12, amp: 0.05 },
      // 수로~적 진지 사이(사격 회랑)는 솟은 곳을 ridgeMul 배로 눌러 우묵한 곳(국지 사각지대)만 남긴다 → 사선 유지
      corridor: { x0: -265, x1: 265, z0: -228, z1: 100, fade: 35, ridgeMul: 0.25 },
      canalDamp: 0.3, // 수로 바로 옆 기복 배율 (canalDampDist 거리에서 1)
      canalDampDist: [6, 32],
      padDampDist: [4, 26], // 건물·차량 바닥 둘레에서 기복을 줄이는 거리
      trenchDamp: 0, // 참호선 바로 옆 기복 배율 (흉벽 높이·참호 사격 위치 사선을 1단계와 같게)
      trenchDampDist: [8, 30],
      trenchOffset: -0.1, // 참호선 둘레는 기복 대신 이만큼 낮게 (뒤쪽 건물 엎드려쏴 사선이 흉벽에 걸리지 않게)
    },
    // 고랑: 깊이는 셰이더 노멀·어둡기용 (해석적, 화면에서 가늘어지면 평균). 실제 형상은 ridge (렌더 전용 얕은 골판 메시):
    // 고랑 바닥 = 평균면 - geomDepth/2 (밭 지면 메시를 이만큼 내림), 마루 = 평균면 + geomDepth/2 → heightAt(평균면)과 ±5cm 이내
    furrow: {
      depth: 0.18,
      sunflowerDepth: 0.13,
      ridge: {
        geomDepth: 0.1, // 실제 형상 높이차 (m)
        lift: 0.012, // 골판을 내린 지면보다 이만큼 띄워 겹침 깜빡임 방지 (마루 높이는 그만큼 줄임)
        // 고랑을 따라가는 정점 간격 (m). 길면 기복이 휜 곳에서 평평 판정(lift 기준)에 걸리는 칸이 늘어 (3m: 약 13%, 1.5m: 약 9%)
        // 마루가 칸마다 꺼져 고랑이 토막 난 점선처럼 보인다
        alongStep: 1.5,
        // 이랑마다 정점 행을 엇갈리는 폭 (alongStep 비율, 0..1): 모든 이랑의 행이 같은 자리에 줄지으면 행마다 꺾이는
        // 정점색·법선·마루 높이가 고랑을 가로지르는 가로줄(바둑판 무늬)로 보인다
        rowStagger: 1,
        chunk: 32, // 골판 묶음 크기 (m) — 묶음 중심이 카메라에서 fadeDistance[1] + 반대각선 안일 때만 그린다
        fadeDistance: [18, 30], // 이 거리 사이에서 형상이 납작해진다 (m)
        fadePhase: [0.2, 0.42], // 화면 1px 당 고랑 위상 변화가 이 범위면 납작하게 (= 고랑 간격 5px → 2.4px, 모아레 방지)
        troughShade: 0.74, // 고랑 바닥 정점색 배수 (형상이 있는 곳만)
        crestShade: 1.2,
      },
    },
    // 포탄 구덩이 (지름 2~8m, 테두리는 항상 솟아 있다)
    craters: {
      count: 72, // 지정 구덩이 외 무작위 수 (MAP.craterZones 가중치로 몰림)
      radius: [1.0, 3.6],
      bigRadius: [3.6, 4.0],
      bigChance: 0.1,
      freshChance: 0.42, // 최근 구덩이: 날카로운 테두리 + 밝은 하층토 분출물
      rimFresh: [0.28, 0.48], // 테두리 높이 (m)
      rimOld: [0.2, 0.28], // 오래된 구덩이: 무뎌지고 풀이 남
      rimMaxNearLines: 0.3, // 참호 앞·수로 앞 구덩이 테두리 상한 (사선 유지)
      ejecta: [1.9, 3.0], // 최근 구덩이 분출물이 퍼지는 범위 (반지름 배수)
      waterMinDepth: 0.85, // 이보다 깊은 오래된 구덩이 바닥엔 물 (최근 구덩이는 1.25)
      // 수로 앞 오래된 구덩이(z > frontWaterZ: 적이 뛰어들지 않는 곳)는 물이 테두리 마루 바로 아래까지 차 있다
      // → 낮은 시선(엎드림·앉음)에서도 테두리 너머로 밝은 수면이 보인다. 물 높이 = 가장 낮은 테두리 마루 - frontWaterBelowRim
      frontWaterZ: 20,
      frontWaterMinDepth: 0.5,
      frontWaterBelowRim: 0.3,
      waterRays: 28, // 수면 윤곽 (구덩이 벽과 만나는 곳을 방사선으로 찾는다)
    },
    // 빗물 웅덩이: 개활지의 얕은 우묵한 곳(높이장에 실제로 판다, 사선과 무관)에 가장자리 바로 아래까지 고인 물.
    // 수로 앞 15~90m(시작 위치·엎드려쏴 홈 앞)에 더 모아 두어 낮은 시선의 거리감 단서(밝은 선·점)가 된다
    rainPuddles: {
      count: 40, // 사격 회랑 전체 (zone)
      zone: { x0: -245, x1: 245, z0: -45, z1: 94 },
      // 수로 앞 띠 (가까운 쪽부터): 엎드린 눈높이에선 30m 너머 땅이 지평선에 납작하게 붙으므로 가까운 곳에 더 많이
      focus: [
        { x0: -42, x1: 18, z0: 74, z1: 102, count: 12 },
        { x0: -46, x1: 24, z0: 22, z1: 74, count: 8 },
      ],
      canalClear: 7.5, // 수로 중심선에서 이 거리 안(북쪽 둔덕 포함)에는 파지 않는다 (m)
      radius: [0.8, 2.3], // 짧은 반지름 (m)
      stretch: [1.2, 1.8], // 긴 반지름 배수 (밭에서는 고랑 방향으로 2배 더)
      depth: [0.05, 0.09], // 우묵한 곳 깊이 (m)
      brim: 0.012, // 물 높이 = 가장 낮은 가장자리 - brim
      gap: 4, // 다른 웅덩이·구덩이·길·궤도 자국과 띄우는 거리 (m)
    },
    // 농로: 두 줄 바퀴 자국(물 고임) + 길가 배수로
    road: {
      rutOffset: 0.85, // 길 중심 → 바퀴 자국 중심
      rutFlat: 0.17, // 바퀴 자국 바닥 반폭
      rutWall: 0.26, // 바닥 가장자리 → 자국 끝 경사 폭
      rutDepth: 0.17,
      crown: 0.04, // 길 가운데 솟음
      sink: 0.05, // 길 전체가 주변보다 꺼진 정도
      ditchOffset: 1.15, // 길 가장자리 → 배수로 중심
      ditchHalf: 0.8,
      ditchDepth: 0.36,
      puddleEvery: 7, // 바퀴 자국 물웅덩이 후보 간격 (m)
      puddleChance: 0.55,
    },
    // 밭 흙길 (MAP.roads 중 field: true): 자갈·배수로 없이 두 줄 바퀴 자국만 (간격·폭은 road 와 같음).
    // 수로 앞 10~70m 를 지나며 멀어질수록 좁아지는 두 줄 자국·고인 물이 낮은 시선(엎드림·앉음)의 거리감 단서가 된다
    //  rutDepth = 자국 깊이, lip = 자국 가장자리로 밀려 솟은 흙, mud = 자국 진흙 칠, puddleChance = 물 고인 구간 확률, endFade = 끝이 얕아지는 길이 (m),
    //  puddleLevel = 자국 바닥 위 수위 범위 (m): 가장자리 가까이까지 찬다 (단, 물웅덩이 구간의 가장 낮은 자국 가장자리 높이 - 1.2cm 를 넘지 않게
    //  — 높이장 0.5m 격자에서 자국 가장자리가 무뎌져 있어 실제로는 자연 지면 5~8cm 아래). 엎드린 눈(지면 위 약 0.4m)에서 10m 너머 땅은
    //  2° 아래로 스치듯 보여, 자국을 가로질러 보면 물이 자국 벽에 가리고 자국을 따라 보면(멀어지는 구간) 밝은 줄로 보인다 (농로 바퀴 자국 물은 5~10cm)
    fieldTrack: { rutDepth: 0.15, lip: 0.03, mud: 0.85, puddleChance: 0.75, endFade: 8, puddleLevel: [0.1, 0.135] },
    // 궤도 차량 자국 (MAP.vehicleTracks): 띠 반폭·깊이, 눌린 진흙 띠의 궤도판 무늬 간격·세기(근거리 노멀), 물 고인 구간 후보 간격·확률
    //  treadJitter = 궤도판 간격 흔들림 (주기 비율), treadShade = 궤도판 골 어둡기, albedo = 띠 알베도 배수 (주변 흙보다 어둡게),
    //  sheen / water = 띠 안에 남기는 하늘 윤기·진흙 물기 비율 (밝은 물은 띠 바닥 물웅덩이에만), endFade = 자국 양 끝이 옅어지며 사라지는 길이 (m),
    //  puddleLen / puddleLevel = 띠 바닥 물웅덩이 길이 범위 (m)·바닥 위 수위 범위 (m, 낮을수록 경사진 바닥의 낮은 쪽에만 짧게 고인다)
    tracks: {
      bandHalf: 0.3,
      depth: 0.1,
      mud: 0.85,
      treadPitch: 0.17,
      treadStrength: 0.18,
      treadJitter: 0.25,
      treadShade: 0.1,
      albedo: 0.8,
      sheen: 0.2,
      water: 0.12,
      roughness: 0.92, // 띠 거칠기 (무광 — 해 쪽을 봐도 번들거리는 밝은 띠가 되지 않게)
      sunSpecular: 0.4, // 띠 위 해 반사 배수
      endFade: 7,
      puddleEvery: 9,
      puddleChance: 0.45,
      puddleLen: [1.5, 4.5],
      puddleLevel: [0.015, 0.04],
    },
    vehiclePadMargin: 2.5, // 차량 아래 지면을 평평하게 고르는 둘레
    // 렌더 메시: 5m 청크마다 해상도(0.5~5m)를 고르고, 100m 묶음마다 근거리/원거리 2단계 LOD
    mesh: { chunk: 5, group: 100, baseRes: 2.5, farBaseRes: 5, lodDistance: 150, lodHysteresis: 0.08 },
  },

  // ---------------------------------------------------------------- 지면 재질 (스플랫 혼합)
  ground: {
    maskRes: 0.5, // 혼합 마스크 해상도 (m/텍셀)
    textureSize: 512, // 재질 텍스처 한 장 크기 (px)
    // 재질 순서: 0 젖은 갈아엎은 흑토, 1 그루터기 밭, 2 마른 풀밭, 3 진흙, 4 밝은 하층토, 5 자갈 섞인 흙길
    layerTile: [2.2, 2.0, 2.6, 3.0, 2.4, 2.0], // 텍스처 한 장이 덮는 크기 (m)
    roughness: [0.8, 1.0, 1.0, 0.5, 0.96, 0.9], // 젖은 흙·진흙은 약한 광택, 마른 풀·흙은 무광
    wetSheen: [0.08, 0, 0, 0.3, 0, 0.03], // 낮은 각도에서 흐린 하늘이 비치는 정도
    detailTile: 0.55, // 근거리 디테일 한 장 크기 (m)
    detailFade: [3, 14], // 이 거리 사이에서 디테일이 사라짐
    detailStrength: 0.6,
    antiTileScale: 1.37, // 반복 깨기: 두 번째 샘플 크기 배수
    antiTileDistance: 50, // 반복 깨기 두 번째 샘플을 쓰는 거리 (그 너머는 밉맵이 평균을 내 반복이 안 보임)
    fieldAntiTileRotDeg: 9, // 밭 재질(고랑 방향 좌표) 반복 깨기 두 번째 샘플 회전 (흙덩이 결이 크게 돌지 않게 작게)
    // 이방성 필터: 알베도(주 재질)는 항상 GPU 최대값. 노멀·혼합 마스크·섞이는 두 번째 재질은 이 값까지 (픽셀당 비용 절약)
    normalAnisotropy: 4,
    maskAnisotropy: 4,
    macroSizes: [61, 9.5, 530], // 큰 색 변화 / 반복 깨기 섞기 / 맵 밖 밭·풀밭 얼룩 노이즈 크기 (m)
    macroStrength: [0.26, 0.1],
    heightBlend: 0.35, // 재질 경계에서 높이(돌·풀 포기)가 높은 쪽이 이기는 정도
    variation: { size: [45, 11], amp: [0.07, 0.035] }, // 정점색 밝기 변화
    ao: { power: 1.2, min: 0.32, fineDists: [0.6, 1.3, 2.6, 5.0], coarseDists: [3, 7] }, // 굽는 앰비언트 오클루전
    waterInFurrows: 0.3, // 젖은 저지대 밭: 고랑 바닥에서 이 높이(이랑 비율)까지 물
    // 셰이더 해석적 고랑(어둡기·노멀)을 화면 1px 당 고랑 위상 변화(fwidth)가 이 범위일 때 평균으로 흐린다 (0.12 = 고랑 간격 약 8px,
    // 0.32 = 약 3px). 간격 4~8px 의 진한 고랑을 픽셀마다 한 점씩 읽으면 모이는 줄이 가로 물결(모아레)로 엇갈려 고랑을 가로지르는
    // 바둑판 무늬가 된다 (30~60m). 해상도가 높을수록 같은 거리의 간격이 넓어 더 멀리까지 남는다
    furrowAA: [0.12, 0.32],
    // 물웅덩이 메시: deepColor = 수직으로 내려다볼 때 물색 (검은 구멍이 아니라 어두운 회갈색), reflect = 하늘 반사 세기,
    // minReflect = 가파른 각도에서도 비치는 하늘 몫, edgeSoft = 물가 선의 폭 (수심 m — 작을수록 또렷한 물가),
    // edgeNoise = 물가 선을 흔드는 양 (m 수심), opacity = 깊은 곳 불투명도, shallowAlpha = 물가 바로 안쪽 얕은 띠(수심 shallowDepth m 까지)의
    // 불투명도 배수 (바닥 진흙이 조금 비침), cloudReflect = 비친 구름 명암 얼룩 세기, wetRing = 물가 바깥 젖은 진흙 테 (지면 혼합).
    // 웅덩이 수심은 물가로 갈수록 완만하게 0 이 되므로 edgeSoft·shallowDepth 를 크게 잡으면 물가가 수십 cm 폭으로 번진다
    puddle: {
      deepColor: 0x3b3936,
      reflect: 1.0,
      minReflect: 0.2,
      opacity: 0.94,
      edgeSoft: 0.003,
      edgeNoise: 0.01,
      shallowAlpha: 0.72,
      shallowDepth: 0.01,
      cloudReflect: 0.16,
      wetRing: 0.9,
    },
    // 해(방향광) 반사: 흐린 날이라 지면은 넓고 약한 윤기만. 물·젖은 흙은 하늘 반사(프레넬, 지평선 색 이하)로만 밝아진다
    sunSpecular: 0.22, // 지형 전체 해 반사 배수
    sunSpecularCap: 0.6, // 해 반사 상한 (물에 비친 지평선 하늘 밝기 배수 — 해 쪽을 봐도 땅이 하늘보다 밝아지지 않게)
    waterSunSpecular: 0.1, // 물(고랑 물·진흙 물기) 위에서 한 번 더 곱하는 배수
    roughnessMin: 0.55, // 해 반사 거칠기 하한 (좁은 하얀 번쩍임 대신 넓은 윤기)
    waterRoughness: 0.6,
    waterReflect: 0.85, // 고인 물에 비치는 하늘 세기 (1 = 지평선 색 그대로)
    // 가파른 면(둔덕 앞면·사격 홈 벽·구덩이 벽): 수평 투영은 세로로 늘어나므로 수직 투영과 섞는다 (법선 y 가 [0] 이상 = 수평만, [1] 이하 = 수직만)
    steepBlend: [0.8, 0.62],
    // 이방성 필터를 GPU 최대값으로 올리는 지형 LOD 거리 (그래픽 품질 '높음' terrainLod 150 이상이면 노멀·마스크·두 번째 층도 최대값)
    fullAnisotropyLod: 150,
  },

  // ---------------------------------------------------------------- 관개수로 (플레이어 진지) 외형 — 단면·배치 좌표는 MAP.canal
  canal: {
    // 프리캐스트 판 (약 1x2m): 폭(수로 방향)·길이(비탈 방향, 바닥 밑에 묻히는 toe 포함)·두께(대부분 흙 속)
    // proud = 판 윗면이 비탈(충돌 높이장)보다 올라온 양, joint = 판 사이 이음매 틈
    // (보이는 길이 = length - toe ≈ 1.86m: 비탈 아래 끝에서 둥근 위 모서리 직전까지)
    slab: { width: 1.0, length: 1.93, toe: 0.07, thick: 0.22, proud: 0.006, joint: 0.014 },
    // 판 아래 지형 렌더 메시를 내리는 양: 바닥 모서리 근처(격자 보간 때문에 흙이 판 윗면을 뚫고 나오는 곳) / 판 가운데(겹침 깜빡임 방지)
    // / 빠진 판 자리 (흙이 드러난 얕은 홈). 판 위쪽 끝은 내리지 않아 흙과 맞닿는다
    renderDrop: 0.06,
    renderDropMid: 0.016,
    holeDrop: 0.07,
    // 판 상태 확률: 빠짐 / 모서리 깨짐(철근 노출) / 금 가서 어긋남 / 기울어짐·미끄러짐
    slabChance: { missing: 0.06, corner: 0.05, cracked: 0.12, tilted: 0.1 },
    rebar: { perEdge: [2, 4], length: [0.08, 0.3], size: 0.011, color: 0x6e4c38 },
    slabTint: [0.84, 0.98], // 판마다 밝기 배수
    slabBottomShade: 0.78, // 판 아래쪽 끝(수로 바닥 쪽) 정점색 배수 (위쪽 끝 = 1)
    slabTexture: { width: 1024, height: 512, variants: 4 }, // 판 텍스처 아틀라스 (판 하나 = 256x512px)
    // 모래주머니 사격 위치: 양옆 더미 사이 틈 폭, 마루를 낮춘 사격 홈 폭(가운데), 더미 길이·단 수,
    // 더미 바깥 끝을 사수 쪽(남쪽)으로 굽힌 각(rad, 말굽 모양) — 앉은 사수의 사계가 정면 ±40° 정도 트인다
    // bagsPerRow = 아랫단·맨 윗단 한 줄의 자루 수 (자루 간격 = stackLen / bagsPerRow = 자루 길이, 가운데 단은 양끝 마구리 + 길이 방향),
    // layerStep = 단 간격 (자루 높이보다 1cm 작아 위 자루가 아래 자루를 누른다 — 단 사이로 하늘이 비치지 않게),
    // sink = 맨 아랫단이 흙에 묻힌 깊이, sag = 자루 양끝이 처지는 최대 양 (m), row0 = 앞줄 가운데의 마루 뒤 거리,
    // colR·colHalfDepth = 충돌 상자 가운데(마루 뒤 거리)·반폭 (예전 더미와 같게 — 적 사격 위치 시야 유지), bottomDark = 자루 아래쪽 어둡게
    sandbag: { gap: 2.0, slot: 0.9, stackLen: 1.04, layers: 3, wrap: 0.25, bagsPerRow: 2, layerStep: 0.16, sink: 0.025, sag: 0.014, row0: 0.06, colR: 0.22, colHalfDepth: 0.26, bottomDark: 0.22 },
    // 모래주머니 한 자루 모양 (눌린 베개: 초이차곡면) — 수로 둔덕 더미(병합 기하)와 참호·엄체호 인스턴스가 같이 쓴다
    // len·width = 길이·폭, hTop·hBot = 가운데에서 윗면·바닥까지 (높이 0.17m), sideExp = 옆 단면 둥글기 (2 = 타원, 클수록 각짐),
    // flatTop·flatBot = 윗면·바닥을 눌러 펴는 지수 (1 = 그대로, 작을수록 평평), endThin = 접어 묶은 양끝이 얇아지는 비율,
    // seg = 분할 [길이, 높이, 폭] (가까이서 보는 수로 더미) / segInst = 인스턴스용 (멀리서 보는 참호)
    bag: { len: 0.52, width: 0.32, hTop: 0.095, hBot: 0.075, sideExp: 2.6, flatTop: 0.7, flatBot: 0.45, endThin: 0.22, seg: [6, 3, 4], segInst: [4, 2, 3] },
    // 북쪽 둔덕 지면 칠 (Terrain.paintCanal): 흑토 흙덩이 비율, 하층토 비율 [적은 곳, 많은 곳] (노이즈로 섞임),
    // 마루·뒤쪽 마른 풀 [듬성한 곳, 덮인 곳]. 앞면에서 흙덩이·하층토가 늘 가장 큰 두 재질이어야 셰이더 혼합 경계가 생기지 않는다
    bermPaint: { clods: 0.6, subsoil: [0.36, 0.6], grass: [0.3, 0.85] },
    // 수로 바닥 잡동사니 개수 (타이어·양동이·탄약 상자), 놓을 x 범위, 시작 위치 둘레 비움 (m)
    junk: { tyres: 9, buckets: 6, crates: 8, xRange: [-150, 150], spawnClear: 4 },
    // 버려진 타이어 (승용차): 단면 중심 반지름, 단면 반높이(지름 방향)·반폭(축 방향), 단면 둥근 직사각형 지수, 분할 [단면, 둘레],
    // 색(sRGB, 바랜 고무 / 진흙), 안쪽 테두리(비드) 어둡게, 트레드 홈(둘레 분할 하나 건너 어둡게), 진흙이 묻는 높이 [완전, 없음] (바닥 위 m),
    // 선 타이어가 바닥에 박힌 깊이, 누운 타이어 가운데 높이 (바닥 기준 — 반쯤 묻힘)
    tyre: { radius: 0.255, section: [0.08, 0.1], sectionExp: 3, seg: [8, 24], color: 0x48443e, mud: 0x5b5044, innerDark: 0.5, treadDark: 0.7, mudHeight: [0.04, 0.2], sink: 0.1, lyingY: 0.015 },
  },

  // ---------------------------------------------------------------- 식생 (말라 죽은 해바라기·마른 풀·갈대·부러진 나무) — Vegetation.js
  // 해바라기·풀·갈대는 InstancedMesh. LOD: 카메라 둘레 칸만 동적 인스턴스 버퍼에 모아 그리고(종류마다 드로우콜 1개),
  // 정점 셰이더가 거리로 디더 전환·축소한다. 모두 은폐만(탄 통과, 시야만 가림: CollisionWorld.addConcealer).
  // 그래픽 품질 프리셋: density·lodScale 을 바꾼 뒤 world.vegetation.applyConfig() (또는 setDensity(배수) / setLodScale(배수)).
  // 그림자는 받지도 드리우지도 않는다 (흐린 날 해가 약해 차이가 거의 없고, 겹침이 많아 비싸다). 안개는 표준 청크로 받는다.
  vegetation: {
    density: 1.0, // 밀도 배수 0..1 (해바라기·풀: 생성한 양에서 이 비율만 그린다 — 낮음 프리셋은 0.5 정도)
    lodScale: 1.0, // 모든 LOD 거리 배수 (해바라기 3D·빌보드 전환, 풀 보이는 거리)
    // 말라 죽은 해바라기 (줄 간격·방향 = MAP.fields.sunflower 의 spacing·furrowDeg: 지형 고랑과 같은 줄, 이랑 마루에 심는다)
    sunflower: {
      plantSpacing: [0.3, 0.4], // 포기 간격 (줄을 따라, m)
      height: [1.4, 2.0], // 줄기 높이 (m) — 모형 기준 높이는 Vegetation.SUNFLOWER_SHAPE.height
      widthScale: [0.85, 1.2], // 가로 배수 (모형: 줄기 굵기 2.7cm, 꽃판 지름 24cm → 2.3~3.2cm, 20~29cm)
      headBearingDeg: [90, 60], // 꽃판이 숙인 방위 (중심, ±폭) — 익은 해바라기는 대개 동쪽을 본다
      tilt: 0.07, // 선 줄기의 무작위 기울기 (rad)
      leanChance: 0.12, // 비스듬히 기운 줄기
      leanAngle: [0.18, 0.6],
      fallenChance: 0.025, // 그냥 쓰러진 줄기
      headlessChance: 0.06, // 꽃판이 떨어져 나간 줄기
      missingChance: 0.05,
      thirdLeafChance: 0.55, // 처진 잎 3장 (나머지는 2장)
      // 밭 가장자리: 경계(밭 구획 사각형)에서 edgeMin 밀도로 시작해 안쪽으로 edgeWidth × (1 ± edgeVar) (노이즈 edgeNoise 로 6~18m) 에 걸쳐
      // 빽빽해지고 키도 조금 작다. 노이즈가 낮은 곳은 경계가 edgeBite(m) 까지 안쪽으로 파고들어 비어 있다 (일직선으로 끊기지 않게)
      edgeWidth: 12,
      edgeVar: 0.5,
      edgeMin: 0.15,
      edgeBite: 4,
      edgeNoise: { size: 22, amp: 7, detailSize: 6, detailAmp: 2 },
      edgeHeight: 0.8, // 가장자리 줄기 키 배수 (안쪽 1)
      straggle: { dist: 8, chance: 0.15 }, // 밭 밖 머리땅: 경계에서 chance 확률로 시작해 dist(m) 에서 0 이 되는 드문드문 남은 줄기
      // 구역마다 키가 다름 (윗선이 평평한 울타리처럼 보이지 않게): 큰 얼룩 size/amp + 작은 얼룩 detailSize/detailAmp, 키 범위 clamp (m)
      // (노이즈 값은 대략 ±0.5 (5~95%) → amp 0.28 이면 구역 평균 키가 ±14% 쯤 오르내린다)
      heightPatch: { size: 25, amp: 0.28, detailSize: 8, detailAmp: 0.12, clamp: [1.15, 2.1] },
      // 구역마다 한쪽으로 함께 기운 줄기 (비바람에 쓰러지다 만 곳): 노이즈 크기(m), 문턱(이 위만 기욺 — 밭의 약 1/3), 최대 기울기(rad), 방향 노이즈 크기(m)
      leanPatch: { size: 18, threshold: 0.12, max: 0.42, dirSize: 40 },
      // 비어 있는 구간 (말라 죽거나 포격으로 빈 곳): 노이즈 크기·세부 크기(m), 문턱(낮을수록 적다), 경계 부드러움
      gapNoise: { size: 16, detail: 5, threshold: -0.36, soft: 0.14 },
      // 차량이 밀고 지나간 띠 (MAP.vehicleTracks 중 밭을 지나는 것 + 밭 데이터의 swaths): 반폭 안 = 납작하게 쓰러짐, 그 밖 edge 폭 = 바깥으로 기울어짐
      swathHalf: 2.2,
      swathEdge: 1.5,
      swathMissing: 0.3,
      // 포탄 구덩이 둘레: 반지름 배수 clear 안은 비고, fall 까지는 바깥쪽으로 꺾이고 쓰러진 줄기
      craterClear: 1.12,
      craterFall: 2.4,
      tint: [0.8, 1.12], // 포기마다 밝기 배수
      // 정점색 (sRGB): 진한 회갈색 ~ 거의 검정 (주변 흑토보다 밝게 튀지 않게)
      colors: { stem: 0x423930, stemTop: 0x342c25, face: 0x211a16, back: 0x3b3129, leaf: 0x463c31 },
      cardShade: 1.05, // 빌보드 밝기 배수 (근거리 3D 와 맞춤)
      wind: 0.03, // 바람 흔들림 (꽃판 높이에서 m, 아주 약하게)
      // LOD (m): near 안 = 저폴리 3D (줄기·꽃판·잎), near~far = 교차 빌보드, far 밖 = 원거리 밭 띠 (band).
      //  전환은 화면 디더 없이: 3D↔빌보드는 포기마다, 빌보드↔띠는 띠 칸마다 nearBand / farBand 폭 안의 무작위 거리에서 통째로 바뀐다.
      //  cell: 동적 선택 칸 크기, refreshMove/TurnDeg: 다시 고르는 이동·회전, wedgeMarginDeg: 시야 쐐기 여유, nearCapacity: 3D 최대 포기 수
      lod: { near: 40, nearBand: 8, far: 125, farBand: 30, cell: 8, refreshMove: 2.5, refreshTurnDeg: 10, wedgeMarginDeg: 20, nearCapacity: 12000 },
      // 원거리 밭 띠 (far 밖, '높이감 있는 밭 표면'): 밭을 cell(m) 칸으로 나눠 칸마다 세로축으로 카메라를 향하는 카드 1장
      //  (포기 여럿이 겹친 덩어리 그림 — textures.sunflowerBandTexture, 근거리 빌보드 그림을 줄여 찍음). 칸의 선 줄기 수·평균 키·중심을 따른다
      //  → 빈 구간·가장자리는 성긴 그림이나 없음, 윗선은 칸마다 높낮이. 낱개 꽃판이 검은 점으로 깜박이지 않고 이어진 띠가 된다.
      //  tileW·tileH: 카드 크기(m, 폭은 칸보다 넓게 — 이웃과 겹침), spread: 그림 속 포기가 퍼진 폭(m), counts: 그림 칸별 포기 수
      //  (오름차순, 같은 수는 다른 배치 — 칸 위치 해시로 고른다: 같은 무늬가 줄지어 반복되지 않게), minPlants: 그릴 밀도를 곱한 포기 수가
      //  이보다 적은 칸은 그리지 않음, heightJitter: 칸마다 키 배수 ±(윗선이 칸 단위로 들쭉날쭉), shade: 밝기 배수 (빌보드와 맞춤), tilePx: 그림 칸 가로 해상도
      band: { cell: 3, tileW: 3.9, tileH: 2.4, spread: 3.4, counts: [7, 7, 15, 15, 24, 24, 34, 34], minPlants: 2.5, heightJitter: 0.06, shade: 1.0, tilePx: 256 },
      conceal: { cell: 10, minFill: 0.4, maxStrip: 30, height: 1.8 }, // 은폐 볼륨: 칸 크기(m), 선 줄기 비율 문턱, 띠 최대 길이, 높이
    },
    // 마른 풀 (20~60cm, 바랜 짚색 + 일부 회녹색): 노이즈 군락으로 모인다 (일직선 띠 없음).
    // 길·콘크리트·건물·차량·수로(바닥·판·발판·둔덕)·참호·구덩이 안·하층토 위에는 생기지 않는다 (지면 종류 + 차량 바닥 마스크)
    grass: {
      density: 2.0, // 군락 한가운데 포기 수 (/m²)
      // 군락 노이즈: 크기(m)·세기 3겹, 덮는 문턱 lo~hi (smoothstep)
      clump: { sizes: [26, 7, 2.4], amps: [0.5, 0.6, 0.35], lo: -0.05, hi: 0.45 },
      height: [0.2, 0.6],
      heightNoise: 15, // 키 큰 군락 / 낮은 군락 노이즈 크기 (m)
      widthMul: [1.3, 1.9], // 포기 폭 / 높이
      weedHeight: [0.12, 0.3], // 갈아엎은 밭·해바라기밭 사이 잡초
      weedDensity: 0.14, // 밭 안 잡초 밀도 배수
      stubbleDensity: 0.3, // 그루터기 밭 밀도 배수
      straw: 0x8a7f6c, // 바랜 짚색 (인스턴스 색, 텍스처와 곱해진다)
      greyGreen: 0x737765, // 회녹색
      greyGreenShare: 0.3,
      brightness: [0.74, 1.0],
      // 수로 북쪽 (수로 중심에서 북쪽 거리 m): canalClear[0] 안은 낮고 드문 풀만 (둔덕·사격 홈에서의 시야), canalClear[1] 까지 보통으로
      canalClear: [18, 34],
      canalMaxH: 0.16,
      canalDensity: 0.35,
      lowNearLines: { trench: 7, crater: 7, maxH: 0.26 }, // 참호선·전방 구덩이(F1·F2) 둘레는 낮은 풀 (흉벽 위 머리·총구 화염이 가끔은 보이게)
      padMargin: 0.4, // 차량 둘레 비움 (m)
      wind: 0.09,
      // LOD: far 거리에서 땅속으로 줄어 사라진다 (band 폭), cell = 동적 선택 칸, refreshMove = 다시 고르는 이동 거리
      lod: { far: 110, band: 25, cell: 25, refreshMove: 6 },
      // 은폐 볼륨: 칸(m) 안에 minHeight 이상 포기가 minCount 개 이상이면 (플레이어가 갈 수 있는 곳 근처만), 띠 최대 길이.
      // 수로 북쪽 canalClear(m) 안에는 두지 않는다 (수로·둔덕에 있는 플레이어를 적이 보는 판정은 이전과 같게)
      conceal: { cell: 4, minHeight: 0.34, minCount: 7, maxStrip: 24, canalClear: 45 },
    },
    // 수로 바닥 물가 마른 갈대 군락 (MAP.canal.reeds): 높이 1.5~2m, 은폐만. band = 수로 중심에서 떨어진 거리 범위 (물가~비탈 아래, 은폐 상자도 이 폭)
    //  군락 = 물가를 따라 긴 타원 (가운데 = band 가운데, 반폭 = band 폭 절반 × spread → band 밖으로도 흩어짐), 둘레는 노이즈로 들쭉날쭉
    //  (edgeNoise = 타원 반지름 변화 비율). 타원 거리로 smoothstep: 가운데는 빽빽하고 키가 크며, 끝·바깥으로 갈수록 성기고 낮다.
    //  키는 물가 waterline(수로 중심에서 m)에서 가장 크고 비탈 위로 slopeDrop 비율만큼 낮아진다. 포기마다 키 ± heightNoise (윗선이 들쭉날쭉).
    //  바깥 줄기는 군락 가운데에서 멀어지는 쪽으로 lean(rad) 만큼 벌어진다. density = 군락 한가운데 카드 수(/m²), width = 카드 폭(m, 좁은 카드 여럿 → 줄기 덩어리)
    //  plume: 무더기 위로 솟은 이삭 줄기 카드 비율·키 배수·폭. 텍스처 칸: 가운데 = 빽빽한 무더기, 가장자리 = 성기고 꺾인 줄기 (edgeTile 문턱)
    reeds: {
      density: 30,
      height: [1.5, 2.0],
      heightNoise: 0.3,
      width: [0.4, 0.7],
      waterline: 0.62,
      slopeDrop: 0.25,
      spread: 1.4,
      edgeNoise: 0.28,
      lean: [0.1, 0.3],
      edgeTile: 0.62,
      plume: { share: 0.08, height: [1.05, 1.2], width: [0.3, 0.45] },
      color: 0x837d6c,
      brightness: [0.78, 1.05],
      wind: 0.06,
      band: [0.45, 1.25],
    },
    // 포격에 부러진 고립 나무 (Structures.tree): 굵은 몸통(밑동이 퍼짐)·찢어진 윗부분(쪼개진 가닥)·짧은 가지 몇 개·옆에 쓰러진 윗동
    //  첫 가지는 굵은 큰 가지(limb 배: 굵기·길이), 나머지는 짧은 가지
    trees: { trunkRadius: [0.3, 0.42], flare: 1.55, branches: [3, 6], branchLen: [0.6, 1.8], limb: [1.5, 2.0], splinters: [6, 9], splinterLen: [0.25, 1.1], fallenLen: [2.4, 4.4] },
  },

  // ---------------------------------------------------------------- 중간 지대 (차량 잔해·송전선·전신주·작은 잔해) — 배치 좌표는 MAP
  midfield: {
    textureSize: 512, // 불탄 차체 절차 텍스처 (px, 한 장 = 2m)
    // 파괴된 장갑차: 진흙에 박힌 깊이, 벗겨진 궤도 조각 길이(링크 2개), 주변에 흩어진 궤도 링크 수,
    // 날아간 포탑 자세(rad: 포신 축 둘레 roll, 포신 들림 pitch, 차체 기준 yaw)·땅에 박힌 깊이, 그을린 땅 데칼
    apc: {
      sink: 0.06,
      trackLink: 0.3,
      looseLinks: 9,
      turret: { roll: 2.0, pitch: 0.3, yaw: 0.335, sink: 0.12 },
      scorch: { hx: 4.4, hz: 2.6, soft: 3.2, strength: 0.3 },
    },
    // 트랙터: 앞 타이어가 타 림만 남아 앞이 내려앉은 양, 한쪽(-z) 뒷바퀴 림이 진흙에 박힌 양 (m), 남은 빨간 도장 정점색
    tractor: { noseDrop: 0.22, rimSink: 0.2, paintTint: 0xa47c70, scorch: { hx: 2.6, hz: 1.6, soft: 2.4, strength: 0.26 } },
    // 민간 차량: 그을린 땅 데칼(차체보다 grow m 넓게), 트럭 차체가 림 위로 내려앉은 양(충돌 상자 높이), 짐칸 판자 색
    // meltPuddle: 녹은 타이어 고무가 바퀴 둘레 땅에 흘러 굳은 웅덩이 (반지름 = 림 반지름 배수, 가운데 볼록한 높이 m)
    // van: 속이 빈 승합차 (Structures.vanWreck) — 창 높이 범위(옆 창, 뒷문 창), 바퀴 위치·아치 반지름, 지붕 처짐(옆 윤곽)·가운데 꺼짐,
    //      바깥 면 정점색, 안쪽 면(그을음 재질) 정점색, 좌석 뼈대 색
    car: {
      scorch: { grow: 0.6, soft: 2.2, strength: 0.26 },
      truckDrop: 0.15,
      plankTint: 0x8a7a66,
      meltPuddle: { size: 2.3, height: 0.035 },
      van: {
        windowBand: [1.29, 1.71],
        rearWindow: [1.3, 1.66],
        wheelX: 1.15,
        wheelZ: 0.83,
        archR: 0.42,
        roofSag: 0.05,
        roofDent: 0.06,
        bodyTint: 0xd8ccbc,
        innerTint: 0xb4b0aa,
        frameTint: 0x5a4a40,
      },
    },
    // 송전선: 선 조각 길이(m), 서 있는 탑 사이 처짐(m), 쓰러진 탑에 걸린 경간 처짐(땅까지), 땅에 닿은 선이 구불거리는 폭,
    // 땅 위로 띄우는 높이, 구불거림이 시작되는 높이 폭, 끊어진 선 길이(경간 배수), 늘어진 선이 땅에 닿는 수평 거리(높이 배수),
    // 격자 탑 주 부재 충돌 막대 반폭
    wires: { segment: 2.5, sag: 3.2, brokenSag: 9, groundWander: 0.35, lift: 0.03, wanderBlend: 0.4, snappedLength: 0.38, hangReach: 0.4, memberHalf: 0.12 },
    // 콘크리트 전신주 (MAP.poles): 땅 위 높이·묻힌 깊이, 단면(밑동·꼭대기 폭 x 두께), 기본 기울기(도), 전선 처짐, 색, 충돌 막대 반폭
    poles: { height: 9.5, buried: 1.6, base: [0.26, 0.18], top: [0.15, 0.15], leanDeg: 9, sag: 0.8, color: 0xa29e94, colliderHalf: 0.1 },
    // 작은 잔해 (인스턴싱, 종류마다 드로우콜 1): 개수, 놓지 않을 남쪽 한계(z, 수로 쪽)·동서 한계, 상자를 두지 않을 적 사격 위치 둘레 (m)
    // types: 크기 배수 범위, 땅 위 높이(배수 1 기준), 색 후보, 충돌 상자 반크기·재질 (상자 = 나무, 헬멧 = 강철, 배낭 = 천; 파편·위장망 조각은 없음)
    debris: {
      counts: { shard: 320, crate: 34, camo: 20, helmet: 26, pack: 16 },
      maxZ: 92,
      maxX: 250,
      clearFp: 6,
      // 앞쪽 구덩이 사격 위치(F1·F2, 엎드림)에서 수로 발판으로 가는 낮은 사선 (Structures.fieldDebris): 사선이 잔해 윗면 + clear(m) 보다
      // 낮게, 옆으로 side(m) 안을 지나면 그 잔해는 충돌체 없음. 눈 = 테두리 마루 + eyeAboveCrest, 표적 = 수로 중심에서 북쪽 bench(m),
      // 지면 위 targetEye(m), 수로 x 범위·간격. faceZ = AI_MAP 의 FACE z (구덩이 사격 방향)
      lanes: { eyeAboveCrest: 0.1, x: [-130, 110], step: 3, bench: 2.42, targetEye: 0.68, clear: 0.06, side: 0.3, faceZ: 112 },
      types: {
        shard: { scale: [0.12, 0.38], lift: 0.03, colors: [0x2c2622, 0x241f1c, 0x332a24, 0x1f1c1a, 0x3a2e26] },
        // 상자 색은 칠한 판자 텍스처(textures.crateTexture)가 정한다 → 인스턴스 색은 밝은 무채색 (바램 정도 차이만)
        crate: { scale: [0.95, 1.05], lift: 0, collider: [0.28, 0.095, 0.17], material: 'wood', colors: [0xe8e6d8, 0xd8d6c4, 0xcdc9b4, 0xf0ece0] },
        camo: { scale: [0.9, 2.3], lift: 0, colors: [0xffffff, 0xe0dcd0, 0xc8c4b8] },
        helmet: { scale: [0.96, 1.04], lift: 0.02, collider: [0.13, 0.07, 0.14], material: 'steel', colors: [0x56593f, 0x4a4d38, 0x5e5a44, 0x3e4234] },
        pack: { scale: [0.9, 1.1], lift: 0, collider: [0.17, 0.1, 0.22], material: 'fabric', colors: [0x5e5a42, 0x6a6248, 0x4c4a38, 0x5a5546] },
      },
    },
  },

  // ---------------------------------------------------------------- 적 진지 외형 (참호선·철조망·엄체호·위장망) — 배치는 MAP.trench / MAP.wire / MAP.dugouts / MAP.camoNets
  // 200m 밖에서도 '저기가 참호선'이 읽히게: 흉벽(지형, 높이 MAP.trench.parapet 0.45m)과 그 앞에 흩뿌린 하층토가 주변 흑토보다 밝은
  // 황갈색 띠가 되고, 흉벽 위 흙덩이·모래주머니 구간이 들쭉날쭉한 윤곽을 만든다. 안의 사람은 흉벽 뒤에 숨는다.
  // (흉벽 형상·사격 발판 높이는 1단계 그대로 — AI 사격 위치 사선 유지. 흙덩이는 충돌 없는 흉벽 표면 요철)
  enemyPosition: {
    // 흉벽 앞으로 흩뿌린 하층토 (지면 혼합 마스크): 흉벽 마루 너머 apron m 까지 얼룩덜룩 (patch = 얼룩 노이즈 크기 m), 세기.
    // 먼 곳에서는 마스크 밉맵이 띠를 주변과 섞으므로 띠가 넓을수록 200m 에서 밝게 남는다. crest = 흉벽 앞면·마루 세기
    // (parados = 후벽 하층토 세기: 흉벽보다 어둡게 남겨 높은 곳에서 보면 밝은 흉벽 뒤에 어두운 띠가 진다)
    // 흉벽 앞 흙은 마루에서 멀어질수록 옅어지고 (falloff = 세기 지수, 1 = 직선), 얼룩 사이는 풀 대신 흑토와 섞인 중간 밝기 흙(gapSoil = 흑토 몫)이다
    // — 흙 얼룩 사이로 시커먼 풀 섬이 또렷하게 드러나 젖소 무늬처럼 보이지 않게. patchSoft = 얼룩 경계 폭 (노이즈 단위, 넓을수록 부드러움),
    // clod = 잔 흙덩이 노이즈 크기 (m) — 큰 얼룩을 잘게 깨서 흙 위에 흩어진 흙덩이로 읽히게. 흑토 몫은 apron 의 1.3배까지 이어져 밝은 흙 → 흑토 → 풀밭으로 옅어진다
    spoil: { apron: 9, strength: 0.85, patch: 2.6, crest: 1.0, parados: 0.4, falloff: 1.3, gapSoil: 0.8, patchSoft: 0.75, clod: 0.55 },
    // 흉벽 앞면·마루 지형 정점색 배수 [r, g, b]: 밝은 황갈색 하층토 띠가 먼 곳(원거리 LOD·마스크 밉맵·안개)에서도 흑토에 묻히지 않게.
    // 참호 가장자리 ~ 앞면 끝 사이에서만 (앞면 끝으로 가며 사라짐). 수로에서 보면 흉벽 앞면은 720p 에서 1~2px 이고 바로 위가 흰 축사 벽 밑동이라,
    // 벽(안개 낀 밝은 회색)보다 확실히 밝은 황갈색 선이어야 '벽 밑동'이 아니라 따로 선 흙둑으로 읽힌다 (플레이어는 120m 안으로 못 다가감)
    crestTint: [2.15, 1.98, 1.62],
    // 흉벽 앞면 끝 너머로 이어지는 갓 흩뿌린 흙 (같은 정점색 배수가 옅어지며 이어짐): 앞면 끝에서 fan m (노이즈로 fanVar 배 흔들림 — 아래 가장자리가 들쭉날쭉),
    // 흉벽을 따라 밝기 얼룩 (patch m 크기 노이즈, ±amp — 갓 파낸 곳·마른 곳·젖은 곳이 섞여 띠가 도로처럼 고르게 보이지 않게)
    crestFan: { fan: 4.5, fanVar: 0.45, patch: 5.5, amp: 0.24 },
    // 흉벽 앞 완만한 내리막 (지형, 참호 앞쪽만 — Terrain.trenchGlacis): 참호 중심선에서 fall m 사이에 depth m 까지 내려가고 rise m 사이에서
    // 다시 자연 지면 (참호가 낮은 둔덕 마루에 판 꼴). 수로의 낮은 시선(흉벽 마루보다 약 0.85m 아래)에서도 흉벽 앞면(0.45m) 전체가
    // 앞쪽 구덩이 테두리·기복 위로 드러난다. 흉벽·사격 발판(참호 앞 3.3m 안)과 전방 구덩이 F1·F2(참호 앞 약 48m)는 건드리지 않는다.
    // endFade = 참호선 양끝 밖으로 이 거리에 걸쳐 사라짐 (m)
    glacis: { depth: 0.25, fall: [4.5, 14], rise: [32, 47], endFade: 12 },
    // 흉벽 앞면·마루의 흙덩이 (인스턴스 'clod'): m 당 개수, 크기(m), 납작함(높이 배수), 색 후보 (흉벽 하층토와 같은 황갈색, 일부 젖어 짙음 —
    // 흐린 날 노출에서 흰 종이처럼 날아가지 않게), 아래쪽 면 어둡기 배수, 사격 위치(fps x) 둘레 이 거리 안은 두지 않음,
    // 뒤쪽 건물 엎드려쏴 사선 띠(proneCorridor) 안에서는 마루 위로 이 높이(m)까지만 솟게 묻는다
    clods: {
      perMeter: 6.0,
      size: [0.2, 0.5],
      flat: [0.45, 0.7],
      colors: [0xaa8c62, 0xb6986c, 0x9e815b, 0xb2936a, 0x8a7050, 0xa4885f, 0x786449],
      underside: 0.55,
      fpClear: 2.8,
      corridorTop: 0.04,
    },
    // 마루를 따라 늘어선 흙무더기 (인스턴스 'spoilLump', 충돌 상자 재질 subsoil): m 당 개수, 마루 위로 솟는 높이, 길이(흉벽 방향)·폭(m),
    // 색 (흉벽 하층토), 아래쪽 어둡기 배수. 200m 에서 흉벽 위에 들쭉날쭉한 밝은 마루선을 더한다 (흉벽 높이·사격 발판은 그대로).
    // 사격 위치 둘레(clods.fpClear)·모래주머니 구간·뒤쪽 건물 엎드려쏴 사선 띠(proneCorridor)에는 두지 않는다
    // (높이는 흉벽 표준 높이 상한 0.5m 까지 — 사격 위치·모래주머니 구간·엎드려쏴 사선 띠 밖에서만)
    // (흙덩이·흙무더기 색은 흉벽 앞면 정점색(crestTint)과 어울리게 같은 밝기대 — 앞면보다 조금 어두워 흙 요철로 읽힘)
    lumps: { perMeter: 0.85, height: [0.2, 0.46], length: [0.8, 1.8], width: [0.7, 1.2], colors: [0xae9064, 0xb89a6c, 0xa0835a, 0xb69c72, 0x957c57], underside: 0.62 },
    // 뒤쪽 건물·잔해 엎드려쏴 사격 위치(AI_MAP 건물·잔해 노드의 prone fps)에서 수로 x 범위 canalX 의 앉은 눈으로 가는 사선이 흉벽을 넘는 띠
    // (양쪽 margin m 더함): 이 사선은 흉벽 마루 위 0.1~0.2m 로 지나므로 띠 안에는 마루 위로 솟는 물체를 두지 않는다 (탄은 통과하는데 사수가 가려 보이지 않게)
    proneCorridor: { canalX: [-110, 70], margin: 2.0, minClear: 0.4 },
    // 흉벽 모래주머니 구간 (MAP.trench.sandbagRuns): 층 수, 자루 길이 방향 간격(m), 줄 수(두께), 흉벽 마루 위치(참호 중심선에서 m),
    // 색 후보 (새 자루는 밝은 황회색, 오래된 것은 흙물 — 사격 발판 양옆·바리케이드), 사격 구멍 폭(m)
    // runColors = 흉벽 모래주머니 구간 색 (흙물 든 짙은 회갈색: 밝은 흉벽 선 위에 어두운 토막으로 끊겨 보여 '도로·벽 밑동'이 아니라 진지로 읽힘),
    // notch = 사격 구멍 위 맨 윗단을 비우는 반폭 여유 (m, 사격 구멍 폭/2 에 더함 — 마루 윤곽에 홈이 파여 보임)
    sandbags: {
      layers: 3,
      bagStep: 0.5,
      rows: 2,
      crestDist: 1.55,
      colors: [0xd4ccb4, 0xc6bea6, 0xb8ae94, 0xa89e86, 0xdcd4bc],
      runColors: [0x8a8370, 0x787260, 0x928a74, 0x6a6555, 0x837b66],
      loopholeWidth: 0.34,
      notch: 0.16,
    },
    // 철조망 (MAP.wire): 말뚝 높이·간격, 가닥 높이, 에이프런(비스듬한 줄) 닻 말뚝까지 거리, 원형 철조망 반지름·고리 간격·고리당 선분 수,
    // 선 색·불투명도, 말뚝 색, 포탄 구덩이에 끊긴 폭(구덩이 반지름 배수), 군데군데 끊긴 곳 확률(말뚝 칸당)
    // (은폐 세기는 concealment.wire — 적 인지 시야선이 지나가므로 아주 옅게)
    wire: {
      picketHeight: 1.3,
      picketSpacing: 3.2,
      strands: [0.2, 0.52, 0.86, 1.2],
      apron: 1.7,
      coilRadius: 0.46,
      coilPitch: 0.24,
      coilSegments: 12,
      color: 0x3e3832,
      opacity: 0.8,
      // 거리 감쇠 [기준 거리 m, 지수, 최소 배수]: 선은 거리와 상관없이 1px 로 그려져 먼 곳에서 실제 굵기(약 2.5mm)보다 훨씬 짙어진다 →
      // 기준 거리 너머에서 (기준/거리)^지수 로 옅게 (200m 에서 약 5%) — 수로에서 보면 철조망 띠가 바로 뒤 흉벽을 덮어 참호선이 지워지지 않게
      fade: [25, 1.5, 0.03],
      picketColor: 0x7a6658,
      craterCut: 1.05,
      breakChance: 0.07,
      // 시작 위치 눈 → 참호 사격 위치 시선(평면)에서 이 거리(m) 안에 선 말뚝은 철조망을 따라 옆으로 비킨다
      // (가는 말뚝이 200m 밖 0.26m 머리 픽셀을 덮지 않게 — 탄·이동 판정과 무관한 보이는 말뚝만)
      headLineClear: 0.4,
    },
    // 엄체호: 지붕 통나무 지름, 흙 둔덕 위로 드러난 통나무 수, 입구 모래주머니 수
    dugout: { logRadius: 0.13, exposedLogs: 3, entranceBags: 6 },
  },

  // ---------------------------------------------------------------- 집단농장 외형 (축사·저장탑·담장·농기계·건초·불탄 차량) — 배치는 MAP.barns / MAP.silo / MAP.farm
  farm: {
    // 벽 데칼 아틀라스 (그을음·포탄 구멍 둘레 그을림·탄흔·떨어져 나간 회반죽·빗물 줄·습기·금): 캔버스 크기 (4 x 2 칸)
    decalTexture: [1024, 512],
    decalLift: 0.015, // 벽면에서 띄우는 거리 (m)
    // 축사: 창·구멍 위 그을음 비율 (0..1), 그을음 높이 배수, 포탄 구멍 둘레 그을림 띠 폭(m), 탄흔 무리 수(벽 한 면당),
    // 서까래 그루터기 길이(m), 탄 서까래 색, 무너진 벽 잔해 더미 (반지름·높이 m)
    barn: {
      sootChance: 0.45,
      sootHeight: 1.5,
      scorchWidth: 0.55,
      pockClusters: 3,
      rafterStub: [0.35, 1.5],
      charred: 0x3a322c,
      heap: { radius: 2.4, height: 0.75 },
      // 벽 정점색 (Structures.shadeWall): 벽 아래 빗물 튐·습기·그을음 띠 — band = [짙은 부분 끝, 사라지는 끝] 높이 (m), dark = 어둡기
      // (흰 규산염 벽돌은 짙게: 수로에서 보면 참호 흉벽 마루 바로 위가 축사 벽 아래쪽이라, 밝은 흉벽이 어두운 띠 위에 선으로 읽힌다),
      // bandVar = 띠 높이·어둡기 흔들림, macroSize·macroAmp = 벽을 따라가는 큰 얼룩 (노이즈 크기 m, 밝기 폭 — 벽돌 텍스처 반복이 안 보이게),
      // inner = 안쪽 면 어둡기 (지붕이 무너진 축사 안 벽은 하늘이 반쯤 가려 어둡다 → 창 너머가 밝은 회색 사각형으로 뜨지 않게)
      // holeDark = 무너진 벽 가장자리 어둡기 (2m 에 걸쳐 옅어짐 — 포탄 구멍 둘레는 hole.soot)
      // splash = 벽 맨 아래 흙탕물 튄 자국·젖은 띠 (band = [짙은 부분 끝, 사라지는 끝] m, dark = 어둡기 — 위 띠에 곱해짐, var = 높이 흔들림):
      // 수로에서 보면 참호 흉벽 마루선이 축사 B1·B2·정비 창고 남쪽 벽 아래 0.4~1.2m 앞에 걸리므로, 이 띠가 짙어야 밝은 마루선이 720p 에서도 따로 읽힌다
      // (정비 창고 콘크리트 벽도 같은 띠 — dark.concrete)
      wallShade: {
        band: [1.0, 2.2],
        dark: { silicate: 0.62, red: 0.35, concrete: 0.45 },
        bandVar: 0.3,
        macroSize: 5.5,
        macroAmp: 0.15,
        inner: 0.5,
        holeDark: 0.36,
        splash: { band: [0.85, 1.45], dark: { silicate: 0.64, red: 0.42, concrete: 0.58 }, var: 0.22 },
        // 참호 사격 위치(AI_MAP 참호 노드 fps) 머리 뒤 벽: 수로 사격 발판(시작 위치 x + canalX 범위)의 눈에서 사격 위치를 지나 이 벽에 닿는
        // 구간(± halfWidth m, 바깥으로 fade m 에 걸쳐 옅어짐)은 아래 띠·흙탕물 띠를 keep 배만 남긴다 — 관측·사격 때 흉벽 위로 0.26m 드러나는
        // 머리가 어두운 띠에 묻히지 않고 밝은 벽 앞의 어두운 점으로 보이게 (그 밖의 벽 밑동은 짙어서 흉벽 마루선이 따로 읽힘)
        headGap: { canalX: [-10, 10], halfWidth: 1.0, fade: 1.6, keep: 0.2 },
      },
      // 포탄 구멍의 보이는 윤곽 (Structures.holeProfile — 충돌 구멍은 맵 데이터 사각형 그대로, 윗변이 확실히 뚫린 만큼·꼭대기까지 뚫린 구간만 더 뚫음):
      // col·course = 기둥 폭(벽돌 반 장)·벽돌 한 줄 높이 (m, 벽돌 텍스처 2m 에 8장 x 16줄과 맞춤), top = 윗변을 들어 올리는 아치 높이 [최소, 최대] (m),
      // side = 위쪽 모서리를 옆으로 넓히는 최대 폭 (m, safeY 위에서만 — 그 아래 옆 가장자리는 사각형 안쪽으로만 들쭉날쭉: 벽 뒤에 엄폐한 적이 드러나지 않게),
      // teeth = safeY 아래 옆 가장자리 줄마다 벽돌 반 장이 튀어나올 확률 (그 줄에서 한 장 더 깊이 튀어나올 확률은 절반), bottom = 바닥이 뜬 구멍 아래 가장자리가 내려앉는 최대 깊이 (m),
      // breakLintel = 구멍 위에 남는 벽이 이보다 얇으면 벽 꼭대기까지 뚫림 (도리·서까래도 없음), rowStep = 그을음 정점색 줄 간격 (m),
      // soot = 윤곽에서 번지는 그을음 (거리 m — 노이즈로 0.55~1.45배, 어둡기), missingBricks = 둘레 빠진 벽돌 무리 데칼 수 (바깥 면, 안쪽 면은 절반),
      // spill = 구멍 아래 땅에 떨어진 벽돌 수
      hole: {
        col: 0.125,
        course: 0.125,
        top: [0.15, 0.6],
        side: 0.85,
        safeY: 1.95,
        teeth: 0.5,
        bottom: 0.25,
        breakLintel: 0.4,
        rowStep: 0.25,
        soot: { reach: 0.85, dark: 0.55 },
        missingBricks: 4,
        spill: 16,
        // 땅까지 뚫린 구멍(아래 가장자리 0.3m 미만) 바닥의 낮은 벽돌 잔해 둔덕: 높이, 벽에서 앞뒤로 뻗는 반지름 (m) — 충돌 'rubble' (사수 눈높이보다 훨씬 낮음)
        heap: { height: 0.3, depth: 0.95 },
      },
      // 긴 벽 꼭대기의 부서진 자리 (Structures.wallTopNotches — 보이는 벽·충돌 모두 낮아짐, 위 도리·서까래 없음): 벽 한 면당 개수, 토막 길이 (m),
      // 길이·가운데 깊이 범위 (m), 아래로 떨어진 벽돌 수. 벽 끝·열린 곳·무너진 곳은 피한다
      topNotches: { perWall: 3, step: 0.25, length: [0.75, 2.5], depth: [0.2, 0.7], spill: 7 },
      // 북쪽 벽 창을 남쪽 벽 창과 이만큼 엇갈리게 (m): 남쪽 창 너머로 하늘이 뚫려 보이지 않게 (적이 쓰는 사격 창은 남쪽 벽)
      northWindowShift: 2.0,
    },
    // 곡물 저장탑 텍스처 (둘레 x 높이 px), 탄흔 수, 큰 구멍은 MAP.silo.holes
    silo: { textureSize: [512, 1024], pocks: 1100 },
    // 소련식 무늬 콘크리트 담장 (ПО-2 마름모 무늬): 판 길이·높이·두께, 기둥 단면, 판 텍스처 크기
    fence: { panel: [4.0, 2.2, 0.14], post: 0.24, textureSize: [512, 256] },
    // 썩은 건초: 둥근 곤포 반지름·폭, 색 (오래 비 맞아 거무스름한 회갈색), 타다 남은 더미 색
    hay: { baleRadius: 0.78, baleWidth: 1.2, colors: [0xa69680, 0x968872, 0xb0a084, 0x8a7e6a], burntColor: 0x4e463e },
  },

  // ---------------------------------------------------------------- 원경과 맵 경계 (맵 밖, 접근 불가) — Terrain.buildFar · Distant.js, 배치는 MAP.distant
  // 맵(600m) 밖으로 지형을 낮은 해상도로 이어 붙이고 (기복·수로·농로·밭 구획이 끊기지 않고 이어짐), 먼 언덕·마을 지붕·교회·
  // 급수탑·곡물 창고·송전탑과 전신주 행렬을 둔다. 모두 같은 안개를 받아 거의 실루엣만 보인다 (먼 곳 몫 atmosphere.fog.farResidual,
  // 지평선 위로 솟은 언덕 마루·비탈 마을은 silhouette 몫이 더해져 0.9~1.3km 에서 희미한 실루엣으로 읽힌다).
  // range: 원경을 그리는 거리 (맵 중심에서 m, maxRange 이하). 그래픽 품질 프리셋은 world.setDistantRange(m) 로 실행 중 바로 바꾼다
  //  (원경 지형·건물·전선을 맵 중심에서 가까운 순으로 쌓아 두어 드로우콜 수는 그대로, 그리는 범위만 줄어든다)
  // 권장 프리셋 거리: 낮음 2000 / 보통 3500 / 높음 4500 (2km 안쪽으로 줄이면 지평선에서 원경 끝이 희미한 선으로 보일 수 있다)
  distant: {
    range: 4500,
    maxRange: 4800, // 만들어 두는 최대 거리 (카메라 원거리면 render.far 안쪽)
    colliderRange: 1700, // 이 거리 안의 원경 물체만 충돌체를 둔다 (탄 수명 3초 ≈ 1.5km, 그 너머는 탄이 닿지 않음)
    terrain: {
      edgeStep: 7.5, // 맵 가장자리를 따라가는 격자 간격 (m) — 맵 지형 가장자리 스커트가 이음매를 가린다
      growth: 1.17, // 바깥으로 한 칸 갈 때마다 격자 간격 배수
      maxStep: 600,
      nearBand: 90, // 맵 가장자리에서 이 거리 안은 근거리 지면 셰이더 (이동 가능 구역 경계에서 보아도 맵 안과 같은 질감)
      drop: 0.05, // 맵 지형 가장자리보다 이만큼 낮게 (가장자리 스커트 뒤로 숨는다)
      roughnessMin: 0.95, // 원경 지면 거칠기 하한: 해 쪽 낮은 각도에서 젖은 흙이 하얗게 번들거리지 않게
      // 먼 언덕: 맵 가장자리 밖 start ~ full (m) 사이에서 높이가 커진다. size = 노이즈 크기 [큰, 작은] m, amp = 높이 (m),
      // valley = 우묵한 쪽 배율 (넓은 골짜기 + 둥근 언덕), canalValley = 수로 둘레 이 거리 사이에서 언덕을 눌러 수로가 낮은 골을 따라간다
      // (그 위에 MAP.distant.hills 둔덕·능선을 더한다 — 마을이 올라앉은 비탈. 0.7~1km 능선 마루가 지평선을 끊도록 full 을 600 으로)
      // crestWobble / crestSize: 능선(len 이 있는 hills) 마루 높이를 이 비율·이 길이(m) 간격으로 들쭉날쭉하게
      hills: { start: 100, full: 600, amp: 20, size: [1500, 620], valley: 0.45, canalValley: [40, 260], crestWobble: 0.3, crestSize: 380 },
      // 밭 구획 (맵 밖, 지면 셰이더): 한 칸 [동서, 남북] m (맵 가장자리 ±300 이 구획 경계가 되도록 600 의 배수),
      // split = 칸을 반으로 나눌 확률 [동서, 남북], 갈아엎은 밭·그루터기 밭 비율 (나머지 묵은 풀밭),
      // 경계 흙길 반폭·풀 둑 폭 (m)·흙길이 나는 경계 비율 (맵 가장자리 둘레는 항상 흙길)
      fields: { size: [600, 600], split: [0.55, 0.4], plowed: 0.42, stubble: 0.34, track: 1.6, verge: 5, trackChance: 0.5 },
      roadHalf: 2.2, // 맵 밖 농로·마을 길 반폭 (m) — 맵 안 농로(MAP.roads[0].width / 2)와 같게
    },
    // 원경 실루엣 (맵 밖 지형·먼 마을·탑·전선 재질만, Distant.applySilhouetteFog): 대기 안개(atmosphere.fog)는 그대로 두고
    //  투과율에 Ts = residual·e^(-dd/length)·smoothstep(rise, 카메라보다 높은 정도 m)·smoothstep(out, 맵 가장자리 밖 거리 m) 를 더한다
    //  (dd = 높이 보정 거리). 평평한 먼 지면은 예전처럼 안개에 녹아 지평선이 칼 같은 선이 되지 않고, 지평선 위로 솟은 언덕 마루·
    //  비탈의 마을·교회·급수탑만 희미한 실루엣으로 읽힌다 (지면 연무 위로 솟은 모습). 맵 안 물체와 맵 가장자리에는 영향 없음.
    //  현재 값 → 30m 솟은 곳의 투과율: 700m 약 32%, 1km 25%, 1.5km 17%, 2km 12%, 3km 5%, 4km 3% (대기 안개만이면 9 / 5.5 / 4.6 / 3.8 / 2.6 / 1.8%)
    //  → 1km 능선 마루는 하늘보다 약 20 단계(0~255) 어둡고, 2km 밖 언덕은 겹겹이 옅어진다. 평평한 먼 지면(솟은 높이 4m 이하)은 그대로
    //  더 진하게 = residual ↑, 먼 곳까지 = length ↑. 0 이면 끈다. rangeFade: 원경을 그리는 끝(range) 앞 이 거리(m)에서 실루엣 몫을 줄인다
    silhouette: { residual: 0.55, length: 1050, rise: [4, 24], out: [100, 380], rangeFade: 700 },
    // 먼 건물·급수탑 밑동을 이동 가능 구역에서의 거리 × 이 값(m)만큼 더 땅속으로 (성긴 원경 지형 메시가 언덕에서 실제 높이보다 낮아도 뜨지 않게)
    foundationPerM: 0.0025,
    // 먼 송전탑·전신주 부재 굵기 = max(실제 굵기, 이동 가능 구역에서의 거리 × thinPerM) → 화면에서 1px 안팎으로 남는다
    thinPerM: 0.0009,
    detailDistance: 1300, // 이보다 먼 송전탑은 격자 사재 없이 다리·띠·팔만
    // 집: 폭(용마루 방향)·깊이·벽 높이 (m), 지붕 높이 / 깊이 반, 부서진 집(벽만)·불탄 집 비율 (마을 damage 배수), 헛간 비율
    house: { length: [7.5, 11], depth: [5.5, 7.5], wall: [2.6, 3.3], pitch: [0.55, 0.85], ruined: 0.2, burnt: 0.15, shed: 0.55, setback: [10, 16] },
    colors: {
      // 원경 실루엣에서 지붕이 언덕 비탈보다 어두운 톱니 줄로, 벽은 안개색과 비슷한 밝기의 점으로 읽히게 (흰 덩어리로 튀지 않게)
      wall: [0x9c978d, 0x8a857c, 0x7e6e63, 0x96928a], // 바랜 회칠 벽 / 회색 블록 / 벽돌 / 시멘트
      roof: [0x45494b, 0x3c4042, 0x57392d, 0x3e4740, 0x55575a], // 슬레이트 / 짙은 슬레이트 / 녹슨 함석 / 초록 함석 / 바랜 슬레이트
      burnt: 0x2b2927,
      steel: 0x8b8e8c, // 송전탑 (맵 안과 같은 색)
      rust: 0x5f483c, // 급수탑
      concrete: 0xa29e94, // 전신주·곡물 창고 (맵 안 전신주와 같은 색)
      church: 0xbcb8ae,
      dome: 0x58625d,
      wire: 0x2a2a2a,
    },
    // 전선 처짐 (m): 맵 안과 같은 110kV 송전선은 midfield.wires.sag, 전신주는 midfield.poles.sag
    bigSag: 9, // 큰 송전선 (경간 300m 안팎)
    bigScale: 1.5, // 큰 송전탑 크기 배수 (맵 안 송전탑 기준)
  },

  // ---------------------------------------------------------------- 탄도
  ballistics: {
    gravity: 9.81,
    integrationHz: 240, // 탄도 적분 주기 (프레임을 이 간격으로 쪼갠다, 영점 표도 같은 간격)
    maxLifetime: 3.0,
    minSpeed: 140, // 이 속도 미만이면 소멸
    terrainStep: 0.45, // 지형 충돌 검사 간격
    maxBullets: 320,
    ricochetSpeedKeep: [0.35, 0.65],
    ricochetScatterDeg: 9,
    penetrationMinSpeed: 180, // 관통 후 이 속도 미만이면 박힘
    friendlyFire: false, // 같은 편 탄에 맞는지
  },

  // ---------------------------------------------------------------- 탄약 정의
  ammo: {
    '545x39': {
      muzzleVelocity: 880,
      dragK: 0.00108, // 이차 공기저항 계수 (a = -k|v|v)
      tracerBurnTime: 3.0,
      tracerColor: 0xff6a2a,
      sightHeight: 0.06, // 조준선-총열 높이차
    },
  },

  // ---------------------------------------------------------------- 무기 정의
  weapons: {
    ak545: {
      name: 'AK 5.45mm',
      ammo: '545x39',
      magCapacity: 30,
      spareMags: 7, // 장전 1 + 예비 7
      rpm: 650,
      fireModes: ['semi', 'auto'],
      defaultFireMode: 'semi',
      tracerLastRounds: 3, // 탄창 마지막 3발 예광탄
      reloadTime: 2.4, // 약실에 탄이 있을 때 (빠른 재장전)
      reloadEmptyTime: 3.3, // 완전히 비었을 때 (노리쇠 후퇴 동작 추가)
      dispersionMrad: 0.9, // 총 자체의 탄 퍼짐 (표준편차)
      sightRanges: [100, 200, 300, 400, 500, 600],
      defaultSightRange: 300,
      muzzleForward: 0.72, // 눈 → 총구 거리
      recoil: {
        pitchDeg: 0.95, // 발당 총구 들림
        pitchRandomDeg: 0.25,
        yawRandomDeg: 0.32,
        permanentFraction: 0.45, // 회복되지 않고 남는 비율 (연발 시 총구가 올라감)
        recoverTime: 0.2,
        autoClimbMul: 1.12, // 연발 연속 사격 시 추가 상승
        postureMul: { stand: 1.0, crouch: 0.85, prone: 0.6 },
        restedMul: 0.65,
        visualKick: 0.035, // 뷰모델이 뒤로 밀리는 거리
      },
    },
  },

  // ---------------------------------------------------------------- 재질 (충돌 메시 태그)
  // impact: 탄착 효과 종류 / penetrable: 관통 가능 / speedLoss: 관통 시 속도 감소 비율
  // ricochet: maxAngleDeg 이하의 낮은 입사각에서 chance 확률로 도탄
  materials: {
    earth: { impact: 'dirt', penetrable: false, cover: true, ricochet: { maxAngleDeg: 6, chance: 0.25 } },
    mud: { impact: 'mud', penetrable: false, cover: true, ricochet: { maxAngleDeg: 4, chance: 0.15 } },
    // 파낸 하층토 (참호 흉벽·구덩이 분출물): 흙과 같은 판정, 탄착 먼지만 밝은 황갈색
    subsoil: { impact: 'subsoil', penetrable: false, cover: true, ricochet: { maxAngleDeg: 6, chance: 0.25 } },
    water: { impact: 'water', penetrable: false, cover: false, ricochet: { maxAngleDeg: 7, chance: 0.6 } },
    rubble: { impact: 'concrete', penetrable: false, cover: true, ricochet: { maxAngleDeg: 10, chance: 0.4 } },
    concrete: { impact: 'concrete', penetrable: false, cover: true, ricochet: { maxAngleDeg: 15, chance: 0.55 } },
    brick: { impact: 'brick', penetrable: false, cover: true, ricochet: { maxAngleDeg: 12, chance: 0.45 } },
    sandbag: { impact: 'sand', penetrable: false, cover: true, ricochet: { maxAngleDeg: 3, chance: 0.1 } },
    armor: { impact: 'metal', penetrable: false, cover: true, ricochet: { maxAngleDeg: 25, chance: 0.75 } },
    steel: { impact: 'metal', penetrable: false, cover: true, ricochet: { maxAngleDeg: 20, chance: 0.6 } },
    log: { impact: 'wood', penetrable: false, cover: true, ricochet: { maxAngleDeg: 5, chance: 0.2 } },
    wood: { impact: 'wood', penetrable: true, speedLoss: 0.3, deflectDeg: 4, cover: false, ricochet: { maxAngleDeg: 5, chance: 0.2 } },
    sheetMetal: { impact: 'metal', penetrable: true, speedLoss: 0.14, deflectDeg: 3, cover: false, ricochet: { maxAngleDeg: 12, chance: 0.5 } },
    slate: { impact: 'concrete', penetrable: true, speedLoss: 0.16, deflectDeg: 4, cover: false, ricochet: { maxAngleDeg: 8, chance: 0.3 } },
    carBody: { impact: 'metal', penetrable: true, speedLoss: 0.38, deflectDeg: 7, cover: false, ricochet: { maxAngleDeg: 10, chance: 0.4 } },
    // 버려진 타이어 (고무 + 공기): 관통되지만 속도가 꽤 줄고, 검은 고무 부스러기
    rubber: { impact: 'rubber', penetrable: true, speedLoss: 0.28, deflectDeg: 5, cover: false, ricochet: { maxAngleDeg: 3, chance: 0.05 } },
    // 버려진 배낭·천 (중간 지대 잔해): 관통되며 속도는 조금만 줄고, 흙먼지 탄착
    fabric: { impact: 'dirt', penetrable: true, speedLoss: 0.12, deflectDeg: 3, cover: false, ricochet: { maxAngleDeg: 0, chance: 0 } },
    // 썩은 건초 곤포·더미: 관통되지만 속도가 크게 줄고 흩어짐, 짚 부스러기·먼지
    hay: { impact: 'hay', penetrable: true, speedLoss: 0.5, deflectDeg: 9, cover: false, ricochet: { maxAngleDeg: 2, chance: 0.02 } },
    thinWall: { impact: 'concrete', penetrable: true, speedLoss: 0.5, deflectDeg: 6, cover: false, ricochet: { maxAngleDeg: 8, chance: 0.3 } },
    flesh: { impact: 'flesh', penetrable: false, cover: false, ricochet: { maxAngleDeg: 0, chance: 0 } },
  },

  // 은폐만 되는 재질 (탄은 그대로 통과, 시야만 가림). density: m 당 가림 정도
  concealment: {
    sunflower: { density: 0.55 },
    grass: { density: 0.9 },
    camoNet: { density: 2.5 },
    // 철조망 (말뚝·가닥·원형 철조망): 탄은 통과, 시야는 거의 가리지 않는다 (참호 사격 위치 사선이 지나가므로 아주 옅게)
    wire: { density: 0.02 },
  },

  // 지면 종류 → 이동 속도·스태미나·탄착 재질
  surfaces: {
    plowed: { id: 0, speedMul: 0.86, staminaMul: 1.45, step: 'mud', material: 'earth' },
    grass: { id: 1, speedMul: 1.0, staminaMul: 1.0, step: 'grass', material: 'earth' },
    road: { id: 2, speedMul: 0.8, staminaMul: 1.6, step: 'mud', material: 'mud' },
    wetMud: { id: 3, speedMul: 0.72, staminaMul: 1.8, step: 'mud', material: 'mud' },
    rubble: { id: 4, speedMul: 0.85, staminaMul: 1.2, step: 'gravel', material: 'rubble' },
    sunflower: { id: 5, speedMul: 0.88, staminaMul: 1.3, step: 'mud', material: 'earth' },
    trench: { id: 6, speedMul: 0.85, staminaMul: 1.4, step: 'mud', material: 'earth' },
    crater: { id: 7, speedMul: 0.82, staminaMul: 1.5, step: 'mud', material: 'earth' },
    water: { id: 8, speedMul: 0.62, staminaMul: 2.0, step: 'water', material: 'water' },
    concrete: { id: 9, speedMul: 1.0, staminaMul: 1.0, step: 'hard', material: 'concrete' },
    subsoil: { id: 10, speedMul: 0.88, staminaMul: 1.3, step: 'mud', material: 'subsoil' }, // 흉벽·구덩이 분출물
  },

  // ---------------------------------------------------------------- 플레이어
  player: {
    speeds: { walk: 3.0, sprint: 5.5, crouch: 1.8, prone: 0.7 },
    adsSpeedMul: 0.6,
    accel: 9, // 속도 변화 반응
    eyeHeights: { stand: 1.65, crouch: 1.1, prone: 0.35 },
    postureTime: { standCrouch: 0.4, crouchProne: 0.7, standProne: 0.8 },
    radius: 0.32,
    stepHeight: 0.45,
    maxSlopeDeg: 64, // 이보다 가파른 오르막은 못 올라감
    slopeSlowStartDeg: 30,
    lean: { angleDeg: 13, offset: 0.36, proneOffset: 0.16, time: 0.22 },
    mouseSensitivity: 0.0022,
    adsSensitivityMul: 0.75,
    maxPitchDeg: 85,
    stamina: { max: 100, sprintDrain: 12, regenMoving: 8, regenStill: 16, minToSprint: 15 },
    breath: { gainPerSecSprint: 0.22, decayPerSec: 0.09 }, // 숨참 정도 0..1
    bob: { walk: 0.022, sprint: 0.045, crouch: 0.014 },
    stepLength: { walk: 0.78, sprint: 1.05, crouch: 0.6, prone: 0.55 },
    // 조준 흔들림 (mrad 단위 진폭)
    sway: {
      baseMrad: 3.4,
      postureMul: { stand: 1.0, crouch: 0.62, prone: 0.3 },
      restedMul: 0.22, // 엄폐물·땅에 총을 걸쳤을 때
      movingMul: 2.6,
      breathMul: 4.0, // 숨참 1.0 일 때 추가 배수
      woundedMul: 1.9,
      suppressionMul: 2.2, // 제압 100 일 때 추가 배수
      adsMul: 0.85,
      transitionMul: 2.0,
    },
    // 총 거치: 눈앞 probeDist 범위에서 총열 아래 bandBelowBore 높이에 엄폐물 윗면이 있으면
    rest: { probeDist: [0.35, 1.15], bandBelowBore: [0.0, 0.38], sideProbe: 0.3 },
    wounded: { speedMul: 0.6, noSprint: true },
    knockdownTime: [2.6, 4.0],
  },

  // ---------------------------------------------------------------- 피해 모델 (플레이어·적 공통)
  damage: {
    plateHalfWidth: 0.125, // 방탄판 (가슴·등 중앙)
    plateKnockdown: [2.5, 4.0], // 방탄판 피격 시 쓰러져 있는 시간
    limbWoundedSpeedMul: 0.6,
    woundedSwayMul: 1.8,
  },

  // ---------------------------------------------------------------- 제압 시스템
  suppression: {
    max: 100,
    // 근접 통과: 탄 비행 선분과 머리·가슴 기준점 사이 최단거리
    nearPass: [
      { dist: 0.5, value: 25 },
      { dist: 1.5, value: 15 },
      { dist: 3.0, value: 8 },
    ],
    // 근접 탄착: 거리에 따라 valueAtZero → valueAtMax 로 선형 감소
    nearImpact: { maxDist: 3.0, coverMaxDist: 5.0, valueAtZero: 20, valueAtMax: 6 },
    tracerMul: 1.2,
    resilienceRange: [0.7, 1.3], // 병사별 내성 (곱해짐)
    repeatWindow: 0.5, // 같은 대상에 이 시간 안에 연달아 들어오면 효과 감소
    repeatMuls: [1.0, 0.7, 0.4], // 첫 번째, 두 번째, 세 번째 이후
    holdTime: 2.0, // 마지막 입력 후 유지 시간
    decayPerSec: 8,
    thresholds: { pressured: 25, suppressed: 50, pinned: 80 },
    finalizePastDist: 6, // 탄이 대상을 이 거리 이상 지나가면 판정 확정
    considerDist: 7.5, // 이 거리 밖의 탄은 무시
    playerNearMissCrackDist: 3.0,
  },

  // ---------------------------------------------------------------- 병사 종류 / 세력
  factions: {
    friendly: { tapeColor: 0x19b3a6, name: '아군' }, // 청록색 테이프
    enemy: { tapeColor: 0xe46f1c, name: '적' }, // 주황색 테이프
  },
  soldierTypes: {
    rifleman: {
      weapon: 'ak545',
      spareMags: 14,
      aimDispersionMrad: 4.8, // 조준 사격 기본 분산 (표준편차)
      blindFireDispersionMrad: 45,
      reactionTime: [0.35, 0.8],
      colors: { uniform: 0x5c5a45, uniform2: 0x48463a, vest: 0x4a4a3a, helmet: 0x3f4234, skin: 0x8a6e5a, boots: 0x1c1a17, gear: 0x2d2b25 },
    },
    // 2단계 아군 분대원: 같은 몸 모델·같은 명중률, 탄창 8개 (장전 1 + 예비 7)
    squadRifleman: {
      weapon: 'ak545',
      spareMags: 7,
      aimDispersionMrad: 4.8,
      blindFireDispersionMrad: 45,
      reactionTime: [0.35, 0.8],
      colors: { uniform: 0x5c5a45, uniform2: 0x48463a, vest: 0x4a4a3a, helmet: 0x3f4234, skin: 0x8a6e5a, boots: 0x1c1a17, gear: 0x2d2b25 },
    },
  },

  // ---------------------------------------------------------------- 적 AI
  ai: {
    maxEnemies: 6,
    coverWait: [2.5, 6.0],
    coverWaitPressuredMul: 1.6,
    coverWaitCoveringFire: [0.6, 1.6],
    observeTime: [1.0, 3.0],
    observeTimePressuredMul: 0.5,
    observeTimeCoveringFireMul: 0.6,
    aimTime: [0.45, 0.95], // 고개를 든 뒤 첫 발까지
    firstShotDelay: [0.3, 0.5], // 사격 자세로 바꾼 뒤 첫 발까지 (견착)
    // 사수 자신의 엄폐물에 탄이 막히는지: 눈 → 총구 → checkDist 앞까지(끝을 endDrop 만큼 낮춰) 검사,
    // 막히면 liftStep 씩 maxLift 까지 들어 올리고 그래도 막히면 쏘지 않는다
    ownCoverClear: { checkDist: 3.5, endDrop: 0.05, liftStep: 0.07, maxLift: 0.21, effectMaxOffset: 0.35 },
    burstChoice: { single: 0.45, two: 0.3, three: 0.25 },
    coveringFireBurst: [3, 5],
    burstInterval: 0.092, // 650rpm
    singleShotInterval: [0.55, 1.1],
    shotsPerExposure: [1, 3],
    repositionChance: 0.38,
    pressuredAccuracyMul: 0.5, // 명중률 절반
    blindFireInterval: [5, 10],
    blindFireRounds: [2, 5],
    duckTime: 0.25,
    moveSpeeds: { crouchWalk: 1.4, walk: 2.6, jog: 3.6, sprint: 5.4, crawl: 0.55 },
    rushTime: [3, 5], // 개활지 질주 시간
    dropTime: 0.5,
    proneRestTime: [1.2, 3.0],
    restWaitMax: 20, // 경유점에서 이 시간 이상 못 움직이면 저지로 처리
    hitTheDirtCraterRadius: 7,
    turnRate: 3.5,
    // 탐지 (적 → 플레이어)
    perceptionInterval: 0.2,
    detectBaseRate: 0.22, // 100m, 완전 노출·정지 상태일 때 초당 발견률
    detectRangeExp: 1.5,
    // 2단계: 여러 대상(플레이어·아군) 중 노릴 대상 고르기 점수
    targeting: {
      visibleBonus: 100, // 지금 보이는 대상
      motionBonus: { still: 0, walk: 10, sprint: 25 }, // 보이는 대상이 움직이면 추가 (약진 중인 아군에 사격이 몰린다)
      recentBonus: 30, // 최근 화염·직접 확인 (초가 지날수록 감소)
      soundBonus: 8, // 총성·공유 정보만
      distancePenalty: 0.06, // m 당 감점 (가까운 대상 우선)
      stickiness: 6, // 지금 대상 유지 가산 (자주 바꾸지 않게)
    },
    detectPostureMul: { stand: 1.0, crouch: 0.6, prone: 0.35 },
    detectMotionMul: { still: 1.0, walk: 2.0, sprint: 3.5 },
    flashDetectChance: 0.75, // 관측 중 플레이어 총구 화염을 볼 확률
    soundErrorPerMeter: 0.1, // 총성만 들었을 때 위치 추정 오차 (거리 비례)
    flashErrorBase: 1.5,
    flashErrorMin: 2.2, // 화염·총성만으로는 이보다 정확해지지 않는다
    soundErrorMin: 6,
    flashErrorPerMeter: 0.01,
    visualErrorBase: 0.25,
    visualErrorPerMeter: 0.002,
    estimateGrowthPerSec: 0.35, // 시간이 지나면 추정 오차가 커짐
    estimateForgetTime: 45,
    priorError: 22, // 처음엔 수로 어딘가에 있다고만 안다
    fireAtPriorChance: 0.55,
    fireAtSoundChance: 0.8,
    shareDelay: [2.0, 4.0],
    shareErrorMul: 2.5,
    aimPointSpreadMul: 0.55, // 점사마다 추정 위치 주변 어디를 노릴지
    trackingError: 0.35,
    firingDetectMul: 2.0, // 플레이어가 방금 쐈으면 눈에 띄기 쉬움
    burstClimbMul: 0.55, // 점사 n발째 분산 증가
    coveringFireDispersionMul: 1.35,
    lightFactor: { outdoor: 1.0, trench: 0.72, building: 0.45, crater: 0.85 },
  },

  // ---------------------------------------------------------------- 임무: 이동 저지
  mission: {
    duration: 300, // 5분
    maxAdvances: 3,
    advanceInterval: [20, 40],
    quietBetweenAttempts: [10, 18], // 이전 시도가 끝난 뒤 최소 대기
    firstAdvanceDelay: [16, 24],
    coveringFireLead: [3, 5], // 출발 3~5초 전부터 엄호사격
    departQuietTime: 3, // 최근 3초간 근처에 탄이 없어야 출발
    departMaxSuppression: 25,
    abandonAfter: 14, // 이 시간 안에 출발 못 하면 저지(포기)
    reinforcementDelay: [30, 60],
    nodeWeights: { line: 0, crater: 3, trench: 2, building: 1, rubble: 1, open: 4 },
  },

  // ---------------------------------------------------------------- 2단계 임무: 약진 엄호
  advanceMission: {
    timeLimit: 720, // 12분
    assaultHoldTime: 30, // 돌격 대기 위치에서 버틸 시간
    assaultRadius: 9, // 돌격 대기 위치 판정 반경
    minAtAssault: 2, // 기동조 중 이만큼이 돌격 대기 위치에 있어야
    maxMobileLosses: 3, // 기동조 전투 불능이 이만큼이면 실패
    reinforcementMax: 2, // 적 증원 최대 횟수
    endDelay: 2.0,
  },

  // ---------------------------------------------------------------- 2단계: 아군 분대 (사격과 기동)
  squad: {
    // 이동·자세
    sprintSpeed: 4.6, // 장비를 메고 밭을 가로지르는 질주 (적 질주 5.4보다 느림)
    runTime: [3, 5], // 한 번에 뛰는 시간 (넘으면 엎드림)
    dropTime: [0.9, 1.8], // 긴 구간 중간에 엎드려 숨 고르는 시간
    upTime: [2.5, 5.0], // 엄호 위치에서 고개를 들고 관측·사격하는 시간
    downTime: [1.2, 3.0], // 고개를 숙이고 있는 시간
    resumeQuiet: 2.0, // 멈춘 뒤 다시 뛰려면 근접탄 없이 이만큼
    diveCraterRadius: 6, // 근접탄을 받으면 이 거리 안의 구덩이로 뛰어든다
    nearRoundDist: 3, // '근접탄' 거리 (통과·탄착)
    craterSnap: 6, // 경로 지점을 이 거리 안의 실제 구덩이 중심에 맞춤
    slotCount: 4, // 구덩이마다 엎드릴 자리 (1조 0·1, 2조 2·3)
    slotSpacing: 1.0, // 자리 사이 좌우 간격 (m)
    slotRimBelow: 0.3, // 구덩이 테두리보다 이만큼 낮은 경사면에 엎드린다 (눈만 테두리 위로)
    slotBodyBack: 0.7, // 몸 중심은 그 지점에서 이만큼 뒤
    canalBench: 2.42, // 수로 중심에서 북쪽 사격 턱까지 (플레이어 시작 위치와 같은 줄)
    facePoint: [-5, -112], // 기본으로 바라보는 곳 (적 진지 가운데)
    // 사격 (1단계 적과 같은 명중률 규칙)
    fireInterval: [2, 5], // 단발 간격
    fireRange: 420,
    estimateMaxAge: 40, // 이보다 오래된 추정에는 쏘지 않는다
    lowAmmoRounds: 60,
    lineClearance: 2.0, // 사선에서 다른 아군까지 이 거리 안이면 쏘지 않는다
    lineClearanceDeg: 2.5, // 또는 이 각도 안
    // 약진 판단 (분대장)
    checkInterval: 1.0, // 출발 조건 검사 간격
    threatMinSuppression: 25, // 사선이 닿는 적은 모두 이 이상(압박)이거나 쓰러져야
    departMaxSuppression: 25, // 뛸 분대원의 제압 값이 이보다 낮아야
    departQuietTime: 2.0, // 최근 이 시간 동안 뛸 분대원 근처(3m)에 적 탄이 없어야
    minBoundGap: 8, // 지난 약진 도착 뒤 최소 대기 (G 요청이면 생략)
    blockedRepeat: 20, // 이 시간 이상 막히면 엄호 사격을 다시 요청
    losStep: 2.5, // 구간 사선 검사 간격 (m)
    losRunnerHeight: 1.2, // 뛰는 사람 가슴 높이
    enemyEyeHeights: { stand: 1.55, kneel: 1.05, prone: 0.35 },
    // 표적 지시 (X)
    designateTime: 15,
    designateSpread: 1.4, // 지시 지점 주변 조준 분산 (m)
    designateRange: 600,
    designateMatch: 18, // 지시 지점에서 이 거리 안의 적 추정을 지시 지점으로 갱신
    designateSigma: 4,
    // 사격 전환 (플레이어 사선과 아군)
    // angleDeg·lineDist: 사선 둘레, targetDist: 탄착점 둘레 (탄착이 minTargetRange 보다 멀 때만), minRange: 이보다 가까운 사선 구간은 보지 않음
    shiftFire: { angleDeg: 5, lineDist: 3, targetDist: 30, minTargetRange: 25, minRange: 8 },
    friendlyNearDist: 3, // 플레이어 탄이 아군 이 거리 안을 지나면 '아군이다! 사격 중지!'
    playerFriendlyFire: true, // 플레이어 탄은 아군에게 피해·제압
    // 콜아웃
    calloutGap: 6, // 같은 콜아웃은 이 시간 안에 반복하지 않는다
    markerTime: 2.0, // Tab 을 떼도 표지가 남는 시간
    contactRange: 450,
  },

  // ---------------------------------------------------------------- 이펙트
  effects: {
    maxDust: 3600,
    maxGlow: 900,
    maxDebris: 700,
    maxTracers: 64,
    maxDecals: 240,
    distanceScaleRef: 55, // 이 거리부터 크기 보정 시작
    distanceScaleExp: 0.72,
    distanceScaleMax: 4.2,
    particleFogMul: 0.55, // 탄착 먼지는 안개에 덜 묻히게
    muzzleFlashTime: 0.055,
    muzzleFlashSize: 0.55,
    muzzleDustHeight: 0.55, // 총구가 지면에서 이 높이 안이면 흙먼지
    tracerLength: 11,
    tracerWidth: 0.07,
    // 예광탄 빛줄기도 장면 안개(atmosphere.fog 식)를 받는다. 거리만 이 배수로 줄여 밝은 빛줄기가 더 멀리까지 읽히게
    //  (0.38 → 300m 에서 안개 약 15%, 600m 약 39% — 예전 자체 안개식과 거의 같음)
    tracerFogMul: 0.38,
  },

  // ---------------------------------------------------------------- 사운드
  audio: {
    master: 0.9, // 출력 최대치 (볼륨 슬라이더 100% 일 때)
    defaultVolume: 0.8, // 일시정지 메뉴 전체 볼륨 기본값 (0~1, 브라우저에 저장됨)
    speedOfSound: 340,
    hrtf: true,
    gunshotNearGain: 0.85,
    gunshotFarRef: 25, // 이 거리 기준으로 감쇠
    gunshotFarExp: 0.85,
    gunshotMinGain: 0.035,
    farLowpass: { near: 9000, far: 1400, range: 380 },
    crackGain: 0.95,
    impactGain: 0.7,
    impactMaxDist: 140,
    reverbSend: { near: 0.18, far: 0.55 },
    windGain: 0.16,
    artilleryInterval: [7, 22],
    artilleryGain: 0.45,
    distantFireInterval: [12, 35],
    footstepGain: 0.42,
    reloadGain: 0.55,
    casingGain: 0.18,
  },

  // ---------------------------------------------------------------- HUD
  hud: {
    compassFovDeg: 120,
    messageTime: 3.2,
    ammoCheckTime: 2.4,
    ammoCheckDelay: 0.55,
    vignetteMax: 0.85,
    shakeNearMiss: 0.010,
    shakeImpact: 0.006,
    shakeDecay: 7,
  },

  // ---------------------------------------------------------------- 2단계: 소리 버스·볼륨·무전 스켈치·음성 합성 (AudioSystem)
  // 출력: 효과음 버스(모든 게임 효과음) + 음성 버스(무전 스켈치) → 전체(master, audio.master × 볼륨) → 먹먹함 → 압축 → 리미터.
  // 일시정지 메뉴 슬라이더 3개(전체·효과음·음성)와 '음성 콜아웃 읽기'는 브라우저(localStorage)에 기억된다 (전체 기본값 = audio.defaultVolume)
  audioMix: {
    defaultSfx: 1.0, // 효과음 볼륨 기본값 (0~1)
    defaultVoice: 0.85, // 음성 볼륨 기본값 (0~1: 무전 스켈치 + 음성 합성)
    storageKeys: { master: 'vftgrf.volume', sfx: 'vftgrf.volume.sfx', voice: 'vftgrf.volume.voice', speech: 'vftgrf.speech' },
    squelchGain: 0.3, // 무전 스켈치 (송신 시작·끝 '지직')
    squelchMinInterval: 0.12, // 이보다 짧은 간격으로 연달아 오면 스켈치는 한 번만 (s)
    refillGain: 0.5, // 탄창 채우기 소리 (클립 꽂기·탄 눌러 넣기·빈 클립·파우치)
    // 음성 합성 (브라우저 speechSynthesis, 한국어 음성): 기본 끔. 음량 = 전체 × 음성.
    // 대기는 최대 1개 (새 콜아웃이 대기 중인 것을 바꿈), maxAge 초가 지난 대기 문장은 버림, 'alert' 는 읽던 것을 끊고 바로 읽음.
    // stuckTimeout: 끝 알림(onend)이 오지 않는 브라우저용 — 이 시간이 지나면 다음 문장으로 넘어감 (s)
    speech: { lang: 'ko-KR', rate: 1.15, pitch: 0.95, maxAge: 4, stuckTimeout: 10, alertInterrupts: true },
  },

  // ---------------------------------------------------------------- 2단계: 분대 콜아웃 자막 (HUD, EV.CALLOUT)
  // 화면 아래 가운데 "[분대장] 2조 이동!" — 새 줄이 아래, 가장 오래된 줄을 밀어낸다. 같은 줄이 연달아 오면 합쳐 시간만 늘린다
  callouts: {
    time: 3.5, // 한 줄이 보이는 시간 (s, 게임 시간 — 일시정지 중에는 멈춤)
    fade: 0.45, // 사라지는 시간 (s)
    maxLines: 2, // 동시에 보이는 줄 수
  },

  // ---------------------------------------------------------------- 2단계: 탄약 상자 (2단계 임무에서만, world/AmmoCrate.js + Player 의 F 탄창 채우기)
  ammoCrate: {
    totalRounds: 300,
    // 놓을 자리 후보 [dx, d]: 시작 위치(MAP.playerSpawn)에서 수로를 따라 동쪽(+)으로 dx m, 수로 중심에서 북쪽 d m (null = 사격 발판 가운데).
    // 앞쪽부터 발자국 지면 높이 차가 flatTol 이하이고 다른 충돌체와 clear m 안에서 겹치지 않는 첫 자리 (시작 위치 동쪽 2.3m 에는 잡동사니 빈 상자가 있다)
    spots: [[-1.75, null], [-2.2, null], [-1.4, null], [1.6, null], [-2.8, null]],
    flatTol: 0.08,
    clear: 0.12,
    size: [0.56, 0.22, 0.34], // 바깥 치수 (길이 · 높이 · 폭, m) — 높이가 player.stepHeight 보다 낮아 넘어 다닐 수 있다
    yawJitter: 0.12, // 수로 방향에서 살짝 틀어 놓음 (rad)
    packetRounds: 30, // 상자 안 종이 탄포 하나 (남은 탄에 맞춰 보이는 탄포 수가 줄어듦, 최대 10개)
    useRadius: 2.2, // 이 수평 거리 안에서 F 로 시작 (m)
    leaveRadius: 2.5, // 이보다 멀어지면 중단 (m)
    maxDy: 1.2, // 높이 차가 이보다 크면 손이 닿지 않음 (m)
    // 탄창 하나 (30발 = 10발 클립 3개 ≈ 8초): 파우치에서 꺼내 장전 가이드 끼우기(takeTime) → 클립마다
    // (꽂기 clipInTime → 엄지로 눌러 넣기 pressTime → 빈 클립 빼기 clipOutTime, 이때 탄이 옮겨짐) → 파우치에 넣기(stowTime)
    clipRounds: 10,
    takeTime: 0.9,
    clipInTime: 0.35,
    pressTime: 1.25,
    clipOutTime: 0.5,
    stowTime: 0.8,
    raiseTime: 0.35, // 멈춘 뒤 총을 다시 들어 쏠 수 있을 때까지 (s)
    // 채우는 동안 1인칭 총 자세 (viewModel.poses 와 같은 형식, 카메라 기준 p[x,y,z]·r[pitch,yaw,roll]):
    // 달릴 때처럼 몸 앞에 비스듬히, 그보다 조금 더 낮게 (총구가 아래로) 들어 화면 아래쪽에 걸친다
    viewPose: { p: [0.14, -0.22, -0.13], r: [-0.3, 0.6, 0.45] },
  },

  // ---------------------------------------------------------------- 1인칭 뷰모델 (AK-74, 실제 치수 m)
  // 좌표: 눈(카메라) = 원점, 조준선 = -Z 축(y=0), 총열은 ammo.sightHeight 아래.
  // 조준 시 뷰모델은 장면 카메라와 같은 시야각으로 그려 가늠쇠 기둥이 실제 각크기(약 3mrad)로 보인다.
  viewModel: {
    eyeToRearSight: 0.25, // 눈 → 가늠자 U홈
    sightRadius: 0.38, // 가늠자 → 가늠쇠
    frontPostWidth: 0.002, // 가늠쇠 기둥 폭 (눈에서 0.63m → 약 3.2mrad, 200m 에서 0.63m 를 가림)
    frontEarGap: 0.011, // 가늠쇠 보호 귀 안쪽 간격
    frontEarRise: 0.005, // 보호 귀 끝이 가늠쇠 끝보다 높은 정도
    rearLeafWidth: 0.02, // 가늠자 판 폭
    rearNotchWidth: 0.0034, // 가늠자 U홈 폭·깊이 (눈에서 25cm → 약 13.6mrad)
    rearNotchDepth: 0.003,
    rearSightBlur: 0.0007, // 가늠자 판 가장자리 흐림 폭 (눈의 초점이 가늠쇠에 있어 가까운 가늠자는 흐리다)
    dustCoverDrop: 0.012, // 기관부 덮개 뒤 끝이 앞보다 낮은 정도 (조준 시 총몸이 화면 아래로 빠지게)
    // 조준 시 눈 바로 앞(가까운 기관부 덮개·개머리판)은 두 눈을 뜨고 볼 때처럼 흐릿하게 비친다:
    // 눈에서 adsNearFade[0]m 이내는 adsGhostAlpha 만 남고 [1]m 부터 완전히 보인다
    adsNearFade: [0.1, 0.225],
    adsGhostAlpha: 0.5,
    // 색: 채도 낮은 짙은 자두빛 갈색 적층목 + 무광 흑회색 금속, 장갑·위장복 소매
    colors: {
      metal: 0x343537,
      metalDark: 0x202122,
      furniture: 0x3d3333,
      magazine: 0x302b2c,
      glove: 0x34332d,
      gloveDark: 0x26251f,
      cuff: 0x45463a,
    },
    // 자세별 총 위치 p[x,y,z] / 회전 r[pitch,yaw,roll] (카메라 기준).
    // ads 는 항상 0 이어야 한다 (가늠쇠 끝 = 화면 중앙 = 설정 거리 탄착점)
    poses: {
      hip: { p: [0.125, -0.095, -0.07], r: [0.045, 0.07, 0.06] },
      sprint: { p: [0.14, -0.15, -0.18], r: [0.0, 0.7, 0.45] }, // 몸 앞에 비스듬히 낮춰 든다 (화면 아래쪽에 보임)
      reload: { p: [0.05, -0.05, -0.26], r: [0.15, 0.3, -0.4] }, // 오른쪽으로 눕혀 탄창 삽입구가 보이게
      bolt: { p: [0.07, -0.06, -0.25], r: [0.12, 0.2, 0.45] }, // 빈 재장전: 왼쪽으로 눕혀 장전손잡이를 당긴다
      down: { p: [0.12, -0.34, 0.0], r: [-0.8, 0.4, 0.4] },
    },
    blendRates: { sprint: 7, reload: 7, down: 6 },
    // 팔: 어깨 관절(카메라 기준)과 위팔·아래팔 길이. 손 위치에 맞춰 2관절 IK 로 팔꿈치를 정한다
    shoulders: { right: [0.17, -0.25, 0.14], left: [-0.19, -0.27, 0.06] },
    upperArm: 0.3,
    foreArm: 0.27,
    bob: { x: 0.006, y: 0.008, sprintMul: 2.2 },
    // 장면 조명(반구광·태양광)을 매 프레임 그대로 옮겨 쓴다. 배율로 미세 조정
    lightHemiMul: 1.0,
    lightSunMul: 1.0,
    flashLight: 3.5,
    // 쓰러질 때 카메라가 지형을 뚫지 않게: 주변 지면보다 최소 이만큼 위
    deathCamClearance: 0.22,
    deathCamProbe: 0.3,
  },

  debug: {
    startEnabled: false,
    bulletTrailCount: 160,
    // F3 적이 기억하는 플레이어 추정 위치: 지면 위 고리(반지름 = 추정 오차 1σ, ringRadius 범위로 자름, ringSegments 각)
    // + 가운데 작은 구(marker 반지름 m). 카메라가 hideNear m 안이면 구를 숨긴다 (내 눈앞을 덮지 않게, 고리·연결선만 남음)
    estimate: { ringSegments: 32, ringRadius: [0.5, 40], ringLift: 0.08, marker: 0.18, hideNear: 3.0 },
    labelGap: 2, // 적 이름표가 화면에서 겹치면 위로 쌓을 때 사이 간격 (px)
    // F4 점검 시점: 4번(장갑차 옆) 후보 자리 = MAP.apc 기준 [x, z] 오프셋 (m, 앞쪽이 우선). 첫 후보 = 차체 서쪽 끝의 남서쪽:
    // 차체가 오른쪽 앞에 보이고, 차체 남동쪽에 날아가 누운 포탑·포신(끝 ≈ 오프셋 [4.9, 0.6], 충돌체 없음)은 시야 밖이다.
    // 선 눈높이에서 북쪽 clearAhead m·좌우 sideDeg 비스듬히 clearSide m 가 지형·충돌체(차체·잔해)에 막히지 않는 첫 자리를 쓴다
    viewPoints: { apcOffsets: [[-6, 6], [-6.5, 4], [6.5, -0.5], [6, 2]], clearAhead: 30, sideDeg: 20, clearSide: 8 },
  },
};

// 편의 접근자
export const MATERIALS = CONFIG.materials;
export const SURFACES = CONFIG.surfaces;
export const SURFACE_BY_ID = Object.fromEntries(
  Object.entries(CONFIG.surfaces).map(([key, def]) => [def.id, { key, ...def }]),
);

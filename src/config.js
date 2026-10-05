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
    exposure: 1.55,
    grade: { saturation: 0.74, tint: [0.955, 0.99, 1.055] },
  },

  // ---------------------------------------------------------------- 그래픽 품질 프리셋 (낮음 / 보통 / 높음)
  // 일시정지 메뉴(브리핑 화면에도 있음)에서 고르면 실행 중 바로 적용되고, 고른 값은 브라우저(localStorage)에 기억된다
  // (저장소를 못 쓰는 환경이면 매번 default). 시작할 때 고른 프리셋이 아래 원래 설정 키를 덮어쓴다:
  //  vegetationDensity → vegetation.density   해바라기·풀을 생성한 양에서 그리는 비율 (은폐 판정은 프리셋과 무관하게 그대로)
  //  vegetationLod     → vegetation.lodScale  식생 거리 배수: 해바라기 3D↔빌보드 전환 40m·원거리 170m, 풀 보이는 거리 110m 에 곱한다
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
    //  광학 깊이 tau = linear·d + (quad·d)²  → 투과율 T = (1 - farResidual)·e^-tau + farResidual·e^(-d/farLength)
    //  d = 카메라에서의 실제 거리 (화면 깊이가 아니라서 고개를 돌려도 안개가 같다)
    //  linear 항: 가까운 곳부터 대기 원근감, quad 항: 시정 600m 근처에서 빠르게 짙어짐,
    //  farResidual: 먼 언덕·마을·연기 기둥이 희미한 실루엣으로 남는 몫 (원경 1~2km 마을·송전탑이 겨우 읽히도록 0.06 → 0.09)
    //  hazeHeight: 높이 안개 (지면 연무가 위로 갈수록 옅어짐, 높은 연기·탑 끝이 덜 묻힌다), m
    //  현재 값 (지면 높이) → 100m 12%, 200m 30%, 300m 49%, 400m 65%, 600m 85%, 1km 92%, 2km 94%, 3km 95%
    fog: { linear: 0.00082, quad: 0.00237, farResidual: 0.09, farLength: 6000, hazeHeight: 90 },
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
      hazeMul: 1.0, // 지평선 연무 띠 두께 배수 (1 = 안개 식과 일치: 지평선 = 안개색, 고도 10° 약 80%, 20° 42%, 머리 위 10%)
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
      alpha: 0.72,
      colorNear: [0x1e1d1c, 0x292827],
      colorFar: [0x3d3e3f, 0x4b4d4f],
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
        alongStep: 3, // 고랑을 따라가는 정점 간격 (m)
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
    tracks: { bandHalf: 0.28, depth: 0.06 }, // 궤도 차량 자국 (MAP.vehicleTracks)
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
    // 이방성 필터: 알베도(주 재질)는 항상 GPU 최대값. 노멀·혼합 마스크·섞이는 두 번째 재질은 이 값까지 (픽셀당 비용 절약)
    normalAnisotropy: 4,
    maskAnisotropy: 4,
    macroSizes: [61, 9.5, 530], // 큰 색 변화 / 반복 깨기 섞기 / 맵 밖 밭·풀밭 얼룩 노이즈 크기 (m)
    macroStrength: [0.26, 0.1],
    heightBlend: 0.35, // 재질 경계에서 높이(돌·풀 포기)가 높은 쪽이 이기는 정도
    variation: { size: [45, 11], amp: [0.07, 0.035] }, // 정점색 밝기 변화
    ao: { power: 1.2, min: 0.32, fineDists: [0.6, 1.3, 2.6, 5.0], coarseDists: [3, 7] }, // 굽는 앰비언트 오클루전
    waterInFurrows: 0.3, // 젖은 저지대 밭: 고랑 바닥에서 이 높이(이랑 비율)까지 물
    puddle: { deepColor: 0x262422, reflect: 0.9, opacity: 0.93, edgeSoft: 0.12 },
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
    sandbag: { gap: 2.0, slot: 0.9, stackLen: 1.1, layers: 3, wrap: 0.25 },
    // 수로 바닥 잡동사니 개수 (타이어·양동이·탄약 상자), 놓을 x 범위, 시작 위치 둘레 비움 (m)
    junk: { tyres: 9, buckets: 6, crates: 8, xRange: [-150, 150], spawnClear: 4 },
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
      // 밭 가장자리: 안쪽으로 edgeWidth 에 걸쳐 듬성듬성해지고 키도 조금 작아진다 (경계는 노이즈로 들쭉날쭉 — 일직선으로 끊기지 않게)
      edgeWidth: 12,
      edgeNoise: { size: 22, amp: 7, detailSize: 6, detailAmp: 2 },
      edgeHeight: 0.8, // 가장자리 줄기 키 배수 (안쪽 1)
      straggle: { dist: 5, chance: 0.05 }, // 밭 밖 머리땅으로 이 거리까지 드문드문 남은 줄기 (확률)
      heightPatch: { size: 25, amp: 0.08 }, // 구역마다 키가 조금씩 다름 (윗선이 평평한 띠가 되지 않게)
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
      colors: { stem: 0x423930, stemTop: 0x342c25, face: 0x271f1a, back: 0x463a30, leaf: 0x4f4437 },
      cardShade: 1.05, // 빌보드 밝기 배수 (근거리 3D 와 맞춤)
      wind: 0.03, // 바람 흔들림 (꽃판 높이에서 m, 아주 약하게)
      // LOD (m): near 안 = 저폴리 3D (줄기·꽃판·잎), 그 밖 = 교차 빌보드 (덮는 비율을 지키는 밉맵이라 멀어져도 높이감 있는 어두운 띠로 남음),
      //  far 밖 = 빌보드를 farKeep 비율만 남기고 넓혀 그린다 (원거리 밭 실루엣, 겹침 줄임). band = 디더 전환 폭.
      //  cell: 동적 선택 칸 크기, refreshMove/TurnDeg: 다시 고르는 이동·회전, wedgeMarginDeg: 시야 쐐기 여유, nearCapacity: 3D 최대 포기 수
      lod: { near: 40, nearBand: 5, far: 170, farBand: 30, farKeep: 0.5, cell: 8, refreshMove: 2.5, refreshTurnDeg: 10, wedgeMarginDeg: 20, nearCapacity: 12000 },
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
    // 수로 바닥 물가 마른 갈대 군락 (MAP.canal.reeds): 높이 1.5~2m, 은폐만. band = 수로 중심에서 떨어진 거리 범위 (물가~비탈 아래)
    reeds: { spacing: 0.3, height: [1.5, 2.0], width: [0.7, 1.05], color: 0x837d6c, brightness: [0.78, 1.05], wind: 0.06, band: [0.45, 1.25] },
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
    car: { scorch: { grow: 0.6, soft: 2.2, strength: 0.26 }, truckDrop: 0.15, plankTint: 0x8a7a66 },
    // 송전선: 선 조각 길이(m), 서 있는 탑 사이 처짐(m), 쓰러진 탑에 걸린 경간 처짐(땅까지), 땅에 닿은 선이 구불거리는 폭,
    // 땅 위로 띄우는 높이, 구불거림이 시작되는 높이 폭, 끊어진 선 길이(경간 배수), 늘어진 선이 땅에 닿는 수평 거리(높이 배수),
    // 격자 탑 주 부재 충돌 막대 반폭
    wires: { segment: 2.5, sag: 3.2, brokenSag: 9, groundWander: 0.35, lift: 0.03, wanderBlend: 0.4, snappedLength: 0.38, hangReach: 0.4, memberHalf: 0.12 },
    // 콘크리트 전신주 (MAP.poles): 땅 위 높이·묻힌 깊이, 단면(밑동·꼭대기 폭 x 두께), 기본 기울기(도), 전선 처짐, 색, 충돌 막대 반폭
    poles: { height: 9.5, buried: 1.6, base: [0.26, 0.18], top: [0.15, 0.15], leanDeg: 9, sag: 0.8, color: 0xa29e94, colliderHalf: 0.1 },
    // 작은 잔해 (인스턴싱, 종류마다 드로우콜 1): 개수, 놓지 않을 남쪽 한계(z, 수로 쪽)·동서 한계, 상자를 두지 않을 적 사격 위치 둘레 (m)
    // types: 크기 배수 범위, 땅 위 높이(배수 1 기준), 색 후보, 충돌 상자 반크기(상자만, 나무)
    debris: {
      counts: { shard: 320, crate: 34, camo: 20, helmet: 26, pack: 16 },
      maxZ: 92,
      maxX: 250,
      clearFp: 6,
      types: {
        shard: { scale: [0.12, 0.38], lift: 0.03, colors: [0x2c2622, 0x241f1c, 0x332a24, 0x1f1c1a, 0x3a2e26] },
        crate: { scale: [0.95, 1.05], lift: 0, collider: [0.28, 0.095, 0.17], colors: [0x7d7c5a, 0x6c6c4c, 0x8a8262, 0x5e5c46] },
        camo: { scale: [0.9, 2.3], lift: 0, colors: [0xffffff, 0xe0dcd0, 0xc8c4b8] },
        helmet: { scale: [0.96, 1.04], lift: 0.02, colors: [0x56593f, 0x4a4d38, 0x5e5a44, 0x3e4234] },
        pack: { scale: [0.9, 1.1], lift: 0, colors: [0x5e5a42, 0x6a6248, 0x4c4a38, 0x5a5546] },
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
    spoil: { apron: 9, strength: 0.85, patch: 2.6, crest: 1.0, parados: 0.75 },
    // 흉벽 앞면·마루의 흙덩이 (인스턴스 'clod'): m 당 개수, 크기(m), 납작함(높이 배수), 색 후보, 사격 위치(fps x) 둘레 이 거리 안은 두지 않음
    clods: { perMeter: 6.0, size: [0.2, 0.55], flat: [0.3, 0.5], colors: [0xd2bf9a, 0xc4b08c, 0xdcc8a4, 0xb8a47e, 0xa89470], fpClear: 2.8 },
    // 흉벽 모래주머니 구간 (MAP.trench.sandbagRuns): 층 수, 자루 길이 방향 간격(m), 줄 수(두께), 흉벽 마루 위치(참호 중심선에서 m),
    // 색 후보 (새 자루는 밝은 황회색, 오래된 것은 흙물), 사격 구멍 폭(m)
    sandbags: { layers: 3, bagStep: 0.5, rows: 2, crestDist: 1.55, colors: [0xd4ccb4, 0xc6bea6, 0xb8ae94, 0xa89e86, 0xdcd4bc], loopholeWidth: 0.34 },
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
      picketColor: 0x7a6658,
      craterCut: 1.05,
      breakChance: 0.07,
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
  // 급수탑·곡물 창고·송전탑과 전신주 행렬을 둔다. 모두 같은 안개를 받아 거의 실루엣만 보인다 (먼 곳 몫 atmosphere.fog.farResidual).
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
      // (그 위에 MAP.distant.hills 둔덕을 더한다 — 마을이 올라앉은 비탈)
      hills: { start: 150, full: 1400, amp: 20, size: [1500, 620], valley: 0.45, canalValley: [40, 260] },
      // 밭 구획 (맵 밖, 지면 셰이더): 한 칸 [동서, 남북] m (맵 가장자리 ±300 이 구획 경계가 되도록 600 의 배수),
      // split = 칸을 반으로 나눌 확률 [동서, 남북], 갈아엎은 밭·그루터기 밭 비율 (나머지 묵은 풀밭),
      // 경계 흙길 반폭·풀 둑 폭 (m)·흙길이 나는 경계 비율 (맵 가장자리 둘레는 항상 흙길)
      fields: { size: [600, 600], split: [0.55, 0.4], plowed: 0.42, stubble: 0.34, track: 1.6, verge: 5, trackChance: 0.5 },
      roadHalf: 2.2, // 맵 밖 농로·마을 길 반폭 (m) — 맵 안 농로(MAP.roads[0].width / 2)와 같게
    },
    // 먼 송전탑·전신주 부재 굵기 = max(실제 굵기, 이동 가능 구역에서의 거리 × thinPerM) → 화면에서 1px 안팎으로 남는다
    thinPerM: 0.0009,
    detailDistance: 1300, // 이보다 먼 송전탑은 격자 사재 없이 다리·띠·팔만
    // 집: 폭(용마루 방향)·깊이·벽 높이 (m), 지붕 높이 / 깊이 반, 부서진 집(벽만)·불탄 집 비율 (마을 damage 배수), 헛간 비율
    house: { length: [7.5, 11], depth: [5.5, 7.5], wall: [2.6, 3.3], pitch: [0.55, 0.85], ruined: 0.2, burnt: 0.15, shed: 0.55, setback: [10, 16] },
    colors: {
      wall: [0xb0aba0, 0x9c978c, 0x8c7c70, 0xa8a49c], // 회칠 벽 / 회색 블록 / 벽돌 / 시멘트
      roof: [0x5a5e60, 0x4e5254, 0x6b4c3e, 0x50594f, 0x6e6f6c], // 슬레이트 / 짙은 슬레이트 / 녹슨 함석 / 초록 함석 / 바랜 슬레이트
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
    distantSmokeColumns: 4,
    bulletTrailDebug: 160,
  },

  // ---------------------------------------------------------------- 사운드
  audio: {
    master: 0.9,
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

  // ---------------------------------------------------------------- 1인칭 뷰모델 (AK-74, 실제 치수 m)
  // 좌표: 눈(카메라) = 원점, 조준선 = -Z 축(y=0), 총열은 ammo.sightHeight 아래.
  // 조준 시 뷰모델은 장면 카메라와 같은 시야각으로 그려 가늠쇠 기둥이 실제 각크기(약 3mrad)로 보인다.
  viewModel: {
    eyeToRearSight: 0.25, // 눈 → 가늠자 U홈
    sightRadius: 0.38, // 가늠자 → 가늠쇠
    frontPostWidth: 0.002, // 가늠쇠 기둥 폭 (눈에서 0.63m → 약 3.2mrad, 200m 에서 0.63m 를 가림)
    frontEarGap: 0.011, // 가늠쇠 보호 귀 안쪽 간격
    frontEarRise: 0.005, // 보호 귀 끝이 가늠쇠 끝보다 높은 정도
    rearLeafWidth: 0.017, // 가늠자 판 폭 (눈에서 25cm → 약 68mrad)
    rearNotchWidth: 0.0034, // 가늠자 U홈 폭·깊이 (눈에서 25cm → 약 13.6mrad)
    rearNotchDepth: 0.003,
    rearSightBlur: 0.0007, // 가늠자 판 가장자리 흐림 폭 (눈의 초점이 가늠쇠에 있어 가까운 가늠자는 흐리다)
    dustCoverDrop: 0.012, // 기관부 덮개 뒤 끝이 앞보다 낮은 정도 (조준 시 총몸이 화면 아래로 빠지게)
    // 조준 시 눈 바로 앞(가까운 기관부 덮개·개머리판)은 두 눈을 뜨고 볼 때처럼 흐릿하게 비친다:
    // 눈에서 adsNearFade[0]m 이내는 adsGhostAlpha 만 남고 [1]m 부터 완전히 보인다
    adsNearFade: [0.1, 0.225],
    adsGhostAlpha: 0.6,
    // 조준 시 가늠자 판 아래 ~ 화면 아래 20% 선 사이의 총몸(가늠자 받침·기관부 덮개·총열 덮개·손)은 더 옅게 비친다
    // → 또렷한 총몸은 화면 아래 약 20% 안에만 남고, 가늠자 U홈·가늠쇠 둘레는 가리지 않는다.
    // adsBandTop: 조준선 아래 각의 tan [흐려지기 시작, 완전히 흐림] (가늠자 판 아래 끝 ≈ 0.042)
    // adsBandBottom: 화면 반높이 대비 비율 [흐림 끝, 다시 또렷] (0.6 = 화면 아래 20% 선)
    adsBandTop: [0.046, 0.07],
    adsBandBottom: [0.56, 0.76],
    adsBandAlpha: 0.28,
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
  },
};

// 편의 접근자
export const MATERIALS = CONFIG.materials;
export const SURFACES = CONFIG.surfaces;
export const SURFACE_BY_ID = Object.fromEntries(
  Object.entries(CONFIG.surfaces).map(([key, def]) => [def.id, { key, ...def }]),
);

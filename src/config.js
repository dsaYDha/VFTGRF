// =============================================================================
// config.js — 게임의 모든 조정 가능한 수치를 모은 곳
// 단위: 거리 m, 시간 s, 속도 m/s, 각도는 이름에 Deg/Mrad가 붙지 않으면 rad.
// 무기·탄약·병사 종류·재질은 여기의 데이터 정의만 추가하면 새 종류가 생긴다.
// 맵 배치(좌표)는 world/mapData.js 에 있다.
// =============================================================================

export const CONFIG = {
  // ---------------------------------------------------------------- 렌더링
  render: {
    pixelRatioMax: 1.5,
    // 프레임이 떨어지면 렌더 해상도를 자동으로 낮춘다 (일반 노트북 60fps 목표)
    dynamicResolution: true,
    pixelRatioMin: 0.65,
    targetFps: 58,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowHalfExtent: 110, // 그림자 카메라 반경 (플레이어 주변)
    fovDeg: 62, // 기본 수직 시야각
    adsZoom: 1.3, // 가늠자 조준 시 확대 배율
    adsTransitionTime: 0.22,
    near: 0.08,
    far: 2600,
    exposure: 1.0,
  },

  // ---------------------------------------------------------------- 대기·조명
  atmosphere: {
    fogColor: 0x8d9192,
    fogDensity: 0.0029, // FogExp2: 600m 에서 약 95% 가려짐 (시정 ~600m)
    skyZenith: 0x5e6367,
    skyHorizon: 0x8d9192,
    cloudContrast: 0.08,
    hemiSky: 0xc9ccce,
    hemiGround: 0x4b4239,
    hemiIntensity: 1.55,
    sunColor: 0xf3ece2,
    sunIntensity: 0.65,
    sunDirection: [0.45, 0.8, 0.4], // 빛이 오는 방향(정규화 전)
    windDirection: [1, 0, -0.35],
    windSpeed: 4.5,
  },

  // ---------------------------------------------------------------- 지형·맵
  world: {
    halfSize: 300, // 맵 600x600m (원점 중심, 북쪽 = -Z, 동쪽 = +X)
    heightRes: 0.5, // 높이 격자 해상도
    surfaceRes: 1.0,
    farExtent: 1500, // 맵 바깥 원경 지형 범위
    farRes: 30,
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
    thinWall: { impact: 'concrete', penetrable: true, speedLoss: 0.5, deflectDeg: 6, cover: false, ricochet: { maxAngleDeg: 8, chance: 0.3 } },
    flesh: { impact: 'flesh', penetrable: false, cover: false, ricochet: { maxAngleDeg: 0, chance: 0 } },
  },

  // 은폐만 되는 재질 (탄은 그대로 통과, 시야만 가림). density: m 당 가림 정도
  concealment: {
    sunflower: { density: 0.55 },
    grass: { density: 0.9 },
    camoNet: { density: 2.5 },
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

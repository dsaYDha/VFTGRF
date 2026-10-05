// =============================================================================
// mapData.js — 맵 배치 데이터 (늦가을 동부 스텝, 폐허가 된 집단농장)
// 좌표계: 북 = -Z, 동 = +X, 원점 = 맵 중심. 플레이어는 남쪽(수로, z≈112), 적은 북쪽.
// 적 사격 위치(자세·엄폐 높이)와 이동 경유점 그래프도 여기서 정의한다.
// =============================================================================

// 지그재그 참호선 생성
function zigzag(x0, x1, zc, amp, seg, phase = 0) {
  const pts = [];
  const n = Math.max(2, Math.round((x1 - x0) / seg));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const z = zc + ((i + phase) % 2 === 0 ? -amp : amp) * (i === 0 || i === n ? 0.4 : 1);
    pts.push([x, z]);
  }
  return pts;
}

const CANAL_Z = 112;

export const MAP = {
  playerSpawn: { x: -18, z: CANAL_Z + 0.1, yaw: 0 },
  // 진출선: 파괴된 장갑차 ↔ 트랙터 잔해 (화면에 그리지 않음)
  advanceLine: { a: [-46, 11], b: [54, 6] },

  // ---------------------------------------------------------------- 수로 (플레이어 측)
  canal: {
    z: CANAL_Z,
    wiggleAmp: 0.9,
    wiggleLen: 95,
    xMin: -300,
    xMax: 300,
    depth: 1.2,
    floorHalf: 0.8,
    topHalf: 1.5,
    // 콘크리트 측벽 구간
    linedSections: [
      [-72, -26],
      [38, 96],
      [-182, -150],
    ],
    linedFloorHalf: 0.95,
    linedTopHalf: 1.12,
    berm: { width: 3.2, height: 0.15, heightVar: 0.06 },
    southBank: { width: 2.6, height: 0.2 },
    // 북쪽 둔덕 중 크게 쌓인 흙무더기
    mounds: [
      { x: -205, len: 12, h: 0.9 },
      { x: -112, len: 9, h: 1.05 },
      { x: -40, len: 6, h: 0.75 },
      { x: 64, len: 10, h: 1.0 },
      { x: 150, len: 8, h: 1.1 },
      { x: 222, len: 9, h: 0.85 },
    ],
    crossing: { x: 8, halfWidth: 3.2 }, // 농로가 지나가는 흙 둑 (배수관)
    waterSections: [
      [-138, -84],
      [18, 34],
      [104, 176],
      [-260, -215],
    ],
  },

  // ---------------------------------------------------------------- 비포장 농로
  roads: [
    {
      width: 4.4,
      points: [
        [8, 300],
        [8, 170],
        [8, 113],
        [5, 72],
        [-3, 32],
        [-6, 2],
        [1, -38],
        [9, -78],
        [12, -100],
        [16, -126],
        [26, -165],
        [40, -230],
        [44, -300],
      ],
    },
    {
      width: 3.8,
      points: [
        [-150, -113],
        [-90, -112],
        [-42, -127],
        [14, -129],
        [70, -121],
        [100, -114],
        [132, -118],
        [190, -138],
      ],
    },
  ],

  // ---------------------------------------------------------------- 참호선 (적)
  trench: {
    depth: 1.5,
    floorHalf: 0.45,
    topHalf: 0.85,
    parapet: { width: 2.6, height: 0.45 },
    parados: { width: 2.2, height: 0.2 },
    lines: [zigzag(-120, -9, -91, 2.6, 11), zigzag(21, 122, -92, 2.6, 11, 1)],
    // 연결호 (얕음, 흉벽 없음)
    commLines: [
      [
        [-60, -93.5],
        [-61, -101],
        [-66, -108],
      ],
      [
        [50, -94.5],
        [52, -102],
        [56, -108],
      ],
    ],
    commDepth: 1.3,
  },

  // 엄체호 (통나무·흙으로 덮음)
  dugouts: [
    { x: -84, z: -98.2, w: 4.6, d: 3.2, rot: 0.05 },
    { x: -31, z: -98.0, w: 4.2, d: 3.0, rot: -0.04 },
    { x: 79, z: -99.0, w: 4.8, d: 3.4, rot: 0.03 },
  ],

  camoNets: [{ x: 96, z: -92.5, w: 9, d: 5, h: 2.1 }],

  // ---------------------------------------------------------------- 건물
  barns: [
    {
      id: 'B1',
      x: -58,
      z: -140,
      length: 56,
      width: 12,
      height: 3.2,
      rot: 0,
      brick: 'silicate',
      roofKeep: 0.35,
      windowSpacing: 4,
      holes: [
        { side: 'south', s: -12, w: 2.6, y0: 0.5, y1: 2.6 },
        { side: 'south', s: 0, w: 1.5, y0: 0, y1: 2.2 },
        { side: 'south', s: 13, w: 1.8, y0: 1.2, y1: 2.8 },
        { side: 'north', s: -4, w: 3.2, y0: 0.3, y1: 2.7 },
      ],
      loopholes: [{ side: 'south', s: 4.6, y0: 0.42, y1: 0.75, w: 0.5 }],
      collapse: [{ side: 'south', s0: -28, s1: -21, h: 1.3 }],
      doors: [
        { side: 'north', s: 6, w: 2.4, h: 2.4 },
        { side: 'east', s: 0, w: 3.0, h: 2.8, wood: true },
      ],
      partitions: [{ s: -8 }, { s: 16 }],
    },
    {
      id: 'B2',
      x: 40,
      z: -150,
      length: 60,
      width: 12,
      height: 3.2,
      rot: 0,
      brick: 'red',
      roofKeep: 0.12,
      windowSpacing: 4,
      holes: [
        { side: 'south', s: 4, w: 3.2, y0: 0.0, y1: 2.7 },
        { side: 'south', s: -19, w: 1.6, y0: 1.5, y1: 2.9 },
      ],
      loopholes: [{ side: 'south', s: 12.6, y0: 0.4, y1: 0.72, w: 0.5 }],
      collapse: [
        { side: 'south', s0: 23, s1: 30, h: 1.0 },
        { side: 'east', s0: -6, s1: 6, h: 1.6 },
      ],
      doors: [{ side: 'north', s: -6, w: 2.4, h: 2.4 }],
      partitions: [{ s: -14 }],
    },
    {
      id: 'B3',
      x: 128,
      z: -192,
      length: 50,
      width: 12,
      height: 3.2,
      rot: Math.PI / 2,
      brick: 'silicate',
      roofKeep: 0.55,
      windowSpacing: 4,
      holes: [{ side: 'south', s: 8, w: 2.4, y0: 0.6, y1: 2.6 }],
      loopholes: [],
      collapse: [],
      doors: [{ side: 'north', s: 0, w: 2.6, h: 2.6 }],
      partitions: [],
    },
  ],
  silo: { x: -122, z: -176, r: 3.4, h: 23 },
  garage: { x: 98, z: -128, w: 18, d: 12, h: 5.2 },
  // 무너진 소건물 (사무동) 잔해 + 남은 벽 모서리
  ruins: [{ id: 'R1', x: -12, z: -121, moundR: 4.6, moundH: 1.35, walls: true }],
  rubbleMounds: [
    { x: 74, z: -114, r: 3.4, h: 1.0 },
    { x: -94, z: -127, r: 2.6, h: 0.8 },
    { x: 20, z: -137, r: 2.4, h: 0.7 },
    { x: 118, z: -160, r: 3.0, h: 0.9 },
  ],
  barricade: { x: 15, z: -91, rot: 0.08 },

  // ---------------------------------------------------------------- 중간 지대
  apc: { x: -46, z: 11, rot: 0.45, tag: 'APC' },
  tractor: { x: 54, z: 6, rot: -1.1, tag: 'TRACTOR' },
  cars: [
    { x: 126, z: 44, rot: 0.6, kind: 'sedan' },
    { x: -102, z: -16, rot: -0.4, kind: 'van' },
    { x: -96, z: -114, rot: 1.35, kind: 'truck' },
  ],
  pylons: [
    { x: -282, z: 4, state: 'stand' },
    { x: -172, z: -9, state: 'stand' },
    { x: -64, z: -24, state: 'fallen' },
    { x: 46, z: -38, state: 'tilted' },
    { x: 156, z: -52, state: 'stand' },
    { x: 266, z: -66, state: 'stand' },
  ],
  trees: [
    { x: -96, z: 84, h: 5.5, broken: true },
    { x: 157, z: 37, h: 4.2, broken: true },
    { x: -188, z: -112, h: 6.5, broken: true },
    { x: 206, z: -138, h: 5.0, broken: true },
    { x: 89, z: 98, h: 3.6, broken: true },
    { x: -34, z: -170, h: 7.0, broken: true },
    { x: 182, z: 128, h: 4.8, broken: true },
  ],
  stumps: [
    [-90, 87],
    [151, 41],
    [-61, 72],
    [31, 93],
    [111, 77],
    [-150, 102],
    [-196, -106],
    [210, -132],
    [-28, -165],
    [64, 132],
    [-230, 140],
  ],

  // ---------------------------------------------------------------- 밭 구역
  fields: {
    sunflower: [{ x0: -238, x1: -120, z0: -62, z1: 66, rowDir: 'z' }],
    plowed: [{ x0: -114, x1: 140, z0: -80, z1: 98 }],
    stubble: [
      { x0: 140, x1: 300, z0: -82, z1: 100 },
      { x0: -300, x1: -238, z0: -82, z1: 100 },
    ],
    farmYard: { x0: -150, x1: 165, z0: -215, z1: -104 },
  },

  // 지정 포탄 구덩이 (이동 경유점·전방 구덩이)
  craters: [
    { x: -24, z: -38, r: 4.2, d: 1.7, tag: 'F1' },
    { x: 36, z: -43, r: 3.8, d: 1.6, tag: 'F2' },
    { x: -40, z: -73, r: 2.4, d: 1.0 },
    { x: -31, z: -56, r: 2.6, d: 1.1 },
    { x: 44, z: -76, r: 2.5, d: 1.0 },
    { x: 40, z: -60, r: 2.2, d: 0.9 },
    { x: -33, z: -19, r: 2.8, d: 1.2 },
    { x: -41, z: -3, r: 2.3, d: 0.95 },
    { x: 46, z: -24, r: 2.6, d: 1.1 },
    { x: 51, z: -9, r: 2.4, d: 1.0 },
    { x: -56, z: -116, r: 2.2, d: 0.8 },
    { x: 42, z: -121, r: 2.4, d: 0.9 },
    { x: -12, z: -107, r: 2.0, d: 0.8 },
    { x: 120, z: 128, r: 2.8, d: 1.1 },
    { x: -70, z: 136, r: 3.4, d: 1.3 },
    { x: 30, z: 142, r: 2.2, d: 0.9 },
  ],
  // 무작위 구덩이를 피할 구역
  craterExclusions: [
    { x0: -300, x1: 300, z0: 98, z1: 127 }, // 수로
    { x0: -125, x1: -5, z0: -98, z1: -84 },
    { x0: 15, x1: 127, z0: -99, z1: -85 },
  ],

  // 원경 연기 기둥 (방위각 도, 거리 m)
  distantSmoke: [
    { bearing: 352, dist: 2600, size: 1.0 },
    { bearing: 38, dist: 3200, size: 0.8 },
    { bearing: 302, dist: 2900, size: 1.2 },
    { bearing: 75, dist: 2400, size: 0.6 },
  ],
};

// =============================================================================
// 적 노드 / 사격 위치 / 경유점 그래프
//  fire: 사격 자세 (stand | kneel | prone), cover: 엄폐 자세 (duck | prone | kneel)
//  step: 참호 사격 발판 사용, fireOffset/coverOffset: 기준점에서의 이동 (월드 xz)
//  coverRef: 이 위치의 엄폐물 ('terrain' 또는 충돌체 태그) — 엄폐물 탄착 5m 규칙에 사용
// =============================================================================
const FACE = [0, CANAL_Z]; // 기본: 플레이어 쪽 (수로 중앙)

export const AI_MAP = {
  nodes: {
    B1: {
      kind: 'building',
      cap: 1,
      next: ['T1'],
      light: 'building',
      exit: [
        [-58, -136.5],
        [-58, -131.5],
      ],
      approach: [
        [-52, -168],
        [-52, -150],
        [-52, -143],
      ],
      fps: [
        { x: -66, z: -135.2, fire: 'stand', cover: 'duck', coverRef: 'B1', face: FACE },
        { x: -54, z: -135.2, fire: 'stand', cover: 'duck', coverRef: 'B1', face: FACE },
        { x: -53.4, z: -135.0, fire: 'prone', cover: 'prone', coverRef: 'B1', face: FACE, coverOffset: [0, -0.9] },
        { x: -42, z: -135.2, fire: 'stand', cover: 'duck', coverRef: 'B1', face: FACE },
      ],
    },
    B2: {
      kind: 'building',
      cap: 1,
      next: ['T2'],
      light: 'building',
      exit: [
        [44, -146.5],
        [44, -141.5],
      ],
      approach: [
        [34, -178],
        [34, -160],
        [34, -153],
      ],
      fps: [
        { x: 28, z: -145.2, fire: 'stand', cover: 'duck', coverRef: 'B2', face: FACE },
        { x: 44, z: -145.4, fire: 'kneel', cover: 'duck', coverRef: 'B2', face: FACE, fireOffset: [0.9, 0], coverOffset: [-0.4, -0.5] },
        { x: 52.6, z: -145.0, fire: 'prone', cover: 'prone', coverRef: 'B2', face: FACE, coverOffset: [0, -0.9] },
        { x: 56, z: -145.2, fire: 'stand', cover: 'duck', coverRef: 'B2', face: FACE },
      ],
    },
    G1: {
      kind: 'building',
      cap: 1,
      next: ['T2'],
      light: 'building',
      exit: [[98, -120.5]],
      approach: [
        [98, -150],
        [98, -136],
      ],
      fps: [
        { x: 93.5, z: -122.6, fire: 'kneel', cover: 'kneel', coverRef: 'GARAGE', face: FACE, fireOffset: [1.0, 0.2], coverOffset: [0, -0.6] },
        { x: 102.5, z: -122.6, fire: 'stand', cover: 'duck', coverRef: 'GARAGE', face: FACE, fireOffset: [-1.0, 0.2], coverOffset: [0, -0.6] },
      ],
    },
    R1: {
      kind: 'rubble',
      cap: 1,
      next: ['T1', 'T2'],
      light: 'outdoor',
      approach: [
        [-14, -150],
        [-14, -128],
      ],
      fps: [
        { x: -10.8, z: -118.2, fire: 'kneel', cover: 'duck', coverRef: 'R1', face: FACE, fireOffset: [0.95, 0.1] },
        { x: -13.6, z: -118.3, fire: 'prone', cover: 'prone', coverRef: ['R1', 'terrain'], face: FACE, coverOffset: [0, -1.2] },
        { x: -15.6, z: -118.4, fire: 'kneel', cover: 'duck', coverRef: 'R1', face: FACE, fireOffset: [-0.95, 0.1] },
      ],
    },
    T1: {
      kind: 'trench',
      cap: 2,
      next: ['F1'],
      light: 'trench',
      trenchLine: 0,
      approach: [
        [-61, -104],
        [-60, -96],
      ],
      fps: [
        { x: -98, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: -74, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: -55, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: -38, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: -20, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
      ],
    },
    T2: {
      kind: 'trench',
      cap: 2,
      next: ['F2'],
      light: 'trench',
      trenchLine: 1,
      approach: [
        [55, -106],
        [51, -97],
      ],
      fps: [
        { x: 30, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: 46, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: 64, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: 86, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
        { x: 108, fire: 'stand', cover: 'duck', step: true, coverRef: 'terrain', face: FACE },
      ],
    },
    F1: {
      kind: 'crater',
      cap: 1,
      next: ['L1'],
      light: 'crater',
      crater: 'F1',
      fps: [
        { rim: -0.35, fire: 'prone', cover: 'prone', coverRef: 'terrain', face: FACE },
        { rim: 0.3, fire: 'prone', cover: 'prone', coverRef: 'terrain', face: FACE },
        { rim: 0.0, fire: 'prone', cover: 'prone', coverRef: 'terrain', face: FACE },
      ],
    },
    F2: {
      kind: 'crater',
      cap: 1,
      next: ['L2'],
      light: 'crater',
      crater: 'F2',
      fps: [
        { rim: -0.3, fire: 'prone', cover: 'prone', coverRef: 'terrain', face: FACE },
        { rim: 0.32, fire: 'prone', cover: 'prone', coverRef: 'terrain', face: FACE },
      ],
    },
    // 진출선 엄폐물: 차량 기준 로컬 좌표 (x = 차체 길이 방향, z = 폭 방향, -z 쪽이 적 진영)
    L1: {
      kind: 'line',
      cap: 2,
      next: [],
      light: 'outdoor',
      line: true,
      vehicle: 'apc',
      fps: [
        { local: [-1.4, -2.7], fireLocal: [-3.7, -2.1], fire: 'kneel', cover: 'kneel', coverRef: 'APC', face: FACE },
        { local: [1.6, -2.7], fireLocal: [4.1, -2.0], fire: 'kneel', cover: 'kneel', coverRef: 'APC', face: FACE },
      ],
    },
    L2: {
      kind: 'line',
      cap: 2,
      next: [],
      light: 'outdoor',
      line: true,
      vehicle: 'tractor',
      fps: [
        { local: [-1.9, 0.0], fireLocal: [-1.7, 1.75], fire: 'kneel', cover: 'kneel', coverRef: 'TRACTOR', face: FACE },
        { local: [-2.5, -0.8], fireLocal: [-1.9, -1.9], fire: 'kneel', cover: 'kneel', coverRef: 'TRACTOR', face: FACE },
      ],
    },
  },

  // 노드 간 이동 경유점 (각 점에서 엎드려 숨을 고른다)
  edges: {
    'B1>T1': [[-57, -118.5], [-58, -104]],
    'B2>T2': [[42, -123.5], [47, -106]],
    'G1>T2': [[86, -116], [74, -104]],
    'R1>T1': [[-12, -109], [-18, -98]],
    'R1>T2': [[-6, -109], [24, -100]],
    'T1>F1': [[-39, -74.5], [-31, -57.5]],
    'T2>F2': [[44, -77.5], [40, -61.5]],
    'F1>L1': [[-33, -20.5], [-41, -4.5]],
    'F2>L2': [[46, -25.5], [51, -10.5]],
  },

  initial: [
    { node: 'T1', fp: 2 },
    { node: 'T2', fp: 1 },
    { node: 'B1', fp: 1 },
    { node: 'B2', fp: 0 },
    { node: 'R1', fp: 0 },
    { node: 'F1', fp: 0 },
  ],

  spawnPoints: [
    [-70, -262],
    [10, -268],
    [96, -258],
  ],
  // 초기 '플레이어는 수로 어딘가에 있다' 추정 범위
  priorZone: { x0: -90, x1: 70, z: CANAL_Z - 1.0 },
};

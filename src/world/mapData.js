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
// 수로 중심선의 완만한 굽이 (Terrain.canalZ 와 같은 식)
const CANAL_WIGGLE = { amp: 0.9, len: 95 };
function canalCenterZ(x) {
  return CANAL_Z + CANAL_WIGGLE.amp * Math.sin(x / CANAL_WIGGLE.len);
}
// 시작 위치: 수로 북쪽 사격 발판(둔덕 뒤) 위, 모래주머니 사격 위치. canal.bench 의 inner~outer 사이
const SPAWN_X = -18;

export const MAP = {
  playerSpawn: { x: SPAWN_X, z: canalCenterZ(SPAWN_X) - 2.42, yaw: 0, posture: 'crouch' },
  // 진출선: 파괴된 장갑차 ↔ 트랙터 잔해 (화면에 그리지 않음)
  advanceLine: { a: [-46, 11], b: [54, 6] },

  // ---------------------------------------------------------------- 수로 (플레이어 측)
  // 단면 (수로 중심에서 북쪽 거리 d): 바닥 d <= floorHalf, 비탈 floorHalf~topHalf (사다리꼴: 윗폭 5.4m, 바닥폭 1.8m, 깊이 1.2m)
  // 북쪽: 비탈을 깎아 만든 사격 발판(자연 지면보다 bench.depth 낮음, 콘크리트 구간 제외) → 수로를 팔 때 나온 흙 둔덕(흉벽).
  //  발판에서 둔덕 마루까지 약 1.0m: 서면 상체가 드러나고, 앉으면 둔덕 위로 고개만 나온다. 수로 바닥으로 내려가면 완전히 숨는다.
  canal: {
    z: CANAL_Z,
    wiggleAmp: CANAL_WIGGLE.amp,
    wiggleLen: CANAL_WIGGLE.len,
    xMin: -300,
    xMax: 300,
    depth: 1.2,
    floorHalf: 0.9,
    topHalf: 2.7,
    edgeRound: 0.25, // 비탈 위 모서리를 둥글리는 반폭
    slabSoil: 0.02, // 라이닝 판 위쪽 끝에 쌓인 흙 높이
    // 사격 발판: 비탈이 이 깊이에 닿는 곳(inner, 단면에서 계산)부터 outer 까지 평평
    bench: { depth: 0.43, outer: 2.8 },
    // 북쪽 흙 둔덕: 발판 바깥 끝에서 face 폭만큼 가파르게 올라 마루(자연 지면 + height), 뒤쪽은 back 폭에 걸쳐 완만히
    berm: { height: 0.62, heightVar: 0.06, face: 0.75, faceVar: 0.1, back: 2.7, gapHeight: 0.6 },
    southBank: { width: 2.6, height: 0.2 },
    // 북쪽 둔덕 중 크게 쌓인 흙무더기 (마루 높이 h, 자연 지면 기준)
    mounds: [
      { x: -205, len: 12, h: 0.82 },
      { x: -112, len: 9, h: 0.86 },
      { x: -40, len: 5, h: 0.76 },
      { x: 72, len: 9, h: 0.84 },
      { x: 152, len: 8, h: 0.88 },
      { x: 236, len: 9, h: 0.8 },
    ],
    // 모래주머니 사격 위치 (x): 마루 가운데 사격 틈(berm.gapHeight 로 낮춤) 양옆에 모래주머니를 쌓는다. 시작 위치 포함
    sandbagPositions: [-226, -128, -92, -48, SPAWN_X, 26, 58, 118, 184],
    // 흙을 파낸 엎드려쏴 사격 홈 (x): 둔덕을 자연 지면 높이(floor)까지 파낸 엎드릴 자리(platform 길이), 앞쪽 끝에 총을 걸치는 낮은 흙 턱(lip)
    notches: { list: [-238, -152, -64, -9, 41, 90, 136, 206], halfWidth: 0.5, edge: 0.35, floor: 0.06, platform: 1.15, lip: 0.16 },
    // 콘크리트 라이닝 구간 (약 1x2m 프리캐스트 판을 양쪽 비탈에 깐다. 판 배치는 Terrain.buildCanalSlabs)
    linedSections: [
      [-72, -26],
      [38, 96],
      [-182, -150],
    ],
    crossing: { x: 8, halfWidth: 3.2 }, // 농로가 지나가는 흙 둑 (배수관)
    // 물이 길게 고인 구간
    waterSections: [
      [-138, -84],
      [-61, -37],
      [18, 34],
      [104, 176],
      [-260, -215],
    ],
    // 바닥 물가의 마른 갈대 군락 (식생에서 그린다): x 중심, len 길이, side = 1 남쪽 물가 / -1 북쪽 물가
    reeds: [
      { x: -253, len: 7, side: 1 },
      { x: -224, len: 5, side: -1 },
      { x: -131, len: 9, side: -1 },
      { x: -97, len: 6, side: 1 },
      { x: -44, len: 4, side: 1 },
      { x: 27, len: 5, side: 1 },
      { x: 112, len: 8, side: -1 },
      { x: 158, len: 11, side: 1 },
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
      loopholes: [{ side: 'south', s: 4.6, y0: 0.2, y1: 0.56, w: 0.8 }],
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
      loopholes: [{ side: 'south', s: 12.6, y0: 0.2, y1: 0.56, w: 0.8 }],
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
  // 콘크리트 전신주: 농로 서쪽을 따라가는 10kV 배전선 (수로 남쪽 → 수로 위를 건너 → 집단농장 쪽). 순서대로 전선이 이어진다.
  // state: stand | lean (fall 방위로 lean 도 기움) | fallen (기초째 뽑혀 fall 방위로 누움) | broken (밑동 stub m 만 서고 윗동이 fall 방위로 누움)
  // fall = 방위각 (도, 0 = 북, 90 = 동). 높이·단면·처짐은 CONFIG.midfield.poles
  poles: [
    { x: 2.6, z: 262, state: 'stand' },
    { x: 2.6, z: 208, state: 'stand' },
    { x: 2.4, z: 154, state: 'lean', fall: 250, lean: 5 },
    { x: 0.3, z: 84, state: 'stand' },
    { x: -8.6, z: 32, state: 'broken', fall: 305, stub: 1.3 },
    { x: -8.1, z: -18, state: 'fallen', fall: 84 },
    { x: 1.4, z: -68, state: 'lean', fall: 275, lean: 11 },
  ],
  // 작은 잔해 흩뿌리기 구역 (개수·종류는 CONFIG.midfield.debris): ring = 점 둘레 dist 범위, road = 농로(roads[road]) 옆 dist,
  // craters = 포탄 구덩이 둘레 (반지름 배수 dist), rect = 사각형. w = 종류별 가중치
  // (shard 포탄 파편, crate 빈 탄약 상자, camo 찢어진 위장망 조각, helmet 버려진 헬멧, pack 배낭)
  debrisZones: [
    { kind: 'ring', x: -46, z: 11, dist: [3.5, 15], w: { shard: 2.4, crate: 1.4, camo: 1.2, helmet: 1.6, pack: 1.2 } }, // 장갑차
    { kind: 'ring', x: 54, z: 6, dist: [3, 10], w: { shard: 1.2, crate: 0.6, helmet: 0.4 } }, // 트랙터
    { kind: 'ring', x: -102, z: -16, dist: [3, 9], w: { shard: 0.8, crate: 0.3, pack: 0.5 } }, // 승합차
    { kind: 'ring', x: 126, z: 44, dist: [3, 9], w: { shard: 0.8, pack: 0.3 } }, // 승용차
    { kind: 'road', road: 0, z0: -82, z1: 90, dist: [2.6, 10], w: { shard: 1.0, crate: 2.2, camo: 1.6, helmet: 1.4, pack: 1.6 } }, // 농로 옆 (버려진 장비)
    { kind: 'craters', z0: -82, z1: 90, dist: [0.9, 2.4], w: { shard: 3.5, helmet: 0.3 } }, // 포탄 구덩이 둘레
    { kind: 'rect', x0: -235, x1: 235, z0: -82, z1: 90, w: { shard: 2.0, crate: 0.8, camo: 1.0, helmet: 1.2, pack: 0.8 } }, // 밭 전체
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
  // 구획마다 furrowDeg = 고랑(이랑) 줄이 뻗은 방위각(도, 0 = 남북, 90 = 동서), spacing = 고랑·줄 간격(m),
  // tint = 구획 색 배수 (구획마다 조금씩 다르게). 그루터기 밭의 spacing 은 그루터기 줄 간격.
  fields: {
    // 해바라기밭: spacing = 줄 간격 (줄은 고랑 방향). swaths = 바퀴 차량이 밀고 지나가 줄기가 쓰러진 띠 (지면 자국 없음,
    // 궤도 차량 자국 MAP.vehicleTracks 중 밭을 지나는 것도 같은 띠가 된다)
    sunflower: [
      {
        x0: -238,
        x1: -120,
        z0: -62,
        z1: 66,
        rowDir: 'z',
        furrowDeg: 3,
        spacing: 0.7,
        tint: [0.97, 0.95, 0.93],
        swaths: [
          { half: 1.7, points: [[-203, -64], [-192, -24], [-181, 14], [-171, 68]] },
          { half: 1.5, points: [[-240, -18], [-214, -12], [-190, -2], [-158, 4]] },
        ],
      },
    ],
    plowed: [
      { x0: -114, x1: -11, z0: -80, z1: 8, furrowDeg: 84, spacing: 0.5, tint: [1.02, 0.99, 0.95] },
      { x0: -114, x1: -11, z0: 16, z1: 97, furrowDeg: 2, spacing: 0.55, tint: [0.93, 0.92, 0.92] },
      { x0: 15, x1: 140, z0: -80, z1: 0, furrowDeg: 58, spacing: 0.45, tint: [1.06, 1.01, 0.96] },
      { x0: 15, x1: 140, z0: 7, z1: 97, furrowDeg: 95, spacing: 0.5, tint: [0.96, 0.95, 0.95] },
      // 수로 남쪽 (플레이어 뒤)
      { x0: -205, x1: -32, z0: 142, z1: 292, furrowDeg: 76, spacing: 0.5, tint: [0.98, 0.96, 0.94] },
    ],
    stubble: [
      { x0: 140, x1: 300, z0: -82, z1: 100, furrowDeg: 90, spacing: 0.16, tint: [1.0, 0.98, 0.95] },
      { x0: -300, x1: -238, z0: -82, z1: 100, furrowDeg: 0, spacing: 0.16, tint: [0.96, 0.95, 0.93] },
      { x0: 28, x1: 236, z0: 146, z1: 292, furrowDeg: 12, spacing: 0.16, tint: [1.02, 1.0, 0.96] },
    ],
    farmYard: { x0: -150, x1: 165, z0: -215, z1: -104 },
  },

  // 궤도 차량 자국 (개활지를 비스듬히 가로지름, 지면 재질·약한 형상만). gauge = 좌우 궤도 중심 간격 (m)
  vehicleTracks: [
    // 해바라기밭을 밀고 지나 장갑차까지 (장갑차가 온 길)
    { gauge: 2.6, points: [[-236, 44], [-190, 37], [-140, 29], [-95, 21], [-53, 13]] },
    { gauge: 2.8, points: [[-18, -68], [16, -36], [58, 2], [104, 46], [146, 86]] },
    { gauge: 2.6, points: [[196, -76], [150, -46], [96, -6], [52, 40], [28, 88]] },
  ],

  // 무작위 포탄 구덩이를 몰아 둘 구역과 가중치 (농로·장갑차 주변·적 진지 앞에 포격이 집중)
  //  road: 농로(roads[road]) 중심에서 dist 범위, ring: 점에서 dist 범위, rect: 사각형
  craterZones: [
    { kind: 'road', road: 0, z0: -88, z1: 86, dist: [5, 18], weight: 3.0 },
    { kind: 'ring', x: -46, z: 11, dist: [9, 30], weight: 1.6 },
    { kind: 'ring', x: 54, z: 6, dist: [9, 24], weight: 0.9 },
    { kind: 'rect', x0: -126, x1: 128, z0: -82, z1: -50, weight: 2.4, front: true },
    { kind: 'rect', x0: -245, x1: 245, z0: -80, z1: 84, weight: 2.6 },
    { kind: 'rect', x0: -150, x1: 165, z0: -215, z1: -100, weight: 1.1 },
    { kind: 'rect', x0: -220, x1: 220, z0: 138, z1: 250, weight: 0.6 },
  ],

  // 지정 포탄 구덩이 (이동 경유점·전방 구덩이)
  craters: [
    { x: -24, z: -38, r: 4.2, d: 1.7, tag: 'F1' },
    { x: 36, z: -43, r: 3.8, d: 1.6, tag: 'F2' },
    { x: -40, z: -73, r: 2.4, d: 1.0, fresh: true },
    { x: -31, z: -56, r: 2.6, d: 1.1 },
    { x: 44, z: -76, r: 2.5, d: 1.0, fresh: true },
    { x: 40, z: -60, r: 2.2, d: 0.9 },
    { x: -33, z: -19, r: 2.8, d: 1.2 },
    { x: -41, z: -3, r: 2.3, d: 0.95 },
    { x: 46, z: -24, r: 2.6, d: 1.1, fresh: true },
    { x: 51, z: -9, r: 2.4, d: 1.0 },
    { x: -56, z: -116, r: 2.2, d: 0.8, fresh: true },
    { x: 42, z: -121, r: 2.4, d: 0.9 },
    { x: -12, z: -107, r: 2.0, d: 0.8 },
    { x: 120, z: 128, r: 2.8, d: 1.1 },
    { x: -70, z: 136, r: 3.4, d: 1.3 },
    { x: 30, z: 142, r: 2.2, d: 0.9 },
  ],
  // 무작위 구덩이를 피할 구역
  craterExclusions: [
    { x0: -300, x1: 300, z0: 88, z1: 134 }, // 수로 (북쪽 둔덕 앞 시야 확보)
    { x0: -125, x1: -5, z0: -98, z1: -84 },
    { x0: 15, x1: 127, z0: -99, z1: -85 },
    // 적 사격 위치 바로 앞 (수로 쪽 사선을 구덩이 테두리가 막지 않게)
    { x0: -44, x1: -4, z0: -37, z1: -14 }, // F1
    { x0: 16, x1: 56, z0: -42, z1: -19 }, // F2
    { x0: -68, x1: -36, z0: -136, z1: -99 }, // B1
    { x0: 22, x1: 62, z0: -146, z1: -99 }, // B2
    { x0: -22, x1: -2, z0: -119, z1: -99 }, // R1
    { x0: 88, x1: 108, z0: -124, z1: -99 }, // G1
  ],

  // 원경 연기 기둥 (방위각 도, 거리 m, 크기 배수). 안개(시정 600m)에 섞여 희미한 실루엣으로만 보인다.
  // 너무 멀면(2km+) 안개에 완전히 묻히므로 1~1.6km 에 둔다 (먼 마을 실루엣도 이 방위·거리를 따른다)
  distantSmoke: [
    { bearing: 348, dist: 1250, size: 1.0 },
    { bearing: 31, dist: 1550, size: 0.8 },
    { bearing: 297, dist: 1100, size: 0.9 },
  ],
  // 건물 화재 연기 (가는 파티클 기둥, 회색~검정): 축사 B2 동쪽 무너진 끝 안쪽, 곡물 저장탑 뒤(북쪽)
  smokeSources: [
    { x: 60, z: -151, kind: 'fire', size: 1.0 },
    { x: -118, z: -187, kind: 'fire', size: 0.8 },
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
        { x: -63, z: -135.2, fire: 'stand', cover: 'duck', coverRef: 'B1', face: FACE },
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
        [101, -150],
        [101, -136],
        [101, -131.5],
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
      // 증원: 축사 B1 서쪽 끝을 돌아 연결호로 들어온다
      approach: [
        [-98, -150],
        [-90, -124],
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
      // 증원: 축사 B2 동쪽 끝을 돌아 연결호로 들어온다
      approach: [
        [78, -162],
        [78, -118],
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
        { local: [-2.5, -0.8], fireLocal: [-1.3, -2.7], fire: 'kneel', cover: 'kneel', coverRef: 'TRACTOR', face: FACE },
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

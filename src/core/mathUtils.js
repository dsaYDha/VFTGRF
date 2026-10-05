// 수학·기하 보조 함수
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};
// 프레임 독립 지수 감쇠 보간 계수
export const dampFactor = (rate, dt) => 1 - Math.exp(-rate * dt);
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export const DEG = Math.PI / 180;

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(a, b, rate, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
}

// yaw(라디안, Three.js Y 회전) → 방위각(도, 0=북, 시계방향)
export function yawToBearing(yaw) {
  let b = (-yaw * 180) / Math.PI;
  b %= 360;
  if (b < 0) b += 360;
  return b;
}

// 선분 AB 와 점 P 사이 최단거리 제곱. 결과의 t 는 out.t 에 저장
export function segPointDistSq(ax, ay, az, bx, by, bz, px, py, pz, out) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const wx = px - ax;
  const wy = py - ay;
  const wz = pz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-12 ? (wx * dx + wy * dy + wz * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px;
  const cy = ay + dy * t - py;
  const cz = az + dz * t - pz;
  if (out) out.t = t;
  return cx * cx + cy * cy + cz * cz;
}

// 2D 선분과 점 사이 거리 (xz 평면)
export function segPointDist2D(ax, az, bx, bz, px, pz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-12 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

// 폴리라인(점 배열 [[x,z],...])까지 거리와 가장 가까운 선분 정보
export function polylineDistance(points, px, pz, out) {
  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    let t = len2 > 1e-12 ? ((px - a[0]) * dx + (pz - a[1]) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = a[0] + dx * t - px;
    const cz = a[1] + dz * t - pz;
    const d = cx * cx + cz * cz;
    if (d < best) {
      best = d;
      bestI = i;
      bestT = t;
    }
  }
  if (out) {
    out.index = bestI;
    out.t = bestT;
    const a = points[bestI];
    const b = points[bestI + 1];
    out.x = a[0] + (b[0] - a[0]) * bestT;
    out.z = a[1] + (b[1] - a[1]) * bestT;
    // 선분 법선 (진행 방향 기준 왼쪽) 과 부호 거리
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    out.nx = -dz / len;
    out.nz = dx / len;
    out.side = (px - out.x) * out.nx + (pz - out.z) * out.nz;
  }
  return Math.sqrt(best);
}

// 폴리라인 길이 누적 및 거리 파라미터로 점 찾기
export function polylineLengths(points) {
  const acc = [0];
  for (let i = 1; i < points.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return acc;
}

export function polylinePointAt(points, acc, s, out) {
  const total = acc[acc.length - 1];
  s = clamp(s, 0, total);
  let i = 1;
  while (i < acc.length - 1 && acc[i] < s) i++;
  const seg = acc[i] - acc[i - 1] || 1;
  const t = (s - acc[i - 1]) / seg;
  out.x = lerp(points[i - 1][0], points[i][0], t);
  out.z = lerp(points[i - 1][1], points[i][1], t);
  out.dirX = (points[i][0] - points[i - 1][0]) / seg;
  out.dirZ = (points[i][1] - points[i - 1][1]) / seg;
  return out;
}

// 선분 - 구 교차. 진입 t (0..1) 또는 -1
export function segSphere(ax, ay, az, dx, dy, dz, cx, cy, cz, r) {
  const ox = ax - cx;
  const oy = ay - cy;
  const oz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c < 0) return -1; // 시작점이 안쪽: 무시
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// 축 정렬 상자(로컬)와 선분. p: 로컬 시작점, d: 로컬 변위, h: 반크기
// 결과: out.t, out.axis, out.sign. 시작점이 안에 있으면 false
export function segBoxLocal(px, py, pz, dx, dy, dz, hx, hy, hz, out) {
  let tmin = 0;
  let tmax = 1;
  let axis = -1;
  let sign = 0;
  // X
  if (Math.abs(dx) < 1e-12) {
    if (px < -hx || px > hx) return false;
  } else {
    const inv = 1 / dx;
    let t1 = (-hx - px) * inv;
    let t2 = (hx - px) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = 0;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Y
  if (Math.abs(dy) < 1e-12) {
    if (py < -hy || py > hy) return false;
  } else {
    const inv = 1 / dy;
    let t1 = (-hy - py) * inv;
    let t2 = (hy - py) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = 1;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Z
  if (Math.abs(dz) < 1e-12) {
    if (pz < -hz || pz > hz) return false;
  } else {
    const inv = 1 / dz;
    let t1 = (-hz - pz) * inv;
    let t2 = (hz - pz) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = 2;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  if (axis < 0) return false; // 시작점이 상자 안
  out.t = tmin;
  out.tExit = tmax;
  out.axis = axis;
  out.sign = sign;
  return true;
}

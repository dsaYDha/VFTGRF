// =============================================================================
// Distant — 원경 (맵 밖, 접근 불가): 먼 마을 지붕·교회·급수탑·곡물 창고·축사, 멀어지는 송전탑·전신주 행렬과 전선.
// 병합 메시 하나(정점색, 램버트) + 전선 LineSegments 하나. 물체를 맵 중심에서 가까운 순으로 쌓아 두어
// setRange(m) 는 drawRange 만 줄인다 (그래픽 품질 프리셋, 실행 중 바로 적용).
// 모두 같은 안개를 받아 거의 실루엣만 보인다 (지평선 위로 솟은 언덕 마루·마을·탑은 applySilhouetteFog 로 희미한 실루엣이 남는다).
// 지면 높이는 Terrain.heightAt (맵 밖 = farHeight: 기복 + 먼 언덕·능선 + 수로·농로).
// 맵 안 송전선(MAP.pylons)·전신주(MAP.poles) 끝 탑의 전선 걸이에서 전선이 그대로 이어진다.
// 탄이 닿을 수 있는 거리(CONFIG.distant.colliderRange) 안의 물체만 충돌체(재질 태그: 벽돌·강철·콘크리트)를 둔다.
// 배치: MAP.distant, 수치: CONFIG.distant
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { MAP } from './mapData.js';
import { Random } from '../core/Random.js';

const DEG = Math.PI / 180;
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

// 방위각(도, 0 = 북, 시계방향) → 수평 단위 벡터 [x, z]
function dirOf(deg) {
  return [Math.sin(deg * DEG), -Math.cos(deg * DEG)];
}

// 마을 길 (직선 선분 [ax, az, bx, bz]): 큰길 + 갈라지는 길
export function villageStreets(v) {
  const [ux, uz] = dirOf(v.street);
  const L = v.len / 2;
  const out = [[v.x - ux * L, v.z - uz * L, v.x + ux * L, v.z + uz * L]];
  for (const c of v.cross || []) {
    const cx = v.x + ux * c.at;
    const cz = v.z + uz * c.at;
    const [wx, wz] = dirOf(v.street + (c.angle ?? 90));
    const h = c.len / 2;
    out.push([cx - wx * h, cz - wz * h, cx + wx * h, cz + wz * h]);
  }
  return out;
}

// 맵 밖 길 선분 목록 (원경 지면 셰이더가 칠한다): MAP.distant.roads + 마을 길
export function farRoadSegments() {
  const D = MAP.distant || {};
  const segs = [];
  for (const r of D.roads || []) {
    for (let i = 0; i < r.points.length - 1; i++) segs.push([...r.points[i], ...r.points[i + 1]]);
  }
  for (const v of D.villages || []) segs.push(...villageStreets(v));
  return segs;
}

// ---------------------------------------------------------------------------- 원경 실루엣 안개
// 원경을 그리는 거리 (맵 중심에서 m, 그래픽 품질 프리셋 — Distant.setRange 가 갱신). 이 끝 rangeFade m 안에서 실루엣 몫을 줄여
// 원경이 끊기는 자리(낮음 프리셋 2km 등)에서 언덕·마을이 툭 잘려 보이지 않게 한다
const SIL_RANGE = { value: CONFIG.distant.range };

// 맵 밖 지형(Terrain 원경 재질)·먼 물체·먼 전선 재질의 onBeforeCompile 에서 부른다 (CONFIG.distant.silhouette).
// Atmosphere 가 바꿔 낀 안개 식(atmoFogFactor: 거리·높이 안개·먼 곳 몫)은 그대로 두고, 투과율에 '높이 솟은 먼 곳' 몫
//  Ts = residual · e^(-dd/length) · smoothstep(rise) · smoothstep(out) · (원경 끝 rangeFade)
// 을 p-노름(atmosphere.fog.blendPow)으로 더한다. dd = 높이 보정 거리 (대기 안개와 같은 식), rise = 카메라보다 높은 정도 (m),
// out = 맵 가장자리 밖 거리 (m). 평평한 먼 지면(지평선)은 그대로 안개에 녹고, 맵 안·맵 가장자리 물체와는 이음매가 없다.
// 0.7~1.5km 언덕 마루·비탈의 마을·교회·급수탑처럼 지평선 위로 솟은 것만 희미한 실루엣으로 읽힌다 (지면 연무 위로 솟은 모습).
// 대기 셰이더 청크(atmoFogFactor)가 없으면 아무것도 바꾸지 않는다 (false 반환).
export function applySilhouetteFog(shader) {
  const SC = THREE.ShaderChunk;
  if (!SC.fog_fragment.includes('float fogFactor = atmoFogFactor( vFogDepth, vFogDY );') || !SC.fog_pars_vertex.includes('vFogDY')) return false;
  if (!shader.fragmentShader.includes('#include <fog_fragment>') || !shader.vertexShader.includes('#include <fog_vertex>')) return false;
  const S = CONFIG.distant.silhouette;
  const F = CONFIG.atmosphere.fog;
  const f = (v) => {
    const s = Number(v).toFixed(6);
    return s.includes('.') ? s : s + '.0';
  };
  shader.uniforms.uSilRange = SIL_RANGE;
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n#ifdef USE_FOG\n\tvarying float vSilOut;\n\tuniform float uSilRange;\n#endif')
    .replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
#ifdef USE_FOG
	{
		vec4 silW = modelMatrix * vec4( transformed, 1.0 );
		vSilOut = smoothstep( ${f(S.out[0])}, ${f(S.out[1])}, max( abs( silW.x ), abs( silW.z ) ) - ${f(CONFIG.world.halfSize)} )
			* ( 1.0 - smoothstep( uSilRange - ${f(S.rangeFade)}, uSilRange, length( silW.xz ) ) );
	}
#endif`,
    );
  // 대기 안개 조각 청크를 그대로 가져와 안개 비율을 구한 바로 뒤에 실루엣 몫을 끼운다
  const anchor = 'float fogFactor = atmoFogFactor( vFogDepth, vFogDY );';
  const frag = SC.fog_fragment.replace(
    anchor,
    `${anchor}
		{
			// 원경 실루엣 몫 (Distant.applySilhouetteFog)
			float sk = clamp( vFogDY / ${f(F.hazeHeight)}, -1.5, 12.0 );
			float shf = abs( sk ) < 1e-3 ? 1.0 : ( 1.0 - exp( -sk ) ) / sk;
			float sts = ${f(S.residual)} * exp( -vFogDepth * shf / ${f(S.length)} ) * smoothstep( ${f(S.rise[0])}, ${f(S.rise[1])}, vFogDY ) * vSilOut;
			fogFactor = 1.0 - pow( pow( 1.0 - fogFactor, ${f(F.blendPow)} ) + pow( max( sts, 1e-6 ), ${f(F.blendPow)} ), ${f(1 / F.blendPow)} );
		}`,
  );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n#ifdef USE_FOG\n\tvarying float vSilOut;\n#endif')
    .replace('#include <fog_fragment>', frag);
  return true;
}

// 맵 안 송전탑 틀 (Structures.pylonGeometry 와 같은 치수: 전선 걸이가 맞물리게)
const PYLON = {
  H: 24,
  base: 2.6,
  top: 0.75,
  body: 19,
  levels: [0, 6.5, 13, 19],
  arms: [
    [15.5, 5.2],
    [19, 4.0],
  ],
};

// 물체 하나 (집·탑): 맵 중심 거리 d 로 정렬된 뒤 정점 배열에 이어 붙는다
class Item {
  constructor(x, z) {
    this.d = Math.hypot(x, z);
    this.pos = [];
    this.nor = [];
    this.col = [];
  }
}

export class Distant {
  constructor({ terrain, col = null }) {
    this.terrain = terrain;
    this.col = col;
    this.rng = new Random(CONFIG.world.seed + 4401);
    this.items = [];
    this.wireItems = [];
    this.cur = null;
    // 현재 물체의 국소 좌표계 (y축 회전 + 이동)
    this.ox = 0;
    this.oy = 0;
    this.oz = 0;
    this.cs = 1;
    this.sn = 0;
    this.stats = { items: 0, triangles: 0, wireSegments: 0, colliders: 0 };
  }

  build() {
    const D = MAP.distant || {};
    for (const v of D.villages || []) this.village(v);
    for (const f of D.farms || []) this.farm(f.x, f.z, f.angle ?? 0, f.barns ?? 3, f.waterTower);
    for (const L of D.lines || []) this.powerLine(L);
    return this.finish();
  }

  // ------------------------------------------------------------------ 조립
  begin(x, z) {
    this.cur = new Item(x, z);
    this.items.push(this.cur);
    return this.cur;
  }

  // 국소 좌표계: 원점 (x, y, z), 국소 +x 가 월드 (cos yaw, -sin yaw) 방향 (THREE rotation.y = yaw 와 같다)
  frame(x, y, z, yaw) {
    this.ox = x;
    this.oy = y;
    this.oz = z;
    this.cs = Math.cos(yaw);
    this.sn = Math.sin(yaw);
  }

  // 국소 → 월드 (점, 방향)
  wp(p) {
    return [this.ox + p[0] * this.cs + p[2] * this.sn, this.oy + p[1], this.oz - p[0] * this.sn + p[2] * this.cs];
  }

  wd(n) {
    return [n[0] * this.cs + n[2] * this.sn, n[1], -n[0] * this.sn + n[2] * this.cs];
  }

  // 국소 좌표 삼각형 (반시계 = 앞면), 면 법선으로 평평한 음영
  tri(a, b, c, color, local = true) {
    const A = local ? this.wp(a) : a;
    const B = local ? this.wp(b) : b;
    const C = local ? this.wp(c) : c;
    const ux = B[0] - A[0];
    const uy = B[1] - A[1];
    const uz = B[2] - A[2];
    const vx = C[0] - A[0];
    const vy = C[1] - A[1];
    const vz = C[2] - A[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const it = this.cur;
    _c.set(color);
    for (const P of [A, B, C]) {
      it.pos.push(P[0], P[1], P[2]);
      it.nor.push(nx, ny, nz);
      it.col.push(_c.r, _c.g, _c.b);
    }
  }

  quad(a, b, c, d, color, local = true) {
    this.tri(a, b, c, color, local);
    this.tri(a, c, d, color, local);
  }

  // 상자 (국소 중심 cx,cy,cz 크기 sx,sy,sz). 바닥면은 그리지 않는다
  box(cx, cy, cz, sx, sy, sz, color, top = color) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color); // -x
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top); // +y
  }

  // 박공지붕 (용마루 = 국소 x). 처마 y0, 길이 L, 폭 W, 높이 h. 박공 삼각형은 벽 색
  gable(cx, y0, cz, L, W, h, roof, wall) {
    const lx = L / 2;
    const wz = W / 2;
    const o = 0.35; // 처마 내밈
    const s = (o * h) / wz;
    const e0 = y0 - s;
    this.quad([cx - lx - o, e0, cz + wz + o], [cx + lx + o, e0, cz + wz + o], [cx + lx + o, y0 + h, cz], [cx - lx - o, y0 + h, cz], roof);
    this.quad([cx + lx + o, e0, cz - wz - o], [cx - lx - o, e0, cz - wz - o], [cx - lx - o, y0 + h, cz], [cx + lx + o, y0 + h, cz], roof);
    this.tri([cx + lx, y0, cz + wz], [cx + lx, y0, cz - wz], [cx + lx, y0 + h, cz], wall);
    this.tri([cx - lx, y0, cz - wz], [cx - lx, y0, cz + wz], [cx - lx, y0 + h, cz], wall);
  }

  // 모임지붕 (네 면, 용마루 짧음)
  hip(cx, y0, cz, L, W, h, roof) {
    const lx = L / 2 + 0.3;
    const wz = W / 2 + 0.3;
    const r = Math.max(0, lx - wz);
    const a = [cx - lx, y0, cz + wz];
    const b = [cx + lx, y0, cz + wz];
    const c = [cx + lx, y0, cz - wz];
    const d = [cx - lx, y0, cz - wz];
    const p = [cx - r, y0 + h, cz];
    const q = [cx + r, y0 + h, cz];
    this.quad(a, b, q, p, roof);
    this.quad(c, d, p, q, roof);
    this.tri(b, c, q, roof);
    this.tri(d, a, p, roof);
  }

  // 원기둥·원뿔대 (국소 축 = y), 아래 반지름 r0, 위 r1. capTop = 위 뚜껑
  cyl(cx, y0, cz, r0, r1, h, seg, color, capTop = true) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      this.quad([cx + c0 * r0, y0, cz - s0 * r0], [cx + c1 * r0, y0, cz - s1 * r0], [cx + c1 * r1, y0 + h, cz - s1 * r1], [cx + c0 * r1, y0 + h, cz - s0 * r1], color);
      if (capTop && r1 > 0.01) this.tri([cx, y0 + h, cz], [cx + c0 * r1, y0 + h, cz - s0 * r1], [cx + c1 * r1, y0 + h, cz - s1 * r1], color);
    }
  }

  // 회전체 (양파 돔 등): prof = [[r, y], ...] 아래에서 위로
  lathe(cx, y0, cz, prof, seg, color) {
    for (let k = 0; k < prof.length - 1; k++) {
      const [ra, ya] = prof[k];
      const [rb, yb] = prof[k + 1];
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        const p00 = [cx + c0 * ra, y0 + ya, cz - s0 * ra];
        const p10 = [cx + c1 * ra, y0 + ya, cz - s1 * ra];
        const p01 = [cx + c0 * rb, y0 + yb, cz - s0 * rb];
        const p11 = [cx + c1 * rb, y0 + yb, cz - s1 * rb];
        if (rb < 0.01) this.tri(p00, p10, p01, color);
        else this.quad(p00, p10, p11, p01, color);
      }
    }
  }

  // 월드 좌표 두 점 사이 막대 (네모 단면 th, 뚜껑 없음) — 송전탑 부재·전신주
  beam(A, B, th, color) {
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const dz = B[2] - A[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return;
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    // 축에 수직인 두 방향
    let px = -uz;
    let py = 0;
    let pz = ux;
    let pl = Math.hypot(px, pz);
    if (pl < 1e-3) {
      px = 1;
      pz = 0;
      pl = 1;
    }
    px /= pl;
    pz /= pl;
    const qx = uy * pz - uz * py;
    const qy = uz * px - ux * pz;
    const qz = ux * py - uy * px;
    const h = th / 2;
    const corner = (P, sa, sb) => [P[0] + (px * sa + qx * sb) * h, P[1] + (py * sa + qy * sb) * h, P[2] + (pz * sa + qz * sb) * h];
    const S = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    for (let i = 0; i < 4; i++) {
      const [a0, b0] = S[i];
      const [a1, b1] = S[(i + 1) % 4];
      this.quad(corner(A, a0, b0), corner(A, a1, b1), corner(B, a1, b1), corner(B, a0, b0), color, false);
    }
  }

  // 원경 지형 메시는 멀수록 격자가 성겨 실제 높이(heightAt)보다 조금 낮게 그려질 수 있다 (언덕 마루·비탈).
  // 먼 건물 벽·탑 받침을 이만큼 더 땅속으로 내려 떠 보이지 않게 한다 (CONFIG.distant.foundationPerM)
  sink(x, z) {
    return this.viewDist(x, z) * CONFIG.distant.foundationPerM;
  }

  // 지면 높이 (발자국 네 모서리 중 가장 낮은 곳 — 비탈에서 벽 밑이 뜨지 않게, 먼 곳은 sink 만큼 더 낮게)
  footY(x, z, yaw, hx, hz) {
    const t = this.terrain;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [a, b] of [
      [hx, hz],
      [-hx, hz],
      [hx, -hz],
      [-hx, -hz],
      [0, 0],
    ]) {
      const y = t.heightAt(x + a * c + b * s, z - a * s + b * c);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return [lo - this.sink(x, z), hi];
  }

  // 이동 가능 구역에서의 수평 거리 (먼 부재 굵기·충돌체 판정용)
  viewDist(x, z) {
    const PA = CONFIG.world.playArea;
    const dx = Math.max(PA.minX - x, 0, x - PA.maxX);
    const dz = Math.max(PA.minZ - z, 0, z - PA.maxZ);
    return Math.hypot(dx, dz);
  }

  thin(real, x, z) {
    return Math.max(real, this.viewDist(x, z) * CONFIG.distant.thinPerM);
  }

  wantCollider(x, z) {
    return !!this.col && Math.hypot(x, z) <= CONFIG.distant.colliderRange;
  }

  // 충돌체 (상자, 국소 축 = yaw)
  boxCollider(x, y, z, hx, hy, hz, yaw, material) {
    if (!this.wantCollider(x, z)) return;
    this.col.addBox(x, y, z, hx, hy, hz, yaw, material, 'DISTANT');
    this.stats.colliders++;
  }

  beamCollider(A, B, half, material) {
    if (!this.wantCollider(A[0], A[2])) return;
    _v.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const len = _v.length();
    if (len < 1e-3) return;
    _v.divideScalar(len);
    _q.setFromUnitVectors(_up, _v);
    _e.setFromQuaternion(_q, 'XYZ');
    this.col.addBox((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, half, len / 2, half, { x: _e.x, y: _e.y, z: _e.z, order: 'XYZ' }, material, 'DISTANT');
    this.stats.colliders++;
  }

  pickColor(list, k = 1) {
    const c = new THREE.Color(this.rng.pick(list));
    const v = this.rng.range(0.9, 1.08) * k;
    return c.multiplyScalar(v).getHex();
  }

  // ------------------------------------------------------------------ 마을
  village(v) {
    const rng = this.rng;
    const H = CONFIG.distant.house;
    const [ux, uz] = dirOf(v.street);
    const streets = [{ cx: v.x, cz: v.z, ux, uz, len: v.len, houses: v.houses }];
    for (const c of v.cross || []) {
      const [wx, wz] = dirOf(v.street + (c.angle ?? 90));
      streets.push({ cx: v.x + ux * c.at, cz: v.z + uz * c.at, ux: wx, uz: wz, len: c.len, houses: c.houses, gap: 22 });
    }
    const dmg = v.damage ?? 0.5;
    for (const s of streets) {
      const nx = -s.uz;
      const nz = s.ux;
      const yawS = Math.atan2(-s.uz, s.ux);
      const per = Math.max(1, Math.round(s.houses / 2));
      const step = s.len / per;
      for (const side of [-1, 1]) {
        for (let i = 0; i < per; i++) {
          if (rng.chance(0.08)) continue; // 빈 집터
          const t = -s.len / 2 + (i + 0.5) * step + rng.range(-0.22, 0.22) * step;
          // 갈라지는 길은 큰길과 만나는 자리를 비운다
          if (s.gap && Math.abs(t) < s.gap) continue;
          const off = side * rng.range(H.setback[0], H.setback[1]);
          const x = s.cx + s.ux * t + nx * off;
          const z = s.cz + s.uz * t + nz * off;
          const yaw = yawS + (rng.chance(0.55) ? 0 : Math.PI / 2) + rng.range(-0.06, 0.06);
          const state = rng.chance(H.ruined * dmg) ? 'ruined' : rng.chance(H.burnt * dmg) ? 'burnt' : 'ok';
          this.house(x, z, yaw, state);
          if (rng.chance(H.shed)) {
            // 집 뒤 헛간 (길에서 더 먼 쪽)
            const back = side * rng.range(14, 24);
            const along = rng.range(-6, 6);
            this.shed(s.cx + s.ux * (t + along) + nx * (off + back), s.cz + s.uz * (t + along) + nz * (off + back), yawS + rng.range(-0.08, 0.08) + (rng.chance(0.3) ? Math.PI / 2 : 0), dmg);
          }
        }
      }
    }
    const at = (o) => {
      const [nx, nz] = [-uz, ux];
      const side = o.side ?? 1;
      return [v.x + ux * o.at + nx * side * (o.off ?? 40), v.z + uz * o.at + nz * side * (o.off ?? 40)];
    };
    const yawS = Math.atan2(-uz, ux);
    if (v.church) this.church(...at(v.church), yawS);
    if (v.waterTower) this.waterTower(...at(v.waterTower));
    if (v.elevator) this.elevator(...at(v.elevator), yawS);
    if (v.farm) this.farm(...at(v.farm), v.street + (v.farm.angle ?? 90), v.farm.barns ?? 3, false, dmg);
  }

  // 집: 벽 상자 + 박공·모임 지붕. ruined = 지붕 없이 벽만 (일부 무너짐), burnt = 그을린 벽 + 내려앉은 지붕
  house(x, z, yaw, state) {
    const rng = this.rng;
    const H = CONFIG.distant.house;
    const C = CONFIG.distant.colors;
    const L = rng.range(H.length[0], H.length[1]);
    const W = rng.range(H.depth[0], H.depth[1]);
    const wall = rng.range(H.wall[0], H.wall[1]);
    const [lo, hi] = this.footY(x, z, yaw, L / 2, W / 2);
    this.begin(x, z);
    const y0 = lo - 0.4;
    const base = hi - lo + 0.4;
    this.frame(x, y0, z, yaw);
    const burnt = state !== 'ok';
    const wc = burnt ? new THREE.Color(this.pickColor(C.wall)).lerp(new THREE.Color(C.burnt), 0.65).getHex() : this.pickColor(C.wall);
    if (state === 'ruined') {
      // 무너진 집: 높이가 다른 벽 조각 (지붕 없음)
      const h1 = base + wall * rng.range(0.45, 0.9);
      const h2 = base + wall * rng.range(0.25, 0.7);
      this.box(-L * 0.25, h1 / 2, 0, L * 0.5, h1, W, wc);
      this.box(L * 0.25, h2 / 2, 0, L * 0.5, h2, W, wc);
    } else {
      this.box(0, (base + wall) / 2, 0, L, base + wall, W, wc);
      const pitch = rng.range(H.pitch[0], H.pitch[1]);
      const rh = (W / 2) * pitch;
      if (state === 'burnt') {
        // 내려앉은 지붕: 낮고 검게
        this.gable(0, base + wall, 0, L * 0.8, W, rh * 0.45, C.burnt, wc);
      } else {
        const roof = this.pickColor(C.roof);
        if (rng.chance(0.3)) this.hip(0, base + wall, 0, L, W, rh, roof);
        else this.gable(0, base + wall, 0, L, W, rh, roof, wc);
        // 굴뚝
        if (rng.chance(0.6)) this.box(rng.range(-L * 0.3, L * 0.3), base + wall + rh * 0.7, W * 0.18, 0.5, rh * 0.9, 0.5, 0x6a5e56);
      }
    }
    this.boxCollider(x, y0 + (base + wall) / 2, z, L / 2, (base + wall) / 2, W / 2, yaw, 'brick');
  }

  // 헛간·창고 (낮은 박공)
  shed(x, z, yaw, dmg) {
    const rng = this.rng;
    const C = CONFIG.distant.colors;
    const L = rng.range(4, 7);
    const W = rng.range(3, 4.5);
    const wall = rng.range(2.0, 2.5);
    const [lo, hi] = this.footY(x, z, yaw, L / 2, W / 2);
    this.begin(x, z);
    this.frame(x, lo - 0.3, z, yaw);
    const base = hi - lo + 0.3;
    const wc = this.pickColor(C.wall, 0.8);
    this.box(0, (base + wall) / 2, 0, L, base + wall, W, wc);
    if (!rng.chance(0.25 * dmg)) this.gable(0, base + wall, 0, L, W, W * 0.25, this.pickColor(C.roof, 0.92), wc);
    this.boxCollider(x, lo - 0.3 + (base + wall) / 2, z, L / 2, (base + wall) / 2, W / 2, yaw, 'brick');
  }

  // 정교회 교회: 본당 + 반원 제단부 + 드럼 위 양파 돔과 십자가, 서쪽 종탑 (본당 길이 방향 = 국소 x)
  church(x, z, yaw) {
    const C = CONFIG.distant.colors;
    const [lo, hi] = this.footY(x, z, yaw, 11, 6);
    this.begin(x, z);
    const y0 = lo - 0.4;
    const b = hi - lo + 0.4;
    this.frame(x, y0, z, yaw);
    const wall = C.church;
    this.box(0, (b + 8) / 2, 0, 15, b + 8, 9, wall);
    this.gable(0, b + 8, 0, 15, 9, 2.6, C.dome, wall);
    this.cyl(7.5, 0, 0, 3.6, 3.6, b + 6.5, 8, wall);
    // 드럼 + 양파 돔 + 십자가
    this.cyl(0, b + 8, 0, 2.7, 2.7, 4.5, 10, wall, false);
    const r = 3.0;
    this.lathe(0, b + 12.5, 0, [[2.75, 0], [r * 1.05, r * 0.35], [r * 1.12, r * 0.75], [r * 0.85, r * 1.25], [r * 0.4, r * 1.6], [0.12, r * 1.95], [0, r * 2.05]], 10, C.dome);
    this.box(0, b + 12.5 + r * 2.05 + 1.2, 0, 0.25, 2.6, 0.25, 0x6e6a60);
    this.box(0, b + 12.5 + r * 2.05 + 1.6, 0, 0.25, 0.22, 1.3, 0x6e6a60);
    // 종탑 (서쪽 = 국소 -x)
    this.box(-9.8, (b + 15) / 2, 0, 4.6, b + 15, 4.6, wall);
    this.lathe(-9.8, b + 15, 0, [[2.0, 0], [2.3, 0.9], [1.7, 2.0], [0.7, 2.9], [0.1, 3.6], [0, 3.8]], 8, C.dome);
    this.box(-9.8, b + 15 + 4.6, 0, 0.2, 1.8, 0.2, 0x6e6a60);
    this.boxCollider(x, y0 + (b + 8) / 2, z, 7.5, (b + 8) / 2, 4.5, yaw, 'brick');
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    this.boxCollider(x - 9.8 * cs, y0 + (b + 15) / 2, z + 9.8 * sn, 2.3, (b + 15) / 2, 2.3, yaw, 'brick');
  }

  // 로즈놉스키식 급수탑: 가는 기둥 위 원통 물탱크 + 원뿔 지붕 (녹슨 강철)
  waterTower(x, z) {
    const C = CONFIG.distant.colors;
    const y = this.terrain.heightAt(x, z) - 0.3;
    this.begin(x, z);
    this.frame(x, y, z, 0);
    const shaft = 18;
    const sk = this.sink(x, z);
    this.cyl(0, -sk, 0, 1.6, 1.1, 1.5 + sk, 8, 0x7a6c62, false);
    this.cyl(0, 1.5, 0, 1.1, 1.1, shaft - 1.5, 8, C.rust, false);
    this.cyl(0, shaft, 0, 1.1, 3.2, 1.4, 10, C.rust, false);
    this.cyl(0, shaft + 1.4, 0, 3.2, 3.2, 5, 10, C.rust, false);
    this.cyl(0, shaft + 6.4, 0, 3.4, 0.3, 2.0, 10, 0x4a3a32, true);
    if (this.wantCollider(x, z)) {
      this.col.addCylinder(x, y + shaft / 2, z, 1.1, shaft / 2, 'steel', 'DISTANT');
      this.col.addCylinder(x, y + shaft + 3.7, z, 3.2, 3.7, 'steel', 'DISTANT');
      this.stats.colliders += 2;
    }
  }

  // 곡물 창고 (엘리베이터): 콘크리트 사일로 줄 + 높은 작업탑
  elevator(x, z, yaw) {
    const C = CONFIG.distant.colors;
    const sk = this.sink(x, z);
    const [lo] = this.footY(x, z, yaw, 18, 6);
    this.begin(x, z);
    const y0 = lo + sk - 0.5; // 높이는 실제 지면 기준, 사일로·작업탑 밑동만 sk 만큼 더 땅속으로
    this.frame(x, y0, z, yaw);
    for (let i = 0; i < 6; i++) {
      for (const sz of [-3.1, 3.1]) this.cyl(-12 + i * 6.2, -sk, sz, 3.1, 3.1, 26 + sk, 10, C.concrete, true);
    }
    this.box(-12 + 6 * 6.2 + 1.5, (42 - sk) / 2, 0, 9, 42 + sk, 12, 0x96928a);
    this.gable(-12 + 6 * 6.2 + 1.5, 42, 0, 9, 12, 2, 0x6a6c6c, 0x96928a);
    this.box(4, 27.5, 0, 34, 3, 4.5, 0x8c8880);
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    this.boxCollider(x + 3.5 * cs, y0 + 13, z - 3.5 * sn, 18.6, 13, 6.2, yaw, 'concrete');
    this.boxCollider(x + 26.7 * cs, y0 + 21, z - 26.7 * sn, 4.5, 21, 6, yaw, 'concrete');
  }

  // 축사 여러 동 (긴 벽돌 건물, 일부 지붕 무너짐) + 선택적으로 급수탑
  farm(x, z, angle, barns, waterTower, dmg = 0.4) {
    const rng = this.rng;
    const C = CONFIG.distant.colors;
    const [ux, uz] = dirOf(angle);
    const nx = -uz;
    const nz = ux;
    const yaw = Math.atan2(-uz, ux);
    for (let i = 0; i < barns; i++) {
      const off = (i - (barns - 1) / 2) * 26;
      const bx = x + nx * off + ux * rng.range(-6, 6);
      const bz = z + nz * off + uz * rng.range(-6, 6);
      const L = rng.range(48, 66);
      const W = rng.range(11, 13);
      const [lo, hi] = this.footY(bx, bz, yaw, L / 2, W / 2);
      this.begin(bx, bz);
      this.frame(bx, lo - 0.4, bz, yaw);
      const b = hi - lo + 0.4;
      const wc = this.pickColor([0x8f8a80, 0x8c7c70, 0x9a968e], 0.95);
      this.box(0, (b + 3.6) / 2, 0, L, b + 3.6, W, wc);
      if (rng.chance(0.35 * dmg + 0.1)) {
        // 지붕이 반쯤 무너짐
        this.gable(-L * 0.25, b + 3.6, 0, L * 0.5, W, 2.2, this.pickColor(C.roof), wc);
      } else this.gable(0, b + 3.6, 0, L, W, 2.4, this.pickColor(C.roof), wc);
      this.boxCollider(bx, lo - 0.4 + (b + 3.6) / 2, bz, L / 2, (b + 3.6) / 2, W / 2, yaw, 'brick');
    }
    if (waterTower) this.waterTower(x + ux * 55 + nx * 30, z + uz * 55 + nz * 30);
  }

  // ------------------------------------------------------------------ 송전선
  // 점을 따라 spacing 마다 탑을 세우고 이웃 탑의 전선 걸이를 처진 선으로 잇는다. anchor 면 첫 점은 맵 안 탑 (세우지 않음)
  powerLine(L) {
    const pts = L.points;
    const sites = [];
    if (!L.anchor) sites.push({ x: pts[0][0], z: pts[0][1] });
    let carry = L.anchor ? L.spacing : 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      let s = carry;
      while (s <= len) {
        const t = s / len;
        if (s > 1e-3 || sites.length === 0) sites.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t });
        s += L.spacing;
      }
      carry = s - len;
    }
    const maxR = CONFIG.distant.maxRange;
    const list = sites.filter((p) => Math.hypot(p.x, p.z) <= maxR);
    const towers = [];
    if (L.anchor) towers.push(this.anchorTower(L.anchor));
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const prev = i > 0 ? list[i - 1] : L.anchor ? towers[0] : p;
      const next = i < list.length - 1 ? list[i + 1] : p;
      // 국소 x = 선로 방향 (이웃 탑 사이)
      const yaw = Math.atan2(-(next.z - prev.z), next.x - prev.x);
      if (L.kind === 'pole') towers.push(this.pole(p.x, p.z, yaw));
      else towers.push(this.pylon(p.x, p.z, yaw, L.kind === 'big' ? CONFIG.distant.bigScale : 1));
    }
    const sag = L.kind === 'pole' ? CONFIG.midfield.poles.sag : L.kind === 'big' ? CONFIG.distant.bigSag : CONFIG.midfield.wires.sag;
    for (let i = 0; i < towers.length - 1; i++) this.span(towers[i], towers[i + 1], sag);
  }

  // 맵 안 송전선·전신주 끝 탑의 전선 걸이 (Structures.pylons / poles 와 같은 식)
  anchorTower(kind) {
    const t = this.terrain;
    if (kind === 'polesSouth') {
      const list = MAP.poles;
      const P = CONFIG.midfield.poles;
      const p = list[0];
      const n = list[1];
      const yaw = Math.atan2(-(n.z - p.z), n.x - p.x);
      const L = P.height + P.buried;
      this.frame(p.x, t.heightAt(p.x, p.z) - P.buried, p.z, yaw);
      return { x: p.x, y: this.oy, z: p.z, attach: [this.wp([0, L - 0.24, -0.76]), this.wp([0, L - 0.24, 0.76]), this.wp([0, L + 0.19, 0])] };
    }
    const list = MAP.pylons;
    const i = kind === 'pylonsEast' ? list.length - 1 : 0;
    const p = list[i];
    const n = list[Math.min(i + 1, list.length - 1)];
    const pv = list[Math.max(i - 1, 0)];
    const yaw = Math.atan2(-(n.z - pv.z), n.x - pv.x);
    this.frame(p.x, t.heightAt(p.x, p.z) - 0.2, p.z, yaw);
    return { x: p.x, y: this.oy, z: p.z, attach: this.pylonAttach(1) };
  }

  // 현재 좌표계 기준 송전탑 전선 걸이 (팔 아래 애자 끝 4개 + 꼭대기 가공지선)
  pylonAttach(k) {
    const out = [];
    for (const [h, span] of PYLON.arms) for (const s of [-1, 1]) out.push(this.wp([0, (h - 1.2) * k, s * span * 0.92 * k]));
    out.push(this.wp([0, PYLON.H * k, 0]));
    return out;
  }

  // 격자 송전탑 (맵 안 송전탑과 같은 윤곽, 사재를 줄임). 먼 탑은 부재를 굵게 (화면에서 1px 안팎)
  pylon(x, z, yaw, k) {
    const C = CONFIG.distant.colors;
    const y = this.terrain.heightAt(x, z) - 0.2;
    this.begin(x, z);
    this.frame(x, y, z, yaw);
    const T = PYLON;
    const far = this.viewDist(x, z) > CONFIG.distant.detailDistance;
    const th = (real) => this.thin(real * k, x, z);
    const at = (h) => (T.base + (T.top - T.base) * (h / T.body)) * k;
    const W = (lx, ly, lz) => this.wp([lx, ly * k, lz]);
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ];
    const col = this.pickColor([C.steel], 0.97);
    const legs = [];
    for (const [sx, sz] of corners) {
      const A = W(sx * at(0), 0, sz * at(0));
      const B = W(sx * at(T.body), T.body, sz * at(T.body));
      this.beam(A, B, th(0.16), col);
      legs.push([A, B]);
    }
    const lv = T.levels;
    for (let l = 1; l < lv.length; l++) {
      const a1 = at(lv[l]);
      const a0 = at(lv[l - 1]);
      for (let c = 0; c < 4; c++) {
        const [sx0, sz0] = corners[c];
        const [sx1, sz1] = corners[(c + 1) % 4];
        this.beam(W(sx0 * a1, lv[l], sz0 * a1), W(sx1 * a1, lv[l], sz1 * a1), th(0.09), col);
        if (far) continue;
        this.beam(W(sx0 * a0, lv[l - 1], sz0 * a0), W(sx1 * a1, lv[l], sz1 * a1), th(0.07), col);
        this.beam(W(sx1 * a0, lv[l - 1], sz1 * a0), W(sx0 * a1, lv[l], sz0 * a1), th(0.07), col);
      }
    }
    const tp = at(T.body);
    for (const [sx, sz] of corners) this.beam(W(sx * tp, T.body, sz * tp), W(0, T.H, 0), th(0.1), col);
    for (const [h, span] of T.arms) {
      const s = span * k;
      for (const sx of [-1, 1]) {
        this.beam(W(sx * tp * 1.3, h, -s), W(sx * tp * 1.3, h, s), th(0.12), col);
        if (!far) {
          this.beam(W(sx * tp * 1.3, h - 1.2, -tp), W(sx * tp * 1.3, h, -s), th(0.08), col);
          this.beam(W(sx * tp * 1.3, h - 1.2, tp), W(sx * tp * 1.3, h, s), th(0.08), col);
        }
      }
      // 애자
      for (const sd of [-1, 1]) this.beam(W(0, h, sd * s * 0.92), W(0, h - 1.2, sd * s * 0.92), th(0.12), 0x9a9c98);
    }
    // 충돌체: 다리 4개 (강철 막대, 맵 안 서 있는 탑과 같다)
    const mh = CONFIG.midfield.wires.memberHalf;
    for (const [A, B] of legs) this.beamCollider(A, B, mh * k, 'steel');
    return { x, y, z, attach: this.pylonAttach(k) };
  }

  // 콘크리트 전신주 (맵 안 전신주와 같은 치수, 완목 = 국소 z)
  pole(x, z, yaw) {
    const P = CONFIG.midfield.poles;
    const C = CONFIG.distant.colors;
    const L = P.height + P.buried;
    const y = this.terrain.heightAt(x, z) - P.buried;
    this.begin(x, z);
    this.frame(x, y, z, yaw);
    const w0 = this.thin(P.base[0], x, z);
    const w1 = this.thin(P.top[0], x, z);
    const col = this.pickColor([C.concrete], 0.95);
    // 가늘어지는 기둥 (네모 단면)
    this.beam(this.wp([0, P.buried - 0.3, 0]), this.wp([0, L, 0]), (w0 + w1) / 2, col);
    this.beam(this.wp([0, L - 0.45, -0.85]), this.wp([0, L - 0.45, 0.85]), this.thin(0.07, x, z), 0x5a544e);
    this.beamCollider(this.wp([0, P.buried, 0]), this.wp([0, L, 0]), P.colliderHalf, 'concrete');
    return { x, y, z, attach: [this.wp([0, L - 0.24, -0.76]), this.wp([0, L - 0.24, 0.76]), this.wp([0, L + 0.19, 0])] };
  }

  // 두 탑 사이 전선: 걸이를 탑 기준 같은 쪽·같은 높이끼리 짝지어 (탑 방향이 반대여도 꼬이지 않게) 처진 포물선으로
  span(A, B, sag) {
    const len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    const segs = Math.max(6, Math.ceil(len / 14));
    const item = { d: Math.hypot((A.x + B.x) / 2, (A.z + B.z) / 2), pts: [] };
    const used = new Set();
    for (let w = 0; w < A.attach.length; w++) {
      const a = A.attach[w];
      const ox = a[0] - A.x;
      const oy = a[1] - A.y;
      const oz = a[2] - A.z;
      let best = -1;
      let bd = Infinity;
      for (let j = 0; j < B.attach.length; j++) {
        if (used.has(j)) continue;
        const b = B.attach[j];
        const d = Math.hypot(b[0] - B.x - ox, b[1] - B.y - oy, b[2] - B.z - oz);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      if (best < 0) continue;
      used.add(best);
      const b = B.attach[best];
      const s = sag * (1 + 0.04 * w);
      let prev = a;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - s * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
        item.pts.push(...prev, ...p);
        prev = p;
      }
    }
    this.wireItems.push(item);
  }

  // ------------------------------------------------------------------ 메시
  finish() {
    const root = new THREE.Group();
    root.name = 'distant';
    // 물체: 맵 중심에서 가까운 순으로 이어 붙이고, 물체 경계마다 (거리, 정점 수) 기록 → setRange
    this.items.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const it of this.items) n += it.pos.length;
    const pos = new Float32Array(n);
    const nor = new Float32Array(n);
    const col = new Float32Array(n);
    this.itemEnds = [];
    let o = 0;
    for (const it of this.items) {
      pos.set(it.pos, o);
      nor.set(it.nor, o);
      col.set(it.col, o);
      o += it.pos.length;
      this.itemEnds.push([it.d, o / 3]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.name = 'distantScenery';
    mat.userData.noShadow = true;
    // 지평선 위로 솟은 먼 물체는 희미한 실루엣으로 남긴다 (applySilhouetteFog)
    mat.onBeforeCompile = (shader) => applySilhouetteFog(shader);
    mat.customProgramCacheKey = () => 'distantSilhouette';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'distantScenery';
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    root.add(mesh);
    // 전선
    this.wireItems.sort((a, b) => a.d - b.d);
    let m = 0;
    for (const w of this.wireItems) m += w.pts.length;
    const wp = new Float32Array(m);
    this.wireEnds = [];
    o = 0;
    for (const w of this.wireItems) {
      wp.set(w.pts, o);
      o += w.pts.length;
      this.wireEnds.push([w.d, o / 3]);
    }
    const wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.BufferAttribute(wp, 3));
    wgeo.computeBoundingSphere();
    const wmat = new THREE.LineBasicMaterial({ color: CONFIG.distant.colors.wire });
    wmat.onBeforeCompile = (shader) => applySilhouetteFog(shader);
    wmat.customProgramCacheKey = () => 'distantSilhouetteWire';
    const wires = new THREE.LineSegments(wgeo, wmat);
    wires.name = 'distantWires';
    wires.matrixAutoUpdate = false;
    this.wires = wires;
    root.add(wires);
    this.stats.items = this.items.length;
    this.stats.triangles = n / 9;
    this.stats.wireSegments = m / 6;
    // 정점 배열은 메시로 옮겼으니 버린다
    this.items = null;
    this.wireItems = null;
    this.setRange(CONFIG.distant.range);
    return root;
  }

  // 그리는 거리 (맵 중심에서 m): 그보다 먼 물체·전선은 그리지 않는다 (원경 지형·실루엣 안개 끝도 같은 거리)
  setRange(r) {
    SIL_RANGE.value = r;
    const count = (ends) => {
      let c = 0;
      for (const [d, e] of ends) {
        if (d > r) break;
        c = e;
      }
      return c;
    };
    if (this.mesh) this.mesh.geometry.setDrawRange(0, count(this.itemEnds));
    if (this.wires) this.wires.geometry.setDrawRange(0, count(this.wireEnds));
  }
}

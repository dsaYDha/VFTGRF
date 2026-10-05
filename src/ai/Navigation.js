// =============================================================================
// Navigation — 맵 데이터(AI_MAP)의 노드·사격 위치를 실제 지형에 맞춰 준비한다.
//  사격 위치마다: 사격 자세·엄폐 자세, 위치(발판 높이 포함), 바라보는 방향, 엄폐물 태그.
//  노드 간 이동 경로(경유점)와 참호 안 좌우 이동 경로를 만든다.
// =============================================================================
import * as THREE from 'three';
import { AI_MAP, MAP } from '../world/mapData.js';
import { poseEyeHeight } from '../units/SoldierModel.js';
import { CONFIG } from '../config.js';

const FIRE_POSE = { stand: 'standAim', kneel: 'kneelAim', prone: 'proneAim' };
const OBSERVE_POSE = { stand: 'standObserve', kneel: 'kneelObserve', prone: 'proneAim' };
const COVER_POSE = { duck: 'duck', prone: 'proneLow', kneel: 'kneel', curl: 'curl' };

export class Navigation {
  constructor(world) {
    this.world = world;
    this.terrain = world.terrain;
    this.nodes = {};
    this.eye = {};
    for (const p of ['standAim', 'kneelAim', 'proneAim', 'duck', 'kneel', 'proneLow', 'curl', 'standObserve']) this.eye[p] = poseEyeHeight(p);
    this.prepare();
  }

  prepare() {
    for (const [id, def] of Object.entries(AI_MAP.nodes)) {
      const node = { id, ...def, fps: [], occupants: new Set() };
      def.fps.forEach((fd, i) => node.fps.push(this.prepareFp(node, fd, i)));
      this.nodes[id] = node;
    }
    this.edges = {};
    for (const [k, pts] of Object.entries(AI_MAP.edges)) this.edges[k] = pts.map(([x, z]) => new THREE.Vector3(x, this.terrain.heightAt(x, z), z));
  }

  yawTo(x, z, tx, tz) {
    // 모델 정면 = +Z, yaw = atan2(dx, dz)
    return Math.atan2(tx - x, tz - z);
  }

  prepareFp(node, fd, index) {
    const t = this.terrain;
    const face = fd.face || [0, MAP.canal.z];
    const fp = {
      node,
      index,
      fire: fd.fire,
      firePose: FIRE_POSE[fd.fire],
      observePose: OBSERVE_POSE[fd.fire],
      coverPose: COVER_POSE[fd.cover],
      coverRef: fd.coverRef || 'terrain',
      light: CONFIG.ai.lightFactor[node.light] ?? 1,
      pos: new THREE.Vector3(),
      firePos: new THREE.Vector3(),
      coverPos: new THREE.Vector3(),
      yaw: 0,
      step: 0,
      occupiedBy: null,
    };
    let x = fd.x;
    let z = fd.z;
    let fireLocalW = null;
    if (node.vehicle) {
      // 차량 기준 로컬 좌표 → 월드
      const v = MAP[node.vehicle];
      const c = Math.cos(v.rot);
      const sn = Math.sin(v.rot);
      const w = (lx, lz) => [v.x + lx * c + lz * sn, v.z - lx * sn + lz * c];
      [x, z] = w(fd.local[0], fd.local[1]);
      fireLocalW = w(fd.fireLocal[0], fd.fireLocal[1]);
    } else if (node.kind === 'building' && fd.fire === 'stand') {
      // 가장 가까운 창문 중앙으로 맞춘다
      const wins = (this.world.structures && this.world.structures.windows) || [];
      let best = null;
      let bd = 3.5;
      for (const wi of wins) {
        if (wi.side !== 'south') continue;
        const d = Math.abs(wi.x - x) + Math.abs(wi.z - z) * 0.5;
        if (Math.abs(wi.z - z) < 2.5 && d < bd) {
          bd = d;
          best = wi;
        }
      }
      if (best) x = best.x;
    }
    if (node.kind === 'trench') {
      // 참호선 위 그 x 의 점에서 앞벽(남쪽) 쪽으로 붙는다
      const line = MAP.trench.lines[node.trenchLine];
      const p = this.trenchPointAtX(line, x);
      x = p.x + p.nx * 0.22;
      z = p.z + p.nz * 0.22;
    } else if (node.kind === 'crater') {
      const c = this.terrain.craters.find((cr) => cr.tag === node.crater);
      const base = Math.atan2(face[0] - c.x, face[1] - c.z) + (fd.rim || 0);
      const dx = Math.sin(base);
      const dz = Math.cos(base);
      // 엎드린 몸(골반)은 안쪽 경사면, 머리가 테두리 마루에 걸친다 (눈이 마루 위로 약 10cm)
      const inset = node.rimInset ?? 0.8;
      x = c.x + dx * (c.r - inset);
      z = c.z + dz * (c.r - inset);
      fp.coverPos.set(c.x + dx * c.r * 0.3, 0, c.z + dz * c.r * 0.3);
      fp.crater = c;
    }
    fp.yaw = this.yawTo(x, z, face[0] + (x - face[0]) * 0.55, face[1]);
    const floor = t.heightAt(x, z);
    fp.pos.set(x, floor, z);
    // 참호: 사격 발판 높이 = 흉벽 위로 눈이 살짝 나오게
    if (fd.step) {
      const fx = Math.sin(fp.yaw);
      const fz = Math.cos(fp.yaw);
      let top = -Infinity;
      for (let d = 0.4; d <= 3.2; d += 0.2) top = Math.max(top, t.heightAt(x + fx * d, z + fz * d));
      const eye = this.eye.standAim;
      const step = Math.max(0, Math.min(0.8, top + 0.12 - (floor + eye)));
      fp.step = step;
      fp.parapetTop = top;
      fp.pos.y = floor + step;
      this.world.addFireStep(x, z, floor, step, fp.yaw, top);
    }
    const fo = fd.fireOffset || [0, 0];
    if (fireLocalW) fp.firePos.set(fireLocalW[0], 0, fireLocalW[1]);
    else fp.firePos.set(x + fo[0], 0, z + fo[1]);
    fp.firePos.y = fd.step ? fp.pos.y : t.heightAt(fp.firePos.x, fp.firePos.z);
    if (node.kind !== 'crater') {
      const co = fd.coverOffset || [0, 0];
      fp.coverPos.set(x + co[0], 0, z + co[1]);
    }
    fp.coverPos.y = fd.step ? fp.pos.y : t.heightAt(fp.coverPos.x, fp.coverPos.z);
    return fp;
  }

  trenchPointAtX(line, x) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      if ((x >= ax && x <= bx) || (x >= bx && x <= ax)) {
        const k = (x - ax) / (bx - ax || 1);
        let nx = -(bz - az);
        let nz = bx - ax;
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        if (nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        return { x, z: az + (bz - az) * k, nx, nz };
      }
    }
    const last = line[line.length - 1];
    return { x: last[0], z: last[1], nx: 0, nz: 1 };
  }

  // 참호선을 따라 x0 → x1 로 갈 때 지나는 꺾이는 점들 (이동 방향 순서)
  trenchCorners(line, x0, x1, out) {
    const dir = Math.sign(x1 - x0);
    const xs = [];
    for (const [px] of line) if ((px - x0) * dir > 0.5 && (x1 - px) * dir > 0.5) xs.push(px);
    xs.sort((p, q) => (p - q) * dir);
    for (const px of xs) {
      const p = this.trenchPointAtX(line, px);
      out.push(new THREE.Vector3(p.x, 0, p.z));
    }
    return out;
  }

  // 같은 노드 안 사격 위치 사이 경로 (참호는 참호선을 따라)
  pathBetweenFps(a, b) {
    const pts = [];
    const node = a.node;
    if (node.kind === 'trench' && a.node === b.node) {
      this.trenchCorners(MAP.trench.lines[node.trenchLine], a.pos.x, b.pos.x, pts);
    } else {
      pts.push(a.coverPos.clone());
    }
    pts.push(b.coverPos.clone());
    for (const p of pts) p.y = this.terrain.heightAt(p.x, p.z);
    return pts;
  }

  // 증원이 노드로 들어가는 경로: 지정된 접근로(건물을 돌아가는 경유점) → 참호는 연결호로 들어와 참호선을 따라간다
  approachPath(node, fp) {
    const pts = [];
    for (const [x, z] of node.approach || []) pts.push(new THREE.Vector3(x, 0, z));
    if (node.kind === 'trench') {
      const line = MAP.trench.lines[node.trenchLine];
      // 이 참호선에 닿는 연결호 (첫 점이 참호선 위에 있는 것)
      let comm = null;
      let best = 3;
      let xmin = Infinity;
      let xmax = -Infinity;
      for (const [px] of line) {
        xmin = Math.min(xmin, px);
        xmax = Math.max(xmax, px);
      }
      for (const cl of MAP.trench.commLines) {
        const [jx, jz] = cl[0];
        if (jx < xmin || jx > xmax) continue;
        const d = Math.abs(this.trenchPointAtX(line, jx).z - jz);
        if (d < best) {
          best = d;
          comm = cl;
        }
      }
      if (comm) {
        for (let i = comm.length - 1; i >= 0; i--) pts.push(new THREE.Vector3(comm[i][0], 0, comm[i][1]));
        const j = this.trenchPointAtX(line, comm[0][0]);
        pts.push(new THREE.Vector3(j.x, 0, j.z));
        this.trenchCorners(line, j.x, fp.pos.x, pts);
      }
    }
    pts.push(fp.coverPos.clone());
    for (const p of pts) p.y = this.terrain.heightAt(p.x, p.z);
    return pts;
  }

  edgeKey(from, to) {
    return `${from}>${to}`;
  }

  // 노드 간 이동 경로 (출구 → 경유점들 → 도착 사격 위치)
  // bound=true 인 점은 질주 후 엎드려 숨을 고르는 경유점 (구덩이 등)
  advancePath(fromNode, toNode, destFp) {
    const pts = [];
    if (fromNode && fromNode.exit) {
      for (const [x, z] of fromNode.exit) {
        const v = new THREE.Vector3(x, 0, z);
        v.bound = false;
        pts.push(v);
      }
    }
    const e = this.edges[this.edgeKey(fromNode.id, toNode.id)] || [];
    for (const p of e) {
      const v = p.clone();
      v.bound = true;
      pts.push(v);
    }
    const d = destFp.coverPos.clone();
    d.bound = false;
    pts.push(d);
    for (const p of pts) p.y = this.terrain.heightAt(p.x, p.z);
    return pts;
  }

  freeFp(node, exclude = null) {
    const free = node.fps.filter((f) => !f.occupiedBy && f !== exclude);
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
  }

  nodeHasRoom(node) {
    return node.occupants.size < node.cap && node.fps.some((f) => !f.occupiedBy);
  }
}

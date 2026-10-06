// =============================================================================
// 점검용 고정 시점 (디버그 모드에서 F4 로 순환). 화면 품질을 같은 자리에서 비교하기 위한 도구.
// 위치는 맵 데이터와 현재 지형에서 매번 계산한다 (지형·수로 형상이 바뀌어도 따라간다).
// =============================================================================
import { CONFIG } from '../config.js';
import { MAP } from '../world/mapData.js';
import { EV } from '../core/events.js';

export const VIEWPOINT_NAMES = [
  '1 수로 안에서 엎드려 북쪽',
  '2 수로 둔덕 뒤에 앉아 북쪽 (시작 위치)',
  '3 둔덕 위에 서서 북쪽 전경',
  '4 중간 지대 장갑차 옆에서 북쪽',
  '5 남쪽 맵 경계 방향',
  '6 시작 위치에서 조준',
];

export class ViewPoints {
  constructor(game) {
    this.game = game;
    this.index = -1;
  }

  next() {
    this.apply((this.index + 1) % VIEWPOINT_NAMES.length);
    return this.index;
  }

  // 북쪽 둑(흉벽) 마루: 수로 중심에서 북쪽으로 가장 높은 지점
  bermTop(x) {
    const t = this.game.world.terrain;
    const zc = t.canalZ(x);
    let best = zc - 3;
    let bh = -Infinity;
    for (let d = 1.5; d <= 10; d += 0.1) {
      const h = t.heightAt(x, zc - d);
      if (h > bh) {
        bh = h;
        best = zc - d;
      }
    }
    return best;
  }

  // 기준점 (bx, bz) + 후보 오프셋 중, 선 눈높이·총 높이에서 북쪽으로 clearAhead m 와 좌우 sideDeg 비스듬히 clearSide m 가
  // 지형·충돌체에 막히지 않는 첫 자리 (모두 막히면 첫 후보)
  clearSpot(bx, bz, offsets) {
    const V = CONFIG.debug.viewPoints;
    const t = this.game.world.terrain;
    const col = this.game.world.collision;
    const eye = CONFIG.player.eyeHeights.stand;
    const sx = Math.sin((V.sideDeg * Math.PI) / 180) * V.clearSide;
    const sz = Math.cos((V.sideDeg * Math.PI) / 180) * V.clearSide;
    for (const [ox, oz] of offsets) {
      const x = bx + ox;
      const z = bz + oz;
      const y0 = col.groundHeight(x, z, t.heightAt(x, z) + 0.6);
      let open = true;
      for (const h of [eye, eye - 0.25]) {
        const y = y0 + h;
        if (
          col.lineBlocked(x, y, z, x, y, z - V.clearAhead) ||
          col.lineBlocked(x, y, z, x - sx, y, z - sz) ||
          col.lineBlocked(x, y, z, x + sx, y, z - sz)
        ) {
          open = false;
          break;
        }
      }
      if (open) return [x, z];
    }
    return [bx + offsets[0][0], bz + offsets[0][1]];
  }

  apply(i) {
    const g = this.game;
    const p = g.player;
    const t = g.world.terrain;
    const sp = MAP.playerSpawn;
    let x = sp.x;
    let z = sp.z;
    let yaw = 0;
    let posture = sp.posture || 'crouch';
    let ads = false;
    switch (i) {
      case 0: {
        // 시작 위치에서 가장 가까운 엎드려쏴 사격 홈 (둔덕을 파낸 엎드릴 자리, 수로 북쪽 가장자리)
        const C = MAP.canal;
        const N = C.notches;
        if (N && N.list.length) {
          x = N.list.reduce((a, b) => (Math.abs(b - sp.x) < Math.abs(a - sp.x) ? b : a));
          z = t.canalZ(x) - (C.bench.outer + 0.35 + N.platform * 0.4);
        } else z = t.canalZ(x) - (C.floorHalf || 0.8) * 0.4;
        posture = 'prone';
        break;
      }
      case 1:
        yaw = sp.yaw ?? 0;
        break;
      case 2:
        z = this.bermTop(x);
        posture = 'stand';
        break;
      case 3: {
        // 장갑차 옆(트인 옆구리). 날아간 포탑·잔해가 눈앞을 막지 않는 첫 후보 자리를 고른다
        const a = MAP.apc;
        [x, z] = this.clearSpot(a.x, a.z, CONFIG.debug.viewPoints.apcOffsets);
        posture = 'stand';
        break;
      }
      case 4:
        z = t.canalZ(x) + 6;
        yaw = Math.PI;
        posture = 'stand';
        break;
      case 5:
        yaw = sp.yaw ?? 0;
        ads = true;
        break;
      default:
        return;
    }
    this.index = i;
    p.pos.set(x, g.world.collision.groundHeight(x, z, t.heightAt(x, z) + 0.6), z);
    p.lastInside.copy(p.pos);
    p.vel.set(0, 0, 0);
    p.vy = 0;
    p.yaw = yaw;
    p.pitch = 0;
    p.lean = 0;
    p.posture = posture;
    p.transFrom = posture;
    p.transT = 1;
    p.eyeHeight = undefined;
    p.forceAds = ads;
    p.ads = ads ? 1 : 0;
    p.updateCamera(0);
    p.updateBody(0);
    // 총 거치 표시('거치')를 새 자리 기준으로 (정지 상태에서는 Player.update 가 돌지 않아 이전 자리 값이 남는다)
    p.speedClass = 'still';
    p.updateRest();
    g.events.emit(EV.PLAYER_POSTURE, { posture });
    g.events.emit(EV.MESSAGE, { text: `점검 시점 ${VIEWPOINT_NAMES[i]}`, kind: 'info' });
  }
}

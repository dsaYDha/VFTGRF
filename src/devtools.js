// 개발·자동 테스트용 도구 (게임 플레이에는 영향 없음). 콘솔에서 __test.* 로 사용
import * as THREE from 'three';

export function installDevTools(game) {
  const T = {
    // 렌더 없이 시뮬레이션만 진행 (초)
    simulate(seconds, dt = 1 / 60, opts = {}) {
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) {
        if (game.state !== 'playing') break;
        if (opts.aim) T.aimAt(...opts.aim);
        if (opts.fire) game.input.buttons.left = (i % opts.fire.every) < (opts.fire.hold || 1);
        game.stepSim(dt);
        if (opts.effects) game.effects.update(dt);
        game.input.endFrame();
      }
      game.input.buttons.left = false;
      return T.summary();
    },
    // 플레이어가 월드 좌표를 겨누게 (가늠자 거리 보정은 무기 쪽에서)
    aimAt(x, y, z) {
      const p = game.player;
      const e = p.eye;
      const dx = x - e.x;
      const dy = y - e.y;
      const dz = z - e.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      p.recoilPitch = 0;
      p.recoilYaw = 0;
      p.updateCamera(0);
      return [p.yaw, p.pitch];
    },
    enemy(i) {
      return game.director.ais[i];
    },
    summary() {
      return {
        time: +game.time.toFixed(1),
        state: game.state,
        mission: { ...game.mission.stats, advances: game.mission.advances },
        player: { sup: +game.player.body.suppression.value.toFixed(1), hp: game.player.body.damage.state, rounds: game.player.weapon.totalRounds() },
        ais: game.director.ais.map((a) => ({
          n: a.s.name,
          st: a.state,
          node: a.node ? a.node.id : null,
          sup: +a.s.suppression.value.toFixed(0),
          lvl: a.s.suppression.level,
          alive: a.s.alive,
          est: a.perception.source,
          sig: +a.perception.effectiveSigma().toFixed(1),
          pos: [a.pos.x, a.pos.y, a.pos.z].map((v) => +v.toFixed(1)),
        })),
        plan: game.director.plan ? { ai: game.director.plan.ai.s.name, to: game.director.plan.to.id, st: game.director.plan.state } : null,
      };
    },
    THREE,
  };
  window.__test = T;
  return T;
}

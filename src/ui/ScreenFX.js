// 플레이어가 제압당할 때 (간이형): 파열음(오디오), 짧은 화면 흔들림, 조준 흔들림 증가(Player),
// 화면 가장자리 어두워짐. 피격 시 붉은 번쩍임, 쓰러짐·전투 불능 시 암전.
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { damp } from '../core/mathUtils.js';

export class ScreenFX {
  constructor(game) {
    this.game = game;
    this.vignette = document.getElementById('fx-vignette');
    this.flash = document.getElementById('fx-flash');
    this.blackout = document.getElementById('fx-blackout');
    this.vig = 0;
    this.flashA = 0;
    this.black = 0;
    const ev = game.events;
    ev.on(EV.UNIT_SUPPRESSED, (e) => {
      if (e.unit !== game.player.body) return;
      const H = CONFIG.hud;
      const near = e.distance < 1.6 || e.impactDist < 2.5;
      game.player.addShake((near ? H.shakeNearMiss : H.shakeImpact) * Math.min(2, e.amount / 12));
    });
    ev.on(EV.UNIT_HIT, (e) => {
      if (e.unit !== game.player.body) return;
      this.flashA = e.result === 'plate' ? 0.5 : 0.9;
      game.player.addShake(0.03);
    });
  }

  reset() {
    this.vig = 0;
    this.flashA = 0;
    this.black = 0;
    this.apply();
  }

  update(dt) {
    const pl = this.game.player;
    const sup = pl.body.suppression.value / 100;
    const target = Math.min(1, sup * 1.1 + pl.breath * 0.15) * CONFIG.hud.vignetteMax;
    this.vig = damp(this.vig, target, 4, dt);
    this.flashA = Math.max(0, this.flashA - dt * 1.2);
    const dmg = pl.body.damage;
    let b = 0;
    if (dmg.incapacitated) b = 0.92;
    else if (dmg.isKnockedDown(this.game.time)) b = 0.55 + 0.25 * Math.sin(this.game.time * 3);
    this.black = damp(this.black, b, dmg.incapacitated ? 1.2 : 4, dt);
    this.apply();
  }

  apply() {
    this.vignette.style.opacity = this.vig.toFixed(3);
    this.flash.style.opacity = this.flashA.toFixed(3);
    this.blackout.style.opacity = this.black.toFixed(3);
  }
}

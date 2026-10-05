// 피해 모델 (플레이어·적 공통). 자동 회복 없음.
//  머리·목, 방탄판 밖 몸통: 1발 전투 불능 / 방탄판: 관통 안 됨, 몇 초 쓰러짐
//  팔다리: 1발 부상, 부상 상태에서 또 맞으면 전투 불능
import { CONFIG } from '../config.js';
import { randRange } from '../core/Random.js';

export class DamageModel {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 'ok'; // ok | wounded | incapacitated
    this.wounded = false;
    this.woundZone = null;
    this.knockdownUntil = 0;
    this.hitCount = 0;
  }

  get incapacitated() {
    return this.state === 'incapacitated';
  }

  isKnockedDown(now) {
    return now < this.knockdownUntil;
  }

  // 반환: 'plate' | 'wounded' | 'incapacitated' | 'none'
  applyHit(zone, plate, now) {
    if (this.state === 'incapacitated') return 'none';
    this.hitCount++;
    if (plate) {
      this.knockdownUntil = now + randRange(CONFIG.damage.plateKnockdown);
      return 'plate';
    }
    if (zone === 'head' || zone === 'torso' || this.wounded) {
      this.state = 'incapacitated';
      return 'incapacitated';
    }
    this.wounded = true;
    this.woundZone = zone;
    this.state = 'wounded';
    return 'wounded';
  }
}

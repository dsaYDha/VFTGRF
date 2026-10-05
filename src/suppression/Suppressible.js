// 병사 한 명의 제압 수치 (0~100) 와 단계
import { CONFIG } from '../config.js';

export const LEVEL = { NORMAL: 0, PRESSURED: 1, SUPPRESSED: 2, PINNED: 3 };
export const LEVEL_NAMES = ['정상', '압박', '제압', '고착'];

export class Suppressible {
  constructor(resilience = 1) {
    this.resilience = resilience;
    this.reset();
  }

  reset() {
    this.value = 0;
    this.level = 0;
    this.lastInputTime = -999;
    this.recent = [];
    this.totalInput = 0;
  }

  static levelFor(v) {
    const T = CONFIG.suppression.thresholds;
    if (v >= T.pinned) return LEVEL.PINNED;
    if (v >= T.suppressed) return LEVEL.SUPPRESSED;
    if (v >= T.pressured) return LEVEL.PRESSURED;
    return LEVEL.NORMAL;
  }

  // 같은 대상에 짧은 시간 안에 연달아 들어오는 탄은 효과 감소
  repeatMultiplier(now) {
    const S = CONFIG.suppression;
    let n = 0;
    for (const t of this.recent) if (now - t <= S.repeatWindow) n++;
    return S.repeatMuls[Math.min(n, S.repeatMuls.length - 1)];
  }

  // amount: 이미 배수가 적용된 최종 증가량. 반환: 이전 단계
  add(amount, now, countAsNew = true) {
    const S = CONFIG.suppression;
    const prev = this.level;
    this.value = Math.min(S.max, this.value + amount);
    this.totalInput += amount;
    this.lastInputTime = now;
    if (countAsNew) {
      this.recent.push(now);
      if (this.recent.length > 6) this.recent.shift();
    }
    this.level = Suppressible.levelFor(this.value);
    return prev;
  }

  // 반환: 단계가 바뀌었으면 이전 단계, 아니면 -1
  update(dt, now) {
    const S = CONFIG.suppression;
    if (now - this.lastInputTime > S.holdTime && this.value > 0) {
      this.value = Math.max(0, this.value - S.decayPerSec * dt);
    }
    const lv = Suppressible.levelFor(this.value);
    if (lv !== this.level) {
      const prev = this.level;
      this.level = lv;
      return prev;
    }
    return -1;
  }

  timeSinceInput(now) {
    return now - this.lastInputTime;
  }
}

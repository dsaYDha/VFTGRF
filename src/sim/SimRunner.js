// =============================================================================
// 시뮬레이션 모드 — 렌더 없이 임무를 N번 돌려 성공률·평균 손실·평균 시간을 낸다 (2단계 밸런스 확인)
//  브라우저: 주소에 ?sim=20&bot=good (bot: good | random | none, mission: advance | hold) 또는
//           브리핑 화면에서 F8 (약진 엄호, 숙련 봇 10회), 콘솔 __sim(횟수, 'good').
//  Node: 같은 함수를 헤드리스 하네스에서 부른다 (game.stepSim / game.startSimRun 만 있으면 된다).
// =============================================================================
import { AutoBot } from './AutoBot.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function runSimulations(game, opts = {}) {
  const o = { runs: 10, bot: 'good', mission: 'advance', dt: 1 / 30, onProgress: null, maxTime: 900, ...opts };
  const realInput = game.input;
  const bot = new AutoBot(game, o.bot);
  game.input = bot.input;
  game.simMode = true;
  const results = [];
  const t0 = Date.now();
  try {
    for (let i = 0; i < o.runs; i++) {
      game.startSimRun(o.mission);
      bot.reset();
      let steps = 0;
      while (game.state === 'playing' && game.time < o.maxTime) {
        bot.update(o.dt);
        game.stepSim(o.dt);
        bot.input.endFrame();
        if (++steps % 1800 === 0) await tick();
      }
      const r = game.mission.result || { success: false, reason: '시간 초과(시뮬레이션)', time: game.time };
      results.push({ ...r, bot: { ...bot.stats } });
      if (o.onProgress) o.onProgress(i + 1, o.runs, r);
    }
  } finally {
    bot.dispose();
    game.input = realInput;
    game.simMode = false;
  }
  const summary = summarize(results, o);
  summary.wallSeconds = (Date.now() - t0) / 1000;
  return summary;
}

const avg = (list, f) => (list.length ? list.reduce((s, r) => s + (f(r) || 0), 0) / list.length : 0);

export function summarize(results, o = {}) {
  const ok = results.filter((r) => r.success);
  const reasons = {};
  for (const r of results) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  return {
    mission: o.mission,
    bot: o.bot,
    runs: results.length,
    successRate: results.length ? ok.length / results.length : 0,
    avgLosses: avg(results, (r) => r.losses),
    avgMobileLosses: avg(results, (r) => r.mobileLosses),
    avgTime: avg(results, (r) => r.time),
    avgTimeSuccess: avg(ok, (r) => r.time),
    avgThreatRate: avg(results, (r) => r.threatRate),
    avgBounds: avg(results, (r) => r.bounds),
    avgGBlocked: avg(results, (r) => r.gBlocked),
    avgShots: avg(results, (r) => r.shotsFired),
    avgNearRatio: avg(results, (r) => r.nearRatio),
    avgNearFriend: avg(results, (r) => r.playerNearFriend),
    avgFriendlyHits: avg(results, (r) => r.friendlyHitsByPlayer),
    avgCoverHits: avg(results, (r) => r.coverTeamHits),
    reasons,
    results,
  };
}

export function formatSummary(s) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const mm = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  const lines = [
    `시뮬레이션 ${s.runs}회 · 임무 ${s.mission} · 봇 ${s.bot}`,
    `성공률 ${pct(s.successRate)} · 평균 손실 ${s.avgLosses.toFixed(2)}명 (기동조 ${s.avgMobileLosses.toFixed(2)}) · 평균 시간 ${mm(s.avgTime)} (성공 ${mm(s.avgTimeSuccess)})`,
    `위협 제압률 ${pct(s.avgThreatRate)} · 약진 ${s.avgBounds.toFixed(1)}회 · 막힌 G ${s.avgGBlocked.toFixed(1)} · 사격 ${s.avgShots.toFixed(0)}발 · 근접탄 ${pct(s.avgNearRatio)}`,
    `아군 근처 탄 ${s.avgNearFriend.toFixed(1)} · 아군 오사 ${s.avgFriendlyHits.toFixed(2)} · 엄호조 피격 ${s.avgCoverHits.toFixed(2)}`,
    `결과: ${Object.entries(s.reasons)
      .map(([k, v]) => `${k} ×${v}`)
      .join(' / ')}`,
  ];
  if (s.wallSeconds) lines.push(`(실행 ${s.wallSeconds.toFixed(0)}초)`);
  return lines.join('\n');
}

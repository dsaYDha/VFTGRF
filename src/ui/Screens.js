// 로딩·브리핑·일시정지·결과 화면
import { CONFIG } from '../config.js';

const KEYS = [
  ['W A S D', '이동'],
  ['Shift', '달리기 (스태미나)'],
  ['C', '앉기 / 서기'],
  ['Z', '엎드리기 / 서기'],
  ['Q / E', '몸 기울이기 (누르는 동안)'],
  ['좌클릭', '사격'],
  ['우클릭', '가늠자 조준 (누르는 동안)'],
  ['R', '재장전'],
  ['B', '단발 / 연발 전환'],
  ['마우스 휠', '가늠자 거리 100~600m'],
  ['T', '잔탄 확인'],
  ['F3', '디버그 / 성능 표시'],
  ['F4', '점검 시점 (디버그 중)'],
  ['Esc', '일시정지'],
];

function keysHtml() {
  return `<div class="keys">${KEYS.map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('')}</div>`;
}

// 그래픽 품질 선택 칸 (CONFIG.quality.presets: 낮음 / 보통 / 높음) — 누르면 바로 적용 (Game.setQuality)
function qualityHtml() {
  const btns = Object.entries(CONFIG.quality.presets)
    .map(([k, p]) => `<div class="btn" data-quality="${k}" style="margin:0 5px;padding:6px 26px;font-size:15px">${p.label}</div>`)
    .join('');
  return `<div class="quality-select" style="text-align:center;cursor:default">
      <h2 style="text-align:left">그래픽 품질</h2>
      <div>${btns}</div>
      <div class="sub" data-quality-note style="margin-top:8px;min-height:2.9em;line-height:1.45"></div>
    </div>`;
}

export class Screens {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.loading = $('screen-loading');
    this.loadingText = $('loading-text');
    this.loadingFill = $('loading-fill');
    this.briefing = $('screen-briefing');
    this.pause = $('screen-pause');
    this.result = $('screen-result');
    this.buildBriefing();
    this.buildPause();
    this.bindQuality(this.briefing);
    this.bindQuality(this.pause);
    this.bindVolume();
  }

  // 전체 볼륨 슬라이더 (일시정지 메뉴). 이 칸 안의 클릭·드래그로 게임이 다시 시작되지 않게 막는다
  bindVolume() {
    const box = this.pause.querySelector('.volume-select');
    const slider = document.getElementById('vol-slider');
    for (const type of ['click', 'pointerdown', 'mousedown']) box.addEventListener(type, (e) => e.stopPropagation());
    slider.addEventListener('input', () => {
      if (this.game.audio) this.game.audio.setVolume(slider.value / 100);
      this.refreshVolume();
    });
    // 화면(Screens)이 오디오보다 먼저 만들어지므로 처음 값은 일시정지 화면을 열 때 채운다 (showPause)
  }

  refreshVolume() {
    const a = this.game.audio;
    const slider = document.getElementById('vol-slider');
    if (!slider || !a) return;
    const pct = Math.round(a.volume * 100);
    if (+slider.value !== pct) slider.value = String(pct);
    document.getElementById('vol-value').textContent = `${pct}%`;
    const st = a.status();
    const STATE = { running: '켜짐', suspended: '일시정지 중 (계속하면 다시 켜짐)', interrupted: '다른 앱이 사용 중', closed: '닫힘' };
    document.getElementById('audio-status').textContent = `오디오: ${STATE[st.state] || st.state}${st.sampleRate ? ` · ${st.sampleRate}Hz` : ''}`;
  }

  // 그래픽 품질 버튼: 누르면 바로 적용하고 선택 표시·설명을 갱신한다.
  // 일시정지 화면은 아무 곳이나 클릭하면 계속하므로, 이 칸 안의 클릭은 위로 올려 보내지 않는다 (게임이 다시 시작되지 않게)
  bindQuality(screen) {
    const box = screen.querySelector('.quality-select');
    if (!box) return;
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-quality]');
      if (b && b.dataset.quality !== this.game.quality) this.game.setQuality(b.dataset.quality);
      this.refreshQuality();
    });
    this.refreshQuality();
  }

  refreshQuality() {
    const name = this.game.quality;
    for (const b of document.querySelectorAll('[data-quality]')) {
      const on = b.dataset.quality === name;
      b.style.background = on ? '#8c8152' : '';
      b.style.borderColor = on ? '#e0d09a' : '';
      b.style.color = on ? '#fffbe8' : '';
    }
    const P = CONFIG.quality.presets[name];
    if (!P) return;
    let note =
      `식생 밀도 ${Math.round(P.vegetationDensity * 100)}% · 식생 거리 ×${P.vegetationLod} · 그림자 ${P.shadows ? P.shadowMapSize : '끔'} · ` +
      `지형 고해상도 ${P.terrainLod}m · 원경 ${(P.distantRange / 1000).toFixed(1)}km · 해상도 상한 ×${P.pixelRatioMax} · 안티앨리어싱 ${P.antialias ? '켬' : '끔'}`;
    if (this.game.qualityNeedsReload()) note += '<br><span style="color:#e8c070">안티앨리어싱은 페이지를 새로 고치면(F5) 적용됩니다. 나머지는 바로 적용되었습니다.</span>';
    for (const el of document.querySelectorAll('[data-quality-note]')) el.innerHTML = note;
  }

  setLoading(text, frac) {
    this.loadingText.textContent = text;
    this.loadingFill.style.width = `${Math.round(frac * 100)}%`;
  }

  hideAll() {
    for (const s of [this.loading, this.briefing, this.pause, this.result]) s.classList.add('hidden');
  }

  buildBriefing() {
    const M = CONFIG.mission;
    const W = CONFIG.weapons.ak545;
    this.briefing.innerHTML = `
      <div class="panel">
        <h1>이동 저지</h1>
        <div class="sub">1단계 테스트 임무 · 늦가을, 동부 스텝의 폐허가 된 집단농장 · 시정 약 600m</div>
        <div class="brief">적은 집단농장 축사와 그 앞 참호에 있다. 놈들이 개활지를 건너오지 못하게 ${Math.round(M.duration / 60)}분간 묶어둬라.</div>
        <h2>상황</h2>
        <ul>
          <li>아군은 남쪽 관개수로(깊이 약 1.2m)에 있다. 수로를 따라 옆으로 이동하며 사격 위치를 바꿀 수 있다.</li>
          <li>북쪽 약 200m: 지그재그 참호선과 엄체호, 그 뒤로 지붕이 무너진 벽돌 축사와 곡물 저장탑.</li>
          <li><b>진출선</b>은 개활지 한가운데 <b>파괴된 장갑차와 트랙터 잔해</b>를 잇는 선(약 100m 전방)이다.
            적이 그 엄폐물에 ${M.maxAdvances}번 도달하면 임무 실패다.</li>
          <li>식별: 아군은 팔·다리에 <span style="color:#3fd0c0">청록색 테이프</span>, 적은 <span style="color:#f0904a">주황색 테이프</span>.</li>
        </ul>
        <h2>요령</h2>
        <ul>
          <li>적은 거의 보이지 않는다. <b>총구 화염, 총성(방향·시간차), 탄 파열음, 흙먼지</b>로 위치를 추정하라.</li>
          <li>맞히지 못해도 된다. 적이 있는 곳 근처에 탄이 지나가거나 떨어지면 고개를 들지 못한다.
            <b>2~3초마다 한두 발씩</b> 구역에 꾸준히 넣어 제압을 유지하라. 적이 없는 곳에 쏜 탄은 낭비다.</li>
          <li>적 사격이 갑자기 늘면 누군가 움직이려는 것이다. 그 순간을 노려라.</li>
          <li>탄약은 30발 탄창 ${W.spareMags + 1}개뿐이다. 탄창 마지막 ${W.tracerLastRounds}발은 예광탄이다.</li>
          <li>사살은 평가하지 않는다. 쓰러뜨려도 증원이 온다.</li>
        </ul>
        <h2>조작</h2>
        ${keysHtml()}
        ${qualityHtml()}
        <div style="text-align:center"><div class="btn" id="btn-start">작전 개시</div></div>
        <div class="sub" style="text-align:center;margin-top:8px">클릭하면 마우스가 화면에 고정됩니다 (Esc 로 해제). 소리를 켜 두세요.</div>
      </div>`;
  }

  buildPause() {
    this.pause.innerHTML = `
      <div class="panel" style="width:min(660px,92vw);text-align:center">
        <h1>일시정지</h1>
        <div class="sub">빈 곳을 클릭하면 계속합니다</div>
        <div style="text-align:left;margin-top:14px">${keysHtml()}</div>
        ${qualityHtml()}
        <div class="volume-select" style="cursor:default;margin:6px 0 14px">
          <h2 style="text-align:left">소리</h2>
          <label for="vol-slider" style="display:flex;align-items:center;justify-content:center;gap:12px">
            전체 볼륨
            <input type="range" id="vol-slider" min="0" max="100" step="1" style="width:min(280px,50vw);accent-color:#c8b878">
            <span id="vol-value" style="min-width:3.2em;text-align:right;font-variant-numeric:tabular-nums"></span>
          </label>
          <div class="sub" id="audio-status" style="margin-top:6px"></div>
        </div>
        <div class="btn" id="btn-resume">계속</div>
        <div class="btn" id="btn-restart-pause" style="margin-left:10px;background:#4a4840">처음부터</div>
      </div>`;
  }

  showBriefing(onStart) {
    this.hideAll();
    this.refreshQuality();
    this.briefing.classList.remove('hidden');
    document.getElementById('btn-start').onclick = onStart;
  }

  showPause(onResume, onRestart) {
    this.refreshQuality();
    this.refreshVolume();
    this.pause.classList.remove('hidden');
    document.getElementById('btn-restart-pause').onclick = (e) => {
      e.stopPropagation();
      onRestart();
    };
    // 화면 아무 곳이나 클릭하면 계속
    this.pause.onclick = () => onResume();
  }

  hidePause() {
    this.pause.classList.add('hidden');
  }

  showResult(r, onRestart) {
    const pct = (v) => `${Math.round(v * 100)}%`;
    const t = Math.round(r.time);
    this.result.innerHTML = `
      <div class="panel" style="width:min(620px,92vw)">
        <div class="result-banner ${r.success ? 'ok' : 'fail'}">${r.success ? '임무 성공' : '임무 실패'}</div>
        <div class="sub">${r.reason} · 경과 ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</div>
        <table class="result-table">
          <tr><td>평균 제압 유지율 <span class="sub">(살아 있는 적이 '압박' 이상이었던 시간 비율)</span></td><td>${pct(r.uptime)}</td></tr>
          <tr><td>적 이동 시도 / 저지</td><td>${r.attempts}회 / ${r.blocked}회</td></tr>
          <tr><td class="sub">&nbsp;&nbsp;저지 내역: 출발 포기 ${r.deterred} · 이동 중 고착 ${r.stopped}</td><td></td></tr>
          <tr><td>적 진출</td><td>${r.advances} / ${CONFIG.mission.maxAdvances}</td></tr>
          <tr><td>사용 탄약</td><td>${r.shotsFired}발 (탄창 ${r.magsUsed.toFixed(1)}개 분량)</td></tr>
          <tr><td>근접탄 비율 <span class="sub">(적 3m 이내를 지나거나 떨어진 탄)</span></td><td>${pct(r.nearRatio)}</td></tr>
          <tr><td>피격 횟수</td><td>${r.hitsTaken}</td></tr>
        </table>
        <div class="result-kills">참고: 사살 ${r.kills}</div>
        <div style="text-align:center"><div class="btn" id="btn-restart">다시 하기</div></div>
      </div>`;
    this.result.classList.remove('hidden');
    document.getElementById('btn-restart').onclick = onRestart;
  }
}

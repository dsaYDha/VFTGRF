// =============================================================================
// SquadPanel — 2단계: Tab 을 누르는 동안 분대 상태 (이름·조·방위·거리·상태·탄약) +
// 아군 머리 위 반투명 표지 (Tab 을 뗀 뒤에도 markerTime 초 동안). 평소에는 아군 표시가 없다.
// =============================================================================
import * as THREE from 'three';
import './squad.css';

const _v = new THREE.Vector3();
const REASON_TEXT = { threat: '적 사격이 아직 살아 있다', suppressed: '조원이 묶였다', near: '조원 옆에 탄이 떨어진다', gap: '자리 잡는 중' };

export class SquadPanel {
  constructor(game) {
    this.game = game;
    this.panel = document.createElement('div');
    this.panel.id = 'squad-panel';
    this.panel.className = 'hidden';
    this.markersEl = document.createElement('div');
    this.markersEl.id = 'squad-markers';
    document.body.appendChild(this.markersEl);
    document.body.appendChild(this.panel);
    this.markers = new Map();
    this.timer = 0;
  }

  hide() {
    this.panel.classList.add('hidden');
    this.markersEl.style.display = 'none';
  }

  update(dt) {
    const g = this.game;
    const sq = g.squad;
    if (!sq || !sq.active || g.state !== 'playing') return this.hide();
    const held = g.input.isDown('Tab') && g.player.alive;
    const showMarkers = g.time < sq.markersUntil || held;
    this.markersEl.style.display = showMarkers ? '' : 'none';
    if (showMarkers) this.updateMarkers();
    this.panel.classList.toggle('hidden', !held);
    if (!held) return;
    // 표는 0.25초마다 다시 쓴다
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const rows = sq.memberRows();
    const cls = (r) => (!r.m.alive ? 'st-dead' : r.m.moving ? 'st-move' : /고착|제압|쓰러짐|부상/.test(r.status) ? 'st-bad' : '');
    let note = '';
    if (sq.bound) note = `${sq.bound.team}조 약진 중 → ${sq.nodes[sq.bound.toId].name}`;
    else if (sq.halted) note = '정지 (H) — 다음 약진 보류 중. G 로 요청하거나 H 로 재개';
    else if (sq.block && sq.block.plan) {
      const p = sq.block.plan;
      const r = sq.block.reasons.find((x) => x.type !== 'gap') || sq.block.reasons[0];
      note = `다음: ${p.team}조 → ${sq.nodes[p.toId].name}${r ? ` · ${REASON_TEXT[r.type]}` : ' · 곧 출발'}`;
    }
    if (sq.designation) note += `${note ? '<br>' : ''}표적 지시 남은 ${Math.ceil(sq.designation.until - g.time)}초`;
    this.panel.innerHTML = `<h3>분대 상태</h3><table><tr><th>이름</th><th>조</th><th>방위</th><th>거리</th><th>상태</th><th>탄약</th></tr>${rows
      .map(
        (r) =>
          `<tr><td>${r.name}</td><td>${r.team}</td><td>${r.bearing}</td><td>${r.range}m</td><td class="${cls(r)}">${r.status}</td><td>${r.m.alive ? `${r.rounds}발 · 탄창 ${r.mags}` : '-'}</td></tr>`,
      )
      .join('')}</table>${note ? `<div class="sq-note">${note}</div>` : ''}`;
  }

  updateMarkers() {
    const g = this.game;
    const cam = g.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const m of g.squad.members) {
      let el = this.markers.get(m);
      if (!el) {
        el = document.createElement('div');
        el.className = 'sq-marker';
        this.markersEl.appendChild(el);
        this.markers.set(m, el);
      }
      m.s.getHeadPos(_v);
      _v.y += 0.45;
      _v.project(cam);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.left = `${((_v.x + 1) / 2) * W}px`;
      el.style.top = `${((1 - _v.y) / 2) * H}px`;
      const bad = !m.alive || m.wounded || m.level >= 2;
      el.classList.toggle('down', bad);
      const txt = m.alive ? m.callName : `${m.callName} ✕`;
      if (el.textContent !== txt) el.textContent = txt;
    }
  }
}

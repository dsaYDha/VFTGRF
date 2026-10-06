// =============================================================================
// DebugOverlay (F3) — 적 위치와 제압 막대·상태, 적이 기억하는 플레이어 추정 위치,
// 사격 위치 후보, 탄도 궤적 선, 성능 측정. 기본 꺼짐.
// F3 을 누를 때마다 끔 → 전체 → 성능만 → 끔. '성능만' 은 디버그 표시(마커·이름표·궤적 선)를 그리지 않아
// 실제 게임 화면 그대로의 FPS·프레임 시간·draw call·삼각형 수를 잰다 (사용자 PC 에서 측정·보고용).
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { MAP } from '../world/mapData.js';
import { STATE_NAMES } from '../ai/EnemyAI.js';

const LEVEL_COLORS = ['#7fd06a', '#e8d250', '#f09a40', '#f05a4a'];
const MODES = ['off', 'full', 'perf'];
const MODE_NAMES = { full: '전체', perf: '성능만' };
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _size = new THREE.Vector2();

export class DebugOverlay {
  constructor(game) {
    this.game = game;
    this.mode = CONFIG.debug.startEnabled ? 'full' : 'off';
    this.enabled = this.mode !== 'off';
    this.root = document.getElementById('debug-overlay');
    this.panel = document.getElementById('debug-panel');
    this.labelsEl = document.getElementById('debug-labels');
    this.labels = new Map();
    this.fps = 60;
    this.frameMs = 16;
    // 성능 측정 창 (1초): 프레임 수·시간·가장 긴 프레임, draw call·삼각형 수 범위. out = 직전 1초 결과
    this.perf = { t: 0, n: 0, worst: 0, cMin: Infinity, cMax: 0, tMin: Infinity, tMax: 0, out: null };
    this.gpu = null;
    this.group = new THREE.Group();
    this.group.name = 'debug';
    this.group.visible = false;
    game.scene.add(this.group);
    const noDepth = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85, fog: false, ...opts });
    this.matEnemy = noDepth(0xff5040, { wireframe: true });
    this.matEstimate = noDepth(0xff2020);
    this.matFpFree = noDepth(0x8a8a8a, { opacity: 0.6 });
    this.matFpUsed = noDepth(0xffa030);
    this.enemyGeo = new THREE.BoxGeometry(0.7, 1.8, 0.7);
    // 추정 위치: 가운데 작은 구 + 지면 고리 (반지름 = 오차). 예전처럼 오차만큼 큰 구를 그리면 추정이 맞을 때
    // 구가 내 눈앞에 와서 화면을 덮으므로, 오차는 땅 위 고리 선으로만 보이고 가까운 구는 숨긴다
    const E = CONFIG.debug.estimate;
    this.estGeo = new THREE.SphereGeometry(E.marker, 10, 8);
    this.fpGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.06, 12);
    this.enemyMeshes = [];
    this.estMeshes = [];
    // 사격 위치 후보
    this.fpMeshes = [];
    for (const node of Object.values(game.director.nav.nodes)) {
      for (const fp of node.fps) {
        const m = new THREE.Mesh(this.fpGeo, this.matFpFree);
        m.position.copy(fp.firePos).y += 0.05;
        m.renderOrder = 10;
        m.userData.fp = fp;
        this.group.add(m);
        this.fpMeshes.push(m);
      }
    }
    // 진출선, 경유점 그래프
    const t = game.world.terrain;
    const lines = [];
    const [a, b] = [MAP.advanceLine.a, MAP.advanceLine.b];
    lines.push(a[0], t.heightAt(a[0], a[1]) + 0.3, a[1], b[0], t.heightAt(b[0], b[1]) + 0.3, b[1]);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffff40, depthTest: false, fog: false })));
    const g2 = [];
    for (const pts of Object.values(game.director.nav.edges)) {
      for (let i = 0; i < pts.length - 1; i++) g2.push(pts[i].x, pts[i].y + 0.2, pts[i].z, pts[i + 1].x, pts[i + 1].y + 0.2, pts[i + 1].z);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(g2, 3));
    this.group.add(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x40c0ff, depthTest: false, fog: false, transparent: true, opacity: 0.5 })));
    // 추정 위치 연결선
    this.estLineGeo = new THREE.BufferGeometry();
    this.estLinePos = new Float32Array(16 * 6);
    this.estLineGeo.setAttribute('position', new THREE.BufferAttribute(this.estLinePos, 3));
    this.estLines = new THREE.LineSegments(this.estLineGeo, new THREE.LineBasicMaterial({ color: 0xff4040, depthTest: false, fog: false, transparent: true, opacity: 0.6 }));
    this.group.add(this.estLines);
    // 추정 오차 고리 (적 16명분을 선분 하나로, 드로우콜 1)
    this.ringCos = [];
    this.ringSin = [];
    for (let i = 0; i <= E.ringSegments; i++) {
      this.ringCos.push(Math.cos((i / E.ringSegments) * Math.PI * 2));
      this.ringSin.push(Math.sin((i / E.ringSegments) * Math.PI * 2));
    }
    this.ringGeo = new THREE.BufferGeometry();
    this.ringPos = new Float32Array(16 * E.ringSegments * 6);
    this.ringGeo.setAttribute('position', new THREE.BufferAttribute(this.ringPos, 3));
    this.estRings = new THREE.LineSegments(this.ringGeo, new THREE.LineBasicMaterial({ color: 0xff3a30, depthTest: false, fog: false, transparent: true, opacity: 0.85 }));
    this.estRings.frustumCulled = false;
    this.estRings.renderOrder = 11;
    this.group.add(this.estRings);
    // 탄도 궤적
    this.trails = [];
    const maxPts = 60000;
    this.trailPos = new Float32Array(maxPts * 3);
    this.trailCol = new Float32Array(maxPts * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trailLines = new THREE.LineSegments(this.trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.85, depthTest: false }));
    this.trailLines.frustumCulled = false;
    this.group.add(this.trailLines);
    game.events.on(EV.BULLET_EXPIRED, (e) => {
      if (this.mode !== 'full' || e.bullet.trail.length < 6) return;
      this.trails.push({ pts: e.bullet.trail.slice(), player: e.bullet.shooter === game.player.body });
      while (this.trails.length > CONFIG.debug.bulletTrailCount) this.trails.shift();
      this.trailsDirty = true;
    });
    this.setMode(this.mode);
  }

  // 'off' | 'full' (전체 디버그) | 'perf' (성능 측정만 — 장면에 디버그 표시를 그리지 않는다)
  setMode(mode) {
    const full = mode === 'full';
    this.mode = mode;
    this.enabled = mode !== 'off';
    this.root.classList.toggle('hidden', !this.enabled);
    this.labelsEl.style.display = full ? '' : 'none';
    this.group.visible = full;
    this.game.ballistics.recordTrails = full;
    if (!full) this.trails.length = 0;
    this.trailsDirty = true;
  }

  setEnabled(v) {
    this.setMode(v ? 'full' : 'off');
  }

  // F3: 끔 → 전체 → 성능만 → 끔
  toggle() {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  reset() {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    this.trails.length = 0;
    this.trailsDirty = true;
  }

  rebuildTrails() {
    let n = 0;
    const max = this.trailPos.length / 3;
    const c = new THREE.Color();
    for (const tr of this.trails) {
      c.set(tr.player ? 0xffe040 : 0xff4030);
      const p = tr.pts;
      for (let i = 0; i + 5 < p.length && n + 2 <= max; i += 3) {
        this.trailPos.set([p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5]], n * 3);
        this.trailCol.set([c.r, c.g, c.b, c.r, c.g, c.b], n * 3);
        n += 2;
      }
    }
    this.trailGeo.setDrawRange(0, n);
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailGeo.attributes.color.needsUpdate = true;
    this.trailsDirty = false;
  }

  // 직전 프레임(주 장면 + 1인칭 총 + 그 프레임의 그림자 패스)의 렌더 통계를 1초 창에 모은다.
  // 그림자 맵은 render.shadowRefreshTime 간격으로만 다시 그리므로 draw call·삼각형 수는 최소~최대로 보인다
  measure(dt) {
    const p = this.perf;
    if (dt <= 0 || dt > 3) return; // 탭 전환·로딩 직후의 아주 긴 간격은 버린다 (셰이더 컴파일 끊김은 '최악'에 남긴다)
    const info = this.game.renderer.info.render;
    p.t += dt;
    p.n++;
    if (dt > p.worst) p.worst = dt;
    if (info.calls > 0) {
      p.cMin = Math.min(p.cMin, info.calls);
      p.cMax = Math.max(p.cMax, info.calls);
      p.tMin = Math.min(p.tMin, info.triangles);
      p.tMax = Math.max(p.tMax, info.triangles);
    }
    if (p.t < 1) return;
    p.out = { fps: p.n / p.t, ms: (p.t / p.n) * 1000, worst: p.worst * 1000, cMin: p.cMin, cMax: p.cMax, tMin: p.tMin, tMax: p.tMax };
    this.fps = p.out.fps;
    this.frameMs = p.out.ms;
    Object.assign(p, { t: 0, n: 0, worst: 0, cMin: Infinity, cMax: 0, tMin: Infinity, tMax: 0 });
  }

  // GPU 이름 (보고용): 브라우저가 알려 주는 렌더러 문자열
  gpuName() {
    if (this.gpu !== null) return this.gpu;
    let s = '';
    try {
      const gl = this.game.renderer.getContext();
      s = gl.getParameter(gl.RENDERER) || '';
      // Chrome 은 RENDERER 가 'WebKit WebGL' 이라 확장으로 실제 이름을 읽는다 (Firefox 는 RENDERER 가 이미 실제 이름)
      if (/^webkit webgl$/i.test(s)) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) s = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || s;
      }
    } catch {
      s = '';
    }
    this.gpu = String(s || '알 수 없음').replace(/\s+/g, ' ').slice(0, 100);
    return this.gpu;
  }

  // 성능 표시 줄 (사용자 PC 에서 측정·보고용)
  perfLines() {
    const g = this.game;
    const r = g.renderer;
    const R = CONFIG.render;
    const o = this.perf.out;
    const k = (v) => `${Math.round(v / 1000)}k`;
    const lines = [`[F3 디버그: ${MODE_NAMES[this.mode]}]  F3 → ${this.mode === 'full' ? '성능만' : '끔'}`];
    if (o) {
      lines.push(`FPS ${o.fps.toFixed(1)}  프레임 ${o.ms.toFixed(1)}ms  최악 ${o.worst.toFixed(1)}ms  (1초 평균)`);
      if (o.cMax > 0) lines.push(`draw ${o.cMin}~${o.cMax}  삼각형 ${k(o.tMin)}~${k(o.tMax)}  (큰 값 = 그림자 맵을 다시 그린 프레임)`);
    } else lines.push('FPS 측정 중…');
    r.getDrawingBufferSize(_size);
    const pr = r.getPixelRatio();
    const prMax = Math.min(window.devicePixelRatio, R.pixelRatioMax);
    const attr = r.getContextAttributes();
    const dyn = R.dynamicResolution ? (pr < prMax - 0.001 ? ', 동적 해상도로 낮춤' : ', 동적 해상도') : '';
    lines.push(
      `렌더 ${_size.x}×${_size.y}  픽셀 비율 ${pr.toFixed(2)} (상한 ${prMax.toFixed(2)}, 기기 ${window.devicePixelRatio}${dyn})  AA ${attr && attr.antialias ? '켬' : '끔'}`,
    );
    const P = CONFIG.quality.presets[g.quality];
    const V = CONFIG.vegetation;
    lines.push(
      `품질 ${P ? P.label : g.quality}  식생 ${Math.round(V.density * 100)}% 거리 ×${V.lodScale}  그림자 ${R.shadows ? R.shadowMapSize : '끔'}  ` +
        `지형 LOD ${CONFIG.terrain.mesh.lodDistance}m  원경 ${CONFIG.distant.range}m`,
    );
    lines.push(`GPU ${this.gpuName()}`);
    const au = g.audio.status();
    lines.push(`오디오 ${au.state}  재생 중 ${au.active}개  볼륨 ${Math.round(au.volume * 100)}%${au.sampleRate ? `  ${au.sampleRate}Hz` : ''}${au.ready ? '' : '  (소리 준비 전)'}`);
    return lines;
  }

  update(dt) {
    this.measure(dt);
    if (!this.enabled) return;
    if (this.mode === 'perf') {
      this.panel.textContent = this.perfLines().join('\n');
      return;
    }
    const g = this.game;
    const ais = g.director.ais;
    // 적 표시
    while (this.enemyMeshes.length < ais.length) {
      const m = new THREE.Mesh(this.enemyGeo, this.matEnemy);
      m.renderOrder = 11;
      this.group.add(m);
      this.enemyMeshes.push(m);
      const e = new THREE.Mesh(this.estGeo, this.matEstimate);
      e.renderOrder = 11;
      this.group.add(e);
      this.estMeshes.push(e);
    }
    const E = CONFIG.debug.estimate;
    const cam = g.camera.position;
    const col = g.world.collision;
    const seg = E.ringSegments;
    let li = 0;
    ais.forEach((ai, i) => {
      const m = this.enemyMeshes[i];
      const e = this.estMeshes[i];
      ai.s.getCenter(_v);
      m.position.copy(_v);
      m.visible = true;
      m.material = this.matEnemy;
      const has = ai.s.alive && ai.perception.has;
      e.visible = false;
      if (!has || li >= 16) return;
      const est = ai.perception.estimate;
      e.position.copy(est);
      // 카메라 바로 앞(추정이 내 위치와 거의 같을 때)이면 구를 숨긴다 — 고리와 연결선만 남는다
      e.visible = est.distanceTo(cam) > E.hideNear;
      ai.s.getEyePos(_w);
      this.estLinePos.set([_w.x, _w.y, _w.z, est.x, est.y, est.z], li * 6);
      // 지면 고리: 반지름 = 추정 오차 (1σ), 정점마다 지면(지형·밟을 수 있는 충돌체 윗면) 높이를 따라 휜다
      const r = Math.max(E.ringRadius[0], Math.min(E.ringRadius[1], ai.perception.effectiveSigma()));
      const P = this.ringPos;
      let o = li * seg * 6;
      let px = est.x + r;
      let pz = est.z;
      let py = col.groundHeight(px, pz, est.y + 0.3) + E.ringLift;
      for (let k = 1; k <= seg; k++) {
        const qx = est.x + this.ringCos[k] * r;
        const qz = est.z + this.ringSin[k] * r;
        const qy = col.groundHeight(qx, qz, est.y + 0.3) + E.ringLift;
        P[o++] = px;
        P[o++] = py;
        P[o++] = pz;
        P[o++] = qx;
        P[o++] = qy;
        P[o++] = qz;
        px = qx;
        py = qy;
        pz = qz;
      }
      li++;
    });
    for (let i = ais.length; i < this.enemyMeshes.length; i++) {
      this.enemyMeshes[i].visible = false;
      this.estMeshes[i].visible = false;
    }
    this.estLineGeo.setDrawRange(0, li * 2);
    this.estLineGeo.attributes.position.needsUpdate = true;
    this.ringGeo.setDrawRange(0, li * seg * 2);
    this.ringGeo.attributes.position.needsUpdate = true;
    for (const m of this.fpMeshes) m.material = m.userData.fp.occupiedBy ? this.matFpUsed : this.matFpFree;
    if (this.trailsDirty) this.rebuildTrails();
    this.updateLabels(ais);
    this.updatePanel(ais);
  }

  updateLabels(ais) {
    const cam = this.game.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const seen = new Set();
    const shown = this.shownLabels || (this.shownLabels = []);
    shown.length = 0;
    for (const ai of ais) {
      seen.add(ai);
      let el = this.labels.get(ai);
      if (!el) {
        el = document.createElement('div');
        el.className = 'dbg-label';
        el.innerHTML = `<div class="t"></div><div class="dbg-bar"><div class="dbg-bar-fill"></div>
          <div class="dbg-bar-tick" style="left:25%"></div><div class="dbg-bar-tick" style="left:50%"></div><div class="dbg-bar-tick" style="left:80%"></div></div>`;
        this.labelsEl.appendChild(el);
        this.labels.set(ai, el);
      }
      ai.s.getHeadPos(_v);
      _v.y += 0.5;
      _v.project(cam);
      if (_v.z > 1 || _v.z < -1) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      const sup = ai.s.suppression;
      const lvl = ai.s.alive ? sup.level : 0;
      const dist = Math.round(ai.pos.distanceTo(this.game.player.pos));
      const st = STATE_NAMES[ai.state] || ai.state;
      const cov = ai.covering ? ' · 엄호' : '';
      el.firstElementChild.textContent = `${ai.s.name} [${ai.statusName()}] ${st}${cov} · ${dist}m`;
      const fill = el.querySelector('.dbg-bar-fill');
      fill.style.width = `${sup.value}%`;
      fill.style.background = ai.s.alive ? LEVEL_COLORS[lvl] : '#555';
      shown.push({ el, x: ((_v.x + 1) / 2) * W, y: ((1 - _v.y) / 2) * H, d: dist, w: 0, h: 0 });
    }
    for (const [ai, el] of this.labels) {
      if (!seen.has(ai)) {
        el.remove();
        this.labels.delete(ai);
      }
    }
    this.stackLabels(shown);
  }

  // 화면에서 겹치는 이름표를 위로 쌓는다 (가까운 적이 제자리, 먼 적이 위로). 밀려난 이름표는 머리까지 가는 가는 선을 단다.
  // 크기는 글자를 다 바꾼 뒤 한 번에 읽고(레이아웃 1회) 위치는 그 뒤에 쓴다
  stackLabels(items) {
    const gap = CONFIG.debug.labelGap;
    for (const it of items) {
      it.w = it.el.offsetWidth;
      it.h = it.el.offsetHeight;
    }
    items.sort((a, b) => a.d - b.d);
    const placed = [];
    for (const it of items) {
      const x0 = it.x - it.w / 2;
      const x1 = it.x + it.w / 2;
      let y = it.y; // 이름표 아래 끝 (transform: translate(-50%, -100%))
      for (let pass = 0; pass < items.length; pass++) {
        let moved = false;
        for (const p of placed) {
          if (x0 < p.x1 && x1 > p.x0 && y - it.h < p.y1 && y > p.y0) {
            y = p.y0 - gap;
            moved = true;
          }
        }
        if (!moved) break;
      }
      placed.push({ x0, x1, y0: y - it.h, y1: y });
      it.el.style.left = `${it.x}px`;
      it.el.style.top = `${y}px`;
      it.el.style.setProperty('--lead', `${Math.max(0, it.y - y)}px`);
    }
  }

  updatePanel(ais) {
    const g = this.game;
    const plan = g.director.plan;
    let planText = '없음';
    if (plan) planText = `${plan.ai.s.name} → ${plan.to.id} (${plan.state === 'pending' ? '출발 대기' : '이동 중'})`;
    else planText = `다음 시도 ${Math.max(0, g.director.nextAttempt - g.time).toFixed(0)}초 후`;
    const pl = g.player;
    const lines = [
      ...this.perfLines(),
      '',
      `탄 ${g.ballistics.active.length}  먼지 ${g.effects.dust.count}  빛 ${g.effects.glow.count}  파편 ${g.effects.debris.n}`,
      `플레이어 제압 ${pl.body.suppression.value.toFixed(0)}  스태미나 ${pl.stamina.toFixed(0)}  숨 ${pl.breath.toFixed(2)}  거치 ${pl.rested ? pl.restKind : '-'}`,
      `탄창 ${pl.weapon.mag ? pl.weapon.mag.rounds : '-'}${pl.weapon.chambered ? '+1' : ''}  예광 ${pl.weapon.chamberTracer ? 'Y' : 'n'}  총 ${pl.weapon.totalRounds()}발`,
      `이동 시도: ${planText}`,
      `미션 ${g.mission.time.toFixed(0)}s  시도 ${g.mission.stats.attempts}  저지 ${g.mission.stats.deterred + g.mission.stats.stopped}  진출 ${g.mission.advances}`,
      '',
      ...ais.map((ai) => {
        const p = ai.perception;
        return `${ai.s.name.padEnd(4)} ${String(Math.round(ai.s.suppression.value)).padStart(3)} ${ai.statusName().padEnd(4)} ${(STATE_NAMES[ai.state] || ai.state).padEnd(5)} ${ai.node ? ai.node.id : '--'}  추정:${p.source} ±${p.effectiveSigma().toFixed(1)}m${p.visible ? ' 보임' : ''}`;
      }),
    ];
    this.panel.textContent = lines.join('\n');
  }
}

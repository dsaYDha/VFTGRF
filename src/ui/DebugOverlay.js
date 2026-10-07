// =============================================================================
// DebugOverlay (F3) — 적 위치와 제압 막대·상태, 적이 기억하는 플레이어 추정 위치,
// 사격 위치 후보, 탄도 궤적 선, 성능 측정. 기본 꺼짐.
// 2단계(약진 엄호): 아군 상태·제압 막대(청록 계열), 약진 경로·다음 구간(초록 = 출발 가능, 노랑 = 대기, 빨강 = 막힘),
// 막고 있는 적에서 구간까지 빨간 선과 이유, 플레이어 사선 위험 범위(5°·3m·탄착점 30m), 아군 근처를 지난 플레이어 탄 위치.
// F3 을 누를 때마다 끔 → 전체 → 성능만 → 끔. '성능만' 은 디버그 표시(마커·이름표·궤적 선)를 그리지 않아
// 실제 게임 화면 그대로의 FPS·프레임 시간·draw call·삼각형 수를 잰다 (사용자 PC 에서 측정·보고용).
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { MAP } from '../world/mapData.js';
import { STATE_NAMES } from '../ai/EnemyAI.js';
import { FRIENDLY_STATE_NAMES } from '../ai/FriendlyAI.js';
import { TEAM_NAMES } from '../ai/SquadLeader.js';

const LEVEL_COLORS = ['#7fd06a', '#e8d250', '#f09a40', '#f05a4a'];
// 아군 제압 막대 (적과 구별되는 청록 → 파랑 → 보라 → 자홍)
const FRIEND_COLORS = ['#4fd8c8', '#46a8f0', '#8a78f0', '#d058d8'];
const REASON_NAMES = { threat: '사선이 닿는 적 미제압', suppressed: '뛸 조원 제압됨', near: '조원 3m 안 근접탄', gap: '도착 뒤 대기' };
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
    this.buildSquadDebug();
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
    this.updateSquad();
    this.updateLabels(ais);
    this.updatePanel(ais);
  }

  // ------------------------------------------------------------------ 2단계 분대
  buildSquadDebug() {
    const sq = this.game.squad;
    this.sqGroup = new THREE.Group();
    this.group.add(this.sqGroup);
    if (!sq) return;
    // 경로 그래프 (흐린 청록) + 지점 표시
    const pts = [];
    for (const n of Object.values(sq.nodes)) {
      for (const id of n.next) {
        const b = sq.nodes[id];
        pts.push(n.x, n.y + 0.35, n.z, b.x, b.y + 0.35, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.sqGroup.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3fb8b0, depthTest: false, fog: false, transparent: true, opacity: 0.55 })));
    const nodeGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.08, 14);
    const nodeMat = new THREE.MeshBasicMaterial({ color: 0x3fd0c0, depthTest: false, transparent: true, opacity: 0.6, fog: false });
    for (const n of Object.values(sq.nodes)) {
      const m = new THREE.Mesh(nodeGeo, nodeMat);
      m.position.set(n.x, n.y + 0.3, n.z);
      m.renderOrder = 10;
      this.sqGroup.add(m);
    }
    // 움직이는 선 (다음 구간·막는 적·사선 위험 범위·아군 근처 탄): 정점 색
    this.sqMax = 400;
    this.sqPos = new Float32Array(this.sqMax * 6);
    this.sqCol = new Float32Array(this.sqMax * 6);
    this.sqGeo = new THREE.BufferGeometry();
    this.sqGeo.setAttribute('position', new THREE.BufferAttribute(this.sqPos, 3));
    this.sqGeo.setAttribute('color', new THREE.BufferAttribute(this.sqCol, 3));
    this.sqLines = new THREE.LineSegments(this.sqGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, fog: false, transparent: true, opacity: 0.95 }));
    this.sqLines.frustumCulled = false;
    this.sqLines.renderOrder = 12;
    this.sqGroup.add(this.sqLines);
  }

  sqLine(ax, ay, az, bx, by, bz, c) {
    if (this.sqN >= this.sqMax) return;
    const o = this.sqN * 6;
    this.sqPos[o] = ax;
    this.sqPos[o + 1] = ay;
    this.sqPos[o + 2] = az;
    this.sqPos[o + 3] = bx;
    this.sqPos[o + 4] = by;
    this.sqPos[o + 5] = bz;
    for (let k = 0; k < 6; k += 3) {
      this.sqCol[o + k] = c[0];
      this.sqCol[o + k + 1] = c[1];
      this.sqCol[o + k + 2] = c[2];
    }
    this.sqN++;
  }

  updateSquad() {
    const g = this.game;
    const sq = g.squad;
    const on = !!(sq && sq.active);
    this.sqGroup.visible = on;
    this.squadInfo = null;
    if (!on) return;
    this.sqN = 0;
    const col = g.world.collision;
    // 다음 구간 (진행 중 약진이면 그 구간)
    const b = sq.bound;
    const ev = sq.block;
    const seg = b ? { fromId: b.fromId, toId: b.toId } : ev ? ev.plan : null;
    let segState = 'none';
    if (seg) {
      const A = sq.nodes[seg.fromId];
      const B = sq.nodes[seg.toId];
      segState = b ? 'moving' : !ev.reasons.length ? 'ok' : ev.reasons.every((r) => r.type === 'gap') ? 'gap' : 'blocked';
      const c = segState === 'moving' ? [0.3, 0.8, 1] : segState === 'ok' ? [0.3, 1, 0.3] : segState === 'gap' ? [1, 0.9, 0.2] : [1, 0.25, 0.2];
      for (const dy of [0.5, 0.6, 0.7]) this.sqLine(A.x, A.y + dy, A.z, B.x, B.y + dy, B.z, c);
      // 막는 적 → 구간 가운데
      const mx = (A.x + B.x) / 2;
      const mz = (A.z + B.z) / 2;
      const my = g.world.terrain.heightAt(mx, mz) + 1.2;
      const blockers = b ? sq.segmentThreats(b.fromId, b.toId).filter((ai) => ai.s.suppression.value < CONFIG.squad.threatMinSuppression) : sq.threats;
      for (const ai of blockers) {
        sq.enemyEye(ai, _v);
        this.sqLine(_v.x, _v.y, _v.z, mx, my, mz, [1, 0.2, 0.15]);
      }
      this.squadInfo = { seg, segState, blockers };
    }
    // 플레이어 사선 위험 범위: 시선 방향으로 탄착점까지, 좌우 5° 선과 탄착점 둘레 30m 원
    const pl = g.player;
    const S = CONFIG.squad.shiftFire;
    const R = CONFIG.squad.designateRange;
    g.camera.getWorldDirection(_w);
    const e = pl.eye;
    const hit = this.sqHit || (this.sqHit = {});
    let dist = R;
    if (col.segmentCast(e.x, e.y, e.z, e.x + _w.x * R, e.y + _w.y * R, e.z + _w.z * R, hit)) dist = hit.t * R;
    const inLine = this.membersInLine(e, _w, dist);
    const c = inLine.length ? [1, 0.2, 0.6] : [1, 0.6, 0.2];
    const hx = e.x + _w.x * dist;
    const hy = e.y + _w.y * dist;
    const hz = e.z + _w.z * dist;
    const yaw = Math.atan2(_w.x, _w.z);
    const a = (S.angleDeg * Math.PI) / 180;
    const sx = e.x + _w.x * S.minRange;
    const sz = e.z + _w.z * S.minRange;
    const sy = e.y + _w.y * S.minRange;
    for (const sgn of [-1, 1]) {
      const ex = e.x + Math.sin(yaw + sgn * a) * dist;
      const ez = e.z + Math.cos(yaw + sgn * a) * dist;
      this.sqLine(sx, sy, sz, ex, hy, ez, c);
    }
    this.sqLine(sx, sy, sz, hx, hy, hz, c);
    const terrain = g.world.terrain;
    let px = hx + S.targetDist;
    let pz = hz;
    for (let k = 1; k <= 32; k++) {
      const t = (k / 32) * Math.PI * 2;
      const qx = hx + Math.cos(t) * S.targetDist;
      const qz = hz + Math.sin(t) * S.targetDist;
      this.sqLine(px, terrain.heightAt(px, pz) + 0.4, pz, qx, terrain.heightAt(qx, qz) + 0.4, qz, c);
      px = qx;
      pz = qz;
    }
    this.lineInfo = { dist, inLine };
    // 아군 근처(3m)를 지난 플레이어 탄 (최근 12초): 자홍 별표
    for (const mk of sq.nearFriendMarks) {
      const p = mk.pos;
      this.sqLine(p.x - 0.5, p.y, p.z, p.x + 0.5, p.y, p.z, [1, 0.2, 1]);
      this.sqLine(p.x, p.y - 0.5, p.z, p.x, p.y + 0.5, p.z, [1, 0.2, 1]);
      this.sqLine(p.x, p.y, p.z - 0.5, p.x, p.y, p.z + 0.5, [1, 0.2, 1]);
    }
    this.sqGeo.setDrawRange(0, this.sqN * 2);
    this.sqGeo.attributes.position.needsUpdate = true;
    this.sqGeo.attributes.color.needsUpdate = true;
  }

  // 플레이어 시선(눈 → dir, dist 까지)의 위험 범위 안 아군 (사격 전환 규칙과 같은 판정)
  membersInLine(eye, dir, dist) {
    const S = CONFIG.squad.shiftFire;
    const tan = Math.tan((S.angleDeg * Math.PI) / 180);
    const out = [];
    const hx = eye.x + dir.x * dist;
    const hy = eye.y + dir.y * dist;
    const hz = eye.z + dir.z * dist;
    for (const m of this.game.squad.members) {
      if (!m.alive) continue;
      m.s.getChestPos(_v);
      if (dist >= S.minTargetRange && Math.hypot(_v.x - hx, _v.y - hy, _v.z - hz) < S.targetDist) {
        out.push(m);
        continue;
      }
      _v.sub(eye);
      const along = _v.dot(dir);
      if (along < S.minRange || along > dist + 5) continue;
      const perp = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      if (perp < S.lineDist || perp < along * tan) out.push(m);
    }
    return out;
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
    // 2단계 아군 (청록 이름표·막대)
    const sq = this.game.squad;
    if (sq && sq.active) {
      const blockers = this.squadInfo ? this.squadInfo.blockers : [];
      for (const ai of blockers) {
        const el = this.labels.get(ai);
        if (el && el.style.display !== 'none') el.firstElementChild.textContent += ' · 약진 막음';
      }
      for (const m of sq.members) {
        seen.add(m);
        let el = this.labels.get(m);
        if (!el) {
          el = document.createElement('div');
          el.className = 'dbg-label';
          el.style.color = '#8ff0e6';
          el.innerHTML = `<div class="t"></div><div class="dbg-bar"><div class="dbg-bar-fill"></div>
            <div class="dbg-bar-tick" style="left:25%"></div><div class="dbg-bar-tick" style="left:50%"></div><div class="dbg-bar-tick" style="left:80%"></div></div>`;
          this.labelsEl.appendChild(el);
          this.labels.set(m, el);
        }
        m.s.getHeadPos(_v);
        _v.y += 0.5;
        _v.project(cam);
        if (_v.z > 1 || _v.z < -1) {
          el.style.display = 'none';
          continue;
        }
        el.style.display = '';
        const sup = m.s.suppression;
        const lvl = m.alive ? sup.level : 0;
        const dist = Math.round(m.pos.distanceTo(this.game.player.pos));
        el.firstElementChild.textContent = `${m.callName}(${TEAM_NAMES[m.team]}) [${m.statusName()}] ${FRIENDLY_STATE_NAMES[m.state] || m.state} · ${dist}m · 탄 ${m.s.weapon.totalRounds()}`;
        const fill = el.querySelector('.dbg-bar-fill');
        fill.style.width = `${sup.value}%`;
        fill.style.background = m.alive ? FRIEND_COLORS[lvl] : '#555';
        shown.push({ el, x: ((_v.x + 1) / 2) * W, y: ((1 - _v.y) / 2) * H, d: dist, w: 0, h: 0 });
      }
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
    if (g.squad && g.squad.active) return this.updateSquadPanel(ais);
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

  enemyLine(ai) {
    const p = ai.perception;
    const tg = p.target === this.game.player ? '플레이어' : p.target.callName || '?';
    return `${ai.s.name.padEnd(4)} ${String(Math.round(ai.s.suppression.value)).padStart(3)} ${ai.statusName().padEnd(4)} ${(STATE_NAMES[ai.state] || ai.state).padEnd(5)} ${ai.node ? ai.node.id : '--'}  노림:${tg} ${p.has ? `${p.source} ±${p.effectiveSigma().toFixed(1)}m` : '모름'}${p.visible ? ' 보임' : ''}`;
  }

  updateSquadPanel(ais) {
    const g = this.game;
    const sq = g.squad;
    const m2 = g.mission;
    const st = sq.stats;
    const pl = g.player;
    const now = g.time;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const where = (team) => {
      const n = sq.nodes[sq.route[sq.teamIdx[team]]];
      const able = sq.ableOf(team).length;
      return `${TEAM_NAMES[team]} ${n ? n.id : '-'}(${able}명)`;
    };
    const lines = [
      ...this.perfLines(),
      '',
      `탄 ${g.ballistics.active.length}  플레이어 제압 ${pl.body.suppression.value.toFixed(0)}  탄창 ${pl.weapon.mag ? pl.weapon.mag.rounds : '-'}${pl.weapon.chambered ? '+1' : ''}  총 ${pl.weapon.totalRounds()}발  상자 ${g.ammoCrate ? g.ammoCrate.rounds : '-'}`,
      `임무 ${m2.time.toFixed(0)}s / ${CONFIG.advanceMission.timeLimit}  돌격 대기 ${m2.holdTime.toFixed(0)}s  경로 ${sq.route.join('→')}`,
      `분대: ${where(1)} · ${where(2)}${sq.halted ? ' · 정지(H)' : ''} · 약진 ${st.bounds}회 (G ${st.bounds - st.autoBounds}) · G 요청 ${st.gRequests} (막힘 ${st.gBlocked})`,
      `위협 제압률 ${st.threatTime > 0 ? pct(st.threatSuppressedTime / st.threatTime) : '-'} (약진 중 ${st.threatTime.toFixed(0)}s)  손실 ${st.losses}  엄호조 피격 ${st.coverTeamHits}`,
    ];
    if (sq.bound) {
      const b = sq.bound;
      lines.push(`약진 중: ${TEAM_NAMES[b.team]} ${b.fromId}→${b.toId} ${b.requested ? '(G)' : '(자동)'} ${(now - b.start).toFixed(1)}s · ${b.members.map((m) => `${m.callName}:${FRIENDLY_STATE_NAMES[m.state] || m.state}`).join(' ')}`);
    } else if (sq.block) {
      const ev = sq.block;
      const p = ev.plan;
      const head = `다음 구간: ${TEAM_NAMES[p.team]} ${p.fromId}→${p.toId}${p.lead ? '' : ' (따라잡기)'}${p.branch ? ' (갈림길)' : ''} — `;
      if (!ev.reasons.length) lines.push(head + '출발 가능');
      for (const r of ev.reasons) {
        let d = REASON_NAMES[r.type];
        if (r.type === 'threat') d += `: ${r.blockers.map((ai) => `${ai.s.name} ${Math.round(ai.s.suppression.value)}`).join(', ')} (사선 ${ev.threats.length}명 중)`;
        if (r.type === 'suppressed' || r.type === 'near') d += `: ${r.members.map((m) => m.callName).join(', ')}`;
        if (r.type === 'gap') d += ` ${r.left.toFixed(1)}s`;
        lines.push(head + d);
      }
      if (sq.blockedSince !== null) lines.push(`  막힌 지 ${(now - sq.blockedSince).toFixed(0)}s (${CONFIG.squad.blockedRepeat}s 넘으면 엄호 요청 반복)`);
    } else lines.push('다음 구간: 없음');
    if (sq.designation) lines.push(`표적 지시: 방위 ${Math.round(sq.designation.bearing)} 거리 ${Math.round(sq.designation.range)}m (남은 ${(sq.designation.until - now).toFixed(0)}s)`);
    const li = this.lineInfo;
    lines.push(
      `플레이어 사선: 탄착 ${li ? li.dist.toFixed(0) : '-'}m · 위험 범위 안 아군 ${li && li.inLine.length ? li.inLine.map((m) => m.callName).join(', ') : '없음'} · 아군 3m 안 탄 ${st.playerNearFriend}발 · 아군 오사 ${st.friendlyHitsByPlayer} · 사격 전환 콜 ${st.shiftFireCalls}`,
    );
    lines.push('');
    for (const m of sq.members) {
      const w = m.s.weapon;
      lines.push(
        `${m.callName.padEnd(3)} ${TEAM_NAMES[m.team].padEnd(3)} ${String(Math.round(m.s.suppression.value)).padStart(3)} ${m.statusName().padEnd(4)} ${(FRIENDLY_STATE_NAMES[m.state] || m.state).padEnd(6)} ${m.node.padEnd(2)} 탄 ${w.totalRounds()}${m.up ? ' 관측' : ''}${m.aimTrack && m.aimTrack.has ? ` 노림:${m.aimTrack.target.s.name}` : ''}`,
      );
    }
    lines.push('');
    for (const ai of ais) lines.push(this.enemyLine(ai));
    this.panel.textContent = lines.join('\n');
  }
}

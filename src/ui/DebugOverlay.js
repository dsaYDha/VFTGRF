// =============================================================================
// DebugOverlay (F3) — 적 위치와 제압 막대·상태, 적이 기억하는 플레이어 추정 위치,
// 사격 위치 후보, 탄도 궤적 선, FPS. 기본 꺼짐.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { MAP } from '../world/mapData.js';
import { STATE_NAMES } from '../ai/EnemyAI.js';

const LEVEL_COLORS = ['#7fd06a', '#e8d250', '#f09a40', '#f05a4a'];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class DebugOverlay {
  constructor(game) {
    this.game = game;
    this.enabled = CONFIG.debug.startEnabled;
    this.root = document.getElementById('debug-overlay');
    this.panel = document.getElementById('debug-panel');
    this.labelsEl = document.getElementById('debug-labels');
    this.labels = new Map();
    this.fps = 60;
    this.frameMs = 16;
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
    this.estGeo = new THREE.SphereGeometry(0.45, 10, 8);
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
      if (!this.enabled || e.bullet.trail.length < 6) return;
      this.trails.push({ pts: e.bullet.trail.slice(), player: e.bullet.shooter === game.player.body });
      while (this.trails.length > CONFIG.debug.bulletTrailCount) this.trails.shift();
      this.trailsDirty = true;
    });
    this.setEnabled(this.enabled);
  }

  setEnabled(v) {
    this.enabled = v;
    this.root.classList.toggle('hidden', !v);
    this.group.visible = v;
    this.game.ballistics.recordTrails = v;
    if (!v) this.trails.length = 0;
    this.trailsDirty = true;
  }

  toggle() {
    this.setEnabled(!this.enabled);
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

  update(dt) {
    const rawFps = dt > 0 ? 1 / dt : 60;
    this.fps += (rawFps - this.fps) * 0.05;
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (!this.enabled) return;
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
    let li = 0;
    ais.forEach((ai, i) => {
      const m = this.enemyMeshes[i];
      const e = this.estMeshes[i];
      ai.s.getCenter(_v);
      m.position.copy(_v);
      m.visible = true;
      m.material = this.matEnemy;
      const alive = ai.s.alive;
      e.visible = alive && ai.perception.has;
      if (e.visible) {
        e.position.copy(ai.perception.estimate);
        const s = Math.max(0.6, Math.min(4, ai.perception.effectiveSigma() * 0.25));
        e.scale.setScalar(s);
        if (li < 16) {
          ai.s.getEyePos(_w);
          this.estLinePos.set([_w.x, _w.y, _w.z, e.position.x, e.position.y, e.position.z], li * 6);
          li++;
        }
      }
    });
    for (let i = ais.length; i < this.enemyMeshes.length; i++) {
      this.enemyMeshes[i].visible = false;
      this.estMeshes[i].visible = false;
    }
    this.estLineGeo.setDrawRange(0, li * 2);
    this.estLineGeo.attributes.position.needsUpdate = true;
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
      el.style.left = `${((_v.x + 1) / 2) * W}px`;
      el.style.top = `${((1 - _v.y) / 2) * H}px`;
      const sup = ai.s.suppression;
      const lvl = ai.s.alive ? sup.level : 0;
      const dist = Math.round(ai.pos.distanceTo(this.game.player.pos));
      const st = STATE_NAMES[ai.state] || ai.state;
      const cov = ai.covering ? ' · 엄호' : '';
      el.firstElementChild.textContent = `${ai.s.name} [${ai.statusName()}] ${st}${cov} · ${dist}m`;
      const fill = el.querySelector('.dbg-bar-fill');
      fill.style.width = `${sup.value}%`;
      fill.style.background = ai.s.alive ? LEVEL_COLORS[lvl] : '#555';
    }
    for (const [ai, el] of this.labels) {
      if (!seen.has(ai)) {
        el.remove();
        this.labels.delete(ai);
      }
    }
  }

  updatePanel(ais) {
    const g = this.game;
    const info = g.renderer.info.render;
    const plan = g.director.plan;
    let planText = '없음';
    if (plan) planText = `${plan.ai.s.name} → ${plan.to.id} (${plan.state === 'pending' ? '출발 대기' : '이동 중'})`;
    else planText = `다음 시도 ${Math.max(0, g.director.nextAttempt - g.time).toFixed(0)}초 후`;
    const pl = g.player;
    const lines = [
      `FPS ${this.fps.toFixed(0)} (${this.frameMs.toFixed(1)}ms)  draw ${info.calls}  tri ${(info.triangles / 1000).toFixed(0)}k`,
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

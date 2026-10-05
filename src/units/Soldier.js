// =============================================================================
// Soldier — 양측 공통 병사 (모델 + 피해 + 제압 + 무기). AI·플레이어가 이를 조종한다.
// 병사 종류는 config.soldierTypes, 세력(식별 테이프)은 config.factions 데이터로 정의.
// =============================================================================
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/events.js';
import { rand } from '../core/Random.js';
import { SoldierModel } from './SoldierModel.js';
import { DamageModel } from './DamageModel.js';
import { Suppressible } from '../suppression/Suppressible.js';
import { Weapon } from '../weapons/Weapon.js';

let nextId = 1;
const _c = new THREE.Vector3();

export class Soldier {
  constructor(game, { team, typeId = 'rifleman', name = '', isPlayer = false, addToScene = true }) {
    this.id = nextId++;
    this.game = game;
    this.team = team;
    this.isPlayer = isPlayer;
    this.name = name || `${team}-${this.id}`;
    this.typeId = typeId;
    this.type = CONFIG.soldierTypes[typeId];
    this.faction = CONFIG.factions[team];
    this.model = new SoldierModel({ tapeColor: this.faction.tapeColor, colors: this.type.colors });
    this.root = this.model.root;
    this.position = this.root.position;
    this.damage = new DamageModel();
    const [r0, r1] = CONFIG.suppression.resilienceRange;
    this.suppression = new Suppressible(rand(r0, r1));
    this.weapon = new Weapon(game, CONFIG.weapons[this.type.weapon], this, {
      spareMags: isPlayer ? undefined : this.type.spareMags,
    });
    // 이 병사가 숨은 엄폐물 (근접 탄착 5m 규칙): 충돌체 태그 또는 'terrain'
    this.coverRef = null;
    this.inCover = false;
    this.coverFacing = new THREE.Vector3(0, 0, 1);
    this.stats = { hitsTaken: 0 };
    this.onHit = null;
    if (addToScene) game.scene.add(this.root);
  }

  get alive() {
    return !this.damage.incapacitated;
  }

  getHeadPos(out) {
    return this.model.getHeadPos(out);
  }

  getChestPos(out) {
    return this.model.getChestPos(out);
  }

  getEyePos(out) {
    return this.model.getEyePos(out);
  }

  getCenter(out) {
    return this.model.getHipsPos(out);
  }

  // 탄 선분과 피격 판정 (넓은 판정 후 부위별)
  testBulletHit(ax, ay, az, bx, by, bz, out) {
    this.model.getHipsPos(_c);
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = len2 > 0 ? ((_c.x - ax) * dx + (_c.y - ay) * dy + (_c.z - az) * dz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + dx * t - _c.x;
    const qy = ay + dy * t - _c.y;
    const qz = az + dz * t - _c.z;
    if (qx * qx + qy * qy + qz * qz > 1.45 * 1.45) return false;
    return this.model.testSegment(ax, ay, az, bx, by, bz, out);
  }

  // 피격 처리 → 결과 이벤트
  receiveHit(hit, bullet) {
    const now = this.game.time;
    const result = this.damage.applyHit(hit.zone, hit.plate, now);
    if (result === 'none') return result;
    this.stats.hitsTaken++;
    const ev = { unit: this, zone: hit.zone, plate: hit.plate, result, bullet, point: { x: hit.x, y: hit.y, z: hit.z } };
    this.game.events.emit(EV.UNIT_HIT, ev);
    if (this.onHit) this.onHit(ev);
    if (result === 'incapacitated') this.game.events.emit(EV.UNIT_INCAPACITATED, { unit: this, bullet });
    return result;
  }

  update(dt) {
    this.weapon.update(dt);
    this.model.update(dt);
  }

  dispose() {
    this.game.scene.remove(this.root);
  }
}

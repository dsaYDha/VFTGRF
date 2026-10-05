// 튀는 파편 (흙덩이·벽돌 조각·나무 조각). InstancedMesh + 간단한 물리, 지면에서 튕김
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class DebrisSystem {
  constructor(max, terrain) {
    this.max = max;
    this.terrain = terrain;
    this.n = 0;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), rv: new THREE.Vector3(), s: new THREE.Vector3(), life: 0, max: 1, rest: false });
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  // o: {x,y,z, vx,vy,vz, size:[sx,sy,sz], color, life}
  spawn(o) {
    let it;
    if (this.n < this.max) it = this.items[this.n++];
    else it = this.items[Math.floor(Math.random() * this.max)];
    it.p.set(o.x, o.y, o.z);
    it.v.set(o.vx, o.vy, o.vz);
    it.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.rv.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    it.s.set(o.size[0], o.size[1], o.size[2]);
    it.life = o.life;
    it.max = o.life;
    it.rest = false;
    _c.set(o.color);
    it.color = it.color || new THREE.Color();
    it.color.copy(_c);
  }

  update(dt) {
    let w = 0;
    const items = this.items;
    for (let i = 0; i < this.n; i++) {
      const it = items[i];
      it.life -= dt;
      if (it.life <= 0) continue;
      if (!it.rest) {
        it.v.y -= 9.81 * dt;
        it.p.addScaledVector(it.v, dt);
        it.r.addScaledVector(it.rv, dt);
        const g = this.terrain.heightAt(it.p.x, it.p.z) + it.s.y * 0.5;
        if (it.p.y < g) {
          it.p.y = g;
          if (it.v.y < -1.2) {
            it.v.y *= -0.28;
            it.v.x *= 0.5;
            it.v.z *= 0.5;
            it.rv.multiplyScalar(0.5);
          } else {
            it.rest = true;
          }
        }
      }
      // 배열 압축 (객체 교환)
      if (w !== i) {
        items[i] = items[w];
        items[w] = it;
      }
      const t = it.life / it.max;
      const k = t < 0.2 ? t / 0.2 : 1;
      _e.set(it.r.x, it.r.y, it.r.z);
      _q.setFromEuler(_e);
      _s.copy(it.s).multiplyScalar(k);
      _m.compose(it.p, _q, _s);
      this.mesh.setMatrixAt(w, _m);
      this.mesh.setColorAt(w, it.color);
      w++;
    }
    this.n = w;
    this.mesh.count = w;
    if (w > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

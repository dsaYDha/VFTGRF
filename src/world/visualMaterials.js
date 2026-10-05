// 공용 시각 재질 (Three.js). 충돌 재질(config.materials)과는 별개
import * as THREE from 'three';
import * as TX from './textures.js';

export function createVisualMaterials() {
  const lam = (opts) => new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  const m = {
    brickRed: lam({ map: TX.brickTexture('red') }),
    brickWhite: lam({ map: TX.brickTexture('silicate') }),
    concrete: lam({ map: TX.concreteTexture() }),
    slate: lam({ map: TX.slateTexture(), side: THREE.DoubleSide }),
    rust: lam({ map: TX.rustTexture() }),
    rustDouble: lam({ map: TX.rustTexture(), side: THREE.DoubleSide }),
    burnt: lam({ map: TX.burntTexture() }),
    wood: lam({ map: TX.woodTexture() }),
    bark: lam({ map: TX.barkTexture() }),
    sandbag: lam({ map: TX.sandbagTexture() }),
    earth: lam({ map: TX.earthTexture() }),
    steel: lam({ color: 0x8b8e8c }),
    darkSteel: lam({ color: 0x3a3a38 }),
    rubber: lam({ color: 0x1d1c1b }),
    plain: lam({}),
    interior: lam({ color: 0x141312 }),
    camoNet: new THREE.MeshLambertMaterial({
      map: TX.camoNetTexture(),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      vertexColors: true,
    }),
    water: new THREE.MeshPhongMaterial({
      color: 0x55595a,
      specular: 0x9aa0a2,
      shininess: 90,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  };
  m.water.userData.noShadow = true;
  m.camoNet.userData.noShadow = false;
  return m;
}

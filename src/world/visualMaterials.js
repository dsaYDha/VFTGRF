// 공용 시각 재질 (Three.js). 충돌 재질(config.materials)과는 별개
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import * as TX from './textures.js';
import { MAP } from './mapData.js';

export function createVisualMaterials() {
  const lam = (opts) => new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  const m = {
    brickRed: lam({ map: TX.brickTexture('red') }),
    brickWhite: lam({ map: TX.brickTexture('silicate') }),
    concrete: lam({ map: TX.concreteTexture() }),
    // 수로 라이닝 판 (판 하나 = 아틀라스 한 칸, UV 는 Structures.slabPartGeometry)
    canalSlab: lam({ map: TX.canalSlabTexture(CONFIG.canal.slabTexture.width, CONFIG.canal.slabTexture.height, CONFIG.canal.slabTexture.variants) }),
    slate: lam({ map: TX.slateTexture(), side: THREE.DoubleSide }),
    rust: lam({ map: TX.rustTexture() }),
    rustDouble: lam({ map: TX.rustTexture(), side: THREE.DoubleSide }),
    burnt: lam({ map: TX.burntTexture() }),
    // 중간 지대 차량 잔해: 불탄 장갑차 차체 / 불탄 민간 차량·트랙터 / 궤도 링크 (Structures.apc·car·tractor)
    wreckArmor: lam({ map: TX.wreckTexture('armor', CONFIG.midfield.textureSize) }),
    wreckCar: lam({ map: TX.wreckTexture('car', CONFIG.midfield.textureSize) }),
    track: lam({ map: TX.trackTexture() }),
    wood: lam({ map: TX.woodTexture() }),
    bark: lam({ map: TX.barkTexture() }),
    sandbag: lam({ map: TX.sandbagTexture() }),
    earth: lam({ map: TX.earthTexture() }),
    steel: lam({ color: 0x8b8e8c }),
    darkSteel: lam({ color: 0x3a3a38 }),
    rubber: lam({ color: 0x1d1c1b }),
    plain: lam({}),
    interior: lam({ color: 0x141312 }),
    // 적 진지·집단농장 (Structures.barn·silo·farmFence·hay·rubbleHeap): 저장탑 전용 텍스처(구멍·탄흔·얼룩), ПО-2 무늬 담장 판,
    // 썩은 건초, 벽돌 잔해 더미 (색은 정점색). 벽 데칼(그을음·탄흔)은 투명 아틀라스 (Structures.buildFarmExtras 에서 따로 그림)
    silo: lam({ map: TX.siloTexture(CONFIG.farm.silo.textureSize[0], CONFIG.farm.silo.textureSize[1], { ...MAP.silo, height: MAP.silo.h, pocks: CONFIG.farm.silo.pocks }) }),
    fencePanel: lam({ map: TX.fencePanelTexture(CONFIG.farm.fence.textureSize[0], CONFIG.farm.fence.textureSize[1]) }),
    hay: lam({ map: TX.hayTexture() }),
    rubbleHeap: lam({ map: TX.rubbleTexture() }),
    farmDecal: new THREE.MeshLambertMaterial({
      map: TX.farmDecalTexture(CONFIG.farm.decalTexture[0], CONFIG.farm.decalTexture[1]),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
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
  m.farmDecal.userData.noShadow = true;
  return m;
}

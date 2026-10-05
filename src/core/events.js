// 이벤트 이름 모음. 시스템끼리는 이 이벤트로만 소통하는 것을 원칙으로 한다.
export const EV = {
  // 사격·탄도
  SHOT_FIRED: 'shotFired', // {shooter, team, weaponDef, origin, dir, muzzle, isTracer, bulletId}
  BULLET_SEGMENT: 'bulletSegment', // 매 프레임 탄 이동 선분 (재사용 payload)
  BULLET_IMPACT: 'bulletImpact', // {bullet, point, normal, material, collider, isTerrain, penetrated, ricochet}
  BULLET_EXPIRED: 'bulletExpired', // {bullet}
  BULLET_NEAR_MISS: 'bulletNearMiss', // {bullet, target, distance, point, value}
  // 제압·피해
  UNIT_SUPPRESSED: 'unitSuppressed', // {unit, amount, value, level}
  SUPPRESSION_LEVEL: 'suppressionLevelChanged', // {unit, level, prevLevel}
  UNIT_HIT: 'unitHit', // {unit, zone, result, bullet, point}
  UNIT_INCAPACITATED: 'unitIncapacitated', // {unit}
  // 무기 조작
  RELOAD_START: 'reloadStart', // {owner, empty, duration}
  RELOAD_STEP: 'reloadStep', // {owner, step: 'magOut'|'magIn'|'boltBack'|'boltForward'|'pouch'}
  RELOAD_END: 'reloadEnd', // {owner}
  DRY_FIRE: 'dryFire',
  FIRE_MODE: 'fireModeChanged', // {owner, mode}
  SIGHT_RANGE: 'sightRangeChanged', // {owner, range}
  AMMO_CHECK: 'ammoCheck', // {owner, status, spareMags}
  // 플레이어
  PLAYER_POSTURE: 'playerPosture', // {posture}
  FOOTSTEP: 'footstep', // {unit, position, surface, intensity}
  PLAYER_KNOCKDOWN: 'playerKnockdown',
  BOUNDARY: 'boundary', // {state: 'warn'|'clear'|'return', timeLeft}
  // AI·임무
  ADVANCE_PLANNED: 'advancePlanned', // {unit, from, to}
  ADVANCE_DEPARTED: 'advanceDeparted',
  ADVANCE_DETERRED: 'advanceDeterred', // 출발 포기
  ADVANCE_STOPPED: 'advanceStopped', // 이동 중 고착
  ADVANCE_COMPLETED: 'advanceCompleted',
  ENEMY_REACHED_LINE: 'enemyReachedLine',
  REINFORCEMENT: 'reinforcement',
  MISSION_START: 'missionStart',
  MISSION_END: 'missionEnd', // {success, reason, stats}
  MESSAGE: 'hudMessage', // {text, kind}
  DEBUG_TOGGLE: 'debugToggle',
};

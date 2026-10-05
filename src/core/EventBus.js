// 시스템 사이를 느슨하게 잇는 동기식 이벤트 버스.
// 주의: 자주 발생하는 이벤트(bulletSegment 등)는 payload 객체를 재사용하므로
// 핸들러에서 payload 를 저장해 두지 말고 필요한 값만 복사해 쓴다.
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    const list = this.handlers.get(type);
    // copy-on-write: emit 중 구독 변경이 있어도 안전
    this.handlers.set(type, list ? [...list, fn] : [fn]);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    this.handlers.set(
      type,
      list.filter((f) => f !== fn),
    );
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}

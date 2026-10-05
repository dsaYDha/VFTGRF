// 단순 오브젝트 풀. create() 로 만든 객체를 재사용한다.
export class Pool {
  constructor(create, size = 0) {
    this.create = create;
    this.free = [];
    for (let i = 0; i < size; i++) this.free.push(create());
  }

  get() {
    return this.free.length ? this.free.pop() : this.create();
  }

  release(obj) {
    this.free.push(obj);
  }
}

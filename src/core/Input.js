// 키보드·마우스 입력. KeyboardEvent.code 를 써서 한글 입력기 상태와 무관하게 동작한다.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set(); // 이번 프레임에 눌린 키 (엣지)
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = { left: false, right: false };
    this.clicked = { left: false, right: false };
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      // F3 (디버그), Tab 등 브라우저 기본 동작 막기
      if (e.code === 'F3' || e.code === 'F4' || e.code === 'F8' || e.code === 'Tab' || (this.locked && e.code === 'Space')) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.buttons.left = false;
      this.buttons.right = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // 일부 브라우저의 포인터락 튐 현상 방지
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.buttons.left = true;
        this.clicked.left = true;
      } else if (e.button === 2) {
        this.buttons.right = true;
        this.clicked.right = true;
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.buttons.left = false;
      else if (e.button === 2) this.buttons.right = false;
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.pollLock());
    document.addEventListener('pointerlockerror', () => {
      if (this.onLockChange) this.onLockChange(false, true);
    });
  }

  // 포인터 잠금 상태 확인. 이벤트가 빠지는 환경도 있어 매 프레임 확인하고, 바뀌었을 때만 알린다.
  pollLock() {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    if (!locked) {
      this.buttons.left = false;
      this.buttons.right = false;
    }
    if (this.onLockChange) this.onLockChange(locked);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.onLockChange && this.onLockChange(false, true));
    } catch {
      if (this.onLockChange) this.onLockChange(false, true);
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code) {
    return this.enabled && this.down.has(code);
  }

  wasPressed(code) {
    return this.enabled && this.pressed.has(code);
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return this.enabled ? [dx, dy] : [0, 0];
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return this.enabled ? w : 0;
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.left = false;
    this.clicked.right = false;
  }
}

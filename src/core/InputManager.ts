import { Emitter } from './events';

export interface InputSnapshot {
  keysDown: Set<string>;
  keysPressed: Set<string>;
  doubleTapped: Set<string>;
  wheelSteps: number;
  buttonsDown: Set<number>;
  buttonsPressed: Set<number>;
}

const DOUBLE_TAP_MS = 300;
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'F3',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
]);

type LockableCanvas = HTMLCanvasElement & { requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void };

export class InputManager {
  readonly pointerLockLost = new Emitter<void>();
  readonly pointerLockAcquired = new Emitter<void>();
  locked = false;
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private doubleTapped = new Set<string>();
  private buttonsDown = new Set<number>();
  private buttonsPressed = new Set<number>();
  private lastTap = new Map<string, number>();
  private wheelSteps = 0;
  private wheelAccum = 0;
  private mouseDx = 0;
  private mouseDy = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly isPlaying: () => boolean) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttonsDown.add(e.button);
      this.buttonsPressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttonsDown.delete(e.button);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDx += Math.max(-300, Math.min(300, e.movementX || 0));
      this.mouseDy += Math.max(-300, Math.min(300, e.movementY || 0));
    });
    window.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('contextmenu', (e) => {
      if (this.isPlaying()) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === this.canvas;
      if (nowLocked === this.locked) return;
      this.locked = nowLocked;
      this.resetState();
      if (nowLocked) this.pointerLockAcquired.emit(undefined);
      else this.pointerLockLost.emit(undefined);
    });
    window.addEventListener('blur', () => this.resetState());
  }

  requestLock(): void {
    const canvas = this.canvas as LockableCanvas;
    const fallback = (): void => {
      try {
        const retry = canvas.requestPointerLock();
        if (retry && typeof retry.catch === 'function') retry.catch(() => undefined);
      } catch {
        // браузер отказал в захвате мыши
      }
    };
    try {
      const result = canvas.requestPointerLock({ unadjustedMovement: true });
      if (result && typeof result.catch === 'function') result.catch(fallback);
    } catch {
      fallback();
    }
  }

  snapshot(): InputSnapshot {
    const snap: InputSnapshot = {
      keysDown: new Set(this.keysDown),
      keysPressed: this.keysPressed,
      doubleTapped: this.doubleTapped,
      wheelSteps: this.wheelSteps,
      buttonsDown: new Set(this.buttonsDown),
      buttonsPressed: this.buttonsPressed,
    };
    this.keysPressed = new Set();
    this.doubleTapped = new Set();
    this.buttonsPressed = new Set();
    this.wheelSteps = 0;
    return snap;
  }

  consumeMouse(): { dx: number; dy: number } {
    const d = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = 0;
    this.mouseDy = 0;
    return d;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.isPlaying() && GAME_KEYS.has(e.code)) e.preventDefault();
    if (!this.locked || e.repeat || this.keysDown.has(e.code)) return;
    this.keysDown.add(e.code);
    this.keysPressed.add(e.code);
    const now = performance.now();
    const last = this.lastTap.get(e.code);
    if (last !== undefined && now - last <= DOUBLE_TAP_MS) {
      this.doubleTapped.add(e.code);
      this.lastTap.delete(e.code);
    } else {
      this.lastTap.set(e.code, now);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (this.isPlaying()) e.preventDefault();
    if (!this.locked || e.deltaY === 0) return;
    if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) {
      this.wheelSteps += Math.sign(e.deltaY);
      this.wheelAccum = 0;
      return;
    }
    this.wheelAccum += e.deltaY;
    if (Math.abs(this.wheelAccum) >= 100) {
      this.wheelSteps += Math.sign(this.wheelAccum);
      this.wheelAccum = 0;
    }
  }

  private resetState(): void {
    this.keysDown.clear();
    this.buttonsDown.clear();
    this.keysPressed = new Set();
    this.doubleTapped = new Set();
    this.buttonsPressed = new Set();
    this.wheelSteps = 0;
    this.wheelAccum = 0;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }
}

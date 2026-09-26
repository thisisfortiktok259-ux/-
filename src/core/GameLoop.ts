import type { GameState, GameStateMachine } from './GameStateMachine';
import type { InputManager, InputSnapshot } from './InputManager';

export const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;

export interface GameSystem {
  activeIn: GameState[];
  update?(dt: number, input: InputSnapshot): void;
  render?(alpha: number): void;
}

export class GameLoop {
  fps = 0;
  private systems: GameSystem[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private frames = 0;
  private fpsTimer = 0;
  private running = false;

  constructor(private readonly states: GameStateMachine, private readonly input: InputManager, private readonly onFrame: () => void) {}

  add(system: GameSystem): void {
    this.systems.push(system);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    const frameDt = Math.min(Math.max((now - this.lastTime) / 1000, 0), 0.25);
    this.lastTime = now;
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      const snapshot = this.input.snapshot();
      const state = this.states.state;
      for (const system of this.systems) {
        if (system.update && system.activeIn.includes(state)) system.update(FIXED_DT, snapshot);
      }
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
    const alpha = this.accumulator / FIXED_DT;
    for (const system of this.systems) if (system.render) system.render(alpha);
    this.onFrame();
    this.frames++;
    this.fpsTimer += frameDt;
    if (this.fpsTimer >= 1) {
      this.fps = Math.round(this.frames / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
    requestAnimationFrame((t) => this.tick(t));
  }
}

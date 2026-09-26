import { Emitter } from './events';

export type GameState = 'Boot' | 'Unsupported' | 'MainMenu' | 'Loading' | 'Playing' | 'Paused' | 'Saving';

export interface GameStateChanged {
  from: GameState;
  to: GameState;
}

const GameStateTransitions: Record<GameState, GameState[]> = {
  Boot: ['Unsupported', 'MainMenu'],
  Unsupported: [],
  MainMenu: ['Loading'],
  Loading: ['Playing', 'MainMenu'],
  Playing: ['Paused', 'Saving'],
  Paused: ['Playing', 'Saving'],
  Saving: ['MainMenu'],
};

export class GameStateMachine {
  readonly changed = new Emitter<GameStateChanged>();
  private current: GameState = 'Boot';

  get state(): GameState {
    return this.current;
  }

  transition(to: GameState): boolean {
    const from = this.current;
    if (from === to) return true;
    if (!GameStateTransitions[from].includes(to)) {
      console.warn('Недопустимый переход состояния: ' + from + ' -> ' + to);
      return false;
    }
    this.current = to;
    this.changed.emit({ from, to });
    return true;
  }
}

import type { GameApp } from '../core/GameApp';
import { Emitter } from '../core/events';
import type { GameStateChanged } from '../core/GameStateMachine';
import type { InputSnapshot } from '../core/InputManager';
import type { HotbarController } from '../blocks/interaction';
import type { TextureAtlas } from '../render/TextureAtlas';
import type { WorldRecord } from '../save/save';
import { blockName } from '../world/blocks';
import type { LoadProgress } from '../world/ChunkManager';

export type UnsupportedReason = 'no-webgl2' | 'no-pointer-lock' | 'no-workers' | 'touch-device';

export function checkBrowserSupport(): UnsupportedReason | null {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no-webgl2';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch {
    return 'no-webgl2';
  }
  if (!('requestPointerLock' in HTMLElement.prototype)) return 'no-pointer-lock';
  if (typeof Worker === 'undefined') return 'no-workers';
  if (window.matchMedia && !window.matchMedia('(any-pointer: fine)').matches) return 'touch-device';
  return null;
}

export interface GameSettings {
  version: number;
  renderDistance: number;
  mouseSensitivity: number;
  fov: number;
}

export const DEFAULT_SETTINGS: GameSettings = { version: 1, renderDistance: 6, mouseSensitivity: 1, fov: 70 };
const SETTINGS_KEY = 'kubomir.settings';

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export class SettingsStore {
  readonly changed = new Emitter<GameSettings>();
  settings: GameSettings;

  constructor() {
    this.settings = this.load();
  }

  set(key: 'renderDistance' | 'mouseSensitivity' | 'fov', value: number): void {
    if (this.settings[key] === value) return;
    this.settings = { ...this.settings, [key]: value };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // хранилище браузера недоступно
    }
    this.changed.emit(this.settings);
  }

  private load(): GameSettings {
    const s: GameSettings = { ...DEFAULT_SETTINGS };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return s;
      const p = JSON.parse(raw) as Record<string, unknown>;
      if (inRange(p.renderDistance, 2, 12)) s.renderDistance = Math.round(p.renderDistance);
      if (inRange(p.mouseSensitivity, 0.1, 2)) s.mouseSensitivity = Math.round(p.mouseSensitivity * 20) / 20;
      if (inRange(p.fov, 50, 110)) s.fov = Math.round(p.fov);
    } catch {
      // остаются значения по умолчанию
    }
    return s;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export class Hud {
  readonly element: HTMLDivElement;
  readonly bottom: HTMLDivElement;
  private readonly saveError: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.element = el('div');
    this.element.id = 'hud';
    this.element.hidden = true;
    this.saveError = el('div', 'save-error', 'Мир не сохранён. Игра повторит попытку при следующем автосохранении.');
    this.saveError.hidden = true;
    this.bottom = el('div', 'hud-bottom');
    this.element.append(el('div', 'crosshair'), this.saveError, this.bottom);
    parent.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  setSaveError(visible: boolean): void {
    this.saveError.hidden = !visible;
  }
}

export class HotbarView {
  private readonly slots: HTMLDivElement[] = [];
  private readonly label: HTMLDivElement;
  private labelTimer = 0;

  constructor(parent: HTMLElement, controller: HotbarController, atlas: TextureAtlas) {
    this.label = el('div', 'hotbar-label');
    const bar = el('div', 'hotbar');
    controller.slots.forEach((blockId, index) => {
      const slot = el('div', 'slot');
      slot.title = blockName(blockId);
      slot.appendChild(atlas.renderBlockIcon(blockId, 40));
      slot.appendChild(el('span', 'slot-num', String(index + 1)));
      bar.appendChild(slot);
      this.slots.push(slot);
    });
    parent.append(this.label, bar);
    this.highlight(controller.activeSlot);
    controller.changed.on((event) => {
      this.highlight(event.activeSlot);
      if (!event.silent) this.showLabel(blockName(event.blockId));
    });
  }

  private highlight(active: number): void {
    this.slots.forEach((slot, i) => slot.classList.toggle('active', i === active));
  }

  private showLabel(text: string): void {
    this.label.textContent = text;
    this.label.classList.add('visible');
    window.clearTimeout(this.labelTimer);
    this.labelTimer = window.setTimeout(() => this.label.classList.remove('visible'), 2000);
  }
}

export interface DebugInfo {
  fps: number;
  x: number;
  y: number;
  z: number;
  chunkX: number;
  chunkZ: number;
  facing: string;
  loadedChunks: number;
}

export class DebugOverlay {
  private readonly element: HTMLDivElement;
  private toggled = false;
  private allowed = false;
  private lastRefresh = 0;

  constructor(parent: HTMLElement, private readonly source: () => DebugInfo | null) {
    this.element = el('div', 'debug');
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  setAllowed(allowed: boolean): void {
    this.allowed = allowed;
    this.sync();
  }

  update(input: InputSnapshot): void {
    if (!input.keysPressed.has('F3')) return;
    this.toggled = !this.toggled;
    this.sync();
    this.refresh();
  }

  render(): void {
    if (!this.toggled || !this.allowed) return;
    if (performance.now() - this.lastRefresh >= 250) this.refresh();
  }

  private sync(): void {
    this.element.hidden = !(this.toggled && this.allowed);
  }

  private refresh(): void {
    this.lastRefresh = performance.now();
    const info = this.source();
    if (!info) return;
    const lines = [
      'Кубомир',
      'Кадров в секунду: ' + info.fps,
      'Координаты: ' + info.x.toFixed(1) + ' / ' + info.y.toFixed(1) + ' / ' + info.z.toFixed(1),
      'Чанк: ' + info.chunkX + ', ' + info.chunkZ,
      'Взгляд: ' + info.facing,
      'Загружено чанков: ' + info.loadedChunks,
    ];
    this.element.replaceChildren(...lines.map((line) => el('div', '', line)));
  }
}

type MenuScreen = 'main' | 'worlds' | 'create' | 'settings';

const CONTROLS = [
  'W, A, S, D: ходьба. Мышь: обзор. Пробел: прыжок.',
  'Дважды W: бег. Дважды пробел: полёт, Shift: вниз.',
  'Левая кнопка: сломать. Правая кнопка: поставить.',
  '1–9 или колесо: выбор блока. F3: отладка. Esc: пауза.',
];

function chunksWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'чанк';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'чанка';
  return 'чанков';
}

function randomSeed(): string {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0]);
}

function tempWorld(name: string, seed: string): WorldRecord {
  const now = Date.now();
  return { id: 'temp-' + now, name, seed, createdAt: now, lastPlayedAt: now, formatVersion: 1 };
}

export class ScreenManager {
  private readonly layer: HTMLDivElement;
  private menuScreen: MenuScreen = 'main';
  private pauseSettings = false;
  private listError = '';
  private unsupportedReason: UnsupportedReason | null = null;
  private loadingFill: HTMLDivElement | null = null;
  private loadingText: HTMLDivElement | null = null;
  private loadingError: HTMLDivElement | null = null;
  private loadingBack: HTMLButtonElement | null = null;

  constructor(root: HTMLElement, private readonly app: GameApp) {
    this.layer = el('div', 'screens');
    root.appendChild(this.layer);
    app.states.changed.on((event) => this.onStateChanged(event));
  }

  setUnsupportedReason(reason: UnsupportedReason): void {
    this.unsupportedReason = reason;
  }

  refresh(): void {
    this.render();
  }

  setLoadingProgress(progress: LoadProgress): void {
    if (!this.loadingFill || !this.loadingText) return;
    const percent = progress.total > 0 ? Math.min(100, Math.floor((progress.ready / progress.total) * 100)) : 0;
    this.loadingFill.style.width = percent + '%';
    this.loadingText.textContent = percent + '%';
  }

  showLoadingError(): void {
    if (!this.loadingError || !this.loadingBack || !this.loadingError.hidden) return;
    this.loadingError.textContent = 'Не удалось загрузить мир.';
    this.loadingError.hidden = false;
    this.loadingBack.hidden = false;
  }

  private onStateChanged(event: GameStateChanged): void {
    if (event.to === 'MainMenu') {
      this.menuScreen = 'main';
      this.pauseSettings = false;
    }
    if (event.to === 'Paused') this.pauseSettings = false;
    this.render();
  }

  private render(): void {
    this.layer.replaceChildren();
    this.loadingFill = null;
    this.loadingText = null;
    this.loadingError = null;
    this.loadingBack = null;
    const state = this.app.states.state;
    this.app.setHudVisible(state === 'Playing' || state === 'Paused');
    let screen: HTMLElement | null = null;
    if (state === 'Unsupported') screen = this.unsupportedScreen();
    else if (state === 'MainMenu') screen = this.menu();
    else if (state === 'Loading') screen = this.loadingScreen();
    else if (state === 'Playing') screen = this.app.isLocked ? null : this.promptScreen();
    else if (state === 'Paused') {
      screen = this.pauseSettings
        ? this.settingsScreen(() => {
            this.pauseSettings = false;
            this.render();
          })
        : this.pauseScreen();
    } else if (state === 'Saving') screen = this.savingScreen();
    if (screen) this.layer.appendChild(screen);
  }

  private menu(): HTMLElement {
    if (this.menuScreen === 'worlds') return this.worldsScreen();
    if (this.menuScreen === 'create') return this.createScreen();
    if (this.menuScreen === 'settings') {
      return this.settingsScreen(() => {
        this.menuScreen = 'main';
        this.render();
      });
    }
    return this.mainMenu();
  }

  private go(screen: MenuScreen): void {
    this.menuScreen = screen;
    this.render();
  }

  private controls(): HTMLElement {
    const box = el('div', 'controls');
    for (const line of CONTROLS) box.appendChild(el('div', '', line));
    return box;
  }

  private unsupportedScreen(): HTMLElement {
    const s = el('div', 'screen menu');
    const text = this.unsupportedReason === 'touch-device'
      ? 'Кубомир работает только на компьютере с клавиатурой и мышью.'
      : 'Ваш браузер не поддерживает 3D-графику, которая нужна игре. Откройте игру в последней версии Chrome, Edge или Firefox.';
    s.append(el('h1', 'title', 'Кубомир'), el('div', 'warning', text));
    return s;
  }

  private mainMenu(): HTMLElement {
    const s = el('div', 'screen menu');
    const buttons = el('div', 'buttons');
    buttons.append(button('Играть', () => this.go('worlds')), button('Настройки', () => this.go('settings')));
    s.append(el('h1', 'title', 'Кубомир'), el('div', 'subtitle', 'Песочница из блоков'), buttons, this.controls(), el('div', 'footnote', 'Не связано с Mojang и Microsoft.'));
    return s;
  }

  private worldsScreen(): HTMLElement {
    const s = el('div', 'screen menu');
    const warning = el('div', 'warning');
    warning.hidden = true;
    const error = el('div', 'error', this.listError);
    error.hidden = !this.listError;
    const list = el('div', 'world-list');
    list.appendChild(el('div', 'muted', 'Загрузка списка миров...'));
    const actions = el('div', 'buttons row');
    actions.append(
      button('Создать мир', () => {
        this.listError = '';
        this.go('create');
      }),
      button('Назад', () => {
        this.listError = '';
        this.go('main');
      }),
    );
    s.append(el('h2', '', 'Выбор мира'), warning, error, list, actions);
    void this.fillWorldList(list, warning);
    return s;
  }

  private async fillWorldList(list: HTMLElement, warning: HTMLElement): Promise<void> {
    const available = await this.app.storageReady;
    if (!list.isConnected) return;
    if (!available) {
      warning.textContent = 'Хранилище браузера недоступно. Миры не будут сохраняться, но играть можно.';
      warning.hidden = false;
      list.replaceChildren(el('div', 'muted', 'Сохранённых миров нет. Нажмите «Создать мир».'));
      return;
    }
    let worlds: WorldRecord[] = [];
    try {
      worlds = await this.app.storage.listWorlds();
    } catch (e) {
      console.warn(e);
      list.replaceChildren(el('div', 'error', 'Не удалось прочитать список миров.'));
      return;
    }
    if (!list.isConnected) return;
    if (worlds.length === 0) {
      list.replaceChildren(el('div', 'muted', 'Миров пока нет. Нажмите «Создать мир».'));
      return;
    }
    list.replaceChildren(...worlds.map((w) => this.worldRow(w)));
  }

  private worldRow(w: WorldRecord): HTMLElement {
    const row = el('div', 'world-row');
    const info = el('div');
    info.append(el('div', 'world-name', w.name), el('div', 'world-date', 'Последняя игра: ' + new Date(w.lastPlayedAt).toLocaleString('ru-RU')));
    const btns = el('div', 'world-buttons');
    const play = button('Играть', () => {
      play.disabled = true;
      void this.app.enterWorld(w, true).then((err) => {
        if (err) {
          this.listError = err;
          this.render();
        }
      });
    }, 'btn small');
    btns.append(play, button('Удалить', () => this.confirmDelete(w), 'btn small danger'));
    row.append(info, btns);
    return row;
  }

  private confirmDelete(w: WorldRecord): void {
    const overlay = el('div', 'modal');
    const box = el('div', 'modal-box');
    const btns = el('div', 'buttons row');
    const remove = button('Удалить', () => {
      remove.disabled = true;
      void (async () => {
        if (await this.app.lock.isInUse(w.id)) {
          this.listError = 'Этот мир открыт в другой вкладке браузера. Закройте его там и попробуйте снова.';
        } else {
          try {
            await this.app.storage.deleteWorld(w.id);
            this.listError = '';
          } catch (e) {
            console.warn(e);
            this.listError = 'Не удалось удалить мир.';
          }
        }
        this.render();
      })();
    }, 'btn danger');
    btns.append(remove, button('Отмена', () => overlay.remove()));
    box.append(el('div', '', 'Удалить мир «' + w.name + '»? Это действие нельзя отменить.'), btns);
    overlay.appendChild(box);
    this.layer.appendChild(overlay);
  }

  private createScreen(): HTMLElement {
    const s = el('div', 'screen menu');
    const nameField = el('label', 'field');
    const name = el('input');
    name.type = 'text';
    name.maxLength = 32;
    name.value = 'Новый мир';
    nameField.append(el('span', '', 'Имя мира'), name);
    const seedField = el('label', 'field');
    const seed = el('input');
    seed.type = 'text';
    seed.maxLength = 64;
    seed.placeholder = 'Пусто: случайное зерно';
    seedField.append(el('span', '', 'Зерно мира (необязательно)'), seed);
    const create = button('Создать', () => {
      void submit();
    });
    const submit = async (): Promise<void> => {
      const worldName = name.value.trim();
      if (!worldName || create.disabled) return;
      create.disabled = true;
      const seedText = seed.value.trim() || randomSeed();
      let world = tempWorld(worldName, seedText);
      let persistent = false;
      if (await this.app.storageReady) {
        try {
          world = await this.app.storage.createWorld(worldName, seedText);
          persistent = true;
        } catch (e) {
          console.warn(e);
        }
      }
      const err = await this.app.enterWorld(world, persistent);
      if (err) {
        this.listError = err;
        this.go('worlds');
      }
    };
    const sync = (): void => {
      create.disabled = name.value.trim().length === 0;
    };
    name.addEventListener('input', sync);
    for (const input of [name, seed]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void submit();
      });
    }
    sync();
    const btns = el('div', 'buttons row');
    btns.append(create, button('Отмена', () => this.go('worlds')));
    s.append(el('h2', '', 'Новый мир'), nameField, seedField, btns);
    window.setTimeout(() => name.focus(), 0);
    return s;
  }

  private loadingScreen(): HTMLElement {
    const s = el('div', 'screen menu');
    const bar = el('div', 'progress');
    const fill = el('div', 'progress-fill');
    bar.appendChild(fill);
    const text = el('div', 'muted', '0%');
    const error = el('div', 'error');
    error.hidden = true;
    const back = button('В главное меню', () => this.app.abortLoading());
    back.hidden = true;
    s.append(el('h2', '', 'Загрузка мира'), bar, text, error, back);
    this.loadingFill = fill;
    this.loadingText = text;
    this.loadingError = error;
    this.loadingBack = back;
    return s;
  }

  private promptScreen(): HTMLElement {
    const s = el('div', 'screen prompt');
    const box = el('div', 'prompt-box');
    box.append(el('div', 'prompt-title', 'Нажмите, чтобы играть'), this.controls());
    s.appendChild(box);
    s.addEventListener('click', () => this.app.requestPointerLock());
    return s;
  }

  private pauseScreen(): HTMLElement {
    const s = el('div', 'screen dim');
    const buttons = el('div', 'buttons');
    buttons.append(
      button('Продолжить', () => this.app.resume()),
      button('Настройки', () => {
        this.pauseSettings = true;
        this.render();
      }),
      button('Выйти в главное меню', () => {
        void this.app.exitToMenu();
      }),
    );
    s.append(el('h2', '', 'Пауза'), buttons);
    return s;
  }

  private savingScreen(): HTMLElement {
    const s = el('div', 'screen dim');
    s.append(el('h2', '', 'Сохранение мира...'));
    return s;
  }

  private settingsScreen(onDone: () => void): HTMLElement {
    const store = this.app.settings;
    const st = store.settings;
    const s = el('div', 'screen dim');
    s.append(
      el('h2', '', 'Настройки'),
      this.slider('Дальность прорисовки', 2, 12, 1, st.renderDistance, (v) => v + ' ' + chunksWord(v), (v) => store.set('renderDistance', v)),
      this.slider('Чувствительность мыши', 10, 200, 5, Math.round(st.mouseSensitivity * 100), (v) => v + '%', (v) => store.set('mouseSensitivity', v / 100)),
      this.slider('Угол обзора', 50, 110, 1, st.fov, (v) => v + '°', (v) => store.set('fov', v)),
    );
    const buttons = el('div', 'buttons');
    buttons.append(button('Готово', onDone));
    s.appendChild(buttons);
    return s;
  }

  private slider(label: string, min: number, max: number, step: number, value: number, format: (v: number) => string, onChange: (v: number) => void): HTMLElement {
    const wrap = el('label', 'slider');
    const title = el('div', 'slider-title');
    const valueText = el('span', '', format(value));
    title.append(el('span', '', label), valueText);
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valueText.textContent = format(v);
      onChange(v);
    });
    wrap.append(title, input);
    return wrap;
  }
}

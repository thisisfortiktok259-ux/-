import { GameLoop } from './GameLoop';
import { GameStateMachine } from './GameStateMachine';
import { InputManager, type InputSnapshot } from './InputManager';
import { BlockInteractionController, HotbarController } from '../blocks/interaction';
import { FirstPersonCamera, PlayerController, adjustSpawn, findSpawn } from '../player/player';
import { ChunkRenderer } from '../render/ChunkRenderer';
import { BlockHighlight, GameRenderer } from '../render/GameRenderer';
import { TextureAtlas } from '../render/TextureAtlas';
import { AutosaveService, CorruptWorldError, PersistentChunkSource, WorldLock, WorldStorage, type PlayerStateRecord, type WorldRecord } from '../save/save';
import { DebugOverlay, HotbarView, Hud, ScreenManager, SettingsStore, checkBrowserSupport, type DebugInfo } from '../ui/ui';
import { ChunkManager, generatedChunkSource } from '../world/ChunkManager';
import { ChunkWorkerPool } from '../world/ChunkWorkerPool';
import { CHUNK_SIZE } from '../world/constants';
import { TerrainGenerator } from '../world/terrain';
import { VoxelWorld } from '../world/VoxelWorld';

export interface WorldSession {
  world: WorldRecord;
  persistent: boolean;
}

interface ActiveSession {
  info: WorldSession;
  world: VoxelWorld;
  chunks: ChunkManager;
  player: PlayerController;
  interaction: BlockInteractionController;
  autosave: AutosaveService | null;
  loadingTime: number;
  needsSpawnCheck: boolean;
}

const LOADING_TIMEOUT = 30;

export class GameApp {
  readonly states = new GameStateMachine();
  readonly storage = new WorldStorage();
  readonly settings = new SettingsStore();
  readonly lock = new WorldLock();
  readonly hotbar = new HotbarController();
  readonly ui: ScreenManager;
  storageReady: Promise<boolean> = Promise.resolve(false);
  input!: InputManager;
  private renderer!: GameRenderer;
  private atlas!: TextureAtlas;
  private chunkRenderer!: ChunkRenderer;
  private highlight!: BlockHighlight;
  private view!: FirstPersonCamera;
  private pool!: ChunkWorkerPool;
  private loop!: GameLoop;
  private hud: Hud | null = null;
  private debug: DebugOverlay | null = null;
  private session: ActiveSession | null = null;

  constructor(canvas: HTMLCanvasElement, root: HTMLElement) {
    this.ui = new ScreenManager(root, this);
    const reason = checkBrowserSupport();
    if (reason) {
      this.ui.setUnsupportedReason(reason);
      this.states.transition('Unsupported');
      return;
    }
    this.renderer = new GameRenderer(canvas);
    this.atlas = new TextureAtlas();
    this.chunkRenderer = new ChunkRenderer(this.renderer.scene, this.atlas.texture);
    this.highlight = new BlockHighlight(this.renderer.scene);
    this.view = new FirstPersonCamera(this.renderer.camera);
    this.input = new InputManager(canvas, () => this.states.state === 'Playing');
    this.pool = new ChunkWorkerPool();
    const hud = new Hud(root);
    this.hud = hud;
    new HotbarView(hud.bottom, this.hotbar, this.atlas);
    this.debug = new DebugOverlay(root, () => this.debugInfo());
    this.applySettings();
    this.settings.changed.on(() => this.applySettings());
    this.input.pointerLockLost.on(() => this.onPointerLockLost());
    this.input.pointerLockAcquired.on(() => this.ui.refresh());
    this.loop = new GameLoop(this.states, this.input, () => this.renderer.render());
    this.loop.add({
      activeIn: ['Loading', 'Playing', 'Paused'],
      update: (dt, input) => this.updateWorld(dt, input),
      render: (alpha) => this.renderWorld(alpha),
    });
    this.storageReady = this.storage.open();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.session && this.session.autosave) void this.session.autosave.saveNow();
    });
    window.addEventListener('pagehide', () => {
      if (this.session && this.session.autosave) void this.session.autosave.saveNow();
    });
    this.states.transition('MainMenu');
    this.loop.start();
  }

  get isLocked(): boolean {
    return this.input ? this.input.locked : false;
  }

  setHudVisible(visible: boolean): void {
    if (this.hud) this.hud.setVisible(visible);
    if (this.debug) this.debug.setAllowed(visible);
  }

  requestPointerLock(): void {
    if (this.input) this.input.requestLock();
  }

  resume(): void {
    if (this.states.state !== 'Paused') return;
    this.states.transition('Playing');
    this.input.requestLock();
  }

  async enterWorld(world: WorldRecord, persistent: boolean): Promise<string | null> {
    if (this.session || this.states.state !== 'MainMenu') return null;
    let record: PlayerStateRecord | null = null;
    if (persistent) {
      const acquired = await this.lock.acquire(world.id);
      if (!acquired) return 'Этот мир уже открыт в другой вкладке браузера.';
      try {
        record = await this.storage.loadPlayer(world.id);
        await this.storage.touchWorld(world.id);
      } catch (error) {
        this.lock.releaseLock();
        console.warn(error);
        return error instanceof CorruptWorldError ? 'Данные мира повреждены и не читаются.' : 'Не удалось открыть мир.';
      }
    }
    if (this.session || this.states.state !== 'MainMenu') {
      if (persistent) this.lock.releaseLock();
      return null;
    }
    const voxelWorld = new VoxelWorld(persistent);
    this.pool.init(world.seed);
    const source = persistent ? new PersistentChunkSource(this.storage, world.id) : generatedChunkSource;
    const chunks = new ChunkManager(voxelWorld, this.pool, this.chunkRenderer, source, this.settings.settings.renderDistance);
    const player = new PlayerController(voxelWorld, this.view);
    let needsSpawnCheck = false;
    if (record) {
      player.setState(record);
      this.hotbar.setActiveSlot(record.activeSlot, true);
    } else {
      const spawn = findSpawn(new TerrainGenerator(world.seed));
      player.setState({ position: [spawn.x, spawn.y, spawn.z], yaw: 0, pitch: 0, flying: false });
      this.hotbar.setActiveSlot(0, true);
      needsSpawnCheck = true;
    }
    const interaction = new BlockInteractionController(voxelWorld, player, this.view, this.highlight, () => this.hotbar.selectedBlockId);
    let autosave: AutosaveService | null = null;
    if (persistent) {
      autosave = new AutosaveService(this.storage, world.id, voxelWorld, () => ({ worldId: world.id, ...player.getState(), activeSlot: this.hotbar.activeSlot }));
      autosave.status.on((status) => {
        if (this.hud) this.hud.setSaveError(status === 'failed');
      });
    }
    if (this.hud) this.hud.setSaveError(false);
    this.session = { info: { world, persistent }, world: voxelWorld, chunks, player, interaction, autosave, loadingTime: 0, needsSpawnCheck };
    this.states.transition('Loading');
    return null;
  }

  abortLoading(): void {
    if (this.states.state !== 'Loading') return;
    this.closeSession();
    this.states.transition('MainMenu');
  }

  async exitToMenu(): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (!this.states.transition('Saving')) return;
    if (document.pointerLockElement) document.exitPointerLock();
    try {
      if (session.autosave) await session.autosave.saveNow();
    } catch (error) {
      console.warn(error);
    }
    this.closeSession();
    this.states.transition('MainMenu');
  }

  private closeSession(): void {
    const session = this.session;
    if (!session) return;
    session.chunks.dispose();
    this.highlight.set(null);
    this.renderer.setUnderwater(false);
    if (session.info.persistent) this.lock.releaseLock();
    this.session = null;
  }

  private onPointerLockLost(): void {
    if (this.states.state !== 'Playing') return;
    this.states.transition('Paused');
    if (this.session && this.session.autosave) void this.session.autosave.saveNow();
  }

  private updateWorld(dt: number, input: InputSnapshot): void {
    const session = this.session;
    if (!session) return;
    const state = this.states.state;
    const p = session.player.body.position;
    session.chunks.update(p.x, p.z);
    if (state === 'Loading') {
      session.loadingTime += dt;
      const progress = session.chunks.progress();
      this.ui.setLoadingProgress(progress);
      if (progress.total > 0 && progress.ready >= progress.total) {
        if (session.needsSpawnCheck) adjustSpawn(session.world, session.player.body);
        this.states.transition('Playing');
      } else if (session.chunks.failed || session.loadingTime > LOADING_TIMEOUT) {
        this.ui.showLoadingError();
      }
      return;
    }
    if (state !== 'Playing') return;
    this.hotbar.update(input);
    if (this.debug) this.debug.update(input);
    session.player.update(dt, input);
    session.interaction.update(dt, input);
    if (session.autosave) session.autosave.update(dt);
  }

  private renderWorld(alpha: number): void {
    const mouse = this.input.consumeMouse();
    const session = this.session;
    if (!session) return;
    if (this.states.state === 'Playing' && this.input.locked) this.view.applyMouse(mouse.dx, mouse.dy);
    const eye = session.player.eyePosition(alpha);
    this.view.place(eye.x, eye.y, eye.z);
    this.renderer.setUnderwater(session.player.body.eyesInWater);
    if (this.debug) this.debug.render();
  }

  private applySettings(): void {
    const s = this.settings.settings;
    this.renderer.setFov(s.fov);
    this.renderer.setRenderDistance(s.renderDistance);
    this.view.sensitivity = s.mouseSensitivity;
    if (this.session) this.session.chunks.setRenderDistance(s.renderDistance);
  }

  private debugInfo(): DebugInfo | null {
    const session = this.session;
    if (!session) return null;
    const p = session.player.body.position;
    return {
      fps: this.loop ? this.loop.fps : 0,
      x: p.x,
      y: p.y,
      z: p.z,
      chunkX: Math.floor(p.x / CHUNK_SIZE),
      chunkZ: Math.floor(p.z / CHUNK_SIZE),
      facing: this.view.facing(),
      loadedChunks: session.chunks.loadedCount,
    };
  }
}

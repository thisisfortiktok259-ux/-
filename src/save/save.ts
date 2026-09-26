import { Emitter } from '../core/events';
import type { ChunkSource } from '../world/ChunkManager';
import { CHUNK_VOLUME } from '../world/constants';
import type { ChunkData, VoxelWorld } from '../world/VoxelWorld';

export interface WorldRecord {
  id: string;
  name: string;
  seed: string;
  createdAt: number;
  lastPlayedAt: number;
  formatVersion: number;
}

export interface PlayerStateRecord {
  worldId: string;
  position: [number, number, number];
  yaw: number;
  pitch: number;
  flying: boolean;
  activeSlot: number;
}

interface ChunkRecord {
  key: [string, number, number];
  blocks: Uint8Array;
  savedAt: number;
}

export class CorruptWorldError extends Error {
  constructor() {
    super('Данные мира повреждены');
    this.name = 'CorruptWorldError';
  }
}

const DB_NAME = 'kubomir';
export const DB_VERSION = 1;

function req<T>(request: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
  });
}

function makeId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'w-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export class WorldStorage {
  private db: IDBDatabase | null = null;

  get available(): boolean {
    return this.db !== null;
  }

  async open(): Promise<boolean> {
    if (typeof indexedDB === 'undefined') return false;
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' }).createIndex('lastPlayedAt', 'lastPlayedAt');
          if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('players')) db.createObjectStore('players', { keyPath: 'worldId' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('База данных заблокирована'));
      });
      return true;
    } catch (error) {
      console.warn('Хранилище браузера недоступно', error);
      this.db = null;
      return false;
    }
  }

  private get database(): IDBDatabase {
    if (!this.db) throw new Error('Хранилище недоступно');
    return this.db;
  }

  async listWorlds(): Promise<WorldRecord[]> {
    const tx = this.database.transaction('worlds', 'readonly');
    const all = await req<WorldRecord[]>(tx.objectStore('worlds').getAll());
    return all.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }

  async createWorld(name: string, seed: string): Promise<WorldRecord> {
    const now = Date.now();
    const world: WorldRecord = { id: makeId(), name, seed, createdAt: now, lastPlayedAt: now, formatVersion: 1 };
    const tx = this.database.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(world);
    await done(tx);
    return world;
  }

  async touchWorld(id: string): Promise<void> {
    const tx = this.database.transaction('worlds', 'readwrite');
    const store = tx.objectStore('worlds');
    const get = store.get(id);
    get.onsuccess = () => {
      const w = get.result as WorldRecord | undefined;
      if (w) {
        w.lastPlayedAt = Date.now();
        store.put(w);
      }
    };
    await done(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    const tx = this.database.transaction(['worlds', 'chunks', 'players'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, -Infinity, -Infinity], [id, Infinity, Infinity]));
    tx.objectStore('players').delete(id);
    await done(tx);
  }

  async loadChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | null> {
    const tx = this.database.transaction('chunks', 'readonly');
    const rec = await req<ChunkRecord | undefined>(tx.objectStore('chunks').get([worldId, cx, cz]));
    if (!rec) return null;
    if (!(rec.blocks instanceof Uint8Array) || rec.blocks.length !== CHUNK_VOLUME) throw new CorruptWorldError();
    return rec.blocks;
  }

  async loadPlayer(worldId: string): Promise<PlayerStateRecord | null> {
    const tx = this.database.transaction('players', 'readonly');
    const rec = await req<PlayerStateRecord | undefined>(tx.objectStore('players').get(worldId));
    if (!rec) return null;
    const p = rec.position;
    if (!Array.isArray(p) || p.length !== 3 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new CorruptWorldError();
    return {
      worldId,
      position: [p[0], p[1], p[2]],
      yaw: Number(rec.yaw) || 0,
      pitch: Number(rec.pitch) || 0,
      flying: !!rec.flying,
      activeSlot: Number.isInteger(rec.activeSlot) ? rec.activeSlot : 0,
    };
  }

  async saveBatch(worldId: string, chunks: { cx: number; cz: number; blocks: Uint8Array }[], player: PlayerStateRecord): Promise<void> {
    const tx = this.database.transaction(['chunks', 'players'], 'readwrite');
    const store = tx.objectStore('chunks');
    const now = Date.now();
    for (const c of chunks) {
      const record: ChunkRecord = { key: [worldId, c.cx, c.cz], blocks: c.blocks, savedAt: now };
      store.put(record);
    }
    tx.objectStore('players').put(player);
    await done(tx);
  }
}

const lockName = (id: string): string => 'kubomir-world-' + id;

export class WorldLock {
  private release: (() => void) | null = null;

  private get locks(): LockManager | undefined {
    return (navigator as Navigator & { locks?: LockManager }).locks;
  }

  acquire(worldId: string): Promise<boolean> {
    const locks = this.locks;
    if (!locks) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      locks
        .request(lockName(worldId), { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          return new Promise<void>((r) => {
            this.release = r;
          });
        })
        .catch(() => resolve(true));
    });
  }

  releaseLock(): void {
    if (this.release) this.release();
    this.release = null;
  }

  async isInUse(worldId: string): Promise<boolean> {
    const locks = this.locks;
    if (!locks) return false;
    try {
      const snapshot = await locks.query();
      return (snapshot.held || []).some((l) => l.name === lockName(worldId));
    } catch {
      return false;
    }
  }
}

const AUTOSAVE_INTERVAL = 30;

export class AutosaveService {
  readonly status = new Emitter<'failed' | 'succeeded'>();
  private timer = 0;
  private busy = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: WorldStorage,
    private readonly worldId: string,
    private readonly world: VoxelWorld,
    private readonly playerState: () => PlayerStateRecord,
  ) {}

  update(dt: number): void {
    this.timer += dt;
    if (this.timer < AUTOSAVE_INTERVAL) return;
    this.timer = 0;
    if (!this.busy) void this.saveNow();
  }

  saveNow(): Promise<void> {
    this.chain = this.chain.then(() => this.run());
    return this.chain;
  }

  private async run(): Promise<void> {
    this.busy = true;
    const saved: { chunk: ChunkData; version: number }[] = [];
    const payload: { cx: number; cz: number; blocks: Uint8Array }[] = [];
    const collect = (map: Map<string, ChunkData>): void => {
      for (const chunk of map.values()) {
        if (!chunk.dirtyForSave) continue;
        saved.push({ chunk, version: chunk.version });
        payload.push({ cx: chunk.cx, cz: chunk.cz, blocks: chunk.blocks.slice() });
      }
    };
    collect(this.world.chunks);
    collect(this.world.retainedChunks);
    try {
      await this.storage.saveBatch(this.worldId, payload, this.playerState());
      for (const s of saved) if (s.chunk.version === s.version) s.chunk.dirtyForSave = false;
      for (const [key, chunk] of this.world.retainedChunks) if (!chunk.dirtyForSave) this.world.retainedChunks.delete(key);
      this.status.emit('succeeded');
    } catch (error) {
      console.warn('Не удалось сохранить мир', error);
      this.status.emit('failed');
    } finally {
      this.busy = false;
    }
  }
}

export class PersistentChunkSource implements ChunkSource {
  constructor(private readonly storage: WorldStorage, private readonly worldId: string) {}

  async load(cx: number, cz: number): Promise<Uint8Array | null> {
    try {
      return await this.storage.loadChunk(this.worldId, cx, cz);
    } catch (error) {
      console.warn('Сохранённый чанк не читается, он будет создан заново', error);
      return null;
    }
  }
}

import type { ChunkRenderer } from '../render/ChunkRenderer';
import type { ChunkWorkerPool } from './ChunkWorkerPool';
import { CHUNK_SIZE, chunkKey, parseKey } from './constants';
import type { MeshChunkResult } from './messages';
import type { BlockChanged, VoxelWorld } from './VoxelWorld';

export interface ChunkSource {
  load(cx: number, cz: number): Promise<Uint8Array | null>;
}

export const generatedChunkSource: ChunkSource = { load: () => Promise.resolve(null) };

export interface LoadProgress {
  ready: number;
  total: number;
}

interface ChunkCoord {
  cx: number;
  cz: number;
  key: string;
  dist2: number;
}

interface ReadyMesh {
  result: MeshChunkResult;
  revision: number;
  urgent: boolean;
}

const INITIAL_RADIUS = 2;
const MAX_UPLOADS_PER_STEP = 4;
const MAX_ERRORS = 30;

export class ChunkManager {
  failed = false;
  private renderDistance: number;
  private disposed = false;
  private centerCx = Number.NaN;
  private centerCz = Number.NaN;
  private dirtyLayout = true;
  private wanted = new Set<string>();
  private wantedList: ChunkCoord[] = [];
  private visible = new Set<string>();
  private loading = new Set<string>();
  private meshing = new Set<string>();
  private revision = new Map<string, number>();
  private meshedRevision = new Map<string, number>();
  private revisionCounter = 0;
  private urgent = new Set<string>();
  private ready: ReadyMesh[] = [];
  private errors = 0;
  private unsubscribe: () => void;

  constructor(
    private readonly world: VoxelWorld,
    private readonly pool: ChunkWorkerPool,
    private readonly renderer: ChunkRenderer,
    private readonly source: ChunkSource,
    renderDistance: number,
  ) {
    this.renderDistance = renderDistance;
    this.unsubscribe = world.blockChanged.on((event) => this.onBlockChanged(event));
  }

  get loadedCount(): number {
    return this.world.chunks.size;
  }

  setRenderDistance(distance: number): void {
    if (distance === this.renderDistance) return;
    this.renderDistance = distance;
    this.dirtyLayout = true;
  }

  update(x: number, z: number): void {
    if (this.disposed) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    if (this.dirtyLayout || cx !== this.centerCx || cz !== this.centerCz) {
      this.centerCx = cx;
      this.centerCz = cz;
      this.dirtyLayout = false;
      this.relayout();
    }
    if (this.pool.broken) this.failed = true;
    this.dispatch();
    this.upload();
  }

  progress(): LoadProgress {
    let ready = 0;
    let total = 0;
    for (let dz = -INITIAL_RADIUS; dz <= INITIAL_RADIUS; dz++) {
      for (let dx = -INITIAL_RADIUS; dx <= INITIAL_RADIUS; dx++) {
        if (dx * dx + dz * dz > INITIAL_RADIUS * INITIAL_RADIUS) continue;
        total++;
        if (this.meshedRevision.has(chunkKey(this.centerCx + dx, this.centerCz + dz))) ready++;
      }
    }
    return { ready, total };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.renderer.clear();
    this.ready = [];
  }

  private relayout(): void {
    const rd = this.renderDistance;
    const dataRadius = rd + 1.5;
    const limit = rd + 2;
    const wanted = new Set<string>();
    const visible = new Set<string>();
    const list: ChunkCoord[] = [];
    for (let dz = -limit; dz <= limit; dz++) {
      for (let dx = -limit; dx <= limit; dx++) {
        const dist2 = dx * dx + dz * dz;
        if (dist2 > dataRadius * dataRadius) continue;
        const cx = this.centerCx + dx;
        const cz = this.centerCz + dz;
        const key = chunkKey(cx, cz);
        wanted.add(key);
        list.push({ cx, cz, key, dist2 });
        if (dist2 <= rd * rd) visible.add(key);
      }
    }
    list.sort((a, b) => a.dist2 - b.dist2);
    for (const [key, chunk] of this.world.chunks) {
      if (wanted.has(key)) continue;
      this.world.removeChunk(chunk.cx, chunk.cz);
      this.renderer.removeChunk(chunk.cx, chunk.cz);
      this.meshedRevision.delete(key);
      this.revision.delete(key);
    }
    for (const key of this.visible) {
      if (visible.has(key) || !this.meshedRevision.has(key)) continue;
      const [cx, cz] = parseKey(key);
      this.renderer.removeChunk(cx, cz);
      this.meshedRevision.delete(key);
    }
    this.wanted = wanted;
    this.visible = visible;
    this.wantedList = list;
    for (const c of list) {
      if (!this.world.chunks.has(c.key) && this.world.restoreRetained(c.cx, c.cz)) this.bumpAround(c.cx, c.cz);
    }
  }

  private dispatch(): void {
    for (const key of this.urgent) {
      if (!this.visible.has(key) || !this.world.chunks.has(key)) {
        this.urgent.delete(key);
        continue;
      }
      const [cx, cz] = parseKey(key);
      if (this.startMesh(key, cx, cz, true)) this.urgent.delete(key);
    }
    const capacity = this.pool.capacity;
    for (const c of this.wantedList) {
      if (this.loading.size + this.meshing.size >= capacity) break;
      if (!this.world.chunks.has(c.key)) {
        if (!this.loading.has(c.key)) this.startLoad(c);
      } else if (this.visible.has(c.key)) {
        this.startMesh(c.key, c.cx, c.cz, false);
      }
    }
  }

  private startMesh(key: string, cx: number, cz: number, urgent: boolean): boolean {
    if (this.meshing.has(key)) return false;
    const chunk = this.world.chunks.get(key);
    if (!chunk) return false;
    const revision = this.revision.get(key) ?? 0;
    if (this.meshedRevision.get(key) === revision) return true;
    const padded = this.world.getPaddedBlocks(cx, cz);
    if (!padded) return false;
    this.meshing.add(key);
    this.pool
      .mesh(cx, cz, chunk.version, padded)
      .then((result) => {
        this.meshing.delete(key);
        if (!this.disposed) this.ready.push({ result, revision, urgent });
      })
      .catch((error) => {
        this.meshing.delete(key);
        this.onError(error);
      });
    return true;
  }

  private startLoad(c: ChunkCoord): void {
    this.loading.add(c.key);
    const finish = (blocks: Uint8Array | null, modified: boolean): void => {
      this.loading.delete(c.key);
      if (this.disposed || !blocks || !this.wanted.has(c.key) || this.world.chunks.has(c.key)) return;
      this.world.addChunk(c.cx, c.cz, blocks, modified);
      this.bumpAround(c.cx, c.cz);
    };
    this.source
      .load(c.cx, c.cz)
      .then((stored) => {
        if (this.disposed) {
          this.loading.delete(c.key);
          return undefined;
        }
        if (stored) {
          finish(stored, true);
          return undefined;
        }
        return this.pool.generate(c.cx, c.cz).then((blocks) => finish(blocks, false));
      })
      .catch((error) => {
        this.loading.delete(c.key);
        this.onError(error);
      });
  }

  private upload(): void {
    if (this.ready.length === 0) return;
    this.ready.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    let uploads = 0;
    while (this.ready.length > 0) {
      const item = this.ready[0];
      if (!item.urgent && uploads >= MAX_UPLOADS_PER_STEP) break;
      this.ready.shift();
      const key = chunkKey(item.result.cx, item.result.cz);
      if (!this.visible.has(key) || !this.world.chunks.has(key)) continue;
      const current = this.meshedRevision.get(key);
      if (current !== undefined && current >= item.revision) continue;
      this.renderer.setChunkMesh(item.result);
      this.meshedRevision.set(key, item.revision);
      uploads++;
    }
  }

  private bump(key: string): void {
    this.revisionCounter++;
    this.revision.set(key, this.revisionCounter);
  }

  private bumpAround(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.bump(chunkKey(cx + dx, cz + dz));
  }

  private onBlockChanged(event: BlockChanged): void {
    const cx = Math.floor(event.x / CHUNK_SIZE);
    const cz = Math.floor(event.z / CHUNK_SIZE);
    const lx = event.x - cx * CHUNK_SIZE;
    const lz = event.z - cz * CHUNK_SIZE;
    const xs = [0];
    const zs = [0];
    if (lx === 0) xs.push(-1);
    if (lx === CHUNK_SIZE - 1) xs.push(1);
    if (lz === 0) zs.push(-1);
    if (lz === CHUNK_SIZE - 1) zs.push(1);
    for (const dx of xs) {
      for (const dz of zs) {
        const key = chunkKey(cx + dx, cz + dz);
        this.bump(key);
        this.urgent.add(key);
      }
    }
  }

  private onError(error: unknown): void {
    console.warn('Ошибка загрузки чанка', error);
    this.errors++;
    if (this.errors > MAX_ERRORS) this.failed = true;
  }
}

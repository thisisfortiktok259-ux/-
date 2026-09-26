import { Emitter } from '../core/events';
import { B, UNLOADED, type BlockId } from './blocks';
import { CHUNK_SIZE, PADDED, PADDED_VOLUME, WORLD_HEIGHT, blockIndex, chunkKey, paddedIndex } from './constants';

export interface ChunkData {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  version: number;
  modified: boolean;
  dirtyForSave: boolean;
}

export interface BlockChanged {
  x: number;
  y: number;
  z: number;
  oldId: BlockId;
  newId: BlockId;
}

export class VoxelWorld {
  readonly chunks = new Map<string, ChunkData>();
  readonly retainedChunks = new Map<string, ChunkData>();
  readonly blockChanged = new Emitter<BlockChanged>();

  constructor(readonly persistent: boolean) {}

  getChunk(cx: number, cz: number): ChunkData | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  addChunk(cx: number, cz: number, blocks: Uint8Array, modified: boolean): ChunkData {
    const chunk: ChunkData = { cx, cz, blocks, version: 1, modified, dirtyForSave: false };
    this.chunks.set(chunkKey(cx, cz), chunk);
    return chunk;
  }

  restoreRetained(cx: number, cz: number): boolean {
    const key = chunkKey(cx, cz);
    const chunk = this.retainedChunks.get(key);
    if (!chunk) return false;
    this.retainedChunks.delete(key);
    this.chunks.set(key, chunk);
    return true;
  }

  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;
    this.chunks.delete(key);
    if (chunk.dirtyForSave || (chunk.modified && !this.persistent)) this.retainedChunks.set(key, chunk);
  }

  getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return UNLOADED;
    return chunk.blocks[blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)];
  }

  setBlock(x: number, y: number, z: number, id: BlockId): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const i = blockIndex(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
    const oldId = chunk.blocks[i];
    if (oldId === id) return false;
    chunk.blocks[i] = id;
    chunk.version++;
    chunk.modified = true;
    chunk.dirtyForSave = true;
    this.blockChanged.emit({ x, y, z, oldId, newId: id });
    return true;
  }

  getPaddedBlocks(cx: number, cz: number): Uint8Array | null {
    const around: ChunkData[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!c) return null;
        around.push(c);
      }
    }
    const padded = new Uint8Array(PADDED_VOLUME);
    for (let pz = 0; pz < PADDED; pz++) {
      const wz = pz - 1;
      const nz = wz < 0 ? 0 : wz >= CHUNK_SIZE ? 2 : 1;
      const lz = wz - (nz - 1) * CHUNK_SIZE;
      for (let px = 0; px < PADDED; px++) {
        const wx = px - 1;
        const nx = wx < 0 ? 0 : wx >= CHUNK_SIZE ? 2 : 1;
        const lx = wx - (nx - 1) * CHUNK_SIZE;
        const src = around[nz * 3 + nx].blocks;
        for (let y = 0; y < WORLD_HEIGHT; y++) padded[paddedIndex(px, y, pz)] = src[blockIndex(lx, y, lz)];
      }
    }
    return padded;
  }
}

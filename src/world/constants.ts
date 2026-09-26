export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const PADDED = CHUNK_SIZE + 2;
export const PADDED_VOLUME = PADDED * PADDED * WORLD_HEIGHT;

export function blockIndex(x: number, y: number, z: number): number {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
}

export function paddedIndex(px: number, y: number, pz: number): number {
  return px + pz * PADDED + y * PADDED * PADDED;
}

export function chunkKey(cx: number, cz: number): string {
  return cx + ',' + cz;
}

export function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export const ATLAS_SIZE = 256;
export const TILE_SIZE = 16;
export const TILES_PER_ROW = ATLAS_SIZE / TILE_SIZE;

export interface TileUv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const cache: TileUv[] = [];

export function tileUv(tile: number): TileUv {
  const cached = cache[tile];
  if (cached) return cached;
  const col = tile % TILES_PER_ROW;
  const row = Math.floor(tile / TILES_PER_ROW);
  const step = TILE_SIZE / ATLAS_SIZE;
  const inset = 0.5 / ATLAS_SIZE;
  const uv = {
    u0: col * step + inset,
    u1: (col + 1) * step - inset,
    v1: 1 - row * step - inset,
    v0: 1 - (row + 1) * step + inset,
  };
  cache[tile] = uv;
  return uv;
}

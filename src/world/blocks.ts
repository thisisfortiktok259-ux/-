export type BlockId = number;

export const B = {
  AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLESTONE: 4, SAND: 5, LOG: 6, PLANKS: 7, LEAVES: 8, GLASS: 9, WATER: 10, BEDROCK: 11,
} as const;

export const UNLOADED = 255;

export type RenderMode = 'none' | 'opaque' | 'cutout' | 'translucent';

export const TILE = {
  STONE: 0, GRASS_TOP: 1, GRASS_SIDE: 2, DIRT: 3, COBBLESTONE: 4, SAND: 5, LOG_SIDE: 6, LOG_TOP: 7, PLANKS: 8, LEAVES: 9, GLASS: 10, WATER: 11, BEDROCK: 12,
} as const;
export const TILE_COUNT = 13;

export interface BlockDefinition {
  id: BlockId;
  name: string;
  solid: boolean;
  renderMode: RenderMode;
  tiles: { top: number; side: number; bottom: number };
  breakable: boolean;
}

function def(id: number, name: string, solid: boolean, renderMode: RenderMode, top: number, side: number, bottom: number, breakable = true): BlockDefinition {
  return { id, name, solid, renderMode, tiles: { top, side, bottom }, breakable };
}

export const BLOCKS: BlockDefinition[] = [
  def(B.AIR, 'Воздух', false, 'none', 0, 0, 0, false),
  def(B.STONE, 'Камень', true, 'opaque', TILE.STONE, TILE.STONE, TILE.STONE),
  def(B.GRASS, 'Трава', true, 'opaque', TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT),
  def(B.DIRT, 'Земля', true, 'opaque', TILE.DIRT, TILE.DIRT, TILE.DIRT),
  def(B.COBBLESTONE, 'Булыжник', true, 'opaque', TILE.COBBLESTONE, TILE.COBBLESTONE, TILE.COBBLESTONE),
  def(B.SAND, 'Песок', true, 'opaque', TILE.SAND, TILE.SAND, TILE.SAND),
  def(B.LOG, 'Бревно', true, 'opaque', TILE.LOG_TOP, TILE.LOG_SIDE, TILE.LOG_TOP),
  def(B.PLANKS, 'Доски', true, 'opaque', TILE.PLANKS, TILE.PLANKS, TILE.PLANKS),
  def(B.LEAVES, 'Листва', true, 'cutout', TILE.LEAVES, TILE.LEAVES, TILE.LEAVES),
  def(B.GLASS, 'Стекло', true, 'cutout', TILE.GLASS, TILE.GLASS, TILE.GLASS),
  def(B.WATER, 'Вода', false, 'translucent', TILE.WATER, TILE.WATER, TILE.WATER, false),
  def(B.BEDROCK, 'Коренная порода', true, 'opaque', TILE.BEDROCK, TILE.BEDROCK, TILE.BEDROCK, false),
];

export const RM_NONE = 0;
export const RM_OPAQUE = 1;
export const RM_CUTOUT = 2;
export const RM_TRANSLUCENT = 3;
const CODES: Record<RenderMode, number> = { none: 0, opaque: 1, cutout: 2, translucent: 3 };

export const IS_SOLID = new Uint8Array(256);
export const RENDER_MODE = new Uint8Array(256);
export const TILE_TOP = new Uint8Array(256);
export const TILE_SIDE = new Uint8Array(256);
export const TILE_BOTTOM = new Uint8Array(256);

for (const b of BLOCKS) {
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  RENDER_MODE[b.id] = CODES[b.renderMode];
  TILE_TOP[b.id] = b.tiles.top;
  TILE_SIDE[b.id] = b.tiles.side;
  TILE_BOTTOM[b.id] = b.tiles.bottom;
}

export function isSolid(id: BlockId): boolean {
  return id === UNLOADED || IS_SOLID[id] === 1;
}

export function isBreakable(id: BlockId): boolean {
  const b = BLOCKS[id];
  return !!b && b.breakable;
}

export function blockName(id: BlockId): string {
  const b = BLOCKS[id];
  return b ? b.name : '';
}

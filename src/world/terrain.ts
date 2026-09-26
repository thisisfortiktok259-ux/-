import { createNoise2D } from 'simplex-noise';
import { B } from './blocks';
import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from './constants';
import { alea, hash32, hashString } from './random';

type Noise2D = (x: number, y: number) => number;

export const TerrainConfig = {
  SEA_LEVEL: 48,
  BASE_HEIGHT: 52,
  CONTINENT_SCALE: 512,
  CONTINENT_AMPLITUDE: 16,
  HILL_SCALE: 128,
  HILL_OCTAVES: 4,
  HILL_AMPLITUDE: 40,
  DETAIL_SCALE: 32,
  DETAIL_AMPLITUDE: 2,
  FOREST_SCALE: 256,
  MAX_SURFACE: 110,
  MIN_SURFACE: 8,
};

const TREE_CELL = 5;
const CROWN_RADIUS = 2;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

export class TerrainGenerator {
  private continent: Noise2D;
  private hills: Noise2D;
  private detail: Noise2D;
  private forest: Noise2D;
  private seedHash: number;

  constructor(seed: string) {
    this.continent = createNoise2D(alea(seed + ':continent'));
    this.hills = createNoise2D(alea(seed + ':hills'));
    this.detail = createNoise2D(alea(seed + ':detail'));
    this.forest = createNoise2D(alea(seed + ':forest'));
    this.seedHash = hashString(seed);
  }

  surfaceHeight(x: number, z: number): number {
    const C = TerrainConfig;
    const continent = this.continent(x / C.CONTINENT_SCALE, z / C.CONTINENT_SCALE);
    let hills = 0;
    let amp = 1;
    let freq = 1 / C.HILL_SCALE;
    let norm = 0;
    for (let o = 0; o < C.HILL_OCTAVES; o++) {
      hills += amp * this.hills(x * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    hills /= norm;
    const detail = this.detail(x / C.DETAIL_SCALE, z / C.DETAIL_SCALE);
    const hilliness = smoothstep(-0.2, 0.6, continent);
    const h = C.BASE_HEIGHT + continent * C.CONTINENT_AMPLITUDE + hilliness * (hills * 0.5 + 0.5) * C.HILL_AMPLITUDE + detail * C.DETAIL_AMPLITUDE;
    return Math.min(Math.max(Math.floor(h), C.MIN_SURFACE), C.MAX_SURFACE);
  }

  isLand(x: number, z: number): boolean {
    return this.surfaceHeight(x, z) > TerrainConfig.SEA_LEVEL;
  }

  generateChunk(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const sea = TerrainConfig.SEA_LEVEL;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const h = this.surfaceHeight(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz);
        const grassy = h > sea + 1;
        blocks[blockIndex(lx, 0, lz)] = B.BEDROCK;
        for (let y = 1; y <= h; y++) {
          let id: number = B.STONE;
          if (y > h - 4) id = grassy ? (y === h ? B.GRASS : B.DIRT) : B.SAND;
          blocks[blockIndex(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= sea; y++) blocks[blockIndex(lx, y, lz)] = B.WATER;
      }
    }
    this.placeTrees(blocks, cx, cz);
    return blocks;
  }

  private placeTrees(blocks: Uint8Array, cx: number, cz: number): void {
    const x0 = cx * CHUNK_SIZE - CROWN_RADIUS;
    const x1 = cx * CHUNK_SIZE + CHUNK_SIZE - 1 + CROWN_RADIUS;
    const z0 = cz * CHUNK_SIZE - CROWN_RADIUS;
    const z1 = cz * CHUNK_SIZE + CHUNK_SIZE - 1 + CROWN_RADIUS;
    for (let gz = Math.floor(z0 / TREE_CELL); gz <= Math.floor(z1 / TREE_CELL); gz++) {
      for (let gx = Math.floor(x0 / TREE_CELL); gx <= Math.floor(x1 / TREE_CELL); gx++) {
        const h = hash32(this.seedHash, gx, gz);
        const tx = gx * TREE_CELL + (h % TREE_CELL);
        const tz = gz * TREE_CELL + ((h >>> 8) % TREE_CELL);
        if (tx < x0 || tx > x1 || tz < z0 || tz > z1) continue;
        const roll = ((h >>> 16) & 0xffff) / 65536;
        const f = this.forest(tx / TerrainConfig.FOREST_SCALE, tz / TerrainConfig.FOREST_SCALE);
        const chance = f > 0.3 ? 0.6 : f < -0.2 ? 0 : 0.1;
        if (roll >= chance) continue;
        const ground = this.surfaceHeight(tx, tz);
        if (ground <= TerrainConfig.SEA_LEVEL + 1) continue;
        const trunk = 4 + (hash32(h, 7, 13) % 3);
        this.buildTree(blocks, cx, cz, tx, ground, tz, trunk);
      }
    }
  }

  private buildTree(blocks: Uint8Array, cx: number, cz: number, tx: number, ground: number, tz: number, trunk: number): void {
    const top = ground + trunk;
    const put = (wx: number, y: number, wz: number, id: number): void => {
      const lx = wx - cx * CHUNK_SIZE;
      const lz = wz - cz * CHUNK_SIZE;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
      const i = blockIndex(lx, y, lz);
      const cur = blocks[i];
      const allowed = id === B.LEAVES ? cur === B.AIR : cur === B.AIR || cur === B.LEAVES;
      if (allowed) blocks[i] = id;
    };
    for (let y = top - 2; y <= top + 1; y++) {
      const r = y <= top - 1 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (y === top + 1 && dx !== 0 && dz !== 0) continue;
          put(tx + dx, y, tz + dz, B.LEAVES);
        }
      }
    }
    for (let y = ground + 1; y <= top; y++) put(tx, y, tz, B.LOG);
  }
}

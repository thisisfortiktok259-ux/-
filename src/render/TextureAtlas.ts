import * as THREE from 'three';
import { BLOCKS, TILE, TILE_COUNT, type BlockId } from '../world/blocks';
import { mulberry32 } from '../world/random';
import { ATLAS_SIZE, TILE_SIZE, TILES_PER_ROW } from './tiles';

type Rgba = [number, number, number, number];
type Rand = () => number;

const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

function vary(base: [number, number, number], amount: number, r: Rand): Rgba {
  const d = (r() * 2 - 1) * amount;
  return [clamp(base[0] + d), clamp(base[1] + d), clamp(base[2] + d), 255];
}

function fill(d: Uint8ClampedArray, fn: (x: number, y: number) => Rgba): void {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const c = fn(x, y);
      const i = (y * TILE_SIZE + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = c[3];
    }
  }
}

const GRASS: [number, number, number] = [95, 159, 53];
const DIRT: [number, number, number] = [134, 96, 67];

const painters: Record<number, (d: Uint8ClampedArray, r: Rand) => void> = {
  [TILE.STONE]: (d, r) => fill(d, () => (r() < 0.12 ? vary([102, 102, 102], 10, r) : vary([128, 128, 128], 16, r))),
  [TILE.GRASS_TOP]: (d, r) => fill(d, () => vary(GRASS, 24, r)),
  [TILE.DIRT]: (d, r) => fill(d, () => (r() < 0.1 ? vary([108, 76, 52], 10, r) : vary(DIRT, 16, r))),
  [TILE.GRASS_SIDE]: (d, r) => {
    const depth: number[] = [];
    for (let x = 0; x < TILE_SIZE; x++) depth.push(3 + Math.floor(r() * 3));
    fill(d, (x, y) => (y < depth[x] ? vary(GRASS, 20, r) : vary(DIRT, 16, r)));
  },
  [TILE.COBBLESTONE]: (d, r) => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 7; i++) pts.push([r() * 16, r() * 16, 100 + r() * 45]);
    fill(d, (x, y) => {
      let d1 = Infinity;
      let d2 = Infinity;
      let shade = 110;
      for (const p of pts) {
        for (let ox = -16; ox <= 16; ox += 16) {
          for (let oy = -16; oy <= 16; oy += 16) {
            const dist = Math.hypot(x + 0.5 - (p[0] + ox), y + 0.5 - (p[1] + oy));
            if (dist < d1) { d2 = d1; d1 = dist; shade = p[2]; } else if (dist < d2) d2 = dist;
          }
        }
      }
      return d2 - d1 < 1.2 ? vary([68, 68, 68], 8, r) : vary([shade, shade, shade], 10, r);
    });
  },
  [TILE.SAND]: (d, r) => fill(d, () => vary([219, 207, 160], 12, r)),
  [TILE.LOG_SIDE]: (d, r) => fill(d, (x) => (x % 4 === 0 ? vary([78, 60, 36], 8, r) : vary([106, 83, 51], 10, r))),
  [TILE.LOG_TOP]: (d, r) => fill(d, (x, y) => {
    const dist = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (dist > 6.5) return vary([96, 75, 45], 8, r);
    return Math.floor(dist) % 2 === 0 ? vary([150, 118, 70], 6, r) : vary([176, 142, 88], 6, r);
  }),
  [TILE.PLANKS]: (d, r) => fill(d, (x, y) => {
    const row = Math.floor(y / 4);
    const seam = row % 2 === 0 ? 7 : 15;
    if (y % 4 === 3 || x === seam) return vary([112, 88, 52], 6, r);
    return vary([162, 130, 78], 10, r);
  }),
  [TILE.LEAVES]: (d, r) => fill(d, () => (r() < 0.22 ? [0, 0, 0, 0] : vary([60, 128, 40], 24, r))),
  [TILE.GLASS]: (d) => fill(d, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [215, 232, 242, 255];
    if ((x - y === 3 || x - y === 4) && x < 9) return [240, 250, 255, 255];
    return [0, 0, 0, 0];
  }),
  [TILE.WATER]: (d, r) => fill(d, () => vary([48, 92, 200], 12, r)),
  [TILE.BEDROCK]: (d, r) => fill(d, () => (r() < 0.5 ? vary([58, 58, 58], 18, r) : vary([98, 98, 98], 22, r))),
};

export class TextureAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_SIZE;
    canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    for (let tile = 0; tile < TILE_COUNT; tile++) {
      const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
      const paint = painters[tile];
      if (paint) paint(img.data, mulberry32(1000 + tile * 7919));
      ctx.putImageData(img, (tile % TILES_PER_ROW) * TILE_SIZE, Math.floor(tile / TILES_PER_ROW) * TILE_SIZE);
    }
    this.canvas = canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    this.texture = texture;
  }

  renderBlockIcon(id: BlockId, size = 40): HTMLCanvasElement {
    const def = BLOCKS[id];
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx || !def) return c;
    ctx.imageSmoothingEnabled = false;
    const s = size;
    const face = (tile: number, a: number, b: number, cc: number, dd: number, e: number, f: number, shade: number): void => {
      ctx.setTransform(a, b, cc, dd, e, f);
      ctx.globalCompositeOperation = 'source-over';
      const sx = (tile % TILES_PER_ROW) * TILE_SIZE;
      const sy = Math.floor(tile / TILES_PER_ROW) * TILE_SIZE;
      ctx.drawImage(this.canvas, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
      if (shade > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgba(0,0,0,' + shade + ')';
        ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      }
    };
    face(def.tiles.top, s / 32, -s / 64, s / 32, s / 64, 0, s / 4, 0);
    face(def.tiles.side, s / 32, s / 64, 0, s / 32, 0, s / 4, 0.2);
    face(def.tiles.side, s / 32, -s / 64, 0, s / 32, s / 2, s / 2, 0.4);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }
}

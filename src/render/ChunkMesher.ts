import { B, RENDER_MODE, RM_NONE, RM_OPAQUE, RM_TRANSLUCENT, TILE_BOTTOM, TILE_SIDE, TILE_TOP } from '../world/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT, paddedIndex } from '../world/constants';
import type { MeshBuffers } from '../world/messages';
import { tileUv } from './tiles';

type V3 = [number, number, number];

interface Corner {
  pos: V3;
  uv: [number, number];
}

interface FaceDef {
  dir: V3;
  corners: Corner[];
  shade: number;
  kind: 0 | 1 | 2;
}

// kind: 0 верх, 1 бок, 2 низ
const FACES: FaceDef[] = [
  { dir: [-1, 0, 0], shade: 0.6, kind: 1, corners: [
    { pos: [0, 1, 0], uv: [0, 1] }, { pos: [0, 0, 0], uv: [0, 0] }, { pos: [0, 1, 1], uv: [1, 1] }, { pos: [0, 0, 1], uv: [1, 0] }] },
  { dir: [1, 0, 0], shade: 0.6, kind: 1, corners: [
    { pos: [1, 1, 1], uv: [0, 1] }, { pos: [1, 0, 1], uv: [0, 0] }, { pos: [1, 1, 0], uv: [1, 1] }, { pos: [1, 0, 0], uv: [1, 0] }] },
  { dir: [0, -1, 0], shade: 0.5, kind: 2, corners: [
    { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 0], uv: [1, 1] }, { pos: [0, 0, 0], uv: [0, 1] }] },
  { dir: [0, 1, 0], shade: 1.0, kind: 0, corners: [
    { pos: [0, 1, 1], uv: [1, 1] }, { pos: [1, 1, 1], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 0] }] },
  { dir: [0, 0, -1], shade: 0.8, kind: 1, corners: [
    { pos: [1, 0, 0], uv: [0, 0] }, { pos: [0, 0, 0], uv: [1, 0] }, { pos: [1, 1, 0], uv: [0, 1] }, { pos: [0, 1, 0], uv: [1, 1] }] },
  { dir: [0, 0, 1], shade: 0.8, kind: 1, corners: [
    { pos: [0, 0, 1], uv: [0, 0] }, { pos: [1, 0, 1], uv: [1, 0] }, { pos: [0, 1, 1], uv: [0, 1] }, { pos: [1, 1, 1], uv: [1, 1] }] },
];

const AO_LEVEL = [0.5, 0.7, 0.85, 1.0];
const WATER_TOP = 0.875;

class Builder {
  positions: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  vertexCount = 0;

  toBuffers(): MeshBuffers {
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      indices: new Uint32Array(this.indices),
    };
  }
}

function faceVisible(id: number, neighbor: number): boolean {
  const nm = RENDER_MODE[neighbor];
  if (nm === RM_NONE) return true;
  if (nm === RM_OPAQUE) return false;
  if (neighbor === id) return id === B.LEAVES;
  return true;
}

export function buildChunkMesh(padded: Uint8Array): { solid: MeshBuffers; water: MeshBuffers } {
  const solid = new Builder();
  const water = new Builder();
  const get = (px: number, y: number, pz: number): number => {
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_HEIGHT) return B.AIR;
    return padded[paddedIndex(px, y, pz)];
  };
  const occ = (px: number, y: number, pz: number): number => (RENDER_MODE[get(px, y, pz)] === RM_OPAQUE ? 1 : 0);

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const px = lx + 1;
        const pz = lz + 1;
        const id = padded[paddedIndex(px, y, pz)];
        const mode = RENDER_MODE[id];
        if (mode === RM_NONE) continue;
        const isWater = mode === RM_TRANSLUCENT;
        const lowered = isWater && get(px, y + 1, pz) !== B.WATER;
        const out = isWater ? water : solid;
        for (const face of FACES) {
          const dx = face.dir[0];
          const dy = face.dir[1];
          const dz = face.dir[2];
          if (!faceVisible(id, get(px + dx, y + dy, pz + dz))) continue;
          const tile = face.kind === 0 ? TILE_TOP[id] : face.kind === 2 ? TILE_BOTTOM[id] : TILE_SIDE[id];
          const uv = tileUv(tile);
          const base = out.vertexCount;
          const ao = [3, 3, 3, 3];
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            const vy = lowered && c.pos[1] === 1 ? y + WATER_TOP : y + c.pos[1];
            out.positions.push(lx + c.pos[0], vy, lz + c.pos[2]);
            out.uvs.push(c.uv[0] ? uv.u1 : uv.u0, c.uv[1] ? uv.v1 : uv.v0);
            if (!isWater) {
              const bx = px + dx;
              const by = y + dy;
              const bz = pz + dz;
              let ax = 0; let ay = 0; let az = 0; let bxo = 0; let byo = 0; let bzo = 0;
              if (dx !== 0) { ay = c.pos[1] ? 1 : -1; bzo = c.pos[2] ? 1 : -1; }
              else if (dy !== 0) { ax = c.pos[0] ? 1 : -1; bzo = c.pos[2] ? 1 : -1; }
              else { ax = c.pos[0] ? 1 : -1; byo = c.pos[1] ? 1 : -1; }
              const s1 = occ(bx + ax, by + ay, bz + az);
              const s2 = occ(bx + bxo, by + byo, bz + bzo);
              const cr = occ(bx + ax + bxo, by + ay + byo, bz + az + bzo);
              ao[i] = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
            }
            const light = face.shade * AO_LEVEL[ao[i]];
            out.colors.push(light, light, light);
          }
          out.vertexCount += 4;
          if (ao[0] + ao[3] > ao[1] + ao[2]) out.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
          else out.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
        }
      }
    }
  }
  return { solid: solid.toBuffers(), water: water.toBuffers() };
}

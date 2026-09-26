import { B, isSolid, type BlockId } from '../world/blocks';

export interface BlockReader {
  getBlock(x: number, y: number, z: number): BlockId;
}

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export interface CollisionResult {
  dx: number;
  dy: number;
  dz: number;
  blockedX: boolean;
  blockedY: boolean;
  blockedZ: boolean;
  onGround: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
}

const EPS = 0.001;
const MAX_SUBSTEP = 0.5;

function anySolid(world: BlockReader, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): boolean {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (isSolid(world.getBlock(x, y, z))) return true;
      }
    }
  }
  return false;
}

function sweep(world: BlockReader, box: Aabb, axis: 0 | 1 | 2, d: number): { moved: number; blocked: boolean } {
  if (d === 0) return { moved: 0, blocked: false };
  const min = [box.minX, box.minY, box.minZ];
  const max = [box.maxX, box.maxY, box.maxZ];
  const lo = [Math.floor(min[0]), Math.floor(min[1]), Math.floor(min[2])];
  const hi = [Math.ceil(max[0]) - 1, Math.ceil(max[1]) - 1, Math.ceil(max[2]) - 1];
  const layerSolid = (c: number): boolean => {
    const l = lo.slice();
    const h = hi.slice();
    l[axis] = c;
    h[axis] = c;
    return anySolid(world, l[0], h[0], l[1], h[1], l[2], h[2]);
  };
  let moved = d;
  let blocked = false;
  if (d > 0) {
    const start = Math.ceil(max[axis]);
    const end = Math.ceil(max[axis] + d) - 1;
    for (let c = start; c <= end; c++) {
      if (layerSolid(c)) {
        moved = Math.min(d, c - max[axis] - EPS);
        blocked = true;
        break;
      }
    }
  } else {
    const start = Math.floor(min[axis]) - 1;
    const end = Math.floor(min[axis] + d);
    for (let c = start; c >= end; c--) {
      if (layerSolid(c)) {
        moved = Math.max(d, c + 1 - min[axis] + EPS);
        blocked = true;
        break;
      }
    }
  }
  if (axis === 0) {
    box.minX += moved;
    box.maxX += moved;
  } else if (axis === 1) {
    box.minY += moved;
    box.maxY += moved;
  } else {
    box.minZ += moved;
    box.maxZ += moved;
  }
  return { moved, blocked };
}

// VoxelCollider: движение по осям по очереди (Y, X, Z) с подшагами не длиннее 0,5 блока.
export function moveAabb(world: BlockReader, box: Aabb, dx: number, dy: number, dz: number): CollisionResult {
  const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP));
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  let bx = false;
  let by = false;
  let bz = false;
  for (let i = 0; i < steps; i++) {
    if (!by) {
      const r = sweep(world, box, 1, sy);
      ty += r.moved;
      by = r.blocked;
    }
    if (!bx) {
      const r = sweep(world, box, 0, sx);
      tx += r.moved;
      bx = r.blocked;
    }
    if (!bz) {
      const r = sweep(world, box, 2, sz);
      tz += r.moved;
      bz = r.blocked;
    }
  }
  const probeY = Math.floor(box.minY - 2 * EPS);
  const onGround = dy <= 0 && anySolid(world, Math.floor(box.minX), Math.ceil(box.maxX) - 1, probeY, probeY, Math.floor(box.minZ), Math.ceil(box.maxZ) - 1);
  return { dx: tx, dy: ty, dz: tz, blockedX: bx, blockedY: by, blockedZ: bz, onGround, hitCeiling: by && dy > 0, hitWall: bx || bz };
}

export const GRAVITY = 32;
export const MAX_FALL_SPEED = 60;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class KinematicBody {
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly previous: Vec3 = { x: 0, y: 0, z: 0 };
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  readonly width = 0.6;
  readonly height = 1.8;
  readonly eyeHeight = 1.62;
  onGround = false;
  inWater = false;
  eyesInWater = false;
  hitWall = false;
  hitCeiling = false;

  get aabb(): Aabb {
    const h = this.width / 2;
    const p = this.position;
    return { minX: p.x - h, minY: p.y, minZ: p.z - h, maxX: p.x + h, maxY: p.y + this.height, maxZ: p.z + h };
  }

  setPosition(x: number, y: number, z: number): void {
    this.position.x = x;
    this.position.y = y;
    this.position.z = z;
    this.previous.x = x;
    this.previous.y = y;
    this.previous.z = z;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
  }

  step(dt: number, world: BlockReader, gravityScale: number, waterDrag: number): void {
    this.previous.x = this.position.x;
    this.previous.y = this.position.y;
    this.previous.z = this.position.z;
    const v = this.velocity;
    v.y -= GRAVITY * gravityScale * dt;
    if (waterDrag > 0) v.y *= Math.max(0, 1 - waterDrag * dt);
    if (v.y < -MAX_FALL_SPEED) v.y = -MAX_FALL_SPEED;
    const r = moveAabb(world, this.aabb, v.x * dt, v.y * dt, v.z * dt);
    this.position.x += r.dx;
    this.position.y += r.dy;
    this.position.z += r.dz;
    if (r.blockedX) v.x = 0;
    if (r.blockedY) v.y = 0;
    if (r.blockedZ) v.z = 0;
    this.onGround = r.onGround;
    this.hitWall = r.hitWall;
    this.hitCeiling = r.hitCeiling;
    this.updateWater(world);
  }

  updateWater(world: BlockReader): void {
    const box = this.aabb;
    let inWater = false;
    for (let x = Math.floor(box.minX); x <= Math.ceil(box.maxX) - 1 && !inWater; x++) {
      for (let y = Math.floor(box.minY); y <= Math.ceil(box.maxY) - 1 && !inWater; y++) {
        for (let z = Math.floor(box.minZ); z <= Math.ceil(box.maxZ) - 1; z++) {
          if (world.getBlock(x, y, z) === B.WATER) {
            inWater = true;
            break;
          }
        }
      }
    }
    this.inWater = inWater;
    const p = this.position;
    this.eyesInWater = world.getBlock(Math.floor(p.x), Math.floor(p.y + this.eyeHeight), Math.floor(p.z)) === B.WATER;
  }
}

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  normal: [number, number, number];
  distance: number;
}

const UNLOADED_ID = 255;

// VoxelRaycaster: обход сетки блоков методом DDA (Amanatides и Woo).
export function raycast(
  world: BlockReader,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  skip: (id: BlockId) => boolean = (id) => id === B.WATER,
): RaycastHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;
  let normal: [number, number, number] = [0, 0, 0];
  let t = 0;
  for (let i = 0; i < 64; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      normal = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      normal = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      normal = [0, 0, -stepZ];
    }
    if (t > maxDistance) return null;
    const id = world.getBlock(x, y, z);
    if (id === UNLOADED_ID) return null;
    if (id !== B.AIR && !skip(id)) return { x, y, z, normal, distance: t };
  }
  return null;
}

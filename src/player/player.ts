import type { PerspectiveCamera } from 'three';
import type { InputSnapshot } from '../core/InputManager';
import { KinematicBody, type BlockReader } from '../physics/physics';
import { IS_SOLID } from '../world/blocks';
import { WORLD_HEIGHT } from '../world/constants';
import { TerrainConfig, type TerrainGenerator } from '../world/terrain';

export const MovementConstants = {
  WALK_SPEED: 4.317,
  SPRINT_MULTIPLIER: 1.3,
  FLY_MULTIPLIER: 2.5,
  FLY_VERTICAL_SPEED: 7.5,
  JUMP_VELOCITY: 9.0,
  GROUND_ACCEL_TIME: 0.1,
  SWIM_SPEED_MULTIPLIER: 0.5,
  SWIM_GRAVITY_SCALE: 0.2,
  SWIM_UP_SPEED: 3.0,
  SWIM_SINK_SPEED: 2.0,
  WATER_EXIT_SPEED: 8.5,
  WATER_DRAG: 2.0,
};

export const MOUSE_BASE_SENSITIVITY = 0.002;
const PITCH_LIMIT = (89.9 * Math.PI) / 180;

export class FirstPersonCamera {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;

  constructor(private readonly camera: PerspectiveCamera) {}

  applyMouse(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    const k = MOUSE_BASE_SENSITIVITY * this.sensitivity;
    this.yaw -= dx * k;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * k));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  place(x: number, y: number, z: number): void {
    this.camera.position.set(x, y, z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  forward(): { x: number; y: number; z: number } {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  facing(): string {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    if (Math.abs(fz) >= Math.abs(fx)) return fz < 0 ? 'север' : 'юг';
    return fx > 0 ? 'восток' : 'запад';
  }
}

export interface PlayerState {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  flying: boolean;
}

export class PlayerController {
  readonly body = new KinematicBody();
  flying = false;
  sprinting = false;

  constructor(private readonly world: BlockReader, private readonly view: FirstPersonCamera) {}

  getState(): PlayerState {
    const p = this.body.position;
    return { position: [p.x, p.y, p.z], yaw: this.view.yaw, pitch: this.view.pitch, flying: this.flying };
  }

  setState(state: PlayerState): void {
    this.body.setPosition(state.position[0], state.position[1], state.position[2]);
    this.view.yaw = state.yaw;
    this.view.pitch = state.pitch;
    this.flying = state.flying;
    this.sprinting = false;
  }

  eyePosition(alpha: number): { x: number; y: number; z: number } {
    const p = this.body.position;
    const q = this.body.previous;
    return {
      x: q.x + (p.x - q.x) * alpha,
      y: q.y + (p.y - q.y) * alpha + this.body.eyeHeight,
      z: q.z + (p.z - q.z) * alpha,
    };
  }

  update(dt: number, input: InputSnapshot): void {
    const M = MovementConstants;
    const keys = input.keysDown;
    if (input.doubleTapped.has('Space')) this.flying = !this.flying;
    if (input.doubleTapped.has('KeyW')) this.sprinting = true;
    if (!keys.has('KeyW')) this.sprinting = false;
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.view.yaw);
    const cos = Math.cos(this.view.yaw);
    let wx = -sin * forward + cos * strafe;
    let wz = -cos * forward - sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }
    const body = this.body;
    const swimming = body.inWater && !this.flying;
    let speed = M.WALK_SPEED;
    if (this.sprinting && forward > 0) speed *= M.SPRINT_MULTIPLIER;
    if (this.flying) speed *= M.FLY_MULTIPLIER;
    if (swimming) speed *= M.SWIM_SPEED_MULTIPLIER;
    const v = body.velocity;
    const tx = wx * speed;
    const tz = wz * speed;
    const accel = Math.max(speed, Math.hypot(v.x, v.z), M.WALK_SPEED) / M.GROUND_ACCEL_TIME;
    const ddx = tx - v.x;
    const ddz = tz - v.z;
    const dl = Math.hypot(ddx, ddz);
    const maxStep = accel * dt;
    if (dl <= maxStep) {
      v.x = tx;
      v.z = tz;
    } else {
      v.x += (ddx / dl) * maxStep;
      v.z += (ddz / dl) * maxStep;
    }
    const up = keys.has('Space');
    const down = keys.has('ShiftLeft') || keys.has('ShiftRight');
    let gravityScale = 1;
    let drag = 0;
    if (this.flying) {
      gravityScale = 0;
      v.y = (up ? M.FLY_VERTICAL_SPEED : 0) - (down ? M.FLY_VERTICAL_SPEED : 0);
    } else if (swimming) {
      gravityScale = M.SWIM_GRAVITY_SCALE;
      drag = M.WATER_DRAG;
      if (up) v.y = body.hitWall ? M.WATER_EXIT_SPEED : Math.max(v.y, M.SWIM_UP_SPEED);
      else if (v.y < -M.SWIM_SINK_SPEED) v.y = -M.SWIM_SINK_SPEED;
    } else if (up && body.onGround) {
      v.y = M.JUMP_VELOCITY;
    }
    body.step(dt, this.world, gravityScale, drag);
    if (this.flying && body.onGround) this.flying = false;
    if (body.hitWall) this.sprinting = false;
  }
}

// SpawnLocator: ближайшая к центру мира суша, поиск по спирали до 256 блоков.
export function findSpawn(terrain: TerrainGenerator): { x: number; y: number; z: number } {
  const sea = TerrainConfig.SEA_LEVEL;
  const at = (x: number, z: number): { x: number; y: number; z: number } | null => {
    const h = terrain.surfaceHeight(x, z);
    return h > sea ? { x: x + 0.5, y: h + 1, z: z + 0.5 } : null;
  };
  const center = at(0, 0);
  if (center) return center;
  for (let r = 1; r <= 256; r++) {
    for (let i = -r; i <= r; i++) {
      const found = at(i, -r) || at(i, r) || at(-r, i) || at(r, i);
      if (found) return found;
    }
  }
  return { x: 0.5, y: sea + 1, z: 0.5 };
}

export function adjustSpawn(world: BlockReader, body: KinematicBody): void {
  const x = Math.floor(body.position.x);
  const z = Math.floor(body.position.z);
  const startY = Math.floor(body.position.y);
  let y = startY;
  const blocked = (yy: number): boolean => IS_SOLID[world.getBlock(x, yy, z)] === 1;
  while (y < WORLD_HEIGHT - 2 && (blocked(y) || blocked(y + 1))) y++;
  if (y !== startY) body.setPosition(body.position.x, y, body.position.z);
}

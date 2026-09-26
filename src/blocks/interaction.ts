import { Emitter } from '../core/events';
import type { InputSnapshot } from '../core/InputManager';
import { aabbIntersects, raycast, type RaycastHit } from '../physics/physics';
import type { FirstPersonCamera, PlayerController } from '../player/player';
import type { BlockHighlight } from '../render/GameRenderer';
import { B, UNLOADED, isBreakable, type BlockId } from '../world/blocks';
import { WORLD_HEIGHT } from '../world/constants';
import type { VoxelWorld } from '../world/VoxelWorld';

export const HOTBAR_DEFAULT_SLOTS: BlockId[] = [B.STONE, B.COBBLESTONE, B.PLANKS, B.LOG, B.GLASS, B.DIRT, B.GRASS, B.SAND, B.LEAVES];

export interface ActiveSlotChanged {
  activeSlot: number;
  blockId: BlockId;
  silent: boolean;
}

export class HotbarController {
  readonly slots: BlockId[] = HOTBAR_DEFAULT_SLOTS.slice();
  readonly changed = new Emitter<ActiveSlotChanged>();
  private active = 0;

  get activeSlot(): number {
    return this.active;
  }

  get selectedBlockId(): BlockId {
    return this.slots[this.active];
  }

  update(input: InputSnapshot): void {
    for (let i = 1; i <= 9; i++) if (input.keysPressed.has('Digit' + i)) this.setActiveSlot(i - 1);
    if (input.wheelSteps !== 0) {
      const n = this.slots.length;
      this.setActiveSlot((((this.active + input.wheelSteps) % n) + n) % n);
    }
  }

  setActiveSlot(index: number, silent = false): void {
    const i = Number.isInteger(index) && index >= 0 && index < this.slots.length ? index : 0;
    if (i === this.active && !silent) return;
    this.active = i;
    this.changed.emit({ activeSlot: i, blockId: this.slots[i], silent });
  }
}

export const REACH = 5;
const REPEAT_INTERVAL = 0.25;
const BUTTON_BREAK = 0;
const BUTTON_PLACE = 2;

export class BlockInteractionController {
  private target: RaycastHit | null = null;
  private breakTimer = 0;
  private placeTimer = 0;

  constructor(
    private readonly world: VoxelWorld,
    private readonly player: PlayerController,
    private readonly view: FirstPersonCamera,
    private readonly highlight: BlockHighlight,
    private readonly selectedBlock: () => BlockId,
  ) {}

  update(dt: number, input: InputSnapshot): void {
    this.target = this.findTarget();
    if (input.buttonsPressed.has(BUTTON_BREAK)) {
      this.breakTarget();
      this.breakTimer = REPEAT_INTERVAL;
    } else if (input.buttonsDown.has(BUTTON_BREAK)) {
      this.breakTimer -= dt;
      if (this.breakTimer <= 0) {
        this.breakTarget();
        this.breakTimer += REPEAT_INTERVAL;
      }
    }
    if (input.buttonsPressed.has(BUTTON_PLACE)) {
      this.placeAtTarget();
      this.placeTimer = REPEAT_INTERVAL;
    } else if (input.buttonsDown.has(BUTTON_PLACE)) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) {
        this.placeAtTarget();
        this.placeTimer += REPEAT_INTERVAL;
      }
    }
    this.highlight.set(this.target);
  }

  private findTarget(): RaycastHit | null {
    const p = this.player.body.position;
    const f = this.view.forward();
    return raycast(this.world, p.x, p.y + this.player.body.eyeHeight, p.z, f.x, f.y, f.z, REACH);
  }

  private breakTarget(): void {
    const t = this.target;
    if (!t) return;
    if (!isBreakable(this.world.getBlock(t.x, t.y, t.z))) return;
    if (this.world.setBlock(t.x, t.y, t.z, B.AIR)) this.target = this.findTarget();
  }

  private placeAtTarget(): void {
    const t = this.target;
    if (!t) return;
    const x = t.x + t.normal[0];
    const y = t.y + t.normal[1];
    const z = t.z + t.normal[2];
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const current = this.world.getBlock(x, y, z);
    if (current === UNLOADED || (current !== B.AIR && current !== B.WATER)) return;
    const cell = { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
    if (aabbIntersects(cell, this.player.body.aabb)) return;
    if (this.world.setBlock(x, y, z, this.selectedBlock())) this.target = this.findTarget();
  }
}

import * as THREE from 'three';
import { CHUNK_SIZE } from '../world/constants';

const SKY = new THREE.Color(0x87b8ff);
const WATER_FOG = new THREE.Color(0x1f4fa8);

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly fog: THREE.Fog;
  private readonly background = SKY.clone();
  private renderDistance = 6;
  private underwater = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.fog = new THREE.Fog(SKY.clone(), 50, 100);
    this.scene.fog = this.fog;
    this.scene.background = this.background;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.applyFog();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  setRenderDistance(chunks: number): void {
    this.renderDistance = chunks;
    this.camera.far = chunks * CHUNK_SIZE + 64;
    this.camera.updateProjectionMatrix();
    this.applyFog();
  }

  setFov(degrees: number): void {
    this.camera.fov = degrees;
    this.camera.updateProjectionMatrix();
  }

  setUnderwater(flag: boolean): void {
    if (flag === this.underwater) return;
    this.underwater = flag;
    this.applyFog();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private applyFog(): void {
    if (this.underwater) {
      this.fog.color.copy(WATER_FOG);
      this.fog.near = 0.5;
      this.fog.far = 20;
      this.background.copy(WATER_FOG);
    } else {
      const far = this.renderDistance * CHUNK_SIZE;
      this.fog.color.copy(SKY);
      this.fog.near = far * 0.7;
      this.fog.far = far;
      this.background.copy(SKY);
    }
  }
}

export class BlockHighlight {
  private readonly lines: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    const material = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7 });
    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.visible = false;
    scene.add(this.lines);
  }

  set(target: { x: number; y: number; z: number } | null): void {
    if (!target) {
      this.lines.visible = false;
      return;
    }
    this.lines.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    this.lines.visible = true;
  }
}

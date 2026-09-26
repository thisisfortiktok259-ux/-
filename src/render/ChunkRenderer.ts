import * as THREE from 'three';
import { CHUNK_SIZE, chunkKey, parseKey } from '../world/constants';
import type { MeshBuffers, MeshChunkResult } from '../world/messages';

interface ChunkMeshes {
  solid: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

export class ChunkRenderer {
  private readonly solidMaterial: THREE.MeshBasicMaterial;
  private readonly waterMaterial: THREE.MeshBasicMaterial;
  private readonly meshes = new Map<string, ChunkMeshes>();

  constructor(private readonly scene: THREE.Scene, atlas: THREE.Texture) {
    this.solidMaterial = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5 });
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: atlas,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  get count(): number {
    return this.meshes.size;
  }

  setChunkMesh(result: MeshChunkResult): void {
    this.removeChunk(result.cx, result.cz);
    const solid = this.createMesh(result.solid, this.solidMaterial, result.cx, result.cz, 0);
    const water = this.createMesh(result.water, this.waterMaterial, result.cx, result.cz, 1);
    this.meshes.set(chunkKey(result.cx, result.cz), { solid, water });
  }

  removeChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const entry = this.meshes.get(key);
    if (!entry) return;
    for (const mesh of [entry.solid, entry.water]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.delete(key);
  }

  clear(): void {
    for (const key of Array.from(this.meshes.keys())) {
      const [cx, cz] = parseKey(key);
      this.removeChunk(cx, cz);
    }
  }

  private createMesh(buffers: MeshBuffers, material: THREE.Material, cx: number, cz: number, order: number): THREE.Mesh | null {
    if (buffers.indices.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(buffers.uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
    mesh.renderOrder = order;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }
}

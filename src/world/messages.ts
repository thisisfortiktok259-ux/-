export interface MeshBuffers {
  positions: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface MeshChunkResult {
  cx: number;
  cz: number;
  version: number;
  solid: MeshBuffers;
  water: MeshBuffers;
}

export type WorkerResponse =
  | { type: 'generate'; id: number; blocks: Uint8Array }
  | { type: 'mesh'; id: number; result: MeshChunkResult }
  | { type: 'error'; id: number; message: string };

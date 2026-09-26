import { TerrainGenerator } from './terrain';
import { buildChunkMesh } from '../render/ChunkMesher';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let generator: TerrainGenerator | null = null;

scope.onmessage = (event: MessageEvent) => {
  const msg = event.data;
  try {
    if (msg.type === 'init') {
      generator = new TerrainGenerator(msg.seed);
      return;
    }
    if (msg.type === 'generate') {
      if (!generator) throw new Error('Мир не инициализирован');
      const blocks = generator.generateChunk(msg.cx, msg.cz);
      scope.postMessage({ type: 'generate', id: msg.id, blocks }, [blocks.buffer]);
      return;
    }
    if (msg.type === 'mesh') {
      const mesh = buildChunkMesh(msg.padded);
      const result = { cx: msg.cx, cz: msg.cz, version: msg.version, solid: mesh.solid, water: mesh.water };
      const transfer: Transferable[] = [
        mesh.solid.positions.buffer, mesh.solid.uvs.buffer, mesh.solid.colors.buffer, mesh.solid.indices.buffer,
        mesh.water.positions.buffer, mesh.water.uvs.buffer, mesh.water.colors.buffer, mesh.water.indices.buffer,
      ] as Transferable[];
      scope.postMessage({ type: 'mesh', id: msg.id, result }, transfer);
    }
  } catch (error) {
    scope.postMessage({ type: 'error', id: msg.id || 0, message: error instanceof Error ? error.message : String(error) });
  }
};

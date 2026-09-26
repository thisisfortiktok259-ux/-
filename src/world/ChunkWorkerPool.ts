import type { MeshChunkResult, WorkerResponse } from './messages';

interface Job {
  resolve: (value: any) => void;
  reject: (reason: unknown) => void;
  worker: number;
}

const MAX_RESTARTS = 8;

export class ChunkWorkerPool {
  readonly size: number;
  broken = false;
  private workers: Worker[] = [];
  private load: number[] = [];
  private jobs = new Map<number, Job>();
  private nextId = 1;
  private seed: string | null = null;
  private restarts = 0;

  constructor() {
    const cores = navigator.hardwareConcurrency || 2;
    this.size = Math.min(4, Math.max(1, cores - 1));
    for (let i = 0; i < this.size; i++) this.spawn(i);
  }

  get capacity(): number {
    return this.size * 2;
  }

  init(seed: string): void {
    this.seed = seed;
    for (const w of this.workers) w.postMessage({ type: 'init', seed });
  }

  generate(cx: number, cz: number): Promise<Uint8Array> {
    return this.post<Uint8Array>({ type: 'generate', cx, cz }, []);
  }

  mesh(cx: number, cz: number, version: number, padded: Uint8Array): Promise<MeshChunkResult> {
    return this.post<MeshChunkResult>({ type: 'mesh', cx, cz, version, padded }, [padded.buffer as ArrayBuffer]);
  }

  private spawn(i: number): void {
    const worker = new Worker(new URL('./chunk.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(i, event.data);
    worker.onerror = (event: ErrorEvent) => {
      event.preventDefault();
      this.restart(i, event.message || 'Воркер остановился');
    };
    this.workers[i] = worker;
    this.load[i] = 0;
    if (this.seed !== null) worker.postMessage({ type: 'init', seed: this.seed });
  }

  private restart(i: number, message: string): void {
    for (const [id, job] of this.jobs) {
      if (job.worker === i) {
        this.jobs.delete(id);
        job.reject(new Error(message));
      }
    }
    this.workers[i].terminate();
    this.restarts++;
    if (this.restarts > MAX_RESTARTS) {
      this.broken = true;
      return;
    }
    this.spawn(i);
  }

  private post<T>(msg: Record<string, unknown>, transfer: Transferable[]): Promise<T> {
    if (this.broken) return Promise.reject(new Error('Фоновые потоки недоступны'));
    let best = 0;
    for (let i = 1; i < this.size; i++) if (this.load[i] < this.load[best]) best = i;
    const id = this.nextId++;
    this.load[best]++;
    return new Promise<T>((resolve, reject) => {
      this.jobs.set(id, { resolve, reject, worker: best });
      this.workers[best].postMessage({ ...msg, id }, transfer);
    });
  }

  private onMessage(i: number, data: WorkerResponse): void {
    const job = this.jobs.get(data.id);
    if (!job) return;
    this.jobs.delete(data.id);
    this.load[i] = Math.max(0, this.load[i] - 1);
    if (data.type === 'error') job.reject(new Error(data.message));
    else if (data.type === 'generate') job.resolve(data.blocks);
    else job.resolve(data.result);
  }
}

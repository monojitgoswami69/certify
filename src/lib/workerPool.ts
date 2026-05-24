/**
 * Worker Pool for Parallel Certificate Generation
 *
 * ARCHITECTURE: Chunk-based processing with synchronization barriers.
 *
 * Workers stay warm between chunks — template Blob is decoded ONCE per worker
 * at init time. The pool emits ALL selected formats from a single canvas draw
 * (eliminating the previous "run generation N times for N formats" overhead).
 *
 * FLOW:
 *   1. initialize() — Spawn workers, send template Blob (zero-copy) + formats
 *   2. processChunk() — Send N tasks, wait for ALL to complete, return
 *   3. (caller zips per format and downloads while workers are IDLE)
 *   4. processChunk() — Next chunk...
 *   5. terminate() — Kill all workers
 */

import type { TextBox, CsvRow } from '../types';

export type OutputFormat = 'png' | 'jpg' | 'pdf';

// =============================================================================
// Types
// =============================================================================

export interface WorkerTask {
    id: number;
    row: CsvRow;
    rowIndex: number;
    filename: string;
}

export interface WorkerResult {
    id: number;
    rowIndex: number;
    filename: string;
    blobs?: Partial<Record<OutputFormat, Blob>>;
    error?: string;
}

// =============================================================================
// Worker Pool Class
// =============================================================================

export class CertificateWorkerPool {
    private workers: Worker[] = [];
    private pendingResolves: Array<() => void> = [];

    static getOptimalWorkerCount(): number {
        const cores = navigator.hardwareConcurrency || 4;
        return Math.max(2, Math.min(Math.floor(cores / 2), 16));
    }

    /**
     * Initialize the worker pool.
     *
     * Sends the template as a Blob ref — each worker calls createImageBitmap()
     * on its own copy. The Blob's underlying buffer is shared across workers via
     * structured clone (no actual byte copy). This replaces the previous approach
     * of extracting ImageData on the main thread and shipping N copies.
     */
    async initialize(
        templateFile: Blob,
        templateWidth: number,
        templateHeight: number,
        boxes: TextBox[],
        formats: OutputFormat[],
        maxWorkers?: number
    ): Promise<number> {
        const workerCount = maxWorkers ?? CertificateWorkerPool.getOptimalWorkerCount();
        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(
                new URL('./certificateWorker.ts', import.meta.url),
                { type: 'module' }
            );

            const initPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Worker ${i} initialization timed out`));
                }, 15000);

                const onReady = (event: MessageEvent) => {
                    if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        worker.removeEventListener('message', onReady);
                        worker.removeEventListener('error', onError);
                        resolve();
                    }
                };

                const onError = (event: ErrorEvent) => {
                    clearTimeout(timeout);
                    worker.removeEventListener('message', onReady);
                    reject(new Error(`Worker ${i} error: ${event.message}`));
                };

                worker.addEventListener('message', onReady);
                worker.addEventListener('error', onError);

                this.pendingResolves.push(resolve);
            });

            this.workers.push(worker);
            initPromises.push(initPromise);

            // Send the Blob ref — postMessage with a Blob is essentially free
            // (structured clone shares the underlying buffer).
            worker.postMessage({
                type: 'init',
                templateBlob: templateFile,
                templateWidth,
                templateHeight,
                boxes,
                formats,
                jpegQuality: 0.92,
            });
        }

        await Promise.all(initPromises);
        this.pendingResolves = [];
        return workerCount;
    }

    /**
     * Process a chunk of tasks across all workers in parallel.
     * Resolves when ALL workers have completed their share.
     */
    async processChunk(
        tasks: WorkerTask[],
        onResult?: (result: WorkerResult, completedInChunk: number, totalInChunk: number) => void
    ): Promise<void> {
        if (tasks.length === 0) return;

        const workerCount = this.workers.length;
        const tasksPerWorker = Math.ceil(tasks.length / workerCount);

        const workerBatches: WorkerTask[][] = [];
        for (let i = 0; i < workerCount; i++) {
            const start = i * tasksPerWorker;
            const end = Math.min(start + tasksPerWorker, tasks.length);
            if (start < tasks.length) {
                workerBatches.push(tasks.slice(start, end));
            }
        }

        let completedCount = 0;
        const totalCount = tasks.length;

        const workerPromises = workerBatches.map((batch, workerIndex) => {
            return new Promise<void>((resolve) => {
                const worker = this.workers[workerIndex];

                this.pendingResolves.push(resolve);

                const handler = (event: MessageEvent) => {
                    if (event.data.type === 'itemComplete') {
                        const r = event.data.result;
                        completedCount++;

                        onResult?.(
                            {
                                id: r.id,
                                rowIndex: r.rowIndex,
                                filename: r.filename,
                                blobs: r.blobs,
                                error: r.error,
                            },
                            completedCount,
                            totalCount
                        );
                    } else if (event.data.type === 'batchComplete') {
                        worker.removeEventListener('message', handler);
                        resolve();
                    }
                };

                worker.addEventListener('message', handler);

                worker.postMessage({
                    type: 'generateBatch',
                    items: batch.map(t => ({
                        id: t.id,
                        rowIndex: t.rowIndex,
                        row: t.row,
                        filename: t.filename,
                    })),
                });
            });
        });

        await Promise.all(workerPromises);
        this.pendingResolves = [];
    }

    /**
     * Generate a single certificate for size probing.
     */
    async generateSingle(task: WorkerTask): Promise<WorkerResult> {
        if (this.workers.length === 0) {
            throw new Error('Worker pool not initialized');
        }

        const worker = this.workers[0];

        return new Promise<WorkerResult>((resolve) => {
            let result: WorkerResult | null = null;

            const handler = (event: MessageEvent) => {
                if (event.data.type === 'itemComplete') {
                    const r = event.data.result;
                    result = {
                        id: r.id,
                        rowIndex: r.rowIndex,
                        filename: r.filename,
                        blobs: r.blobs,
                        error: r.error,
                    };
                } else if (event.data.type === 'batchComplete') {
                    worker.removeEventListener('message', handler);
                    resolve(result ?? {
                        id: task.id,
                        rowIndex: task.rowIndex,
                        filename: task.filename,
                        error: 'Probe generation failed',
                    });
                }
            };

            worker.addEventListener('message', handler);

            const noop = () => {
                resolve({
                    id: task.id,
                    rowIndex: task.rowIndex,
                    filename: task.filename,
                    error: 'Worker pool terminated',
                });
            };
            this.pendingResolves.push(noop);

            worker.postMessage({
                type: 'generateBatch',
                items: [{
                    id: task.id,
                    rowIndex: task.rowIndex,
                    row: task.row,
                    filename: task.filename,
                }],
            });
        });
    }

    getWorkerCount(): number {
        return this.workers.length;
    }

    terminate(): void {
        for (const resolve of this.pendingResolves) {
            resolve();
        }
        this.pendingResolves = [];

        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }
}

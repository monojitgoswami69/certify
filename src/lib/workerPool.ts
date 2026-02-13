/**
 * Worker Pool for Parallel Certificate Generation
 * 
 * ARCHITECTURE: Chunk-based processing with synchronization barriers.
 * 
 * The pool is designed to be called multiple times (once per ZIP chunk).
 * Workers stay warm between calls — template data is cached in each worker.
 * 
 * FLOW:
 *   1. initialize() — Create workers, send template ONCE
 *   2. processChunk() — Send N tasks, wait for ALL to complete, return
 *   3. (caller zips and downloads while workers are IDLE)
 *   4. processChunk() — Next chunk...
 *   5. terminate() — Kill all workers
 * 
 * This ensures workers are NEVER running during ZIP packaging,
 * eliminating CPU contention and memory pressure.
 */

import type { TextBox, CsvRow } from '../types';

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
    blob?: Blob;
    error?: string;
}

// =============================================================================
// Worker Pool Class
// =============================================================================

export class CertificateWorkerPool {
    private workers: Worker[] = [];
    private outputFormat: string = 'image/jpeg';
    private fileExtension: string = 'jpg';

    /**
     * Pending resolve callbacks for processChunk.
     * terminate() calls these to unblock awaiting code.
     */
    private pendingResolves: Array<() => void> = [];

    /**
     * Get optimal number of workers.
     * Capped to HALF of reported cores because the browser's
     * JPEG encoding thread pool saturates at ~half the logical processors.
     * Extra workers beyond that just queue up waiting for encoding slots.
     */
    static getOptimalWorkerCount(): number {
        const cores = navigator.hardwareConcurrency || 4;
        return Math.max(2, Math.min(Math.floor(cores / 2), 16));
    }

    /**
     * Initialize the worker pool — sends template to each worker ONCE.
     * Workers remain warm and reusable across multiple processChunk() calls.
     * 
     * @param maxWorkers - If 1, uses single worker. If undefined, uses all cores.
     */
    async initialize(
        templateImage: HTMLImageElement,
        boxes: TextBox[],
        format: 'png' | 'jpg' | 'pdf',
        maxWorkers?: number
    ): Promise<number> {
        // Determine output format and extension
        if (format === 'png') {
            this.outputFormat = 'image/png';
            this.fileExtension = 'png';
        } else if (format === 'pdf') {
            this.outputFormat = 'image/jpeg';
            this.fileExtension = 'pdf';
        } else {
            this.outputFormat = 'image/jpeg';
            this.fileExtension = 'jpg';
        }

        // Extract template image data once
        const canvas = document.createElement('canvas');
        canvas.width = templateImage.naturalWidth;
        canvas.height = templateImage.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(templateImage, 0, 0);

        const templateImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const templateWidth = canvas.width;
        const templateHeight = canvas.height;

        // Release temp canvas
        canvas.width = 0;
        canvas.height = 0;

        // Create workers
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
                }, 10000);

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

                // Track this resolve so terminate() can unblock it
                this.pendingResolves.push(resolve);
            });

            this.workers.push(worker);
            initPromises.push(initPromise);

            // Send template data (each worker gets its own copy)
            const imageDataCopy = new ImageData(
                new Uint8ClampedArray(templateImageData.data),
                templateWidth,
                templateHeight
            );

            worker.postMessage({
                type: 'init',
                templateImageData: imageDataCopy,
                templateWidth,
                templateHeight,
                boxes,
                outputFormat: this.outputFormat,
                quality: this.outputFormat === 'image/jpeg' ? 0.92 : 1,
            });
        }

        await Promise.all(initPromises);
        this.pendingResolves = [];
        return workerCount;
    }

    /**
     * Get the file extension for output files
     */
    getFileExtension(): string {
        return this.fileExtension;
    }

    /**
     * Process a chunk of tasks across all workers, then RETURN.
     * 
     * This is the core method. It divides the given tasks equally among
     * workers, processes them in parallel, and resolves ONLY when every
     * worker has completed its share. After this method resolves,
     * ALL workers are IDLE — safe for ZIP packaging.
     * 
     * Designed to be called repeatedly (once per ZIP chunk) on the same pool.
     * Workers stay warm between calls.
     * 
     * @param tasks - The subset of tasks to process in this chunk
     * @param onResult - Called synchronously for each completed certificate.
     *                    Receives the result and progress counters for this chunk.
     */
    async processChunk(
        tasks: WorkerTask[],
        onResult?: (result: WorkerResult, completedInChunk: number, totalInChunk: number) => void
    ): Promise<void> {
        if (tasks.length === 0) return;

        const workerCount = this.workers.length;
        const tasksPerWorker = Math.ceil(tasks.length / workerCount);

        // Divide tasks equally among workers
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

        // Launch all workers in parallel, collect results as they arrive
        const workerPromises = workerBatches.map((batch, workerIndex) => {
            return new Promise<void>((resolve) => {
                const worker = this.workers[workerIndex];

                // Track this resolve so terminate() can unblock it
                this.pendingResolves.push(resolve);

                const handler = (event: MessageEvent) => {
                    if (event.data.type === 'itemComplete') {
                        const r = event.data.result;
                        completedCount++;

                        // Call result handler synchronously — no promise queue,
                        // no async backlog. The caller adds to JSZip (sync).
                        onResult?.(
                            {
                                id: r.id,
                                rowIndex: r.rowIndex,
                                filename: r.filename,
                                blob: r.blob,
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

                // Send this chunk's batch to the worker
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

        // SYNCHRONIZATION BARRIER: Wait for ALL workers to complete
        await Promise.all(workerPromises);

        // Clear pending resolves (all completed normally)
        this.pendingResolves = [];
    }

    /**
     * Generate a single certificate for size probing.
     * Uses one worker, waits for completion.
     */
    async generateSingle(task: WorkerTask): Promise<WorkerResult> {
        if (this.workers.length === 0) {
            throw new Error('Worker pool not initialized');
        }

        const worker = this.workers[0];

        return new Promise<WorkerResult>((resolve) => {
            const handler = (event: MessageEvent) => {
                if (event.data.type === 'itemComplete') {
                    const r = event.data.result;
                    const result: WorkerResult = {
                        id: r.id,
                        rowIndex: r.rowIndex,
                        filename: r.filename,
                        blob: r.blob,
                        error: r.error,
                    };
                    worker.removeEventListener('message', handler);

                    // Wait for batchComplete before resolving
                    const batchHandler = (e: MessageEvent) => {
                        if (e.data.type === 'batchComplete') {
                            worker.removeEventListener('message', batchHandler);
                            resolve(result);
                        }
                    };
                    worker.addEventListener('message', batchHandler);
                } else if (event.data.type === 'batchComplete') {
                    worker.removeEventListener('message', handler);
                    resolve({
                        id: task.id,
                        rowIndex: task.rowIndex,
                        filename: task.filename,
                        error: 'Probe generation failed',
                    });
                }
            };

            worker.addEventListener('message', handler);

            // Track a resolve so terminate() can unblock any pending processChunk calls.
            // Note: generateSingle has its own resolve; we register a no-op here.
            const noop = () => { resolve({ id: task.id, rowIndex: task.rowIndex, filename: task.filename, error: 'Worker pool terminated' }); };
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

    /**
     * Get current pool size
     */
    getWorkerCount(): number {
        return this.workers.length;
    }

    /**
     * Terminate all workers and release resources.
     * Also resolves any pending processChunk promises to unblock awaiting code.
     */
    terminate(): void {
        // Resolve pending processChunk promises FIRST (unblocks generateBatch)
        for (const resolve of this.pendingResolves) {
            resolve();
        }
        this.pendingResolves = [];

        // Now kill all workers
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }
}

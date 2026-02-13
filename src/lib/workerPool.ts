/**
 * Worker Pool for Parallel Certificate Generation
 * 
 * Divides work equally among workers. Each worker processes its batch sequentially.
 * Uses 100% of CPU cores for maximum performance.
 * 
 * OPTIMIZATION:
 * - Batch-based processing (fewer IPC calls)
 * - Equal division of work
 * - No PDF generation
 * - Output format matches template
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

interface WorkerState {
    worker: Worker;
    ready: boolean;
}

// =============================================================================
// Worker Pool Class
// =============================================================================

export class CertificateWorkerPool {
    private workerStates: WorkerState[] = [];
    private outputFormat: string = 'image/jpeg';
    private fileExtension: string = 'jpg';

    /**
     * Get optimal number of workers (100% of CPU cores, minimum 2, maximum 32)
     */
    static getOptimalWorkerCount(): number {
        const cores = navigator.hardwareConcurrency || 4;
        return Math.max(2, Math.min(cores, 32));
    }

    /**
     * Initialize the worker pool - sends template to each worker ONCE
     * @param maxWorkers - If 1, uses single worker. If undefined, uses all cores.
     */
    async initialize(
        templateImage: HTMLImageElement,
        boxes: TextBox[],
        format: 'png' | 'jpg' | 'webp' | 'pdf',
        maxWorkers?: number
    ): Promise<number> {
        // Determine output format and extension
        if (format === 'png') {
            this.outputFormat = 'image/png';
            this.fileExtension = 'png';
        } else if (format === 'webp') {
            this.outputFormat = 'image/webp';
            this.fileExtension = 'webp';
        } else if (format === 'pdf') {
            // For PDF we generate high quality JPEG first
            this.outputFormat = 'image/jpeg';
            this.fileExtension = 'pdf'; // We'll convert to PDF on main thread or just use this as a marker
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

        // Clean up temporary canvas
        canvas.width = 0;
        canvas.height = 0;

        // Create worker pool - use specified count or optimal
        const workerCount = maxWorkers ?? CertificateWorkerPool.getOptimalWorkerCount();
        const initPromises: Promise<void>[] = [];

        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(
                new URL('./certificateWorker.ts', import.meta.url),
                { type: 'module' }
            );

            const state: WorkerState = {
                worker,
                ready: false,
            };

            const initPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Worker ${i} initialization timed out`));
                }, 10000); // 10 second timeout

                const initHandler = (event: MessageEvent) => {
                    if (event.data.type === 'ready') {
                        clearTimeout(timeout);
                        state.ready = true;
                        worker.removeEventListener('message', initHandler);
                        resolve();
                    }
                };

                const errorHandler = (event: ErrorEvent) => {
                    clearTimeout(timeout);
                    reject(new Error(`Worker ${i} error: ${event.message}`));
                };

                worker.addEventListener('message', initHandler);
                worker.addEventListener('error', errorHandler);
            });

            this.workerStates.push(state);
            initPromises.push(initPromise);

            // Send template data ONCE to this worker
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
        return workerCount;
    }

    /**
     * Get the file extension for output files
     */
    getFileExtension(): string {
        return this.fileExtension;
    }

    /**
     * Process all tasks by dividing equally among workers
     * Each worker processes its batch sequentially
     */
    async processBatch(
        tasks: WorkerTask[],
        onProgress?: (completed: number, total: number, latestResult?: WorkerResult) => void | Promise<void>
    ): Promise<void> {
        const workerCount = this.workerStates.length;
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

        // Create promises for each worker's batch
        const batchPromises = workerBatches.map((batch, workerIndex) => {
            return new Promise<void>((resolve) => {
                const state = this.workerStates[workerIndex];
                let progressQueue = Promise.resolve();

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

                        completedCount++;
                        progressQueue = progressQueue
                            .then(() => onProgress?.(completedCount, totalCount, result))
                            .catch(() => undefined);
                    } else if (event.data.type === 'batchComplete') {
                        state.worker.removeEventListener('message', handler);
                        void progressQueue.finally(resolve);
                    }
                };

                state.worker.addEventListener('message', handler);

                // Send batch to worker
                state.worker.postMessage({
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

        await Promise.all(batchPromises);
    }

    /**
     * Get current pool statistics
     */
    getStats(): { total: number; ready: number } {
        return {
            total: this.workerStates.length,
            ready: this.workerStates.filter(s => s.ready).length,
        };
    }

    /**
     * Terminate all workers and clean up
     */
    terminate(): void {
        for (const state of this.workerStates) {
            state.worker.terminate();
        }
        this.workerStates = [];
    }
}

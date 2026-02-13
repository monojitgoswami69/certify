/**
 * Generate Button Component
 * 
 * Main action button for certificate generation.
 * Handles batch certificate generation with progress tracking.
 * Downloads certificates as a ZIP file.
 * 
 * PERFORMANCE: Uses Web Workers for parallel processing (~80% of CPU cores)
 * MEMORY: Chunked ZIP generation to avoid memory exhaustion on large batches
 */

import { useState, useRef, useCallback } from 'react';
import { Download, Loader2, Pause, Play, X, CheckCircle2, AlertCircle, RefreshCw, Clock, Cpu } from 'lucide-react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { useAppStore } from '../store/appStore';
import { downloadBlob, sanitizeFilename, delay } from '../lib/utils';
import { loadFont } from '../lib/certificateGenerator';
import { CertificateWorkerPool } from '../lib/workerPool';
import type { CsvRow } from '../types';

// =============================================================================
// Performance & Memory Constants
// =============================================================================

/**
 * Maximum certificates per ZIP file to avoid memory issues.
 * Larger chunks reduce number of downloads but increase peak memory during packaging.
 */
const MAX_BATCH_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB per ZIP part

// =============================================================================
// Types
// =============================================================================

interface FailedRecord {
    rowIndex: number;
    name: string;
    row: CsvRow;
    error: string;
}

interface GenerateLogs {
    firstGenerated: Date | null;
    lastGenerated: Date | null;
    totalElapsed: number;
}

interface GenerateProgress {
    current: number;
    total: number;
    currentName: string;
    status: 'idle' | 'generating' | 'paused' | 'completed' | 'zipping' | 'loading-fonts' | 'initializing';
    errors: FailedRecord[];
    generated: number;
    zipPart: number;
    totalZipParts: number;
    workerCount: number;
}

const DEFAULT_PROGRESS: GenerateProgress = {
    current: 0,
    total: 0,
    currentName: '',
    status: 'idle',
    errors: [],
    generated: 0,
    zipPart: 0,
    totalZipParts: 1,
    workerCount: 0,
};

const DEFAULT_LOGS: GenerateLogs = {
    firstGenerated: null,
    lastGenerated: null,
    totalElapsed: 0,
};

// =============================================================================
// Component
// =============================================================================

export function GenerateButton() {
    const {
        templateImage,
        csvData,
        boxes,
        workerCount: configuredWorkerCount,
        outputFormats,
        setError,
        setGenerationStatus,
    } = useAppStore();

    const [progress, setProgress] = useState<GenerateProgress>(DEFAULT_PROGRESS);
    const [logs, setLogs] = useState<GenerateLogs>(DEFAULT_LOGS);
    const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
    const pauseRef = useRef(false);
    const abortRef = useRef(false);
    const workerPoolRef = useRef<CertificateWorkerPool | null>(null);
    const [localPaused, setLocalPaused] = useState(false);

    const validBoxes = boxes.filter(b => b.field);
    const isReady = templateImage && csvData.length > 0 && validBoxes.length > 0;

    /**
     * Get the filename basis from a CSV row
     */
    const getFilenameBasis = useCallback((row: CsvRow): string => {
        const nameBox = boxes.find(b => b.field.toLowerCase().includes('name'));
        if (nameBox && row[nameBox.field]) {
            return row[nameBox.field];
        }
        if (validBoxes.length > 0 && row[validBoxes[0].field]) {
            return row[validBoxes[0].field];
        }
        return 'certificate';
    }, [boxes, validBoxes]);

    /**
     * Generate certificates in PARALLEL using Web Workers.
     * Uses Size-Based Batching (1GB per ZIP).
     */
    const generateBatch = useCallback(async (
        records: Array<{ rowIndex: number; row: CsvRow }>,
        isRetry: boolean = false,
        format: 'png' | 'jpg' | 'webp' | 'pdf' = 'jpg'
    ) => {
        if (!templateImage || validBoxes.length === 0) return;

        abortRef.current = false;
        pauseRef.current = false;
        setLocalPaused(false);
        setError(null);
        setGenerationStatus('running');

        const startTime = Date.now();
        const errors: FailedRecord[] = [];
        let totalGeneratedCount = 0;
        let currentZipPart = 1;

        // Phase 0: Estimate Certificate Size and Dynamic Batching
        setProgress(prev => ({
            ...prev,
            currentName: `[${format.toUpperCase()}] Estimating resource requirements...`,
            status: 'initializing',
        }));

        let certsPerZip = 2000; // Safe default
        let estimatedSize = 500 * 1024; // Default 500KB

        try {
            const probeCanvas = document.createElement('canvas');
            probeCanvas.width = templateImage.naturalWidth;
            probeCanvas.height = templateImage.naturalHeight;
            const probeCtx = probeCanvas.getContext('2d')!;
            probeCtx.drawImage(templateImage, 0, 0);

            // Format for JSZip depends on extension
            const probeFormat = format === 'png' ? 'image/png' : (format === 'webp' ? 'image/webp' : 'image/jpeg');
            const blob = await new Promise<Blob>((resolve) => probeCanvas.toBlob(b => resolve(b!), probeFormat, 0.92));
            estimatedSize = blob.size;

            // If PDF, wrap it roughly (PDF overhead is ~20% more than JPG)
            if (format === 'pdf') estimatedSize *= 1.2;

            // Calculate how many fit in target ZIP part size
            const countPerPart = MAX_BATCH_SIZE_BYTES / estimatedSize;

            // Round down to the nearest 500 for stable batching
            certsPerZip = Math.max(500, Math.floor(countPerPart / 500) * 500);

            // Cleanup
            probeCanvas.width = 0;
            probeCanvas.height = 0;
        } catch (err) {
            console.warn('Size estimation failed, using default batching', err);
        }

        // Calculate ZIP parts needed based on dynamic batch size
        const totalZipParts = Math.ceil(records.length / certsPerZip);
        setProgress({
            current: 0,
            total: records.length,
            currentName: `[${format.toUpperCase()}] Loading fonts...`,
            status: 'loading-fonts',
            errors: [],
            generated: 0,
            zipPart: 1,
            totalZipParts: 1,
            workerCount: 0,
        });

        const uniqueFonts = new Set(boxes.map(b => b.fontFamily).filter(Boolean));
        for (const font of uniqueFonts) {
            await loadFont(font);
        }

        // Phase 2: Initialize worker pool
        setProgress(prev => ({
            ...prev,
            currentName: `[${format.toUpperCase()}] Initializing parallel workers...`,
            status: 'initializing',
        }));

        let workerPool: CertificateWorkerPool;
        let workerCount: number;
        let fileExtension: string;

        try {
            workerPool = new CertificateWorkerPool();
            workerPoolRef.current = workerPool;
            // Use the configured worker count from settings
            workerCount = await workerPool.initialize(templateImage, validBoxes, format, configuredWorkerCount);
            fileExtension = workerPool.getFileExtension();
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to initialize workers';
            setError(errorMsg);
            setProgress(DEFAULT_PROGRESS);
            setGenerationStatus('idle');
            return;
        }

        // Initialize progress with calculated total parts
        setProgress({
            current: 0,
            total: records.length,
            currentName: `[${format.toUpperCase()}] Using ${workerCount} parallel workers`,
            status: 'generating',
            errors: [],
            generated: 0,
            zipPart: 1,
            totalZipParts,
            workerCount,
        });

        if (!isRetry) {
            setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
        }

        // Prepare items for ZIP
        let currentZip = new JSZip();
        let currentZipFolder = currentZip.folder('certificates');
        let currentZipSize = 0;
        let chunkGeneratedCount = 0;

        const tasks = records.map((record, i) => {
            const displayName = getFilenameBasis(record.row);
            return {
                id: i,
                row: record.row,
                rowIndex: record.rowIndex,
                filename: sanitizeFilename(displayName),
            };
        });

        // Create task lookup map for O(1) error handling
        const taskMap = new Map(tasks.map(t => [t.id, t]));

        // Helper to finalize and download a ZIP part
        const finalizeZip = async () => {
            if (chunkGeneratedCount === 0 || !currentZip) return;

            const zipFileName = totalZipParts > 1
                ? `certificates_${format}_part${currentZipPart}_of_${totalZipParts}.zip`
                : `certificates_${format}.zip`;

            setProgress(prev => ({
                ...prev,
                status: 'zipping',
                currentName: `[${format.toUpperCase()}] Packaging Part ${currentZipPart}/${totalZipParts}...`,
            }));

            try {
                const zipBlob = await currentZip.generateAsync({
                    type: 'blob',
                    compression: 'STORE',  // NO COMPRESSION (Level 0) - Fastest
                    streamFiles: true,
                });
                downloadBlob(zipBlob, zipFileName);
                await delay(300); // Give browser time to GC
            } catch {
                setError(`Failed to create ZIP part ${currentZipPart}`);
            }

            // Reset for next part - Critical for memory
            currentZip = null as any;
            currentZipFolder = null as any;
            await delay(500); // Force pause for GC

            currentZip = new JSZip();
            currentZipFolder = currentZip.folder('certificates');
            currentZipSize = 0;
            chunkGeneratedCount = 0;
            currentZipPart++;

            setProgress(prev => ({ ...prev, status: 'generating', zipPart: currentZipPart }));
        };

        let lastUpdate = Date.now();

        // INTERLEAVED PROCESSING: Process each result as it arrives to maximize throughput
        await workerPool.processBatch(tasks, async (completed, total, latestResult) => {
            const now = Date.now();

            // 1. Process the latest result immediately (Interleaved)
            if (latestResult && !latestResult.error && latestResult.blob && currentZipFolder) {
                let finalBlob = latestResult.blob;
                if (format === 'pdf') {
                    const isLandscape = templateImage.naturalWidth > templateImage.naturalHeight;
                    const pdf = new jsPDF({
                        orientation: isLandscape ? 'landscape' : 'portrait',
                        unit: 'px',
                        format: [templateImage.naturalWidth, templateImage.naturalHeight]
                    });
                    const arrayBuffer = await latestResult.blob.arrayBuffer();
                    pdf.addImage(new Uint8Array(arrayBuffer), 'JPEG', 0, 0, templateImage.naturalWidth, templateImage.naturalHeight);
                    finalBlob = pdf.output('blob');
                }

                currentZipSize += finalBlob.size;
                currentZipFolder.file(`${latestResult.filename}.${format === 'pdf' ? 'pdf' : fileExtension}`, finalBlob);
                latestResult.blob = undefined;
                chunkGeneratedCount++;
                totalGeneratedCount++;

                // Trigger dynamic split (based on count OR the 1GB size threshold)
                // CRITICAL: Immediately finalize and release memory
                if (chunkGeneratedCount >= certsPerZip || currentZipSize >= MAX_BATCH_SIZE_BYTES) {
                    await finalizeZip();
                }
            } else if (latestResult?.error) {
                const task = taskMap.get(latestResult.id);
                errors.push({
                    rowIndex: latestResult.rowIndex,
                    name: latestResult.filename,
                    row: task?.row || {},
                    error: latestResult.error,
                });
            }

            // 2. Throttle UI updates
            if (now - lastUpdate > 100 || completed === total) {
                lastUpdate = now;
                setProgress(prev => ({
                    ...prev,
                    current: completed,
                    generated: totalGeneratedCount,
                    totalZipParts,
                    currentName: `[${format.toUpperCase()}] ${completed} generated (${Math.round(currentZipSize / 1024 / 1024)}MB / 1GB batch)`,
                }));
                setLogs(prev => ({ ...prev, lastGenerated: new Date(), totalElapsed: now - startTime }));
            }
        });

        // Final cleanup for any leftovers
        if (!abortRef.current && chunkGeneratedCount > 0) {
            await finalizeZip();
        }

        // Cleanup
        workerPool.terminate();
        workerPoolRef.current = null;

        setProgress(prev => ({ ...prev, status: 'completed', totalZipParts: currentZipPart - 1 }));
        setGenerationStatus('completed');
        setRetryQueue(errors);

        setLogs(prev => ({ ...prev, totalElapsed: Date.now() - startTime }));
    }, [templateImage, boxes, validBoxes, getFilenameBasis, setError, setGenerationStatus, configuredWorkerCount]);

    // Event handlers
    const handleGenerate = async () => {
        const records = csvData.map((row, i) => ({ rowIndex: i, row }));
        for (const format of outputFormats) {
            if (abortRef.current) break;
            await generateBatch(records, false, format);
        }
    };

    const handleRetry = () => {
        const records = retryQueue.map(r => ({ rowIndex: r.rowIndex, row: r.row }));
        generateBatch(records, true);
    };

    const handlePause = () => {
        pauseRef.current = true;
        setLocalPaused(true);
        setProgress(prev => ({ ...prev, status: 'paused' }));
    };

    const handleResume = () => {
        pauseRef.current = false;
        setLocalPaused(false);
        setProgress(prev => ({ ...prev, status: 'generating' }));
    };

    const handleAbort = () => {
        abortRef.current = true;
        pauseRef.current = false;
        // Terminate worker pool if running
        if (workerPoolRef.current) {
            workerPoolRef.current.terminate();
            workerPoolRef.current = null;
        }
        setProgress(DEFAULT_PROGRESS);
        setGenerationStatus('idle');
        setRetryQueue([]);
    };

    const handleReset = () => {
        setProgress(DEFAULT_PROGRESS);
        setGenerationStatus('idle');
        setRetryQueue([]);
        setLogs(DEFAULT_LOGS);
    };

    // Format elapsed time
    const formatElapsed = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs}s`;
    };

    // Idle state
    if (progress.status === 'idle') {
        return (
            <button
                onClick={handleGenerate}
                disabled={!isReady}
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all ${isReady
                    ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800 shadow-lg shadow-primary-500/25'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
            >
                <Download className="w-5 h-5" />
                <span>Generate {csvData.length} Certificate{csvData.length !== 1 ? 's' : ''}</span>
            </button>
        );
    }

    // Completed state
    if (progress.status === 'completed') {
        // Calculate certificates per second
        const certsPerSecond = logs.totalElapsed > 0
            ? (progress.generated / (logs.totalElapsed / 1000)).toFixed(1)
            : '0';

        return (
            <div className="space-y-3">
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                    <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span className="font-medium text-emerald-700">Generation Complete</span>
                    </div>
                    <div className="text-sm text-emerald-600 space-y-1">
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                            <span>{progress.generated} certificate{progress.generated !== 1 ? 's' : ''} generated</span>
                        </div>
                        {progress.totalZipParts > 1 && (
                            <div className="flex items-center gap-1.5 text-slate-500">
                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span>
                                <span>Downloaded as {progress.totalZipParts} ZIP files</span>
                            </div>
                        )}
                        {progress.workerCount > 0 && (
                            <div className="flex items-center gap-1.5 text-slate-500">
                                <Cpu className="w-3.5 h-3.5" />
                                <span>{progress.workerCount} workers used at {certsPerSecond} certs/sec</span>
                            </div>
                        )}
                        {progress.errors.length > 0 && (
                            <div className="flex items-center gap-1.5 text-amber-600">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>{progress.errors.length} failed</span>
                            </div>
                        )}
                        {logs.totalElapsed > 0 && (
                            <div className="flex items-center gap-1.5 text-slate-500 mt-2">
                                <Clock className="w-3.5 h-3.5" />
                                <span>Completed in {formatElapsed(logs.totalElapsed)}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Retry failed */}
                {retryQueue.length > 0 && (
                    <button
                        onClick={handleRetry}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span>Retry {retryQueue.length} Failed</span>
                    </button>
                )}

                {/* Done button */}
                <button
                    onClick={handleReset}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Done</span>
                </button>
            </div>
        );
    }

    // Progress state
    const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div className="space-y-3">
            {/* Progress Card */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        {progress.status === 'loading-fonts' || progress.status === 'zipping' || progress.status === 'initializing' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                        ) : progress.status === 'paused' ? (
                            <Pause className="w-4 h-4 text-amber-500" />
                        ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                        )}
                        <span className="text-sm font-medium text-slate-700">
                            {progress.status === 'loading-fonts' ? 'Loading fonts...' :
                                progress.status === 'initializing' ? 'Initializing workers...' :
                                    progress.status === 'zipping'
                                        ? `Creating ZIP${progress.totalZipParts > 1 ? ` (${progress.zipPart}/${progress.totalZipParts})` : ''}...` :
                                        progress.status === 'paused' ? 'Paused' :
                                            'Generating...'}
                        </span>
                    </div>
                    <span className="text-sm text-slate-500">
                        {progress.current}/{progress.total}
                    </span>
                </div>

                {/* Worker count indicator */}
                {progress.workerCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-primary-600 mb-2">
                        <Cpu className="w-3.5 h-3.5" />
                        <span>{progress.workerCount} parallel workers active</span>
                    </div>
                )}

                {/* Batch indicator for large jobs */}
                {progress.totalZipParts > 1 && (
                    <div className="text-xs text-slate-400 mb-2">
                        Large batch: will create {progress.totalZipParts} ZIP files
                    </div>
                )}

                {/* Progress Bar */}
                <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden mb-2 relative">
                    <div
                        className="h-full bg-gradient-to-r from-primary-500 via-primary-600 to-indigo-600 transition-all duration-500 ease-out relative"
                        style={{ width: `${progressPercent}%` }}
                    >
                        {/* Shimmer effect */}
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                    </div>
                </div>

                {/* Current Item */}
                {progress.currentName && (
                    <p className="text-xs text-slate-500 truncate">
                        {progress.currentName}
                    </p>
                )}

                {/* Error count */}
                {progress.errors.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{progress.errors.length} error{progress.errors.length !== 1 ? 's' : ''}</span>
                    </div>
                )}
            </div>

            {/* Control Buttons */}
            <div className="flex gap-2">
                {localPaused ? (
                    <button
                        onClick={handleResume}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
                    >
                        <Play className="w-4 h-4" />
                        <span>Resume</span>
                    </button>
                ) : (
                    <button
                        onClick={handlePause}
                        disabled={progress.status === 'zipping' || progress.status === 'loading-fonts'}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                        <Pause className="w-4 h-4" />
                        <span>Pause</span>
                    </button>
                )}

                <button
                    onClick={handleAbort}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                >
                    <X className="w-4 h-4" />
                    <span>Cancel</span>
                </button>
            </div>
        </div>
    );
}

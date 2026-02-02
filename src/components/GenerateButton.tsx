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
 * For 21,000 certificates, this creates ~7 ZIP files of 3000 each.
 * Each ZIP stays under ~3-5GB in memory which is manageable.
 */
const MAX_CERTS_PER_ZIP = 5000;

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
     * Uses ~80% of CPU cores for maximum throughput.
     * For large batches (>MAX_CERTS_PER_ZIP), creates multiple smaller ZIP files.
     */
    const generateBatch = useCallback(async (
        records: Array<{ rowIndex: number; row: CsvRow }>,
        isRetry: boolean = false
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
        
        // Calculate ZIP parts needed
        const totalZipParts = Math.ceil(records.length / MAX_CERTS_PER_ZIP);

        // Phase 1: Load fonts
        setProgress({
            current: 0,
            total: records.length,
            currentName: 'Loading fonts...',
            status: 'loading-fonts',
            errors: [],
            generated: 0,
            zipPart: 0,
            totalZipParts,
            workerCount: 0,
        });

        const uniqueFonts = new Set(boxes.map(b => b.fontFamily).filter(Boolean));
        for (const font of uniqueFonts) {
            await loadFont(font);
        }

        // Phase 2: Initialize worker pool
        // Detect template format from image src or content type
        const templateMimeType = templateImage.src.includes('data:image/png') 
            ? 'image/png' 
            : 'image/jpeg';
        
        setProgress(prev => ({
            ...prev,
            currentName: 'Initializing parallel workers...',
            status: 'initializing',
        }));

        let workerPool: CertificateWorkerPool;
        let workerCount: number;
        let fileExtension: string;
        
        try {
            workerPool = new CertificateWorkerPool();
            workerPoolRef.current = workerPool;
            // Use the configured worker count from settings
            workerCount = await workerPool.initialize(templateImage, validBoxes, templateMimeType, configuredWorkerCount);
            fileExtension = workerPool.getFileExtension();
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to initialize workers';
            setError(errorMsg);
            setProgress(DEFAULT_PROGRESS);
            setGenerationStatus('idle');
            return;
        }

        setProgress(prev => ({
            ...prev,
            current: 0,
            currentName: `Using ${workerCount} parallel workers`,
            status: 'generating',
            workerCount,
        }));

        if (!isRetry) {
            setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
        }

        // Process in chunks, creating a new ZIP for each chunk
        for (let chunkStart = 0; chunkStart < records.length; chunkStart += MAX_CERTS_PER_ZIP) {
            if (abortRef.current) {
                workerPool.terminate();
                workerPoolRef.current = null;
                setProgress(prev => ({ ...prev, status: 'idle' }));
                setGenerationStatus('idle');
                return;
            }

            const chunkEnd = Math.min(chunkStart + MAX_CERTS_PER_ZIP, records.length);
            const chunkRecords = records.slice(chunkStart, chunkEnd);
            const currentZipPart = Math.floor(chunkStart / MAX_CERTS_PER_ZIP) + 1;

            // Create fresh ZIP for this chunk
            let zip: JSZip | null = new JSZip();
            const certsFolder = zip.folder('certificates');
            let chunkGeneratedCount = 0;

            setProgress(prev => ({
                ...prev,
                zipPart: currentZipPart,
                currentName: `Processing batch ${currentZipPart}/${totalZipParts}...`,
            }));

            // Prepare tasks for parallel processing
            const tasks = chunkRecords
                .map((record, i) => {
                    const displayName = getFilenameBasis(record.row);
                    const hasContent = validBoxes.some(box => record.row[box.field]?.trim());
                    
                    if (!hasContent) {
                        // Track empty records as errors immediately
                        errors.push({ 
                            rowIndex: record.rowIndex, 
                            name: displayName || '(empty)', 
                            row: record.row, 
                            error: 'All text fields are empty' 
                        });
                        return null;
                    }

                    return {
                        id: chunkStart + i,
                        row: record.row,
                        rowIndex: record.rowIndex,
                        filename: sanitizeFilename(displayName),
                    };
                })
                .filter((task): task is NonNullable<typeof task> => task !== null);

            // Process entire chunk with batch-based workers
            // Each worker receives an equal portion of the work
            const results = await workerPool.processBatch(tasks, (completed, _total) => {
                setProgress(prev => ({
                    ...prev,
                    current: chunkStart + completed,
                    generated: totalGeneratedCount + completed,
                    currentName: `${totalGeneratedCount + completed} generated (${workerCount} workers)`,
                }));
                
                setLogs(prev => ({
                    ...prev,
                    lastGenerated: new Date(),
                    totalElapsed: Date.now() - startTime,
                }));
            });

            // Process results
            for (const result of results) {
                if (result.error) {
                    const task = tasks.find(t => t.id === result.id);
                    errors.push({
                        rowIndex: result.rowIndex,
                        name: result.filename,
                        row: task?.row || {},
                        error: result.error,
                    });
                } else if (result.blob && certsFolder) {
                    // Add to ZIP
                    certsFolder.file(`${result.filename}.${fileExtension}`, result.blob);
                    chunkGeneratedCount++;
                    totalGeneratedCount++;
                }
            }

            setProgress(prev => ({
                ...prev,
                current: chunkEnd,
                generated: totalGeneratedCount,
                errors: errors,
                currentName: `${totalGeneratedCount} generated (${workerCount} workers)`,
            }));

            // Generate and download this chunk's ZIP
            if (chunkGeneratedCount > 0 && !abortRef.current) {
                const zipFileName = totalZipParts > 1
                    ? `certificates_part${currentZipPart}_of_${totalZipParts}${isRetry ? '_retry' : ''}.zip`
                    : `certificates${isRetry ? '_retry' : ''}.zip`;

                setProgress(prev => ({
                    ...prev,
                    status: 'zipping',
                    currentName: `Creating ZIP ${currentZipPart}/${totalZipParts}...`,
                }));

                try {
                    const zipBlob = await zip.generateAsync({
                        type: 'blob',
                        compression: 'STORE', // No compression for speed - images are already compressed
                        streamFiles: true,
                    });
                    downloadBlob(zipBlob, zipFileName);

                    // Release ZIP memory
                    zip = null;
                    await delay(100);

                } catch {
                    setError(`Failed to create ZIP file (part ${currentZipPart})`);
                }
            }

            // Reset status for next chunk if there are more
            if (chunkEnd < records.length) {
                setProgress(prev => ({
                    ...prev,
                    status: 'generating',
                }));
            }
        }

        // Cleanup worker pool
        workerPool.terminate();
        workerPoolRef.current = null;

        setProgress(prev => ({ ...prev, status: 'completed' }));
        setGenerationStatus('completed');
        setRetryQueue(errors);

        setLogs(prev => ({
            ...prev,
            totalElapsed: Date.now() - startTime,
        }));
    }, [templateImage, boxes, validBoxes, getFilenameBasis, setError, setGenerationStatus, configuredWorkerCount]);

    // Event handlers
    const handleGenerate = () => {
        const records = csvData.map((row, i) => ({ rowIndex: i, row }));
        generateBatch(records);
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
                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all ${
                    isReady
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
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-2">
                    <div
                        className="h-full bg-primary-600 transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                    />
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

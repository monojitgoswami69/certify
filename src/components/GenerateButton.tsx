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

import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, Loader2, X, CheckCircle2, AlertCircle, RefreshCw, Clock, Cpu } from 'lucide-react';
import { downloadZip } from 'client-zip';
import { jsPDF } from 'jspdf';
import { useAppStore } from '../store/appStore';
import { downloadBlob, sanitizeFilename, delay } from '../lib/utils';
import { loadGoogleFont } from '../lib/googleFonts';
import { CertificateWorkerPool } from '../lib/workerPool';
import type { CsvRow } from '../types';

// =============================================================================
// Performance & Memory Constants
// =============================================================================

/**
 * Target maximum size per ZIP file (1GB).
 * 
 * MEMORY SAFETY: We use client-zip which efficiently streams input data.
 * The primary memory consumer is the final ZIP blob itself.
 * 
 * - 1GB chunk = ~1GB output ZIP blob.
 * 
 * This keeps us comfortably under the 1.5GB process limit while 
 * maximizing the number of certificates per download.
 */
const TARGET_ZIP_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB per ZIP part

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
    status: 'idle' | 'generating' | 'completed' | 'zipping' | 'loading-fonts' | 'initializing' | 'cooldown';
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
        generationStatus,
        setGenerationStatus,
    } = useAppStore();

    const [progress, setProgress] = useState<GenerateProgress>(DEFAULT_PROGRESS);
    const [logs, setLogs] = useState<GenerateLogs>(DEFAULT_LOGS);
    const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
    const abortRef = useRef(false);
    const workerPoolRef = useRef<CertificateWorkerPool | null>(null);
    // Track current batch for immediate memory flush on abort
    const currentBatchRef = useRef<Array<{ name: string; lastModified: Date; input: Blob }> | null>(null);
    const zipBlobRef = useRef<Blob | null>(null);

    const validBoxes = boxes.filter(b => b.field);
    const isReady = templateImage && csvData.length > 0 && validBoxes.length > 0 && outputFormats.length > 0;

    // Cleanup: terminate worker pool if component unmounts mid-generation
    useEffect(() => {
        return () => {
            if (workerPoolRef.current) {
                workerPoolRef.current.terminate();
                workerPoolRef.current = null;
            }
        };
    }, []);

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
     * 
     * ARCHITECTURE: Chunk-based processing with synchronization barriers.
     * 
     * 1. Probe: Generate a single real certificate → measure size
     * 2. Calculate certsPerZip = floor(1GB / certSize), rounded down to nearest 500
     * 3. For each chunk of certsPerZip tasks:
     *    a. GENERATE: Send chunk to workers → ALL workers process in parallel
     *    b. BARRIER:  processChunk() resolves → ALL workers are now IDLE
     *    c. ZIP:      Package results into ZIP (workers idle, no CPU contention)
     *    d. DOWNLOAD: Trigger browser download
     *    e. GC:       Release all references, pause for garbage collection
     * 
     * This guarantees:
     * - Workers NEVER run during ZIP packaging
     * - Memory bounded to one chunk at a time
     * - Deterministic ZIP count = ceil(total / certsPerZip)
     */
    const generateBatch = useCallback(async (
        records: Array<{ rowIndex: number; row: CsvRow }>,
        isRetry: boolean = false,
        format: 'png' | 'jpg' | 'pdf' = 'jpg'
    ) => {
        if (!templateImage || validBoxes.length === 0 || abortRef.current) return { generatedCount: 0, errors: [] };

        let pureGenerationTime = 0; // Track only actual generation time (exclude zipping, waiting, etc.)
        const errors: FailedRecord[] = [];
        let totalGeneratedCount = 0;


        setError(null);
        setGenerationStatus('running');

        // =====================================================================
        // PHASE 0: Load fonts
        // =====================================================================
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
            loadGoogleFont(font);
        }

        // =====================================================================
        // PHASE 1: Initialize worker pool
        // =====================================================================
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
            workerCount = await workerPool.initialize(templateImage, validBoxes, format, configuredWorkerCount);
            fileExtension = workerPool.getFileExtension();
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to initialize workers';
            setError(errorMsg);
            setProgress(DEFAULT_PROGRESS);
            setGenerationStatus('idle');
            return { generatedCount: 0, errors: [] };
        }

        if (abortRef.current) return { generatedCount: 0, errors: [] };

        // =====================================================================
        // PHASE 2: SPECIAL DETECTION TECHNIQUE — Probe single real certificate
        // =====================================================================
        setProgress(prev => ({
            ...prev,
            currentName: `[${format.toUpperCase()}] Probing certificate size...`,
            status: 'initializing',
            workerCount,
        }));

        let certsPerZip = 2000; // Safe default fallback

        try {
            const probeRecord = records[0];
            const probeDisplayName = getFilenameBasis(probeRecord.row);
            const probeTask = {
                id: -1,
                row: probeRecord.row,
                rowIndex: probeRecord.rowIndex,
                filename: sanitizeFilename(probeDisplayName),
            };

            const probeResult = await workerPool.generateSingle(probeTask);

            if (probeResult.blob && !probeResult.error) {
                let certSize = probeResult.blob.size;
                if (format === 'pdf') certSize *= 1.2;

                const rawCount = TARGET_ZIP_SIZE_BYTES / certSize;
                certsPerZip = Math.max(500, Math.floor(rawCount / 500) * 500);


                probeResult.blob = undefined;
            } else {
                console.warn('Probe failed, using default batch size');
            }
        } catch (err) {
            console.warn('Size probe failed, using default batch size', err);
        }

        if (abortRef.current) return { generatedCount: 0, errors: [] };

        // =====================================================================
        // PHASE 3: Prepare all tasks
        // =====================================================================
        let allTasks: Array<{ id: number; row: CsvRow; rowIndex: number; filename: string }> | null = records.map((record, i) => {
            const displayName = getFilenameBasis(record.row);
            return {
                id: i,
                row: record.row,
                rowIndex: record.rowIndex,
                filename: sanitizeFilename(displayName),
            };
        });

        let taskMap: Map<number, { id: number; row: CsvRow; rowIndex: number; filename: string }> | null = new Map(allTasks.map(t => [t.id, t]));
        const totalZipParts = Math.ceil(allTasks.length / certsPerZip);

        if (!isRetry) {
            setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
        }

        // =====================================================================
        // PHASE 4: CHUNK-BASED GENERATION
        //
        // Each iteration processes exactly one ZIP's worth of certificates.
        // Workers are IDLE during ZIP packaging — no concurrent generation.
        // Memory is bounded to one chunk at a time.
        // =====================================================================
        for (let chunkIndex = 0; chunkIndex < totalZipParts; chunkIndex++) {
            if (abortRef.current) break;

            // Slice this chunk's tasks
            const chunkStart = chunkIndex * certsPerZip;
            const chunkEnd = Math.min(chunkStart + certsPerZip, allTasks!.length);
            const chunkTasks = allTasks!.slice(chunkStart, chunkEnd);
            const currentZipPart = chunkIndex + 1;

            // Fresh collection for this chunk
            // client-zip takes an array of file objects
            const currentBatchFiles: Array<{ name: string; lastModified: Date; input: Blob }> = [];
            currentBatchRef.current = currentBatchFiles; // Track for abort cleanup
            const batchTimestamp = new Date(); // Shared timestamp for the entire batch
            let chunkGeneratedCount = 0;

            // Update UI: GENERATING
            setProgress({
                current: totalGeneratedCount,
                total: records.length,
                currentName: `[${format.toUpperCase()}] Batch ${currentZipPart}/${totalZipParts} — generating...`,
                status: 'generating',
                errors,
                generated: totalGeneratedCount,
                zipPart: currentZipPart,
                totalZipParts,
                workerCount,
            });

            let lastUpdate = Date.now();
            const chunkGenerationStart = Date.now();

            // -----------------------------------------------------------------
            // GENERATE: Send chunk to workers, collect results as they arrive.
            // processChunk() resolves ONLY when ALL workers finish this chunk.
            // -----------------------------------------------------------------
            await workerPool.processChunk(chunkTasks, (result, completedInChunk, totalInChunk) => {
                // Process successful result
                if (result && !result.error && result.blob) {
                    const ext = format === 'pdf' ? 'jpg' : fileExtension;
                    const filename = `certificates/${result.filename}.${ext}`;

                    // Add to batch collection
                    currentBatchFiles.push({
                        name: filename,
                        lastModified: batchTimestamp,
                        input: result.blob
                    });

                    result.blob = undefined; // Release — array now owns the reference
                    chunkGeneratedCount++;
                    totalGeneratedCount++;
                } else if (result?.error) {
                    const task = taskMap!.get(result.id);
                    errors.push({
                        rowIndex: result.rowIndex,
                        name: result.filename,
                        row: task?.row || {},
                        error: result.error,
                    });
                }

                // Throttle UI updates (every 100ms or on completion)
                const now = Date.now();
                if (now - lastUpdate > 100 || completedInChunk === totalInChunk) {
                    lastUpdate = now;
                    setProgress(prev => ({
                        ...prev,
                        current: totalGeneratedCount,
                        generated: totalGeneratedCount,
                        currentName: `[${format.toUpperCase()}] ${totalGeneratedCount}/${records.length} (batch ${currentZipPart}/${totalZipParts})`,
                    }));
                    setLogs(prev => ({
                        ...prev,
                        lastGenerated: new Date(),
                        totalElapsed: pureGenerationTime,
                    }));
                }
            });

            // Track pure generation time (exclude zipping, PDF conversion, etc.)
            const chunkGenerationEnd = Date.now();
            pureGenerationTime += (chunkGenerationEnd - chunkGenerationStart);

            // -----------------------------------------------------------------
            // BARRIER: processChunk() resolved — ALL workers are now IDLE.
            // Safe to do CPU-intensive ZIP packaging without contention.
            // -----------------------------------------------------------------

            if (abortRef.current || chunkGeneratedCount === 0) {
                // Clear array to release blobs
                currentBatchFiles.length = 0;
                currentBatchRef.current = null;
                continue;
            }

            // For PDF format: convert raw JPEG blobs to actual PDFs.
            // This runs while workers are IDLE — no CPU contention.
            if (format === 'pdf') {
                setProgress(prev => ({
                    ...prev,
                    currentName: `[${format.toUpperCase()}] Converting to PDF (batch ${currentZipPart}/${totalZipParts})...`,
                }));

                const isLandscape = templateImage.naturalWidth > templateImage.naturalHeight;

                // Iterate through the batch to convert JPG blobs to PDF blobs
                // We modify the inputs in-place within the array
                for (let i = 0; i < currentBatchFiles.length; i++) {
                    if (abortRef.current) break;

                    const fileObj = currentBatchFiles[i];

                    // Only process files that look like our certificates (safe check)
                    if (fileObj.name.endsWith('.jpg') && fileObj.name.startsWith('certificates/')) {
                        let arrayBuffer: ArrayBuffer | null = await fileObj.input.arrayBuffer();
                        const pdf = new jsPDF({
                            orientation: isLandscape ? 'landscape' : 'portrait',
                            unit: 'px',
                            format: [templateImage.naturalWidth, templateImage.naturalHeight],
                        });

                        pdf.addImage(
                            new Uint8Array(arrayBuffer),
                            'JPEG', 0, 0,
                            templateImage.naturalWidth,
                            templateImage.naturalHeight
                        );

                        // Release the intermediate ArrayBuffer before generating the PDF blob
                        arrayBuffer = null;

                        // Replace the input blob with the PDF blob
                        fileObj.input = pdf.output('blob');
                        // Update filename extension
                        fileObj.name = fileObj.name.replace(/\.jpg$/, '.pdf');
                    }
                }

                // Check abort after PDF conversion loop — flush memory immediately
                if (abortRef.current) {
                    currentBatchFiles.length = 0;
                    currentBatchRef.current = null;
                    continue;
                }
            }

            // Update UI: ZIPPING
            setProgress(prev => ({
                ...prev,
                status: 'zipping',
                currentName: `[${format.toUpperCase()}] Packaging batch ${currentZipPart}/${totalZipParts}...`,
            }));

            // -----------------------------------------------------------------
            // ZIP & DOWNLOAD: Package and trigger download
            //
            // Using client-zip to stream-process the upload (array -> blob)
            // -----------------------------------------------------------------
            try {
                // downloadZip returns an async iterable (Stream), .blob() consumes it
                let zipBlob: Blob | null = await downloadZip(currentBatchFiles).blob();
                zipBlobRef.current = zipBlob; // Track for abort cleanup

                // Immediately clear the input array to release the source blobs
                // The zipBlob is now the only large object in memory
                currentBatchFiles.length = 0;
                currentBatchRef.current = null;

                const zipFileName = totalZipParts > 1
                    ? `certificates_${format}_part${currentZipPart}_of_${totalZipParts}.zip`
                    : `certificates_${format}.zip`;

                downloadBlob(zipBlob, zipFileName);

                // Release our reference to the ZIP blob
                zipBlob = null;
                zipBlobRef.current = null;
            } catch {
                currentBatchFiles.length = 0;
                currentBatchRef.current = null;
                zipBlobRef.current = null;
                setError(`Failed to create ZIP part ${currentZipPart}`);
            }

            // -----------------------------------------------------------------
            // GC FLUSH: Give the engine time to collect released blobs
            // -----------------------------------------------------------------
            await delay(100);

            // Wait for browser to flush the download to disk before starting
            // the next batch. Without this, the download manager gets overwhelmed.
            if (chunkIndex < totalZipParts - 1) {
                setProgress(prev => ({
                    ...prev,
                    status: 'cooldown',
                    currentName: `[${format.toUpperCase()}] Cooling down...`,
                }));
                await delay(2000);
            }
        }

        // =====================================================================
        // PHASE 5: Cleanup — aggressively release all large data structures
        // =====================================================================
        workerPool.terminate();
        workerPoolRef.current = null;

        // Release task data — no longer needed after generation
        allTasks = null;
        taskMap = null;

        if (abortRef.current) return { generatedCount: 0, errors: [] };

        setProgress(prev => ({
            ...prev,
            status: 'completed',
            generated: totalGeneratedCount,
            totalZipParts,
        }));
        setRetryQueue(errors);
        setLogs(prev => ({ ...prev, totalElapsed: pureGenerationTime }));

        // Give the browser time to GC worker memory and blob data
        await delay(200);

        return { generatedCount: totalGeneratedCount, errors };
    }, [templateImage, boxes, validBoxes, getFilenameBasis, setError, setGenerationStatus, configuredWorkerCount]);

    // Event handlers
    const runGeneration = async (records: Array<{ rowIndex: number; row: CsvRow }>, isRetry: boolean = false) => {
        if (generationStatus === 'running') return;

        let cumulativeGenerated = 0;
        let cumulativeErrors: FailedRecord[] = [];

        try {
            // Start clean run
            abortRef.current = false;
            setGenerationStatus('running');

            for (const format of outputFormats) {
                if (abortRef.current) break;
                const result = await generateBatch(records, isRetry, format);
                cumulativeGenerated += result.generatedCount;
                cumulativeErrors = [...cumulativeErrors, ...result.errors];
            }
        } catch (err) {
            console.error('Generation process failed:', err);
            setError(err instanceof Error ? err.message : 'Generation failed unexpectedly');
        } finally {
            if (!abortRef.current) {
                // Deduplicate errors by rowIndex (a row failing in multiple formats only needs one retry entry)
                const uniqueErrorsMap = new Map<number, FailedRecord>();
                for (const err of cumulativeErrors) {
                    if (!uniqueErrorsMap.has(err.rowIndex)) {
                        uniqueErrorsMap.set(err.rowIndex, err);
                    }
                }
                const uniqueErrors = Array.from(uniqueErrorsMap.values());

                setProgress(prev => ({
                    ...prev,
                    status: 'completed',
                    generated: cumulativeGenerated,
                    errors: uniqueErrors,
                }));
                setRetryQueue(uniqueErrors);
                setGenerationStatus(uniqueErrors.length > 0 ? 'idle' : 'completed');
                // Don't update totalElapsed here — it's already set to pureGenerationTime in generateBatch
            } else {
                setGenerationStatus('idle');
                if (progress.status !== 'idle') {
                    setProgress(DEFAULT_PROGRESS);
                }
            }
        }
    };

    const handleGenerate = async () => {
        // ── DEDUPLICATION: Only keep unique rows based on PRINTED fields ──
        const printedFields = validBoxes.map(b => b.field);
        const seen = new Set<string>();
        const deduplicatedRecords: Array<{ rowIndex: number; row: CsvRow }> = [];

        for (let i = 0; i < csvData.length; i++) {
            const row = csvData[i];
            const fingerprint = printedFields.map(f => row[f] ?? '').join('\x00');
            if (!seen.has(fingerprint)) {
                seen.add(fingerprint);
                const strippedRow: CsvRow = {};
                for (const field of printedFields) {
                    strippedRow[field] = row[field] ?? '';
                }
                deduplicatedRecords.push({ rowIndex: i, row: strippedRow });
            }
        }

        await runGeneration(deduplicatedRecords, false);
    };

    const handleRetry = () => {
        const records = retryQueue.map(r => ({ rowIndex: r.rowIndex, row: r.row }));
        runGeneration(records, true);
    };



    const handleAbort = () => {
        abortRef.current = true;

        // IMMEDIATE MEMORY FLUSH: Clear any in-progress batch and ZIP blob
        if (currentBatchRef.current) {
            currentBatchRef.current.length = 0;
            currentBatchRef.current = null;
        }
        if (zipBlobRef.current) {
            zipBlobRef.current = null;
        }

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
        const needsFormats = isReady === false && templateImage && csvData.length > 0 && validBoxes.length > 0 && outputFormats.length === 0;

        return (
            <div
                className="relative"
                title={needsFormats ? "Please select at least one output type to proceed" : undefined}
            >
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
            </div>
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
                        <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                        <span className="text-sm font-medium text-slate-700">
                            {progress.status === 'loading-fonts' ? 'Loading fonts...' :
                                progress.status === 'initializing' ? 'Initializing workers...' :
                                    progress.status === 'zipping'
                                        ? `Creating ZIP${progress.totalZipParts > 1 ? ` (${progress.zipPart}/${progress.totalZipParts})` : ''}...` :
                                        progress.status === 'cooldown' ? 'Cooling down...' :
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

            {/* Cancel Button */}
            <button
                onClick={handleAbort}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
            >
                <X className="w-4 h-4" />
                <span>Cancel</span>
            </button>
        </div>
    );
}

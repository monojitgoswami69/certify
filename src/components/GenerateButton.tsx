/**
 * Generate Button Component
 *
 * Main action button for certificate generation.
 *
 * PIPELINE (single-pass multi-format):
 *   1. Probe one cert → measure per-format size
 *   2. Compute chunk size so the SUM of per-format sizes stays under target
 *   3. For each chunk:
 *      a. Workers draw ONCE, emit ALL selected formats (PNG/JPG/PDF)
 *      b. For each format: stream ZIP straight to disk via FSA API (fallback: blob download)
 *      c. Release all blobs, brief cooldown
 *
 * MEMORY: Bounded to one chunk per format. FSA streaming avoids the multi-GB
 * in-memory ZIP blob entirely on Chromium.
 *
 * UI: Progress updates are rAF-coalesced — workers post hundreds of events
 * per second, we render at most once per frame.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, Loader2, X, CheckCircle2, AlertCircle, RefreshCw, Clock, Cpu } from 'lucide-react';
import { downloadZip } from 'client-zip';
import { useAppStore } from '../store/appStore';
import { downloadBlob, sanitizeFilename, delay, hasFileSystemAccess, streamToFile, createRafScheduler } from '../lib/utils';
import { loadGoogleFont } from '../lib/googleFonts';
import { CertificateWorkerPool, type OutputFormat } from '../lib/workerPool';
import type { CsvRow } from '../types';

const TARGET_ZIP_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB per ZIP part

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

// File extension per output format
const FORMAT_EXT: Record<OutputFormat, string> = {
    png: 'png',
    jpg: 'jpg',
    pdf: 'pdf',
};

export function GenerateButton() {
    const templateImage = useAppStore(s => s.templateImage);
    const templateFile = useAppStore(s => s.templateFile);
    const csvData = useAppStore(s => s.csvData);
    const boxes = useAppStore(s => s.boxes);
    const configuredWorkerCount = useAppStore(s => s.workerCount);
    const outputFormats = useAppStore(s => s.outputFormats);
    const setError = useAppStore(s => s.setError);
    const generationStatus = useAppStore(s => s.generationStatus);
    const setGenerationStatus = useAppStore(s => s.setGenerationStatus);

    const [progress, setProgress] = useState<GenerateProgress>(DEFAULT_PROGRESS);
    const [logs, setLogs] = useState<GenerateLogs>(DEFAULT_LOGS);
    const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
    const abortRef = useRef(false);
    const workerPoolRef = useRef<CertificateWorkerPool | null>(null);
    // Per-format batch tracking for immediate abort cleanup
    const currentBatchRef = useRef<Map<OutputFormat, Array<{ name: string; lastModified: Date; input: Blob }>> | null>(null);

    const validBoxes = boxes.filter(b => b.field);
    const isReady = templateImage && csvData.length > 0 && validBoxes.length > 0 && outputFormats.length > 0;

    useEffect(() => {
        return () => {
            if (workerPoolRef.current) {
                workerPoolRef.current.terminate();
                workerPoolRef.current = null;
            }
        };
    }, []);

    const getFilenameBasis = useCallback((row: CsvRow): string => {
        const nameBox = boxes.find(b => b.field.toLowerCase().includes('name'));
        if (nameBox && row[nameBox.field]) return row[nameBox.field];
        if (validBoxes.length > 0 && row[validBoxes[0].field]) return row[validBoxes[0].field];
        return 'certificate';
    }, [boxes, validBoxes]);

    /**
     * Package a chunk's blobs for ONE format into a ZIP and write to disk.
     * Uses FSA streaming where available, falls back to blob download.
     */
    const writeFormatZip = useCallback(async (
        files: Array<{ name: string; lastModified: Date; input: Blob }>,
        format: OutputFormat,
        zipFileName: string
    ) => {
        if (files.length === 0) return;

        if (hasFileSystemAccess()) {
            // Stream the ZIP straight to disk — no in-memory blob.
            const response = downloadZip(files);
            const body = response.body;
            if (!body) {
                throw new Error('client-zip returned no stream');
            }
            try {
                await streamToFile(body, zipFileName);
            } catch (err) {
                // FSA failed mid-write — fall back to blob path.
                console.warn(`FSA write failed for ${format}, falling back to blob download`, err);
                const blob = await downloadZip(files).blob();
                downloadBlob(blob, zipFileName);
            }
        } else {
            // Firefox/Safari path — buffer the whole ZIP into memory.
            const blob = await downloadZip(files).blob();
            downloadBlob(blob, zipFileName);
        }
    }, []);

    /**
     * Single-pass generation across ALL selected formats.
     * Workers draw each cert once and emit blobs for each format.
     */
    const runGeneration = async (
        records: Array<{ rowIndex: number; row: CsvRow }>,
        isRetry: boolean = false
    ) => {
        if (!templateImage || !templateFile || validBoxes.length === 0 || abortRef.current) return;
        if (outputFormats.length === 0) return;

        // Progress updates are rAF-coalesced to avoid React thrash on hot worker output.
        // Logs update only once per chunk, so direct setLogs(prev => ...) is fine.
        const progressScheduler = createRafScheduler<GenerateProgress>(setProgress);

        try {
            abortRef.current = false;
            setError(null);
            setGenerationStatus('running');

            let pureGenerationTime = 0;
            const errors: FailedRecord[] = [];
            let totalGeneratedCount = 0;

            // ── PHASE 0: Fonts ──────────────────────────────────────────────
            progressScheduler.schedule({
                current: 0,
                total: records.length,
                currentName: 'Loading fonts...',
                status: 'loading-fonts',
                errors: [],
                generated: 0,
                zipPart: 1,
                totalZipParts: 1,
                workerCount: 0,
            });
            progressScheduler.flush();

            const uniqueFonts = new Set(boxes.map(b => b.fontFamily).filter(Boolean));
            for (const font of uniqueFonts) loadGoogleFont(font);

            // ── PHASE 1: Spin up worker pool ────────────────────────────────
            progressScheduler.schedule({
                current: 0,
                total: records.length,
                currentName: 'Initializing parallel workers...',
                status: 'initializing',
                errors: [],
                generated: 0,
                zipPart: 1,
                totalZipParts: 1,
                workerCount: 0,
            });
            progressScheduler.flush();

            let workerPool: CertificateWorkerPool;
            let workerCount: number;

            try {
                workerPool = new CertificateWorkerPool();
                workerPoolRef.current = workerPool;
                workerCount = await workerPool.initialize(
                    templateFile,
                    templateImage.naturalWidth,
                    templateImage.naturalHeight,
                    validBoxes,
                    outputFormats,
                    configuredWorkerCount
                );
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to initialize workers';
                setError(errorMsg);
                progressScheduler.cancel();
                setProgress(DEFAULT_PROGRESS);
                setGenerationStatus('idle');
                return;
            }

            if (abortRef.current) return;

            // ── PHASE 2: Probe — measure per-format cert size ───────────────
            progressScheduler.schedule({
                current: 0,
                total: records.length,
                currentName: 'Probing certificate size...',
                status: 'initializing',
                errors: [],
                generated: 0,
                zipPart: 1,
                totalZipParts: 1,
                workerCount,
            });
            progressScheduler.flush();

            // Chunk size sums all formats' weights so total in-memory stays under target.
            let certsPerChunk = 1000;
            try {
                const probeRecord = records[0];
                const probeTask = {
                    id: -1,
                    row: probeRecord.row,
                    rowIndex: probeRecord.rowIndex,
                    filename: sanitizeFilename(getFilenameBasis(probeRecord.row)),
                };
                const probeResult = await workerPool.generateSingle(probeTask);

                if (probeResult.blobs && !probeResult.error) {
                    let totalBytesPerCert = 0;
                    for (const fmt of outputFormats) {
                        const b = probeResult.blobs[fmt];
                        if (b) totalBytesPerCert += b.size;
                    }
                    if (totalBytesPerCert > 0) {
                        const rawCount = TARGET_ZIP_SIZE_BYTES / totalBytesPerCert;
                        certsPerChunk = Math.max(500, Math.floor(rawCount / 500) * 500);
                    }
                    // Release probe blobs
                    for (const fmt of outputFormats) {
                        if (probeResult.blobs[fmt]) probeResult.blobs[fmt] = undefined;
                    }
                }
            } catch (err) {
                console.warn('Size probe failed, using default batch size', err);
            }

            if (abortRef.current) return;

            // ── PHASE 3: Prepare tasks ──────────────────────────────────────
            let allTasks: Array<{ id: number; row: CsvRow; rowIndex: number; filename: string }> | null =
                records.map((record, i) => ({
                    id: i,
                    row: record.row,
                    rowIndex: record.rowIndex,
                    filename: sanitizeFilename(getFilenameBasis(record.row)),
                }));

            let taskMap: Map<number, { id: number; row: CsvRow; rowIndex: number; filename: string }> | null =
                new Map(allTasks.map(t => [t.id, t]));
            const totalZipParts = Math.ceil(allTasks.length / certsPerChunk);

            if (!isRetry) {
                setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
            }

            // ── PHASE 4: CHUNKED GENERATION ─────────────────────────────────
            for (let chunkIndex = 0; chunkIndex < totalZipParts; chunkIndex++) {
                if (abortRef.current) break;

                const chunkStart = chunkIndex * certsPerChunk;
                const chunkEnd = Math.min(chunkStart + certsPerChunk, allTasks!.length);
                const chunkTasks = allTasks!.slice(chunkStart, chunkEnd);
                const currentZipPart = chunkIndex + 1;

                // Per-format file lists; shared timestamp keeps ZIP order stable.
                const filesByFormat = new Map<OutputFormat, Array<{ name: string; lastModified: Date; input: Blob }>>();
                for (const fmt of outputFormats) filesByFormat.set(fmt, []);
                currentBatchRef.current = filesByFormat;
                const batchTimestamp = new Date();
                let chunkGeneratedCount = 0;

                progressScheduler.schedule({
                    current: totalGeneratedCount,
                    total: records.length,
                    currentName: `Batch ${currentZipPart}/${totalZipParts} — generating...`,
                    status: 'generating',
                    errors,
                    generated: totalGeneratedCount,
                    zipPart: currentZipPart,
                    totalZipParts,
                    workerCount,
                });

                const chunkGenerationStart = Date.now();

                await workerPool.processChunk(chunkTasks, (result, completedInChunk, totalInChunk) => {
                    if (result.blobs && !result.error) {
                        let added = false;
                        for (const fmt of outputFormats) {
                            const blob = result.blobs[fmt];
                            if (blob) {
                                filesByFormat.get(fmt)!.push({
                                    name: `certificates/${result.filename}.${FORMAT_EXT[fmt]}`,
                                    lastModified: batchTimestamp,
                                    input: blob,
                                });
                                result.blobs[fmt] = undefined;
                                added = true;
                            }
                        }
                        if (added) {
                            chunkGeneratedCount++;
                            totalGeneratedCount++;
                        }
                    } else if (result.error) {
                        const task = taskMap!.get(result.id);
                        errors.push({
                            rowIndex: result.rowIndex,
                            name: result.filename,
                            row: task?.row || {},
                            error: result.error,
                        });
                    }

                    progressScheduler.schedule({
                        current: totalGeneratedCount,
                        total: records.length,
                        currentName: `${totalGeneratedCount}/${records.length} (batch ${currentZipPart}/${totalZipParts})`,
                        status: 'generating',
                        errors,
                        generated: totalGeneratedCount,
                        zipPart: currentZipPart,
                        totalZipParts,
                        workerCount,
                    });

                    if (completedInChunk === totalInChunk) {
                        setLogs(prev => ({
                            firstGenerated: prev.firstGenerated ?? new Date(),
                            lastGenerated: new Date(),
                            totalElapsed: pureGenerationTime,
                        }));
                    }
                });

                pureGenerationTime += Date.now() - chunkGenerationStart;
                progressScheduler.flush();

                if (abortRef.current || chunkGeneratedCount === 0) {
                    for (const list of filesByFormat.values()) list.length = 0;
                    currentBatchRef.current = null;
                    continue;
                }

                // ── ZIP & DOWNLOAD: per-format, sequential ───────────────────
                for (const fmt of outputFormats) {
                    if (abortRef.current) break;
                    const files = filesByFormat.get(fmt)!;
                    if (files.length === 0) continue;

                    progressScheduler.schedule({
                        current: totalGeneratedCount,
                        total: records.length,
                        currentName: `Packaging ${fmt.toUpperCase()} (batch ${currentZipPart}/${totalZipParts})...`,
                        status: 'zipping',
                        errors,
                        generated: totalGeneratedCount,
                        zipPart: currentZipPart,
                        totalZipParts,
                        workerCount,
                    });
                    progressScheduler.flush();

                    const zipFileName = totalZipParts > 1
                        ? `certificates_${fmt}_part${currentZipPart}_of_${totalZipParts}.zip`
                        : `certificates_${fmt}.zip`;

                    try {
                        await writeFormatZip(files, fmt, zipFileName);
                    } catch (err) {
                        console.error(`Failed to write ZIP for ${fmt}`, err);
                        setError(`Failed to create ZIP for ${fmt.toUpperCase()} (batch ${currentZipPart})`);
                    }

                    // Release this format's blobs immediately
                    files.length = 0;
                }

                currentBatchRef.current = null;
                await delay(100);

                if (chunkIndex < totalZipParts - 1) {
                    progressScheduler.schedule({
                        current: totalGeneratedCount,
                        total: records.length,
                        currentName: 'Cooling down...',
                        status: 'cooldown',
                        errors,
                        generated: totalGeneratedCount,
                        zipPart: currentZipPart,
                        totalZipParts,
                        workerCount,
                    });
                    progressScheduler.flush();
                    await delay(2000);
                }
            }

            // ── PHASE 5: Cleanup ────────────────────────────────────────────
            workerPool.terminate();
            workerPoolRef.current = null;
            allTasks = null;
            taskMap = null;

            if (abortRef.current) return;

            // Deduplicate errors by rowIndex
            const uniqueErrorsMap = new Map<number, FailedRecord>();
            for (const e of errors) {
                if (!uniqueErrorsMap.has(e.rowIndex)) uniqueErrorsMap.set(e.rowIndex, e);
            }
            const uniqueErrors = Array.from(uniqueErrorsMap.values());

            progressScheduler.cancel();

            setProgress(prev => ({
                ...prev,
                status: 'completed',
                generated: totalGeneratedCount,
                errors: uniqueErrors,
                totalZipParts,
            }));
            setRetryQueue(uniqueErrors);
            setLogs(prev => ({ ...prev, totalElapsed: pureGenerationTime }));
            setGenerationStatus(uniqueErrors.length > 0 ? 'idle' : 'completed');

            await delay(200);
        } catch (err) {
            console.error('Generation process failed:', err);
            setError(err instanceof Error ? err.message : 'Generation failed unexpectedly');
            progressScheduler.cancel();
        } finally {
            if (abortRef.current) {
                setGenerationStatus('idle');
                progressScheduler.cancel();
            }
        }
    };

    // =========================================================================
    // Handlers
    // =========================================================================

    const handleGenerate = async () => {
        if (generationStatus === 'running') return;

        // Dedupe rows by printed-field fingerprint
        const printedFields = validBoxes.map(b => b.field);
        const seen = new Set<string>();
        const deduped: Array<{ rowIndex: number; row: CsvRow }> = [];

        for (let i = 0; i < csvData.length; i++) {
            const row = csvData[i];
            const fingerprint = printedFields.map(f => row[f] ?? '').join('\x00');
            if (!seen.has(fingerprint)) {
                seen.add(fingerprint);
                const stripped: CsvRow = {};
                for (const field of printedFields) stripped[field] = row[field] ?? '';
                deduped.push({ rowIndex: i, row: stripped });
            }
        }

        await runGeneration(deduped, false);
    };

    const handleRetry = async () => {
        const records = retryQueue.map(r => ({ rowIndex: r.rowIndex, row: r.row }));
        await runGeneration(records, true);
    };

    const handleAbort = () => {
        abortRef.current = true;

        // Immediate memory flush
        if (currentBatchRef.current) {
            for (const list of currentBatchRef.current.values()) list.length = 0;
            currentBatchRef.current = null;
        }

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

    const formatElapsed = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs}s`;
    };

    // =========================================================================
    // Render
    // =========================================================================

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

    if (progress.status === 'completed') {
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
                                <span>Downloaded as {progress.totalZipParts} ZIP files per format</span>
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

                {retryQueue.length > 0 && (
                    <button
                        onClick={handleRetry}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span>Retry {retryQueue.length} Failed</span>
                    </button>
                )}

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

    const progressPercent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return (
        <div className="space-y-3">
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

                {progress.workerCount > 0 && (
                    <div className="flex items-center gap-1 text-xs text-primary-600 mb-2">
                        <Cpu className="w-3.5 h-3.5" />
                        <span>{progress.workerCount} parallel workers active</span>
                    </div>
                )}

                {progress.totalZipParts > 1 && (
                    <div className="text-xs text-slate-400 mb-2">
                        Large batch: will create {progress.totalZipParts} ZIP files per format
                    </div>
                )}

                <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden mb-2 relative">
                    <div
                        className="h-full bg-gradient-to-r from-primary-500 via-primary-600 to-indigo-600 transition-all duration-500 ease-out relative"
                        style={{ width: `${progressPercent}%` }}
                    >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                    </div>
                </div>

                {progress.currentName && (
                    <p className="text-xs text-slate-500 truncate">
                        {progress.currentName}
                    </p>
                )}

                {progress.errors.length > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{progress.errors.length} error{progress.errors.length !== 1 ? 's' : ''}</span>
                    </div>
                )}
            </div>

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

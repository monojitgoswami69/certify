/**
 * Generate Button Component
 * 
 * Main action button for certificate generation.
 * Handles batch certificate generation with progress tracking.
 * Downloads certificates as a ZIP file.
 */

import { useState, useRef, useCallback } from 'react';
import { Download, Loader2, Pause, Play, X, CheckCircle2, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import JSZip from 'jszip';
import { useAppStore } from '../store/appStore';
import { downloadBlob, sanitizeFilename, delay } from '../lib/utils';
import { generateCertificate, loadFont } from '../lib/certificateGenerator';
import type { CsvRow } from '../types';

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
    status: 'idle' | 'generating' | 'paused' | 'completed' | 'zipping' | 'loading-fonts';
    errors: FailedRecord[];
    generated: number;
}

const DEFAULT_PROGRESS: GenerateProgress = {
    current: 0,
    total: 0,
    currentName: '',
    status: 'idle',
    errors: [],
    generated: 0,
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
        setError,
    } = useAppStore();

    const [progress, setProgress] = useState<GenerateProgress>(DEFAULT_PROGRESS);
    const [logs, setLogs] = useState<GenerateLogs>(DEFAULT_LOGS);
    const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
    const pauseRef = useRef(false);
    const abortRef = useRef(false);
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
     * Generate certificates in batch
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

        const startTime = Date.now();
        const errors: FailedRecord[] = [];
        const certificates: Array<{ filename: string; jpgBlob?: Blob; pdfBlob?: Blob }> = [];

        // Pre-load all fonts
        setProgress({
            current: 0,
            total: records.length,
            currentName: 'Loading fonts...',
            status: 'loading-fonts',
            errors: [],
            generated: 0,
        });

        const uniqueFonts = new Set(boxes.map(b => b.fontFamily).filter(Boolean));
        for (const font of uniqueFonts) {
            await loadFont(font);
        }

        setProgress({
            current: 0,
            total: records.length,
            currentName: '',
            status: 'generating',
            errors: [],
            generated: 0,
        });

        if (!isRetry) {
            setLogs({ firstGenerated: new Date(), lastGenerated: null, totalElapsed: 0 });
        }

        for (let i = 0; i < records.length; i++) {
            if (abortRef.current) {
                setProgress(prev => ({ ...prev, status: 'idle' }));
                return;
            }

            while (pauseRef.current && !abortRef.current) {
                await delay(100);
            }

            if (abortRef.current) {
                setProgress(prev => ({ ...prev, status: 'idle' }));
                return;
            }

            const { rowIndex, row } = records[i];
            const displayName = getFilenameBasis(row);

            // Check if all fields are empty
            const hasContent = validBoxes.some(box => row[box.field]?.trim());
            if (!hasContent) {
                errors.push({ rowIndex, name: displayName || '(empty)', row, error: 'All text fields are empty' });
                setProgress(prev => ({
                    ...prev,
                    current: i + 1,
                    errors: [...errors],
                }));
                continue;
            }

            setProgress(prev => ({
                ...prev,
                current: i + 1,
                currentName: displayName,
            }));

            try {
                const result = await generateCertificate({
                    templateImage,
                    boxes: validBoxes,
                    row,
                    filename: sanitizeFilename(displayName),
                    includeJpg: true,
                    includePdf: true,
                });

                certificates.push({
                    filename: result.filename,
                    jpgBlob: result.jpgBlob,
                    pdfBlob: result.pdfBlob,
                });

                setProgress(prev => ({
                    ...prev,
                    generated: prev.generated + 1,
                    errors: [...errors],
                }));

                setLogs(prev => ({
                    ...prev,
                    lastGenerated: new Date(),
                    totalElapsed: Date.now() - startTime,
                }));

            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to generate';
                errors.push({ rowIndex, name: displayName, row, error: errorMsg });
                setProgress(prev => ({
                    ...prev,
                    errors: [...errors],
                }));
            }
        }

        // Zip and download
        if (certificates.length > 0 && !abortRef.current) {
            setProgress(prev => ({ ...prev, status: 'zipping', currentName: 'Creating ZIP...' }));

            try {
                const zip = new JSZip();
                const jpgFolder = zip.folder('certificates_jpg');
                const pdfFolder = zip.folder('certificates_pdf');

                for (const cert of certificates) {
                    if (cert.jpgBlob && jpgFolder) {
                        jpgFolder.file(`${cert.filename}.jpg`, cert.jpgBlob);
                    }
                    if (cert.pdfBlob && pdfFolder) {
                        pdfFolder.file(`${cert.filename}.pdf`, cert.pdfBlob);
                    }
                }

                const zipBlob = await zip.generateAsync({ type: 'blob' });
                downloadBlob(zipBlob, isRetry ? 'certificates_retry.zip' : 'certificates.zip');

            } catch {
                setError('Failed to create ZIP file');
            }
        }

        setProgress(prev => ({ ...prev, status: 'completed' }));
        setRetryQueue(errors);
        
        setLogs(prev => ({
            ...prev,
            totalElapsed: Date.now() - startTime,
        }));
    }, [templateImage, boxes, validBoxes, getFilenameBasis, setError]);

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
        setProgress(DEFAULT_PROGRESS);
        setRetryQueue([]);
    };

    const handleReset = () => {
        setProgress(DEFAULT_PROGRESS);
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
        return (
            <div className="space-y-3">
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
                    <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span className="font-medium text-emerald-700">Generation Complete!</span>
                    </div>
                    <div className="text-sm text-emerald-600 space-y-1">
                        <p>✓ {progress.generated} certificate{progress.generated !== 1 ? 's' : ''} generated</p>
                        {progress.errors.length > 0 && (
                            <p className="text-amber-600">⚠ {progress.errors.length} failed</p>
                        )}
                        {logs.totalElapsed > 0 && (
                            <div className="flex items-center gap-1 text-slate-500 mt-2">
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

                {/* Reset */}
                <button
                    onClick={handleReset}
                    className="w-full text-sm text-slate-500 hover:text-slate-700"
                >
                    Generate Another Batch
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
                        {progress.status === 'loading-fonts' || progress.status === 'zipping' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                        ) : progress.status === 'paused' ? (
                            <Pause className="w-4 h-4 text-amber-500" />
                        ) : (
                            <Loader2 className="w-4 h-4 animate-spin text-primary-600" />
                        )}
                        <span className="text-sm font-medium text-slate-700">
                            {progress.status === 'loading-fonts' ? 'Loading fonts...' :
                             progress.status === 'zipping' ? 'Creating ZIP...' :
                             progress.status === 'paused' ? 'Paused' :
                             'Generating...'}
                        </span>
                    </div>
                    <span className="text-sm text-slate-500">
                        {progress.current}/{progress.total}
                    </span>
                </div>

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

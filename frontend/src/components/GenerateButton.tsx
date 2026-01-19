import { useState, useRef, useCallback } from 'react';
import { Download, Mail, Loader2, Pause, Play, X, CheckCircle2, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import JSZip from 'jszip';
import { useAppStore } from '../store/appStore';
import { downloadBlob, fetchEmailConfig, delay, downloadErrorReport, sanitizeFilename } from '../lib/api';
import { generateCertificate, loadFont } from '../lib/certificateGenerator';
import type { CsvRow } from '../types';

interface FailedRecord {
    rowIndex: number;
    name: string;
    row: CsvRow;
    error: string;
}

interface GenerateLogs {
    firstGenerated: Date | null;
    lastGenerated: Date | null;
    totalElapsed: number; // ms
}

interface GenerateProgress {
    current: number;
    total: number;
    currentName: string;
    status: 'idle' | 'generating' | 'paused' | 'completed' | 'zipping' | 'loading-fonts';
    errors: FailedRecord[];
    generated: number;
}

const defaultProgress: GenerateProgress = {
    current: 0,
    total: 0,
    currentName: '',
    status: 'idle',
    errors: [],
    generated: 0,
};

const defaultLogs: GenerateLogs = {
    firstGenerated: null,
    lastGenerated: null,
    totalElapsed: 0,
};

export function GenerateButton() {
    const {
        templateImage,
        csvData,
        boxes,
        apiOnline,
        setViewMode,
        setError,
        setEmailConfig,
    } = useAppStore();

    const [progress, setProgress] = useState<GenerateProgress>(defaultProgress);
    const [logs, setLogs] = useState<GenerateLogs>(defaultLogs);
    const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
    const pauseRef = useRef(false);
    const abortRef = useRef(false);
    const [localPaused, setLocalPaused] = useState(false);

    const validBoxes = boxes.filter(b => b.field);
    const isReady = templateImage && csvData.length > 0 && validBoxes.length > 0 && apiOnline;

    const getFilenameBasis = (row: CsvRow): string => {
        const nameBox = boxes.find(b => b.field.toLowerCase().includes('name'));
        if (nameBox && row[nameBox.field]) {
            return row[nameBox.field];
        }
        if (validBoxes.length > 0 && row[validBoxes[0].field]) {
            return row[validBoxes[0].field];
        }
        return 'certificate';
    };

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

        const uniqueFonts = new Set(boxes.map(b => b.fontFile).filter(Boolean));
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
                // Client-side generation
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

            } catch (err) {
                setError('Failed to create ZIP file');
            }
        }

        setProgress(prev => ({
            ...prev,
            status: 'completed',
            errors: [...errors],
        }));

        setLogs(prev => ({
            ...prev,
            totalElapsed: Date.now() - startTime,
        }));

        setRetryQueue(errors);
    }, [templateImage, boxes, validBoxes, setError]);

    const handleGenerate = useCallback(async () => {
        const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
        await generateBatch(records, false);
    }, [csvData, generateBatch]);

    const handleRetry = useCallback(async () => {
        const records = retryQueue.map(err => ({ rowIndex: err.rowIndex, row: err.row }));
        await generateBatch(records, true);
    }, [retryQueue, generateBatch]);

    const handlePauseResume = () => {
        pauseRef.current = !pauseRef.current;
        setLocalPaused(pauseRef.current);
        setProgress(prev => ({ ...prev, status: pauseRef.current ? 'paused' : 'generating' }));
    };

    const handleStop = () => {
        abortRef.current = true;
        pauseRef.current = false;
        setLocalPaused(false);
    };

    const handleDone = () => {
        setProgress(defaultProgress);
        setLogs(defaultLogs);
        setRetryQueue([]);
    };

    const handleEmailMode = async () => {
        try {
            const config = await fetchEmailConfig();
            setEmailConfig(config);
            setViewMode('email');
        } catch {
            setError('Failed to fetch email configuration');
        }
    };

    const handleDownloadErrorReport = () => {
        downloadErrorReport(progress.errors.map(e => ({
            rowIndex: e.rowIndex,
            name: e.name,
            email: '',
            error: e.error,
        })), 'generation');
    };

    const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs}s`;
    };

    const formatTime = (date: Date | null): string => {
        if (!date) return '--:--:--';
        return date.toLocaleTimeString();
    };

    // Idle state - show action buttons
    if (progress.status === 'idle') {
        return (
            <div className="space-y-3">
                {validBoxes.length === 0 && boxes.length > 0 && (
                    <p className="text-xs text-amber-600">
                        Assign CSV fields to your text boxes to enable generation
                    </p>
                )}

                <button
                    onClick={handleGenerate}
                    disabled={!isReady}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                    <Download className="w-5 h-5" />
                    <span>Download as ZIP ({csvData.length})</span>
                </button>

                <button
                    onClick={handleEmailMode}
                    disabled={!isReady}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg font-medium hover:from-indigo-600 hover:to-purple-600 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/20"
                >
                    <Mail className="w-5 h-5" />
                    <span>Send via Email</span>
                </button>
            </div>
        );
    }

    // Generating / Paused / Zipping / Loading fonts state
    if (progress.status === 'generating' || progress.status === 'paused' || progress.status === 'zipping' || progress.status === 'loading-fonts') {
        return (
            <div className="space-y-4">
                {/* Progress */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">
                            {progress.status === 'loading-fonts' ? 'Loading fonts...' :
                                progress.status === 'zipping' ? 'Creating ZIP...' :
                                    `Generating ${progress.current}/${progress.total}`}
                        </span>
                        <span className="text-slate-500">{progress.currentName}</span>
                    </div>
                    <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                            className={`absolute left-0 top-0 h-full transition-all rounded-full ${progress.status === 'paused' ? 'bg-amber-500' : 'bg-primary-600'
                                }`}
                            style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{progress.generated} generated</span>
                        {progress.errors.length > 0 && (
                            <span className="text-red-500">{progress.errors.length} failed</span>
                        )}
                    </div>
                </div>

                {/* Controls */}
                <div className="flex gap-2">
                    <button
                        onClick={handlePauseResume}
                        disabled={progress.status === 'zipping' || progress.status === 'loading-fonts'}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {localPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                        <span>{localPaused ? 'Resume' : 'Pause'}</span>
                    </button>
                    <button
                        onClick={handleStop}
                        className="flex items-center justify-center px-3 py-2 border border-red-300 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {progress.status === 'zipping' && (
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Compressing files...</span>
                    </div>
                )}
            </div>
        );
    }

    // Completed state
    if (progress.status === 'completed') {
        const hasErrors = progress.errors.length > 0;

        return (
            <div className="space-y-4">
                {/* Success/Error Summary */}
                <div className={`p-3 rounded-lg ${hasErrors ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
                    <div className="flex items-start gap-2">
                        {hasErrors ? (
                            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        ) : (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div>
                            <p className={`font-medium ${hasErrors ? 'text-amber-800' : 'text-emerald-800'}`}>
                                {hasErrors ? 'Completed with issues' : 'Generation complete!'}
                            </p>
                            <p className={`text-sm ${hasErrors ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {progress.generated} of {csvData.length} certificates generated
                            </p>
                        </div>
                    </div>
                </div>

                {/* Logs */}
                <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
                    <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        <span>First: {formatTime(logs.firstGenerated)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Last: {formatTime(logs.lastGenerated)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Total time: {formatDuration(logs.totalElapsed)}</span>
                    </div>
                </div>

                {/* Errors section */}
                {hasErrors && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                        <p className="text-sm font-medium text-red-800">
                            {progress.errors.length} record{progress.errors.length > 1 ? 's' : ''} failed
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={handleRetry}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 transition-colors"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                Retry Failed
                            </button>
                            <button
                                onClick={handleDownloadErrorReport}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Report
                            </button>
                        </div>
                    </div>
                )}

                {/* Done button */}
                <button
                    onClick={handleDone}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg font-medium hover:bg-slate-900 transition-colors"
                >
                    <CheckCircle2 className="w-4 h-4" />
                    Done
                </button>
            </div>
        );
    }

    return null;
}

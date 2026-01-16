import { useState, useRef, useCallback } from 'react';
import { Download, Mail, Loader2, Pause, Play, X, CheckCircle2, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import JSZip from 'jszip';
import { useAppStore } from '../store/appStore';
import { generateSingleCertificate, downloadBlob, fetchEmailConfig, delay, downloadErrorReport, buildTextBoxConfigs, sanitizeFilename } from '../lib/api';
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
    status: 'idle' | 'generating' | 'paused' | 'completed' | 'zipping';
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
        templateFile,
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
    const isReady = templateFile && csvData.length > 0 && validBoxes.length > 0 && apiOnline;

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
        if (!templateFile || validBoxes.length === 0) return;

        abortRef.current = false;
        pauseRef.current = false;
        setLocalPaused(false);
        setError(null);

        const startTime = Date.now();
        const errors: FailedRecord[] = [];
        const certificates: Array<{ filename: string; jpg?: string; pdf?: string }> = [];

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
            const textBoxConfigs = buildTextBoxConfigs(boxes, row);

            const missingFields = textBoxConfigs.filter(tb => !tb.text.trim());
            if (missingFields.length === textBoxConfigs.length) {
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
                const result = await generateSingleCertificate({
                    templateFile,
                    textBoxes: textBoxConfigs,
                    includePdf: true,
                    includeJpg: true,
                    filename: sanitizeFilename(displayName),
                });

                certificates.push({
                    filename: result.filename,
                    jpg: result.jpg,
                    pdf: result.pdf,
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
                    if (cert.jpg && jpgFolder) {
                        const jpgData = Uint8Array.from(atob(cert.jpg), c => c.charCodeAt(0));
                        jpgFolder.file(`${cert.filename}.jpg`, jpgData);
                    }
                    if (cert.pdf && pdfFolder) {
                        const pdfData = Uint8Array.from(atob(cert.pdf), c => c.charCodeAt(0));
                        pdfFolder.file(`${cert.filename}.pdf`, pdfData);
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
    }, [templateFile, boxes, validBoxes, setError]);

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
        } catch (err) {
            console.error('Failed to fetch email config:', err);
        }
        setViewMode('email');
    };

    const handleDownloadFailures = () => {
        if (progress.errors.length > 0) {
            downloadErrorReport(progress.errors, 'generation');
        }
    };

    const formatTime = (date: Date | null) => {
        if (!date) return '-';
        return date.toLocaleTimeString();
    };

    const formatElapsed = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}m ${secs}s`;
    };

    const progressPercent = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    // Idle state
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

    // Generating / Paused / Zipping state
    if (progress.status === 'generating' || progress.status === 'paused' || progress.status === 'zipping') {
        return (
            <div className="space-y-3">
                <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className={`absolute inset-y-0 left-0 transition-all duration-300 ${progress.status === 'paused' ? 'bg-amber-500' :
                            progress.status === 'zipping' ? 'bg-emerald-500' : 'bg-primary-600'
                            }`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                        {progress.status === 'paused' ? (
                            <Pause className="w-4 h-4 text-amber-500" />
                        ) : progress.status === 'zipping' ? (
                            <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                        ) : (
                            <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />
                        )}
                        <span className="text-slate-600">
                            {progress.status === 'paused' ? 'Paused' :
                                progress.status === 'zipping' ? 'Creating ZIP...' : 'Generating'}:{' '}
                            <span className="font-medium">{progress.currentName}</span>
                        </span>
                    </div>
                    <span className="text-slate-500">
                        {progress.generated} / {progress.total}
                    </span>
                </div>

                {progress.status !== 'zipping' && (
                    <div className="flex gap-2">
                        <button
                            onClick={handlePauseResume}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors ${localPaused
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                }`}
                        >
                            {localPaused ? <><Play className="w-4 h-4" />Resume</> : <><Pause className="w-4 h-4" />Pause</>}
                        </button>
                        <button
                            onClick={handleStop}
                            className="flex items-center justify-center gap-2 px-3 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition-colors"
                        >
                            <X className="w-4 h-4" />Stop
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Completed state
    if (progress.status === 'completed') {
        const hasErrors = progress.errors.length > 0;
        const allFailed = progress.generated === 0 && hasErrors;

        return (
            <div className="space-y-3">
                {/* Logs */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="font-medium">Generation Log</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span className="text-slate-400">First:</span>{' '}
                            <span className="text-slate-600">{formatTime(logs.firstGenerated)}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">Last:</span>{' '}
                            <span className="text-slate-600">{formatTime(logs.lastGenerated)}</span>
                        </div>
                        <div className="col-span-2">
                            <span className="text-slate-400">Total Time:</span>{' '}
                            <span className="text-slate-600 font-medium">{formatElapsed(logs.totalElapsed)}</span>
                        </div>
                    </div>
                </div>

                {/* Success summary */}
                {!hasErrors && (
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                            <span className="text-sm font-medium text-emerald-800">
                                All {progress.generated} certificates generated successfully
                            </span>
                        </div>
                    </div>
                )}

                {/* Failure section */}
                {hasErrors && (
                    <div className={`p-3 rounded-lg border ${allFailed ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <AlertCircle className={`w-5 h-5 ${allFailed ? 'text-red-600' : 'text-amber-600'}`} />
                                <span className={`text-sm font-medium ${allFailed ? 'text-red-800' : 'text-amber-800'}`}>
                                    {progress.errors.length} failed
                                </span>
                            </div>
                            {progress.generated > 0 && (
                                <span className="text-xs text-emerald-600">
                                    {progress.generated} succeeded
                                </span>
                            )}
                        </div>

                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={handleRetry}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Retry Failed
                            </button>
                            <button
                                onClick={handleDownloadFailures}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-300 transition-colors"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Done button */}
                <button
                    onClick={handleDone}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg font-medium hover:bg-slate-900 transition-colors"
                >
                    Done
                </button>
            </div>
        );
    }

    return null;
}

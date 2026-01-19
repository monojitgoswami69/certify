import { useState, useRef, useCallback } from 'react';
import { Send, Pause, Play, X, Loader2, CheckCircle2, AlertCircle, RefreshCw, Download, Clock } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { sendEmailV2, replaceTemplateVariables, delay, downloadErrorReport, sanitizeFilename } from '../lib/api';
import { generateCertificate, loadFont } from '../lib/certificateGenerator';
import type { CsvRow } from '../types';

interface FailedRecord {
    rowIndex: number;
    name: string;
    email: string;
    row: CsvRow;
    error: string;
}

interface EmailLogs {
    firstSent: Date | null;
    lastSent: Date | null;
    totalElapsed: number;
}

export function EmailSendButton() {
    const {
        templateImage,
        csvData,
        boxes,
        emailColumn,
        apiOnline,
        emailConfig,
        emailSettings,
        emailProgress,
        setEmailProgress,
        resetEmailProgress,
        setError,
    } = useAppStore();

    const [logs, setLogs] = useState<EmailLogs>({ firstSent: null, lastSent: null, totalElapsed: 0 });
    const [retryQueue, setRetryQueue] = useState<FailedRecord[]>([]);
    const pauseRef = useRef(false);
    const abortRef = useRef(false);
    const [localPaused, setLocalPaused] = useState(false);

    const validBoxes = boxes.filter(b => b.field);
    const isReady = templateImage &&
        csvData.length > 0 &&
        validBoxes.length > 0 &&
        emailColumn &&
        apiOnline &&
        emailConfig?.configured &&
        (emailSettings.attachPdf || emailSettings.attachJpg);

    const getDisplayName = (row: CsvRow): string => {
        const nameBox = boxes.find(b => b.field.toLowerCase().includes('name'));
        if (nameBox && row[nameBox.field]) {
            return row[nameBox.field];
        }
        if (validBoxes.length > 0 && row[validBoxes[0].field]) {
            return row[validBoxes[0].field];
        }
        return 'Recipient';
    };

    const sendBatch = useCallback(async (
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
        const sent: Array<{ rowIndex: number; name: string; email: string }> = [];

        // Pre-load all fonts
        setEmailProgress({
            current: 0,
            total: records.length,
            currentRecipient: 'Loading fonts...',
            status: 'sending',
            errors: [],
            sent: [],
        });

        const uniqueFonts = new Set(boxes.map(b => b.fontFile).filter(Boolean));
        for (const font of uniqueFonts) {
            await loadFont(font);
        }

        if (!isRetry) {
            setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
        }

        for (let i = 0; i < records.length; i++) {
            if (abortRef.current) {
                setEmailProgress({ status: 'idle', errors, sent });
                return;
            }

            while (pauseRef.current && !abortRef.current) {
                await delay(100);
            }

            if (abortRef.current) {
                setEmailProgress({ status: 'idle', errors, sent });
                return;
            }

            const { rowIndex, row } = records[i];
            const displayName = getDisplayName(row);
            const email = row[emailColumn] || '';

            if (!email) {
                errors.push({
                    rowIndex,
                    name: displayName || '(empty)',
                    email: '(empty)',
                    row,
                    error: 'Missing email address'
                });
                setEmailProgress({
                    current: i + 1,
                    currentRecipient: displayName || '(skipped)',
                    errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                    sent: [...sent],
                });
                continue;
            }

            setEmailProgress({
                current: i + 1,
                currentRecipient: displayName,
                errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                sent: [...sent],
            });

            try {
                // Generate certificate client-side
                const cert = await generateCertificate({
                    templateImage,
                    boxes: validBoxes,
                    row,
                    filename: sanitizeFilename(displayName),
                    includeJpg: emailSettings.attachJpg,
                    includePdf: emailSettings.attachPdf,
                    includeBase64: true,  // We need base64 for email
                });

                const subject = replaceTemplateVariables(emailSettings.subject, row);
                const bodyPlain = replaceTemplateVariables(emailSettings.bodyPlain, row);
                const bodyHtml = emailSettings.bodyHtml.trim()
                    ? replaceTemplateVariables(emailSettings.bodyHtml, row)
                    : '';

                // Send via new simplified API
                await sendEmailV2({
                    recipientEmail: email,
                    emailSubject: subject,
                    emailBodyPlain: bodyPlain,
                    emailBodyHtml: bodyHtml,
                    filename: cert.filename,
                    jpgBase64: cert.jpgBase64,
                    pdfBase64: cert.pdfBase64,
                });

                sent.push({ rowIndex, name: displayName, email });

                // Update logs
                setLogs(prev => ({
                    firstSent: prev.firstSent || new Date(),
                    lastSent: new Date(),
                    totalElapsed: Date.now() - startTime,
                }));

                setEmailProgress({
                    current: i + 1,
                    currentRecipient: displayName,
                    errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                    sent: [...sent],
                });

                // Delay before next email
                if (i < records.length - 1 && !abortRef.current) {
                    await delay(emailSettings.delayMs);
                }

            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to send';
                errors.push({ rowIndex, name: displayName, email, row, error: errorMsg });
                setEmailProgress({
                    current: i + 1,
                    currentRecipient: displayName,
                    errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                    sent: [...sent],
                });
            }
        }

        setEmailProgress({
            current: records.length,
            total: records.length,
            currentRecipient: '',
            status: 'completed',
            errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
            sent: [...sent],
        });

        setLogs(prev => ({
            ...prev,
            totalElapsed: Date.now() - startTime,
        }));

        setRetryQueue(errors);
    }, [templateImage, boxes, validBoxes, emailColumn, emailSettings, setEmailProgress, setError]);

    const handleSend = useCallback(async () => {
        const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
        await sendBatch(records, false);
    }, [csvData, sendBatch]);

    const handleRetry = useCallback(async () => {
        const records = retryQueue.map(err => ({ rowIndex: err.rowIndex, row: err.row }));
        await sendBatch(records, true);
    }, [retryQueue, sendBatch]);

    const handlePauseResume = () => {
        pauseRef.current = !pauseRef.current;
        setLocalPaused(pauseRef.current);
        setEmailProgress({ status: pauseRef.current ? 'paused' : 'sending' });
    };

    const handleStop = () => {
        abortRef.current = true;
        pauseRef.current = false;
        setLocalPaused(false);
    };

    const handleDone = () => {
        resetEmailProgress();
        setLogs({ firstSent: null, lastSent: null, totalElapsed: 0 });
        setRetryQueue([]);
    };

    const handleDownloadErrorReport = () => {
        downloadErrorReport(emailProgress.errors, 'email');
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

    // Idle state
    if (emailProgress.status === 'idle') {
        return (
            <button
                onClick={handleSend}
                disabled={!isReady}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25"
            >
                <Send className="w-5 h-5" />
                <span>Send to {csvData.length} Recipients</span>
            </button>
        );
    }

    // Sending / Paused state
    if (emailProgress.status === 'sending' || emailProgress.status === 'paused') {
        return (
            <div className="space-y-4">
                {/* Progress */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">
                            Sending {emailProgress.current}/{emailProgress.total}
                        </span>
                        <span className="text-slate-500 truncate max-w-[150px]">
                            {emailProgress.currentRecipient}
                        </span>
                    </div>
                    <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                            className={`absolute left-0 top-0 h-full transition-all rounded-full ${emailProgress.status === 'paused' ? 'bg-amber-500' : 'bg-primary-600'
                                }`}
                            style={{ width: `${emailProgress.total > 0 ? (emailProgress.current / emailProgress.total) * 100 : 0}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{emailProgress.sent.length} sent</span>
                        {emailProgress.errors.length > 0 && (
                            <span className="text-red-500">{emailProgress.errors.length} failed</span>
                        )}
                    </div>
                </div>

                {/* Controls */}
                <div className="flex gap-2">
                    <button
                        onClick={handlePauseResume}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
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

                {emailProgress.status === 'sending' && (
                    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sending emails...</span>
                    </div>
                )}
            </div>
        );
    }

    // Completed state
    if (emailProgress.status === 'completed') {
        const hasErrors = emailProgress.errors.length > 0;

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
                                {hasErrors ? 'Completed with issues' : 'All emails sent!'}
                            </p>
                            <p className={`text-sm ${hasErrors ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {emailProgress.sent.length} of {csvData.length} emails sent
                            </p>
                        </div>
                    </div>
                </div>

                {/* Logs */}
                <div className="p-3 bg-slate-50 rounded-lg space-y-1 text-xs">
                    <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        <span>First sent: {formatTime(logs.firstSent)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Last sent: {formatTime(logs.lastSent)}</span>
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
                            {emailProgress.errors.length} email{emailProgress.errors.length > 1 ? 's' : ''} failed
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
    // Default fallback - show send button
    return (
        <button
            onClick={handleSend}
            disabled={!isReady}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25"
        >
            <Send className="w-5 h-5" />
            <span>Send to {csvData.length} Recipients</span>
        </button>
    );
}

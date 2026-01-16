import { useState, useRef, useCallback } from 'react';
import { Send, Pause, Play, X, Loader2, CheckCircle2, AlertCircle, RefreshCw, Download, Clock } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { sendCertificateEmail, replaceTemplateVariables, delay, downloadErrorReport, buildTextBoxConfigs, sanitizeFilename } from '../lib/api';
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
        templateFile,
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
    const isReady = templateFile &&
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
        if (!templateFile || validBoxes.length === 0) return;

        abortRef.current = false;
        pauseRef.current = false;
        setLocalPaused(false);
        setError(null);

        const startTime = Date.now();
        const errors: FailedRecord[] = [];
        const sent: Array<{ rowIndex: number; name: string; email: string }> = [];

        setEmailProgress({
            current: 0,
            total: records.length,
            currentRecipient: '',
            status: 'sending',
            errors: [],
            sent: [],
        });

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

            const textBoxConfigs = buildTextBoxConfigs(boxes, row);

            setEmailProgress({
                current: i + 1,
                currentRecipient: displayName,
                errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                sent: [...sent],
            });

            try {
                const subject = replaceTemplateVariables(emailSettings.subject, row);
                const bodyPlain = replaceTemplateVariables(emailSettings.bodyPlain, row);
                const bodyHtml = emailSettings.bodyHtml.trim()
                    ? replaceTemplateVariables(emailSettings.bodyHtml, row)
                    : '';

                await sendCertificateEmail({
                    templateFile,
                    recipientEmail: email,
                    textBoxes: textBoxConfigs,
                    emailSubject: subject,
                    emailBodyPlain: bodyPlain,
                    emailBodyHtml: bodyHtml,
                    attachPdf: emailSettings.attachPdf,
                    attachJpg: emailSettings.attachJpg,
                    filename: sanitizeFilename(displayName),
                });

                sent.push({ rowIndex, name: displayName, email });

                // Update logs
                setLogs(prev => ({
                    firstSent: prev.firstSent || new Date(),
                    lastSent: new Date(),
                    totalElapsed: Date.now() - startTime,
                }));

                setEmailProgress({
                    sent: [...sent],
                    errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                });

            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : 'Failed to send';
                errors.push({ rowIndex, name: displayName, email, row, error: errorMsg });
                setEmailProgress({
                    sent: [...sent],
                    errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
                });
            }

            if (i < records.length - 1 && !abortRef.current) {
                await delay(emailSettings.delayMs);
            }
        }

        setEmailProgress({
            status: 'completed',
            errors: errors.map(e => ({ rowIndex: e.rowIndex, name: e.name, email: e.email, error: e.error })),
            sent: [...sent],
        });

        setLogs(prev => ({
            ...prev,
            totalElapsed: Date.now() - startTime,
        }));

        setRetryQueue(errors);
    }, [templateFile, boxes, emailColumn, emailSettings, validBoxes, setEmailProgress, setError]);

    const handleStartSending = useCallback(async () => {
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

    const handleDownloadFailures = () => {
        if (emailProgress.errors.length > 0) {
            downloadErrorReport(emailProgress.errors, 'email');
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

    const progressPercent = emailProgress.total > 0
        ? Math.round((emailProgress.current / emailProgress.total) * 100)
        : 0;

    // Idle state
    if (emailProgress.status === 'idle') {
        return (
            <div className="space-y-3">
                <button
                    onClick={handleStartSending}
                    disabled={!isReady}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-indigo-600 text-white rounded-lg font-medium hover:from-primary-700 hover:to-indigo-700 disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-primary-500/25"
                >
                    <Send className="w-5 h-5" />
                    <span>Send to {csvData.length} Recipients</span>
                </button>

                {!isReady && (
                    <p className="text-xs text-amber-600 text-center">
                        {validBoxes.length === 0 && 'Assign CSV fields to text boxes • '}
                        {!emailColumn && 'Select an email column • '}
                        {!emailConfig?.configured && 'Email not configured on server • '}
                        {(!emailSettings.attachPdf && !emailSettings.attachJpg) && 'Select at least one attachment'}
                    </p>
                )}
            </div>
        );
    }

    // Sending / Paused state
    if (emailProgress.status === 'sending' || emailProgress.status === 'paused') {
        return (
            <div className="space-y-3">
                <div className="relative h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className={`absolute inset-y-0 left-0 transition-all duration-300 ${emailProgress.status === 'paused' ? 'bg-amber-500' : 'bg-primary-600'
                            }`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                        {emailProgress.status === 'paused' ? (
                            <Pause className="w-4 h-4 text-amber-500" />
                        ) : (
                            <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />
                        )}
                        <span className="text-slate-600">
                            {emailProgress.status === 'paused' ? 'Paused' : 'Sending'}:{' '}
                            <span className="font-medium">{emailProgress.currentRecipient}</span>
                        </span>
                    </div>
                    <span className="text-slate-500">
                        {emailProgress.current} / {emailProgress.total}
                    </span>
                </div>

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
            </div>
        );
    }

    // Completed state
    if (emailProgress.status === 'completed') {
        const hasErrors = emailProgress.errors.length > 0;
        const allFailed = emailProgress.sent.length === 0 && hasErrors;

        return (
            <div className="space-y-3">
                {/* Logs */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="font-medium">Email Log</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <span className="text-slate-400">First Sent:</span>{' '}
                            <span className="text-slate-600">{formatTime(logs.firstSent)}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">Last Sent:</span>{' '}
                            <span className="text-slate-600">{formatTime(logs.lastSent)}</span>
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
                                All {emailProgress.sent.length} emails sent successfully
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
                                    {emailProgress.errors.length} failed
                                </span>
                            </div>
                            {emailProgress.sent.length > 0 && (
                                <span className="text-xs text-emerald-600">
                                    {emailProgress.sent.length} succeeded
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

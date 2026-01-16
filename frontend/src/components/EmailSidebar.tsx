import { useRef } from 'react';
import { ArrowLeft, Mail, FileText, Paperclip, Clock, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { calculateEstimatedTime } from '../lib/api';
import { EmailSendButton } from './EmailSendButton';

export function EmailSidebar() {
    const {
        csvHeaders,
        csvData,
        emailColumn,
        emailSettings,
        emailConfig,
        setEmailColumn,
        setEmailSettings,
        resetToDownload,
    } = useAppStore();

    // Refs to track cursor position in text fields
    const subjectRef = useRef<HTMLInputElement>(null);
    const bodyPlainRef = useRef<HTMLTextAreaElement>(null);
    const bodyHtmlRef = useRef<HTMLTextAreaElement>(null);

    const estimatedTime = calculateEstimatedTime(csvData.length, emailSettings.delayMs);

    const emailColumns = csvHeaders.filter(h =>
        h.toLowerCase().includes('email') || h.toLowerCase().includes('mail')
    );

    // Insert variable at cursor position in the last focused field
    const insertVariable = (variable: string) => {
        const insertion = `{{${variable}}}`;

        // Check which field was last focused and insert there
        if (document.activeElement === subjectRef.current && subjectRef.current) {
            const input = subjectRef.current;
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const newValue = emailSettings.subject.slice(0, start) + insertion + emailSettings.subject.slice(end);
            setEmailSettings({ subject: newValue });
            // Restore cursor position after React re-renders
            setTimeout(() => {
                input.setSelectionRange(start + insertion.length, start + insertion.length);
                input.focus();
            }, 0);
        } else if (document.activeElement === bodyHtmlRef.current && bodyHtmlRef.current) {
            const textarea = bodyHtmlRef.current;
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const newValue = emailSettings.bodyHtml.slice(0, start) + insertion + emailSettings.bodyHtml.slice(end);
            setEmailSettings({ bodyHtml: newValue });
            setTimeout(() => {
                textarea.setSelectionRange(start + insertion.length, start + insertion.length);
                textarea.focus();
            }, 0);
        } else {
            // Default to plain text body
            const textarea = bodyPlainRef.current;
            if (textarea) {
                const start = textarea.selectionStart || emailSettings.bodyPlain.length;
                const end = textarea.selectionEnd || emailSettings.bodyPlain.length;
                const newValue = emailSettings.bodyPlain.slice(0, start) + insertion + emailSettings.bodyPlain.slice(end);
                setEmailSettings({ bodyPlain: newValue });
                setTimeout(() => {
                    textarea.setSelectionRange(start + insertion.length, start + insertion.length);
                    textarea.focus();
                }, 0);
            }
        }
    };

    return (
        <aside className="w-[420px] bg-white border-r border-slate-200 overflow-y-auto flex-shrink-0 flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-primary-50 to-indigo-50">
                <div className="flex items-center gap-3">
                    <button
                        onClick={resetToDownload}
                        className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5 text-primary-600" />
                    </button>
                    <div>
                        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                            <Mail className="w-5 h-5 text-primary-600" />
                            Email Mode
                        </h2>
                        <p className="text-sm text-slate-500">
                            Send certificates directly to recipients
                        </p>
                    </div>
                </div>
            </div>

            {/* Email Config Status */}
            {emailConfig && (
                <div className={`mx-4 mt-4 p-3 rounded-lg text-sm ${emailConfig.configured
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                    : 'bg-amber-50 border border-amber-200 text-amber-700'
                    }`}>
                    {emailConfig.configured ? (
                        <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            <span>Sending from: <strong>{emailConfig.sender}</strong></span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            <span>Email not configured on server</span>
                        </div>
                    )}
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 p-4 space-y-5 overflow-y-auto">
                {/* Email Column Selection */}
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                        <Mail className="inline w-3.5 h-3.5 mr-1" />
                        Email Column in CSV
                    </label>
                    <select
                        value={emailColumn}
                        onChange={(e) => setEmailColumn(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    >
                        <option value="">Select email column...</option>
                        {emailColumns.length > 0 ? (
                            emailColumns.map(h => (
                                <option key={h} value={h}>{h}</option>
                            ))
                        ) : (
                            csvHeaders.map(h => (
                                <option key={h} value={h}>{h}</option>
                            ))
                        )}
                    </select>
                </div>

                {/* Variable Helper - Active styling */}
                <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg">
                    <p className="text-xs font-medium text-primary-800 mb-2">
                        Template Variables
                    </p>
                    <p className="text-xs text-primary-600 mb-3">
                        Click to insert <code className="bg-white px-1 rounded border border-primary-200">{'{{column}}'}</code> at cursor
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {csvHeaders.map(header => (
                            <button
                                key={header}
                                onClick={() => insertVariable(header)}
                                className="px-2.5 py-1 text-xs bg-white text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 hover:border-slate-400 transition-colors"
                            >
                                {header}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Subject */}
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                        <FileText className="inline w-3.5 h-3.5 mr-1" />
                        Email Subject
                    </label>
                    <input
                        ref={subjectRef}
                        type="text"
                        value={emailSettings.subject}
                        onChange={(e) => setEmailSettings({ subject: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                        placeholder="Your Certificate is Ready!"
                    />
                </div>

                {/* Plain Text Body - Taller */}
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                        Email Body (Plain Text)
                    </label>
                    <textarea
                        ref={bodyPlainRef}
                        value={emailSettings.bodyPlain}
                        onChange={(e) => setEmailSettings({ bodyPlain: e.target.value })}
                        rows={10}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 font-mono resize-y"
                        placeholder="Hi {{name}},&#10;&#10;Congratulations!..."
                    />
                </div>

                {/* HTML Body - Taller */}
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                        Email Body (HTML) - Optional
                    </label>
                    <textarea
                        ref={bodyHtmlRef}
                        value={emailSettings.bodyHtml}
                        onChange={(e) => setEmailSettings({ bodyHtml: e.target.value })}
                        rows={8}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 font-mono text-xs resize-y"
                        placeholder="<div>Hi {{name}},</div>..."
                    />
                    <p className="text-xs text-slate-400 mt-1">
                        Leave empty to use plain text only
                    </p>
                </div>

                {/* Attachment Options */}
                <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-500">
                        <Paperclip className="inline w-3.5 h-3.5 mr-1" />
                        Attachments
                    </label>
                    <div className="flex items-center gap-6">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    checked={emailSettings.attachPdf}
                                    onChange={(e) => setEmailSettings({ attachPdf: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-primary-600 transition-colors"></div>
                                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-5"></div>
                            </div>
                            <span className="text-sm text-slate-600 font-medium">PDF</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    checked={emailSettings.attachJpg}
                                    onChange={(e) => setEmailSettings({ attachJpg: e.target.checked })}
                                    className="sr-only peer"
                                />
                                <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:bg-primary-600 transition-colors"></div>
                                <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform peer-checked:translate-x-5"></div>
                            </div>
                            <span className="text-sm text-slate-600 font-medium">JPG</span>
                        </label>
                    </div>
                    {!emailSettings.attachPdf && !emailSettings.attachJpg && (
                        <p className="text-xs text-amber-600">Select at least one attachment type</p>
                    )}
                </div>

                {/* Delay Between Emails */}
                <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-500">
                        <Clock className="inline w-3.5 h-3.5 mr-1" />
                        Delay Between Emails: {(emailSettings.delayMs / 1000).toFixed(0)}s
                    </label>
                    <input
                        type="range"
                        min="1000"
                        max="10000"
                        step="1000"
                        value={emailSettings.delayMs}
                        onChange={(e) => setEmailSettings({ delayMs: parseInt(e.target.value) })}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
                    />
                    <div className="flex justify-between text-xs text-slate-400">
                        <span>1s</span>
                        <span>10s</span>
                    </div>
                </div>

                {/* Estimated Time */}
                <div className="p-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                    <div className="flex items-start gap-2">
                        <Clock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-medium text-amber-800">
                                Estimated time: {estimatedTime}
                            </p>
                            <p className="text-xs text-amber-600 mt-0.5">
                                for {csvData.length} recipients • may vary based on server load
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Send Button - Fixed at bottom */}
            <div className="p-4 border-t border-slate-200 bg-white">
                <EmailSendButton />
            </div>
        </aside>
    );
}

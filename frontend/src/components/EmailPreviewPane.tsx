import { Mail, Paperclip, FileImage, FileText as FilePdf, Eye, Code } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { replaceTemplateVariables } from '../lib/api';

export function EmailPreviewPane() {
    const {
        csvData,
        boxes,
        emailColumn,
        emailSettings,
        emailConfig,
    } = useAppStore();

    const [viewType, setViewType] = useState<'plain' | 'html'>('plain');

    // Get first row for preview
    const previewData = csvData.length > 0 ? csvData[0] : {};

    // Find a name-like field from boxes for display
    const nameField = boxes.find(b => b.field.toLowerCase().includes('name'))?.field || boxes[0]?.field || '';
    const recipientName = previewData[nameField] || 'John Doe';
    const recipientEmail = previewData[emailColumn] || 'recipient@example.com';

    // Replace template variables with actual data
    const renderedSubject = replaceTemplateVariables(emailSettings.subject, previewData);
    const renderedBodyPlain = replaceTemplateVariables(emailSettings.bodyPlain, previewData);
    const renderedBodyHtml = emailSettings.bodyHtml.trim()
        ? replaceTemplateVariables(emailSettings.bodyHtml, previewData)
        : '';

    const hasHtml = renderedBodyHtml.length > 0;

    const attachments: { icon: React.ReactNode; name: string; type: string }[] = [];
    if (emailSettings.attachPdf) {
        attachments.push({
            icon: <FilePdf className="w-5 h-5 text-red-500" />,
            name: `${recipientName.replace(/\s+/g, '_')}.pdf`,
            type: 'PDF'
        });
    }
    if (emailSettings.attachJpg) {
        attachments.push({
            icon: <FileImage className="w-5 h-5 text-cyan-500" />,
            name: `${recipientName.replace(/\s+/g, '_')}.jpg`,
            type: 'JPG'
        });
    }

    return (
        <div className="flex-1 flex flex-col bg-slate-100 overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                            <Eye className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-slate-800">Email Preview</h2>
                            <p className="text-sm text-slate-500">
                                Using data from first CSV row
                            </p>
                        </div>
                    </div>

                    {/* View Toggle - Always visible */}
                    <div className="flex bg-slate-100 p-1 rounded-lg">
                        <button
                            onClick={() => setViewType('plain')}
                            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewType === 'plain'
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Plain Text
                        </button>
                        <button
                            onClick={() => setViewType('html')}
                            className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${viewType === 'html'
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Code className="w-3.5 h-3.5" />
                            HTML
                        </button>
                    </div>
                </div>
            </div>

            {/* Email Preview Content */}
            <div className="flex-1 overflow-auto p-6">
                <div className="max-w-2xl mx-auto">
                    {/* Email Container */}
                    <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-slate-200">
                        {/* Email Header */}
                        <div className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 p-5">
                            <div className="space-y-3">
                                {/* From */}
                                <div className="flex items-baseline gap-3">
                                    <span className="text-sm text-slate-400 w-14">From</span>
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                                            <Mail className="w-4 h-4 text-primary-600" />
                                        </div>
                                        <span className="font-medium text-slate-800">
                                            {emailConfig?.sender || 'sender@example.com'}
                                        </span>
                                    </div>
                                </div>

                                {/* To */}
                                <div className="flex items-baseline gap-3">
                                    <span className="text-sm text-slate-400 w-14">To</span>
                                    <span className="text-slate-700">{recipientEmail}</span>
                                </div>

                                {/* Subject */}
                                <div className="flex items-baseline gap-3">
                                    <span className="text-sm text-slate-400 w-14">Subject</span>
                                    <span className="text-lg font-semibold text-slate-900">
                                        {renderedSubject || '(No subject)'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Attachments */}
                        {attachments.length > 0 && (
                            <div className="border-b border-slate-200 px-5 py-4 bg-slate-50/50">
                                <div className="flex items-center gap-2 text-sm text-slate-500 mb-3">
                                    <Paperclip className="w-4 h-4" />
                                    <span className="font-medium">{attachments.length} Attachment{attachments.length > 1 ? 's' : ''}</span>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    {attachments.map((att, idx) => (
                                        <div
                                            key={idx}
                                            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:shadow-sm transition-shadow"
                                        >
                                            {att.icon}
                                            <div>
                                                <div className="text-sm font-medium text-slate-700">{att.name}</div>
                                                <div className="text-xs text-slate-400">{att.type} Certificate</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Email Body */}
                        <div className="p-6 min-h-[300px]">
                            {viewType === 'plain' ? (
                                <pre className="whitespace-pre-wrap font-sans text-slate-700 text-base leading-relaxed">
                                    {renderedBodyPlain || '(No content)'}
                                </pre>
                            ) : hasHtml ? (
                                <div
                                    className="prose prose-slate max-w-none"
                                    dangerouslySetInnerHTML={{ __html: renderedBodyHtml }}
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                                    <Code className="w-12 h-12 text-slate-300 mb-4" />
                                    <p className="text-slate-500 font-medium">No HTML content</p>
                                    <p className="text-sm text-slate-400 mt-1">
                                        Add HTML body in the sidebar to preview rich formatting
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/50">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                                <span>
                                    This preview uses data from row 1 of your CSV
                                </span>
                                <div className="flex items-center gap-1">
                                    <Mail className="w-3.5 h-3.5" />
                                    <span>Email Preview</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

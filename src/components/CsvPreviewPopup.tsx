import { useState } from 'react';
import { X, Table, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface CsvPreviewPopupProps {
    isOpen: boolean;
    onClose: () => void;
}

export function CsvPreviewPopup({ isOpen, onClose }: CsvPreviewPopupProps) {
    const { csvHeaders, csvData, csvFile } = useAppStore();
    const [page, setPage] = useState(0);
    const rowsPerPage = 10;

    if (!isOpen) return null;

    const totalPages = Math.ceil(csvData.length / rowsPerPage);
    const startRow = page * rowsPerPage;
    const visibleRows = csvData.slice(startRow, startRow + rowsPerPage);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                            <Table className="w-5 h-5 text-primary-600" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-slate-800">CSV Data Preview</h2>
                            <p className="text-sm text-slate-500">
                                {csvFile?.name} • {csvData.length} records • {csvHeaders.length} columns
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-slate-500" />
                    </button>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto p-4">
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50">
                                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                                        #
                                    </th>
                                    {csvHeaders.map((header, idx) => (
                                        <th
                                            key={idx}
                                            className="px-3 py-2.5 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider border-b border-slate-200 whitespace-nowrap"
                                        >
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {visibleRows.map((row, rowIdx) => (
                                    <tr key={rowIdx} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-3 py-2 text-slate-400 font-mono text-xs">
                                            {startRow + rowIdx + 1}
                                        </td>
                                        {csvHeaders.map((header, colIdx) => (
                                            <td
                                                key={colIdx}
                                                className="px-3 py-2 text-slate-700 max-w-[200px] truncate"
                                                title={row[header]}
                                            >
                                                {row[header] || <span className="text-slate-300 italic">empty</span>}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Footer with pagination */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50">
                        <p className="text-sm text-slate-500">
                            Showing {startRow + 1}-{Math.min(startRow + rowsPerPage, csvData.length)} of {csvData.length}
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                                className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm text-slate-600 px-2">
                                Page {page + 1} of {totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                                className="p-2 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

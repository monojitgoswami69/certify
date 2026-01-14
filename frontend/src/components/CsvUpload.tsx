import { useCallback } from 'react';
import { FileText } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { parseCsv } from '../lib/api';

export function CsvUpload() {
    const { setCsvData, setError } = useAppStore();

    const handleFile = useCallback((file: File) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target?.result as string;
                const { headers, data } = parseCsv(text);
                setCsvData(file, headers, data);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to parse CSV');
            }
        };
        reader.readAsText(file);
    }, [setCsvData, setError]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    }, [handleFile]);

    return (
        <label
            className="flex items-center gap-3 p-4 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
        >
            <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleChange}
            />
            <FileText className="w-6 h-6 text-slate-400" />
            <span className="text-sm text-slate-600">Upload CSV file</span>
        </label>
    );
}

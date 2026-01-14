import { Download } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { generateCertificates, downloadBlob } from '../lib/api';

export function GenerateButton() {
    const {
        templateFile,
        csvFile,
        selection,
        selectedColumn,
        fontSize,
        fontColor,
        selectedFont,
        apiOnline,
        isGenerating,
        progress,
        setGenerating,
        setError,
    } = useAppStore();

    const isReady = templateFile && csvFile && selection && selectedColumn && apiOnline;

    const handleGenerate = async () => {
        if (!templateFile || !csvFile || !selection || !selectedColumn) return;

        setGenerating(true, 50);
        setError(null);

        try {
            const { blob, count } = await generateCertificates(
                templateFile,
                csvFile,
                selectedColumn,
                selection,
                fontSize,
                fontColor,
                selectedFont
            );

            setGenerating(true, 100);
            downloadBlob(blob, 'certificates.zip');

            setTimeout(() => {
                setGenerating(false);
                alert(`Successfully generated ${count} certificates!`);
            }, 500);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Generation failed');
            setGenerating(false);
        }
    };

    return (
        <div className="space-y-3">
            <button
                onClick={handleGenerate}
                disabled={!isReady || isGenerating}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
                {isGenerating ? (
                    <span>Generating...</span>
                ) : (
                    <>
                        <Download className="w-5 h-5" />
                        <span>Generate & Download</span>
                    </>
                )}
            </button>

            {isGenerating && (
                <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-primary-600 transition-all duration-300"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
        </div>
    );
}

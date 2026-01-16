import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function BoxCustomizer() {
    const {
        boxes,
        activeBoxId,
        fonts,
        csvHeaders,
        csvData,
        updateBox,
        deleteBox,
    } = useAppStore();

    const activeBox = boxes.find(b => b.id === activeBoxId);

    // Local state for font size input to allow erasing
    const [fontSizeInput, setFontSizeInput] = useState<string>(
        activeBox ? String(activeBox.fontSize) : '60'
    );

    // Sync local state when active box changes
    if (activeBox && String(activeBox.fontSize) !== fontSizeInput && document.activeElement?.tagName !== 'INPUT') {
        setFontSizeInput(String(activeBox.fontSize));
    }

    if (!activeBox) {
        if (boxes.length === 0) {
            return (
                <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center">
                    <p className="text-sm text-slate-500">
                        Draw a box on the template to add text areas
                    </p>
                </div>
            );
        }
        return (
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <p className="text-sm text-slate-500">
                    Click on a box to customize it
                </p>
            </div>
        );
    }

    // Get preview text from first CSV row
    const previewValue = csvData.length > 0 && activeBox.field
        ? csvData[0][activeBox.field] || '(empty)'
        : '';

    const handleFontSizeChange = (value: string) => {
        setFontSizeInput(value);
        const num = parseInt(value);
        if (!isNaN(num) && num >= 10 && num <= 200) {
            updateBox(activeBox.id, { fontSize: num });
        }
    };

    const handleFontSizeBlur = () => {
        const num = parseInt(fontSizeInput);
        if (isNaN(num) || num < 10) {
            setFontSizeInput('10');
            updateBox(activeBox.id, { fontSize: 10 });
        } else if (num > 200) {
            setFontSizeInput('200');
            updateBox(activeBox.id, { fontSize: 200 });
        }
    };

    return (
        <div className="space-y-4">
            {/* Box Header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide">Selected Box</p>
                    <p className="font-medium text-slate-700 mt-0.5">
                        {activeBox.field || 'No field selected'}
                    </p>
                </div>
                <button
                    onClick={() => deleteBox(activeBox.id)}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {/* Preview */}
            {previewValue && (
                <div className="p-2 bg-primary-50 rounded-lg border border-primary-100">
                    <p className="text-xs text-primary-600 mb-0.5">First row preview:</p>
                    <p className="text-sm font-medium text-primary-800 truncate">{previewValue}</p>
                </div>
            )}

            {/* Field Selector */}
            <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    CSV Field
                </label>
                <select
                    value={activeBox.field}
                    onChange={(e) => updateBox(activeBox.id, { field: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                >
                    <option value="">Select a field...</option>
                    {csvHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                    ))}
                </select>
            </div>

            {/* Font Selector */}
            <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Font</label>
                <select
                    value={activeBox.fontFile}
                    onChange={(e) => updateBox(activeBox.id, { fontFile: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                >
                    {fonts.map((font) => (
                        <option key={font.filename} value={font.filename}>
                            {font.displayName}
                        </option>
                    ))}
                </select>
            </div>

            {/* Font Size & Color */}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Size (px)</label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={fontSizeInput}
                        onChange={(e) => handleFontSizeChange(e.target.value)}
                        onBlur={handleFontSizeBlur}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Color</label>
                    <input
                        type="color"
                        value={activeBox.fontColor}
                        onChange={(e) => updateBox(activeBox.id, { fontColor: e.target.value })}
                        className="w-full h-10 border border-slate-200 rounded-lg cursor-pointer"
                    />
                </div>
            </div>

            {/* Position Info */}
            <div className="p-2 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">Position</p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                        <span className="text-slate-400">X:</span>{' '}
                        <span className="font-mono text-slate-600">{Math.round(activeBox.x)}</span>
                    </div>
                    <div>
                        <span className="text-slate-400">Y:</span>{' '}
                        <span className="font-mono text-slate-600">{Math.round(activeBox.y)}</span>
                    </div>
                    <div>
                        <span className="text-slate-400">W:</span>{' '}
                        <span className="font-mono text-slate-600">{Math.round(activeBox.w)}</span>
                    </div>
                    <div>
                        <span className="text-slate-400">H:</span>{' '}
                        <span className="font-mono text-slate-600">{Math.round(activeBox.h)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

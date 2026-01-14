import { useAppStore } from '../store/appStore';

export function StyleControls() {
    const {
        fonts,
        selectedFont,
        fontSize,
        fontColor,
        previewText,
        previewEnabled,
        setSelectedFont,
        setFontSize,
        setFontColor,
        setPreviewText,
        setPreviewEnabled,
    } = useAppStore();

    return (
        <div className="space-y-4">
            {/* Preview Toggle */}
            <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        checked={previewEnabled}
                        onChange={(e) => setPreviewEnabled(e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:bg-primary-600 peer-focus:ring-4 peer-focus:ring-primary-300/30 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:shadow-sm after:transition-all peer-checked:after:translate-x-full" />
                </label>
                <span className="text-sm font-medium text-slate-700">Enable Preview</span>
            </div>

            {/* Preview Text Input */}
            <div className={`transition-opacity ${previewEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Preview Text</label>
                <input
                    type="text"
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    placeholder="Type a sample name..."
                    disabled={!previewEnabled}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 disabled:bg-slate-50 disabled:cursor-not-allowed"
                />
                <p className="text-xs text-slate-400 mt-1">Text will appear on the certificate</p>
            </div>

            {/* Font Selector */}
            <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Font</label>
                <select
                    value={selectedFont}
                    onChange={(e) => setSelectedFont(e.target.value)}
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
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Font Size (px)</label>
                    <input
                        type="number"
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value) || 60)}
                        min={10}
                        max={200}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Text Color</label>
                    <input
                        type="color"
                        value={fontColor}
                        onChange={(e) => setFontColor(e.target.value)}
                        className="w-full h-10 border border-slate-200 rounded-lg cursor-pointer"
                    />
                </div>
            </div>
        </div>
    );
}

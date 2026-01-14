import { useAppStore } from '../store/appStore';

export function CoordinateInputs() {
    const { selection, setSelection, templateImage } = useAppStore();

    const handleChange = (field: 'x' | 'y' | 'w' | 'h', value: string) => {
        if (!templateImage || !selection) return;

        const numValue = parseInt(value) || 0;
        const maxX = templateImage.width - 20;
        const maxY = templateImage.height - 20;

        const newSelection = { ...selection };

        switch (field) {
            case 'x':
                newSelection.x = Math.max(0, Math.min(numValue, maxX));
                break;
            case 'y':
                newSelection.y = Math.max(0, Math.min(numValue, maxY));
                break;
            case 'w':
                newSelection.w = Math.max(20, Math.min(numValue, templateImage.width - selection.x));
                break;
            case 'h':
                newSelection.h = Math.max(20, Math.min(numValue, templateImage.height - selection.y));
                break;
        }

        setSelection(newSelection);
    };

    return (
        <div className="grid grid-cols-4 gap-2">
            {(['x', 'y', 'w', 'h'] as const).map((field) => (
                <div key={field} className="flex flex-col gap-1">
                    <span className="text-xs font-semibold text-slate-400 uppercase">{field}</span>
                    <input
                        type="number"
                        value={selection ? Math.round(selection[field]) : ''}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="w-full px-2 py-1.5 text-sm font-mono text-center bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                        min={field === 'x' || field === 'y' ? 0 : 20}
                    />
                </div>
            ))}
        </div>
    );
}

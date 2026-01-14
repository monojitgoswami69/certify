import { CheckCircle, Cloud, CloudOff, RotateCcw } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function Header() {
    const { apiOnline, reset } = useAppStore();

    const handleReset = () => {
        if (confirm('Reset everything and start over?')) {
            reset();
            window.location.reload();
        }
    };

    return (
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
            <div className="flex items-center gap-2 text-primary-600">
                <CheckCircle className="w-7 h-7" />
                <span className="text-xl font-semibold text-slate-900">Certify</span>
            </div>

            <div className="flex items-center gap-2 text-sm">
                {apiOnline ? (
                    <>
                        <Cloud className="w-4 h-4 text-emerald-500" />
                        <span className="text-emerald-600">API Connected</span>
                    </>
                ) : (
                    <>
                        <CloudOff className="w-4 h-4 text-red-500" />
                        <span className="text-red-600">API Offline</span>
                    </>
                )}
            </div>

            <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
                <RotateCcw className="w-4 h-4" />
                Reset
            </button>
        </header>
    );
}

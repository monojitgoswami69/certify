import type { ReactNode } from 'react';
import { clsx } from 'clsx';

interface StepCardProps {
    number: number;
    title: string;
    status: 'pending' | 'active' | 'completed';
    children: ReactNode;
}

export function StepCard({ number, title, status, children }: StepCardProps) {
    const isCollapsed = status === 'pending';

    return (
        <div
            className={clsx(
                'rounded-lg border transition-all duration-300',
                status === 'completed' && 'bg-slate-50 border-slate-200',
                status === 'active' && 'bg-white border-primary-300 shadow-sm shadow-primary-100',
                status === 'pending' && 'bg-slate-50/50 border-slate-200 opacity-50'
            )}
        >
            <div className={clsx(
                'flex items-center gap-3 px-4 py-3',
                !isCollapsed && 'border-b border-slate-100'
            )}>
                <span
                    className={clsx(
                        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                        status === 'completed' && 'bg-emerald-500 text-white',
                        status === 'active' && 'bg-primary-600 text-white',
                        status === 'pending' && 'bg-slate-300 text-slate-500'
                    )}
                >
                    {status === 'completed' ? '✓' : number}
                </span>
                <h3 className={clsx(
                    'font-medium text-sm',
                    status === 'pending' ? 'text-slate-400' : 'text-slate-900'
                )}>{title}</h3>
            </div>

            {/* Content - only shown when not pending */}
            <div className={clsx(
                'overflow-hidden transition-all duration-300',
                isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'
            )}>
                <div className="p-4 pt-3">{children}</div>
            </div>
        </div>
    );
}

import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface StepCardProps {
    number: number;
    title: string;
    status: 'pending' | 'active' | 'completed';
    children: ReactNode;
}

export function StepCard({ number, title, status, children }: StepCardProps) {

    return (
        <div
            className={cn(
                'rounded-lg border transition-all duration-300',
                status === 'completed' && 'bg-slate-50 border-slate-200',
                status === 'active' && 'bg-white border-primary-300 shadow-sm shadow-primary-100',
                status === 'pending' && 'bg-slate-50 border-slate-100 opacity-85'
            )}
        >
            <div className={cn(
                'flex items-center gap-3 px-4 py-3 border-b border-slate-100'
            )}>
                <span
                    className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                        status === 'completed' && 'bg-emerald-500 text-white',
                        status === 'active' && 'bg-primary-600 text-white',
                        status === 'pending' && 'bg-slate-200 text-slate-500'
                    )}
                >
                    {status === 'completed' ? '✓' : number}
                </span>
                <h3 className={cn(
                    'font-bold text-sm',
                    status === 'pending' ? 'text-slate-500' : 'text-slate-900'
                )}>{title}</h3>
            </div>

            {/* Content - always visible but non-interactive when pending */}
            <div className={cn(
                'transition-opacity duration-300',
                status === 'pending' && 'pointer-events-none'
            )}>
                <div className="p-4 pt-3">{children}</div>
            </div>
        </div>
    );
}

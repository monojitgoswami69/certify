import type { ReactNode } from 'react';
import { clsx } from 'clsx';

interface StepCardProps {
    number: number;
    title: string;
    status: 'pending' | 'active' | 'completed';
    children: ReactNode;
}

export function StepCard({ number, title, status, children }: StepCardProps) {
    return (
        <div
            className={clsx(
                'rounded-xl border transition-all duration-200',
                status === 'completed' && 'bg-slate-50 border-slate-200',
                status === 'active' && 'bg-white border-primary-300 shadow-sm shadow-primary-100',
                status === 'pending' && 'bg-slate-50/50 border-slate-200 opacity-60'
            )}
        >
            <div className="flex items-center gap-3 p-4 border-b border-slate-100">
                <span
                    className={clsx(
                        'w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold',
                        status === 'completed' && 'bg-emerald-500 text-white',
                        status === 'active' && 'bg-primary-600 text-white',
                        status === 'pending' && 'bg-slate-300 text-slate-500'
                    )}
                >
                    {status === 'completed' ? '✓' : number}
                </span>
                <h3 className="font-medium text-slate-900">{title}</h3>
            </div>
            <div className="p-4">{children}</div>
        </div>
    );
}

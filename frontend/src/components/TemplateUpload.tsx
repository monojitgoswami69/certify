/**
 * Template Upload Component
 * 
 * Drag-and-drop or click-to-browse file upload for certificate templates.
 * Supports common image formats (JPG, PNG, WebP).
 */

import { useCallback } from 'react';
import { Upload } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export function TemplateUpload() {
    const { setTemplate } = useAppStore();

    const handleFile = useCallback((file: File) => {
        if (!file || !file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const info = `${file.name} (${img.width}×${img.height})`;
                setTemplate(file, img, info);
            };
            img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    }, [setTemplate]);

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
            className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
        >
            <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleChange}
            />
            <Upload className="w-8 h-8 text-slate-400" />
            <div className="text-center">
                <p className="text-sm text-slate-600">
                    Drag & drop or <span className="text-primary-600 font-medium">browse</span>
                </p>
                <p className="text-xs text-slate-400 mt-1">Supports JPG, PNG, WebP</p>
            </div>
        </label>
    );
}

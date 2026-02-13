import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Papa from 'papaparse';

/**
 * Utility for merging Tailwind CSS classes safely
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
}

/**
 * Parse CSV text into headers and data rows
 * Uses PapaParse for robust, optimized parsing
 */
export function parseCsv(text: string): { headers: string[]; data: Record<string, string>[] } {
    const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (header) => header.trim(),
        transform: (value) => value.trim(),
    });

    if (result.errors.length > 0 && result.data.length === 0) {
        throw new Error(result.errors[0].message);
    }

    return {
        headers: result.meta.fields || [],
        data: result.data,
    };
}

/**
 * Create a safe filename from text
 * Handles OS-specific reserved characters and cleans whitespace
 */
export function sanitizeFilename(text: string): string {
    if (!text) return 'certificate';

    // Remove characters that are unsafe for filenames across OSs
    // eslint-disable-next-line no-control-regex
    const safe = text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '');

    return safe
        .trim()
        .replace(/\s+/g, '_')           // Replace spaces with underscores
        .replace(/_{2,}/g, '_')         // Remove duplicate underscores
        .substring(0, 100)              // Reasonable limit
        || 'certificate';
}

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

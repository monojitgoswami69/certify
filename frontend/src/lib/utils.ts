/**
 * Utility functions for certificate generation
 */

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
 */
export function parseCsv(text: string): { headers: string[]; data: Record<string, string>[] } {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
        });
        data.push(row);
    }

    return { headers, data };
}

/**
 * Create a safe filename from text
 */
export function sanitizeFilename(text: string): string {
    const safe = text.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    return safe.trim().replace(/\s+/g, '_').substring(0, 50) || 'certificate';
}

/**
 * Delay helper
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

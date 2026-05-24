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
 * Download a blob as a file (fallback path when FSA API is unavailable).
 */
export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 60000);
}

/**
 * Feature detection for File System Access API.
 * Chromium-based browsers ship this; Firefox/Safari don't.
 */
export function hasFileSystemAccess(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

/**
 * Open a save-picker and pipe a ReadableStream straight to disk.
 *
 * Eliminates the in-memory ZIP blob — bytes flush as client-zip produces them.
 * Returns true if the user confirmed the save, false if they cancelled.
 * Throws on any other error (caller can fall back to downloadBlob).
 */
export async function streamToFile(
    stream: ReadableStream<Uint8Array>,
    filename: string
): Promise<boolean> {
    type SaveFilePicker = (opts: {
        suggestedName: string;
        types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<{
        createWritable: () => Promise<WritableStream<Uint8Array> & { close: () => Promise<void> }>;
    }>;

    const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker;

    let handle;
    try {
        handle = await picker({
            suggestedName: filename,
            types: [{
                description: 'ZIP archive',
                accept: { 'application/zip': ['.zip'] },
            }],
        });
    } catch (err) {
        // AbortError = user cancelled. Not a real failure.
        if (err instanceof Error && err.name === 'AbortError') return false;
        throw err;
    }

    const writable = await handle.createWritable();
    await stream.pipeTo(writable);
    return true;
}

/**
 * Parse CSV text into headers and data rows.
 *
 * Runs in a Web Worker via PapaParse's built-in worker mode — keeps the main
 * thread free even on multi-megabyte CSVs.
 */
export function parseCsv(text: string): Promise<{ headers: string[]; data: Record<string, string>[] }> {
    // PapaParse in worker mode can't accept function options (structured clone
    // rejects functions). Trim headers/values on the main thread after parse —
    // the trim loop is O(n) and trivial compared to the parse itself.
    return new Promise((resolve, reject) => {
        Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: 'greedy',
            worker: true,
            complete: (result) => {
                if (result.errors.length > 0 && result.data.length === 0) {
                    reject(new Error(result.errors[0].message));
                    return;
                }

                const rawHeaders = result.meta.fields || [];
                const headers = rawHeaders.map(h => h.trim());

                // Remap each row to trimmed headers + trimmed values
                const data: Record<string, string>[] = new Array(result.data.length);
                for (let i = 0; i < result.data.length; i++) {
                    const row = result.data[i];
                    const out: Record<string, string> = {};
                    for (let j = 0; j < rawHeaders.length; j++) {
                        const raw = rawHeaders[j];
                        const v = row[raw];
                        out[headers[j]] = typeof v === 'string' ? v.trim() : '';
                    }
                    data[i] = out;
                }

                resolve({ headers, data });
            },
            error: (err: Error) => reject(err),
        });
    });
}

/**
 * Create a safe filename from text.
 */
export function sanitizeFilename(text: string): string {
    if (!text) return 'certificate';

    // eslint-disable-next-line no-control-regex
    const safe = text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '');

    return safe
        .trim()
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .substring(0, 100)
        || 'certificate';
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * rAF-coalesced setter — collapses many calls per frame into a single React update.
 *
 * Use for high-frequency progress updates from workers. Returns a function that
 * schedules `update` on the next animation frame; subsequent calls before the
 * frame fires replace the queued payload (latest wins).
 */
export function createRafScheduler<T>(update: (value: T) => void): {
    schedule: (value: T) => void;
    flush: () => void;
    cancel: () => void;
} {
    let queued: { value: T } | null = null;
    let handle: number | null = null;

    const fire = () => {
        handle = null;
        if (queued) {
            const v = queued.value;
            queued = null;
            update(v);
        }
    };

    return {
        schedule(value: T) {
            queued = { value };
            if (handle === null) {
                handle = requestAnimationFrame(fire);
            }
        },
        flush() {
            if (handle !== null) {
                cancelAnimationFrame(handle);
                handle = null;
            }
            if (queued) {
                const v = queued.value;
                queued = null;
                update(v);
            }
        },
        cancel() {
            if (handle !== null) {
                cancelAnimationFrame(handle);
                handle = null;
            }
            queued = null;
        },
    };
}

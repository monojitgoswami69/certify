/**
 * Web Worker for parallel certificate generation
 *
 * Each worker receives a BATCH of rows and processes them sequentially.
 * Workers emit ALL selected output formats from a single canvas draw.
 *
 * OPTIMIZATIONS:
 * - Template received as Blob → workers decode independently (zero per-worker ImageData copies)
 * - Template cached as ImageBitmap (GPU-accelerated drawing)
 * - Pre-computed font strings per box (zero allocation in hot loop)
 * - Binary search for font sizing (O(log n) vs O(n) measureText calls)
 * - Multi-format emit per draw: one canvas render → PNG + JPG + PDF blobs
 * - Pipelined encoding: encodes of cert N overlap with drawing of cert N+1
 * - PDF assembled inside the worker (parallelized) — no main-thread bottleneck
 * - OffscreenCanvas with desynchronized: true (no display sync overhead)
 * - Reusable canvas (no allocation per certificate)
 */

import { jsPDF } from 'jspdf';

// =============================================================================
// Types
// =============================================================================

type OutputFormat = 'png' | 'jpg' | 'pdf';

interface TextBox {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    field: string;
    fontSize: number;
    fontColor: string;
    fontFamily: string;
    hAlign: 'left' | 'center' | 'right';
    vAlign: 'top' | 'middle' | 'bottom';
}

interface CsvRow {
    [key: string]: string;
}

interface BatchItem {
    id: number;
    rowIndex: number;
    row: CsvRow;
    filename: string;
}

interface InitMessage {
    type: 'init';
    templateBlob: Blob;
    templateWidth: number;
    templateHeight: number;
    boxes: TextBox[];
    formats: OutputFormat[];
    jpegQuality: number;
}

interface GenerateBatchMessage {
    type: 'generateBatch';
    items: BatchItem[];
}

interface BatchResultItem {
    id: number;
    rowIndex: number;
    filename: string;
    blobs?: Partial<Record<OutputFormat, Blob>>;
    error?: string;
}

interface WorkerResponse {
    type: 'ready' | 'batchComplete' | 'itemComplete';
    result?: BatchResultItem;
}

interface BoxRenderInfo {
    box: TextBox;
    fontBase: string;
    textX: number;
    textAlign: CanvasTextAlign;
}

// =============================================================================
// Worker State
// =============================================================================

let cachedTemplateBitmap: ImageBitmap | null = null;
let cachedTemplateWidth = 0;
let cachedTemplateHeight = 0;
let cachedBoxRenderInfo: BoxRenderInfo[] = [];
let cachedFormats: OutputFormat[] = [];
let cachedJpegQuality = 0.92;
let cachedPdfOrientation: 'landscape' | 'portrait' = 'landscape';

let reusableCanvas: OffscreenCanvas | null = null;
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

// =============================================================================
// Text Rendering
// =============================================================================

const fontSizeCache = new Map<string, number>();

function findFittingFontSize(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    box: TextBox,
    fontBase: string
): number {
    const cacheKey = `${text.length}:${box.w}:${box.h}:${box.fontSize}:${box.fontFamily}`;
    const cached = fontSizeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const padding = 10;
    const maxW = box.w - padding;
    const maxH = box.h - padding;
    const minFontSize = 10;
    const maxFontSize = box.fontSize;

    ctx.font = `${maxFontSize}px ${fontBase}`;
    if (ctx.measureText(text).width <= maxW && maxFontSize * 1.2 <= maxH) {
        fontSizeCache.set(cacheKey, maxFontSize);
        return maxFontSize;
    }

    let low = minFontSize;
    let high = maxFontSize;
    let result = minFontSize;

    while (low <= high) {
        const mid = (low + high) >> 1;
        ctx.font = `${mid}px ${fontBase}`;

        if (ctx.measureText(text).width <= maxW && mid * 1.2 <= maxH) {
            result = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    fontSizeCache.set(cacheKey, result);
    return result;
}

function drawTextBox(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    info: BoxRenderInfo
): void {
    if (!text.trim()) return;

    const box = info.box;
    const fontSize = findFittingFontSize(ctx, text, box, info.fontBase);

    ctx.font = `${fontSize}px ${info.fontBase}`;
    ctx.fillStyle = box.fontColor;
    ctx.textAlign = info.textAlign;

    let textY: number;
    const vAlign = box.vAlign || 'bottom';
    if (vAlign === 'top') {
        textY = box.y + fontSize + 5;
    } else if (vAlign === 'middle') {
        textY = box.y + (box.h + fontSize) / 2;
    } else {
        textY = box.y + box.h - 8;
    }

    ctx.fillText(text, info.textX, textY);
}

// =============================================================================
// PDF Assembly (in-worker, parallelized)
// =============================================================================

async function buildPdfFromJpeg(jpegBlob: Blob): Promise<Blob> {
    const arrayBuffer = await jpegBlob.arrayBuffer();
    const pdf = new jsPDF({
        orientation: cachedPdfOrientation,
        unit: 'px',
        format: [cachedTemplateWidth, cachedTemplateHeight],
    });

    pdf.addImage(
        new Uint8Array(arrayBuffer),
        'JPEG',
        0, 0,
        cachedTemplateWidth,
        cachedTemplateHeight
    );

    return pdf.output('blob');
}

// =============================================================================
// Encode pipeline
// =============================================================================

interface PendingEncode {
    item: BatchItem;
    jpegPromise: Promise<Blob> | null;
    pngPromise: Promise<Blob> | null;
}

async function flushPending(pending: PendingEncode): Promise<void> {
    const { item, jpegPromise, pngPromise } = pending;
    try {
        const blobs: Partial<Record<OutputFormat, Blob>> = {};

        // Resolve PNG and JPEG in parallel
        const [pngBlob, jpegBlob] = await Promise.all([
            pngPromise,
            jpegPromise,
        ]);

        if (pngBlob && cachedFormats.includes('png')) {
            blobs.png = pngBlob;
        }
        if (jpegBlob && cachedFormats.includes('jpg')) {
            blobs.jpg = jpegBlob;
        }
        if (jpegBlob && cachedFormats.includes('pdf')) {
            blobs.pdf = await buildPdfFromJpeg(jpegBlob);
        }

        self.postMessage({
            type: 'itemComplete',
            result: {
                id: item.id,
                rowIndex: item.rowIndex,
                filename: item.filename,
                blobs,
            },
        } as WorkerResponse);
    } catch (error) {
        self.postMessage({
            type: 'itemComplete',
            result: {
                id: item.id,
                rowIndex: item.rowIndex,
                filename: item.filename,
                error: error instanceof Error ? error.message : 'Encoding failed',
            },
        } as WorkerResponse);
    }
}

// =============================================================================
// Batch Certificate Generation
// =============================================================================

async function generateBatch(items: BatchItem[]): Promise<void> {
    if (!cachedTemplateBitmap || !reusableCanvas || !reusableCtx) {
        for (const item of items) {
            self.postMessage({
                type: 'itemComplete',
                result: {
                    id: item.id,
                    rowIndex: item.rowIndex,
                    filename: item.filename,
                    error: 'Worker not initialized',
                },
            } as WorkerResponse);
        }
        return;
    }

    const ctx = reusableCtx;
    const canvas = reusableCanvas;

    if (fontSizeCache.size > 1000) {
        fontSizeCache.clear();
    }

    ctx.textBaseline = 'alphabetic';

    const needJpeg = cachedFormats.includes('jpg') || cachedFormats.includes('pdf');
    const needPng = cachedFormats.includes('png');

    let pending: PendingEncode | null = null;

    for (const item of items) {
        try {
            // DRAW
            ctx.drawImage(cachedTemplateBitmap, 0, 0);
            for (const info of cachedBoxRenderInfo) {
                const text = item.row[info.box.field] || '';
                drawTextBox(ctx, text, info);
            }

            // ENCODE (start all formats; they share the canvas snapshot taken synchronously)
            const jpegPromise = needJpeg
                ? canvas.convertToBlob({ type: 'image/jpeg', quality: cachedJpegQuality })
                : null;
            const pngPromise = needPng
                ? canvas.convertToBlob({ type: 'image/png' })
                : null;

            // FLUSH PREVIOUS while current encodes
            if (pending) {
                await flushPending(pending);
            }

            pending = { item, jpegPromise, pngPromise };
        } catch (error) {
            if (pending) {
                await flushPending(pending);
                pending = null;
            }

            self.postMessage({
                type: 'itemComplete',
                result: {
                    id: item.id,
                    rowIndex: item.rowIndex,
                    filename: item.filename,
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            } as WorkerResponse);
        }
    }

    if (pending) {
        await flushPending(pending);
    }
}

// =============================================================================
// Worker Message Handler
// =============================================================================

self.onmessage = async (event: MessageEvent<InitMessage | GenerateBatchMessage>) => {
    const message = event.data;

    if (message.type === 'init') {
        // Decode the shared template Blob into an ImageBitmap.
        // The Blob ref was sent by postMessage — zero-copy across workers.
        cachedTemplateBitmap = await createImageBitmap(message.templateBlob);
        cachedTemplateWidth = message.templateWidth;
        cachedTemplateHeight = message.templateHeight;
        cachedFormats = message.formats;
        cachedJpegQuality = message.jpegQuality;
        cachedPdfOrientation = message.templateWidth > message.templateHeight ? 'landscape' : 'portrait';

        cachedBoxRenderInfo = message.boxes
            .filter(box => box.field)
            .map(box => {
                const hAlign = box.hAlign || 'center';
                let textX: number;
                let textAlign: CanvasTextAlign;

                if (hAlign === 'left') {
                    textAlign = 'left';
                    textX = box.x + 5;
                } else if (hAlign === 'right') {
                    textAlign = 'right';
                    textX = box.x + box.w - 5;
                } else {
                    textAlign = 'center';
                    textX = box.x + box.w / 2;
                }

                return { box, fontBase: `"${box.fontFamily}"`, textX, textAlign };
            });

        reusableCanvas = new OffscreenCanvas(cachedTemplateWidth, cachedTemplateHeight);
        reusableCtx = reusableCanvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
        })!;

        self.postMessage({ type: 'ready' } as WorkerResponse);
    } else if (message.type === 'generateBatch') {
        await generateBatch(message.items);
        self.postMessage({ type: 'batchComplete' } as WorkerResponse);
    }
};

export { };

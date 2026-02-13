/**
 * Web Worker for parallel certificate generation
 * 
 * Each worker receives a BATCH of rows and processes them sequentially.
 * This minimizes postMessage overhead and maximizes cache locality.
 * 
 * OPTIMIZATIONS:
 * - Template cached as ImageBitmap (GPU-accelerated drawing)
 * - Pre-computed font strings per box (zero allocation in hot loop)
 * - Binary search for font sizing (O(log n) vs O(n) measureText calls)
 * - Pipelined encoding: convertToBlob snapshots bitmap immediately,
 *   so we draw cert N+1 while cert N encodes on a background thread
 * - OffscreenCanvas with desynchronized: true (no display sync overhead)
 * - Reusable canvas (no allocation per certificate)
 */

// =============================================================================
// Types (duplicated here since workers have separate context)
// =============================================================================

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
    templateImageData: ImageData;
    templateWidth: number;
    templateHeight: number;
    boxes: TextBox[];
    outputFormat: string;
    quality: number;
}

interface GenerateBatchMessage {
    type: 'generateBatch';
    items: BatchItem[];
}

interface BatchResultItem {
    id: number;
    rowIndex: number;
    filename: string;
    blob?: Blob;
    error?: string;
}

interface WorkerResponse {
    type: 'ready' | 'batchComplete' | 'itemComplete';
    result?: BatchResultItem;
}

// Pre-computed box rendering info (computed once at init, reused for every certificate)
interface BoxRenderInfo {
    box: TextBox;
    fontBase: string;   // Pre-built: '"Arial"' — avoids string allocation in hot loop
    textX: number;
    textAlign: CanvasTextAlign;
}

// =============================================================================
// Worker State (cached after initialization)
// =============================================================================

let cachedTemplateBitmap: ImageBitmap | null = null;
let cachedTemplateWidth = 0;
let cachedTemplateHeight = 0;
let cachedBoxRenderInfo: BoxRenderInfo[] = [];
let cachedOutputFormat: string = 'image/jpeg';
let cachedQuality = 1;

// Reusable canvas — allocated once, reused for every certificate
let reusableCanvas: OffscreenCanvas | null = null;
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

// =============================================================================
// Text Rendering (optimized for speed)
// =============================================================================

/**
 * Font size cache — avoids repeated measureText calls for same text/box combos.
 * 
 * Key: `textLength:boxW:boxH:maxFontSize:fontFamily`
 * Using text LENGTH (not full text) keeps cache small with high hit rate.
 * Same-length strings have similar widths in most fonts (accurate enough for certificates).
 */
const fontSizeCache = new Map<string, number>();

/**
 * Find the largest font size that fits text within a box.
 * 
 * Uses BINARY SEARCH: O(log n) measureText calls instead of O(n).
 * For a 72px → 10px range, this is ~6 iterations vs ~31 iterations.
 * Each measureText call costs ~0.1-0.2ms, so this saves ~5ms per text box worst case.
 */
function findFittingFontSize(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    box: TextBox,
    fontBase: string
): number {
    // Check cache first
    const cacheKey = `${text.length}:${box.w}:${box.h}:${box.fontSize}:${box.fontFamily}`;
    const cached = fontSizeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const padding = 10;
    const maxW = box.w - padding;
    const maxH = box.h - padding;
    const minFontSize = 10;
    const maxFontSize = box.fontSize;

    // Early exit: max font size already fits (common for short text)
    ctx.font = `${maxFontSize}px ${fontBase}`;
    if (ctx.measureText(text).width <= maxW && maxFontSize * 1.2 <= maxH) {
        fontSizeCache.set(cacheKey, maxFontSize);
        return maxFontSize;
    }

    // Binary search for the LARGEST font size that fits
    let low = minFontSize;
    let high = maxFontSize;
    let result = minFontSize;

    while (low <= high) {
        const mid = (low + high) >> 1; // integer division, no allocation
        ctx.font = `${mid}px ${fontBase}`;

        if (ctx.measureText(text).width <= maxW && mid * 1.2 <= maxH) {
            result = mid;
            low = mid + 1;  // text fits — try larger
        } else {
            high = mid - 1; // text overflows — try smaller
        }
    }

    fontSizeCache.set(cacheKey, result);
    return result;
}

/**
 * Draw text in a box with specified alignment.
 * Uses pre-computed BoxRenderInfo to avoid redundant calculations.
 */
function drawTextBox(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    info: BoxRenderInfo
): void {
    if (!text.trim()) return;

    const box = info.box;
    const fontSize = findFittingFontSize(ctx, text, box, info.fontBase);

    // Set font (findFittingFontSize may have left ctx.font at a different size)
    ctx.font = `${fontSize}px ${info.fontBase}`;
    ctx.fillStyle = box.fontColor;
    ctx.textAlign = info.textAlign;

    // Calculate Y position based on vertical alignment
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
// Batch Certificate Generation
// =============================================================================

/**
 * Helper to flush a pending encode result.
 * Awaits the blob promise and posts the result to the main thread.
 */
async function flushPendingResult(
    blobPromise: Promise<Blob>,
    item: BatchItem
): Promise<void> {
    try {
        const blob = await blobPromise;
        self.postMessage({
            type: 'itemComplete',
            result: {
                id: item.id,
                rowIndex: item.rowIndex,
                filename: item.filename,
                blob,
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

/**
 * Process an entire batch of certificates sequentially with PIPELINED ENCODING.
 * 
 * Pipeline strategy:
 *   convertToBlob() snapshots the canvas bitmap SYNCHRONOUSLY, then encodes
 *   JPEG asynchronously on a browser thread. By starting the encode for cert N
 *   and then immediately drawing cert N+1, we overlap the ~2-4ms drawing time
 *   with the ~15-40ms encoding time. This yields ~5-15% throughput improvement.
 * 
 *   Without pipeline:  [draw A][===encode A===][draw B][===encode B===]
 *   With pipeline:     [draw A][draw B + await A][draw C + await B]...
 *                               [===encode A===  ][===encode B===  ]
 *                               ↑ drawing overlaps with encoding
 */
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

    // Clear font cache periodically to prevent unbounded growth
    if (fontSizeCache.size > 1000) {
        fontSizeCache.clear();
    }

    // Set baseline once (doesn't change between certificates)
    ctx.textBaseline = 'alphabetic';

    // Pipeline state: holds the previous certificate's encode promise
    let pendingPromise: Promise<Blob> | null = null;
    let pendingItem: BatchItem | null = null;

    for (const item of items) {
        try {
            // ── DRAW: Render this certificate onto the reusable canvas ──
            ctx.drawImage(cachedTemplateBitmap, 0, 0);

            for (const info of cachedBoxRenderInfo) {
                const text = item.row[info.box.field] || '';
                drawTextBox(ctx, text, info);
            }

            // ── ENCODE: Snapshot bitmap + start async JPEG encoding ──
            // convertToBlob copies the bitmap synchronously, then encodes
            // on a browser thread. Safe to draw new content immediately after.
            const blobPromise = reusableCanvas.convertToBlob({
                type: cachedOutputFormat,
                quality: cachedQuality,
            });

            // ── FLUSH: While current cert encodes, post the PREVIOUS result ──
            // This overlaps the previous cert's encoding with current cert's drawing.
            if (pendingPromise && pendingItem) {
                await flushPendingResult(pendingPromise, pendingItem);
            }

            // Current becomes pending for next iteration
            pendingPromise = blobPromise;
            pendingItem = item;

        } catch (error) {
            // Flush any pending result before reporting this error
            if (pendingPromise && pendingItem) {
                await flushPendingResult(pendingPromise, pendingItem);
                pendingPromise = null;
                pendingItem = null;
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

    // ── FLUSH LAST: Post the final certificate's result ──
    if (pendingPromise && pendingItem) {
        await flushPendingResult(pendingPromise, pendingItem);
    }
}

// =============================================================================
// Worker Message Handler
// =============================================================================

self.onmessage = async (event: MessageEvent<InitMessage | GenerateBatchMessage>) => {
    const message = event.data;

    if (message.type === 'init') {
        // Cache template as ImageBitmap for GPU-accelerated drawing
        cachedTemplateBitmap = await createImageBitmap(message.templateImageData);
        cachedTemplateWidth = message.templateWidth;
        cachedTemplateHeight = message.templateHeight;
        cachedOutputFormat = message.outputFormat;
        cachedQuality = message.quality;

        // Pre-compute render info for each box (done ONCE, reused for every certificate)
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

                // Pre-build font string base to avoid allocation in hot loop
                return { box, fontBase: `"${box.fontFamily}"`, textX, textAlign };
            });

        // Create reusable canvas (allocated once, reused for every certificate)
        reusableCanvas = new OffscreenCanvas(cachedTemplateWidth, cachedTemplateHeight);
        reusableCtx = reusableCanvas.getContext('2d', {
            alpha: false,         // No transparency — faster compositing
            desynchronized: true, // Don't sync with display — purely encoding
        })!;

        self.postMessage({ type: 'ready' } as WorkerResponse);
    } else if (message.type === 'generateBatch') {
        await generateBatch(message.items);
        self.postMessage({ type: 'batchComplete' } as WorkerResponse);
    }
};

export { };

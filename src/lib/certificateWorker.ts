/**
 * Web Worker for parallel certificate generation
 * 
 * Each worker receives a BATCH of rows and processes them sequentially.
 * This minimizes postMessage overhead and maximizes cache locality.
 * 
 * OPTIMIZATIONS: 
 * - Template cached as ImageBitmap (GPU-accelerated drawing)
 * - Pre-computed font strings per box
 * - Lower quality for faster JPEG encoding
 * - Minimal canvas state changes
 * - No PDF generation
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

// Pre-computed box rendering info
interface BoxRenderInfo {
    box: TextBox;
    fontBase: string; // Pre-built font string base
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

// Reusable canvas
let reusableCanvas: OffscreenCanvas | null = null;
let reusableCtx: OffscreenCanvasRenderingContext2D | null = null;

// =============================================================================
// Text Rendering (optimized for speed)
// =============================================================================

// Font size cache to avoid repeated measurements for same text/box combos
const fontSizeCache = new Map<string, number>();

function findFittingFontSize(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    box: TextBox
): number {
    // Check cache first (text length + box dimensions as key)
    const cacheKey = `${text.length}:${box.w}:${box.h}:${box.fontSize}:${box.fontFamily}`;
    const cached = fontSizeCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let fontSize = box.fontSize;
    const minFontSize = 10;
    const padding = 10;
    const maxW = box.w - padding;
    const maxH = box.h - padding;

    while (fontSize >= minFontSize) {
        ctx.font = `${fontSize}px "${box.fontFamily}"`;
        const textWidth = ctx.measureText(text).width;

        if (textWidth <= maxW && fontSize * 1.2 <= maxH) {
            fontSizeCache.set(cacheKey, fontSize);
            return fontSize;
        }
        fontSize -= 2;
    }

    fontSizeCache.set(cacheKey, minFontSize);
    return minFontSize;
}

function drawTextBox(
    ctx: OffscreenCanvasRenderingContext2D,
    text: string,
    info: BoxRenderInfo
): void {
    if (!text.trim()) return;

    const box = info.box;
    const fontSize = findFittingFontSize(ctx, text, box);

    ctx.font = `${fontSize}px "${box.fontFamily}"`;

    ctx.fillStyle = box.fontColor;
    ctx.textAlign = info.textAlign;

    // Calculate Y position
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
// Batch Certificate Generation (processes entire batch sequentially)
// =============================================================================

async function generateBatch(items: BatchItem[]): Promise<void> {
    if (!cachedTemplateBitmap || !reusableCanvas || !reusableCtx) {
        const errors = items.map(item => ({
            id: item.id,
            rowIndex: item.rowIndex,
            filename: item.filename,
            error: 'Worker not initialized',
        }));
        for (const result of errors) {
            self.postMessage({ type: 'itemComplete', result } as WorkerResponse);
        }
        return;
    }

    const ctx = reusableCtx;

    // Clear font cache periodically to prevent unbounded growth
    if (fontSizeCache.size > 1000) {
        fontSizeCache.clear();
    }

    // Pre-set baseline once (doesn't change)
    ctx.textBaseline = 'alphabetic';

    for (const item of items) {
        try {
            // Draw template from cached ImageBitmap (GPU-accelerated)
            ctx.drawImage(cachedTemplateBitmap, 0, 0);

            // Draw each text box using pre-computed render info
            for (const info of cachedBoxRenderInfo) {
                const text = item.row[info.box.field] || '';
                drawTextBox(ctx, text, info);
            }

            // Generate blob (this is the slowest part - JPEG encoding)
            const blob = await reusableCanvas.convertToBlob({
                type: cachedOutputFormat,
                quality: cachedQuality,
            });

            const result: BatchResultItem = {
                id: item.id,
                rowIndex: item.rowIndex,
                filename: item.filename,
                blob,
            };

            // Notify main thread for smooth progress updates
            self.postMessage({ type: 'itemComplete', result } as WorkerResponse);

        } catch (error) {
            const errorResult: BatchResultItem = {
                id: item.id,
                rowIndex: item.rowIndex,
                filename: item.filename,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
            self.postMessage({ type: 'itemComplete', result: errorResult } as WorkerResponse);
        }
    }

    return;
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
        // Use provided quality (0.92 for JPEG = 3-5x faster encoding with minimal visual difference)
        cachedQuality = message.quality;

        // Pre-compute render info for each box
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

        // Create reusable canvas
        reusableCanvas = new OffscreenCanvas(cachedTemplateWidth, cachedTemplateHeight);
        reusableCtx = reusableCanvas.getContext('2d', {
            alpha: false,  // No transparency needed - faster
            desynchronized: true,  // Don't sync with display - we're just encoding
        })!;

        self.postMessage({ type: 'ready' } as WorkerResponse);
    } else if (message.type === 'generateBatch') {
        // Process entire batch sequentially (minimizes IPC overhead)
        await generateBatch(message.items);
        self.postMessage({ type: 'batchComplete' } as WorkerResponse);
    }
};

export { };

/**
 * Client-side certificate generation using HTML5 Canvas
 * Replaces backend PIL-based generation
 */

import { jsPDF } from 'jspdf';
import type { TextBox, CsvRow, HorizontalAlign, VerticalAlign } from '../types';

// Font cache to avoid reloading
const fontCache = new Map<string, FontFace>();

/**
 * Load a font from the backend fonts directory
 */
export async function loadFont(fontFilename: string): Promise<FontFace | null> {
    if (fontCache.has(fontFilename)) {
        return fontCache.get(fontFilename)!;
    }

    try {
        const fontUrl = `/api/fonts/${fontFilename}`;
        const fontFace = new FontFace(fontFilename, `url(${fontUrl})`);
        await fontFace.load();
        document.fonts.add(fontFace);
        fontCache.set(fontFilename, fontFace);
        return fontFace;
    } catch (error) {
        console.error(`Failed to load font ${fontFilename}:`, error);
        return null;
    }
}

/**
 * Find the largest font size that fits text within the box
 */
function findFittingFontSize(
    ctx: CanvasRenderingContext2D,
    text: string,
    boxW: number,
    boxH: number,
    maxFontSize: number,
    fontFamily: string
): number {
    let fontSize = maxFontSize;
    const minFontSize = 10;
    const padding = 10;

    while (fontSize >= minFontSize) {
        ctx.font = `${fontSize}px "${fontFamily}"`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = fontSize * 1.2;

        if (textWidth <= boxW - padding && textHeight <= boxH - padding) {
            return fontSize;
        }
        fontSize -= 2;
    }

    return minFontSize;
}

/**
 * Draw text in a box with alignment
 */
function drawTextBox(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number, y: number, w: number, h: number,
    maxFontSize: number,
    color: string,
    fontFamily: string,
    hAlign: HorizontalAlign,
    vAlign: VerticalAlign
): void {
    if (!text.trim()) return;

    // Find fitting font size
    const fontSize = findFittingFontSize(ctx, text, w, h, maxFontSize, fontFamily);
    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.fillStyle = color;
    const textHeight = fontSize;

    // Horizontal alignment
    let textX: number;
    if (hAlign === 'left') {
        ctx.textAlign = 'left';
        textX = x + 5;
    } else if (hAlign === 'right') {
        ctx.textAlign = 'right';
        textX = x + w - 5;
    } else {
        ctx.textAlign = 'center';
        textX = x + w / 2;
    }

    // Vertical alignment
    let textY: number;
    ctx.textBaseline = 'alphabetic';
    if (vAlign === 'top') {
        textY = y + textHeight + 5;
    } else if (vAlign === 'middle') {
        textY = y + (h + textHeight) / 2;
    } else {
        textY = y + h - 8;
    }

    ctx.fillText(text, textX, textY);
}

export interface GeneratedCertificate {
    filename: string;
    jpgBlob?: Blob;
    pdfBlob?: Blob;
    jpgBase64?: string;
    pdfBase64?: string;
}

export interface GenerateCertificateParams {
    templateImage: HTMLImageElement;
    boxes: TextBox[];
    row: CsvRow;
    filename: string;
    includeJpg: boolean;
    includePdf: boolean;
    includeBase64?: boolean; // For email
}

/**
 * Generate a single certificate
 */
export async function generateCertificate(
    params: GenerateCertificateParams
): Promise<GeneratedCertificate> {
    const { templateImage, boxes, row, filename, includeJpg, includePdf, includeBase64 } = params;

    // Create canvas at original image size
    const canvas = document.createElement('canvas');
    canvas.width = templateImage.naturalWidth;
    canvas.height = templateImage.naturalHeight;
    const ctx = canvas.getContext('2d')!;

    // Draw template
    ctx.drawImage(templateImage, 0, 0);

    // Load and draw each text box
    for (const box of boxes) {
        if (!box.field) continue;

        // Load font if needed
        await loadFont(box.fontFile);

        const text = row[box.field] || '';
        drawTextBox(
            ctx,
            text,
            box.x, box.y, box.w, box.h,
            box.fontSize,
            box.fontColor,
            box.fontFile,
            box.hAlign || 'center',
            box.vAlign || 'bottom'
        );
    }

    const result: GeneratedCertificate = { filename };

    // Generate JPG
    if (includeJpg) {
        const jpgBlob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.95);
        });
        result.jpgBlob = jpgBlob;

        if (includeBase64) {
            result.jpgBase64 = await blobToBase64(jpgBlob);
        }
    }

    // Generate PDF
    if (includePdf) {
        const imgData = canvas.toDataURL('image/jpeg', 0.95);

        // Determine PDF orientation based on image dimensions
        const isLandscape = canvas.width > canvas.height;
        const pdf = new jsPDF({
            orientation: isLandscape ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height],
        });

        pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
        const pdfBlob = pdf.output('blob');
        result.pdfBlob = pdfBlob;

        if (includeBase64) {
            result.pdfBase64 = await blobToBase64(pdfBlob);
        }
    }

    return result;
}

/**
 * Convert blob to base64 string
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Create a safe filename from text
 */
export function sanitizeFilename(text: string): string {
    const safe = text.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    return safe.trim().replace(/\s+/g, '_').substring(0, 50) || 'certificate';
}

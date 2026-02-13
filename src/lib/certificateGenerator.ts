/**
 * Client-side certificate generation using HTML5 Canvas
 * 
 * This module handles all certificate rendering in the browser.
 * Uses Google Fonts for unlimited font options.
 * 
 * MEMORY OPTIMIZATION: Canvas resources are explicitly cleaned up after use.
 * Blobs are created directly without intermediate base64 data URLs.
 */

import { jsPDF } from 'jspdf';
import type { TextBox, CsvRow, HorizontalAlign, VerticalAlign } from '../types';
import { loadGoogleFont, isFontLoaded, getGoogleFont, getFontFamilyCSS } from './googleFonts';

// =============================================================================
// Font Management
// =============================================================================

/**
 * Load a Google Font by family name
 */
export async function loadFont(fontFamily: string): Promise<boolean> {
    if (isFontLoaded(fontFamily)) {
        return true;
    }

    const result = loadGoogleFont(fontFamily);
    return result.success;
}

/**
 * Get CSS-safe font family string with appropriate fallbacks
 */
export function getFontFamily(family: string): string {
    const font = getGoogleFont(family);
    return getFontFamilyCSS(family, font?.category);
}

// =============================================================================
// Text Rendering
// =============================================================================

/**
 * Find the largest font size that fits text within the given box
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
 * Draw text in a box with specified alignment
 */
function drawTextBox(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
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

// =============================================================================
// Certificate Generation
// =============================================================================

/**
 * Result of certificate generation
 */
export interface GeneratedCertificate {
    filename: string;
    jpgBlob?: Blob;
    pdfBlob?: Blob;
}

/**
 * Parameters for generating a certificate
 */
export interface GenerateCertificateParams {
    templateImage: HTMLImageElement;
    boxes: TextBox[];
    row: CsvRow;
    filename: string;
    includeJpg: boolean;
    includePdf: boolean;
}

/**
 * MEMORY OPTIMIZATION: Clean up canvas to free GPU/memory resources
 */
function cleanupCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null): void {
    // Clear the canvas content
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Set dimensions to 0 to release memory (especially important for GPU memory)
    canvas.width = 0;
    canvas.height = 0;
    // Remove from DOM if attached (shouldn't be, but just in case)
    if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
    }
}

/**
 * Generate a single certificate
 * 
 * MEMORY OPTIMIZATION: Canvas is cleaned up after blob generation.
 * Uses toBlob instead of toDataURL for PDF to avoid large base64 strings.
 */
export async function generateCertificate(
    params: GenerateCertificateParams
): Promise<GeneratedCertificate> {
    const {
        templateImage,
        boxes,
        row,
        filename,
        includeJpg,
        includePdf,
    } = params;

    // Create canvas at original image size
    const canvas = document.createElement('canvas');
    canvas.width = templateImage.naturalWidth;
    canvas.height = templateImage.naturalHeight;
    const ctx = canvas.getContext('2d')!;

    try {
        // Draw template
        ctx.drawImage(templateImage, 0, 0);

        // Load and draw each text box
        for (const box of boxes) {
            if (!box.field) continue;

            // Load font if needed
            await loadFont(box.fontFamily);

            const text = row[box.field] || '';
            drawTextBox(
                ctx,
                text,
                box.x,
                box.y,
                box.w,
                box.h,
                box.fontSize,
                box.fontColor,
                box.fontFamily,
                box.hAlign || 'center',
                box.vAlign || 'bottom'
            );
        }

        const result: GeneratedCertificate = { filename };

        // Generate JPG - use toBlob which is more memory efficient than toDataURL
        if (includeJpg) {
            const jpgBlob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Failed to create JPG blob'));
                    },
                    'image/jpeg',
                    0.92 // Slightly lower quality for memory savings
                );
            });
            result.jpgBlob = jpgBlob;
        }

        // Generate PDF - MEMORY OPTIMIZATION: Use blob directly instead of base64 data URL
        if (includePdf) {
            // Get image as blob first (more memory efficient than base64)
            const pdfImageBlob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Failed to create PDF image blob'));
                    },
                    'image/jpeg',
                    0.92
                );
            });

            // Convert blob to array buffer for jsPDF (smaller than base64)
            const arrayBuffer = await pdfImageBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Determine PDF orientation based on image dimensions
            const isLandscape = canvas.width > canvas.height;
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            const pdf = new jsPDF({
                orientation: isLandscape ? 'landscape' : 'portrait',
                unit: 'px',
                format: [canvasWidth, canvasHeight],
            });

            // addImage can accept Uint8Array which is more memory efficient
            pdf.addImage(uint8Array, 'JPEG', 0, 0, canvasWidth, canvasHeight);
            const pdfBlob = pdf.output('blob');
            result.pdfBlob = pdfBlob;
        }

        return result;
    } finally {
        // MEMORY OPTIMIZATION: Always clean up canvas resources
        cleanupCanvas(canvas, ctx);
    }
}


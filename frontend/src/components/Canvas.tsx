/**
 * Canvas Component
 * 
 * Interactive canvas for template editing. Supports:
 * - Drawing new text boxes
 * - Moving existing boxes
 * - Resizing boxes via corner/edge handles
 * - Live text preview from CSV data
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { isFontLoaded, loadGoogleFont, getFontFamilyCSS, getGoogleFont } from '../lib/googleFonts';
import type { TextBox } from '../types';

// =============================================================================
// Constants
// =============================================================================

const HANDLE_SIZE = 8;
const LABEL_HEIGHT = 20;
const LABEL_PADDING = 6;

type DragMode = 'none' | 'draw' | 'move' | 'resize';
type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

// =============================================================================
// Component
// =============================================================================

export function Canvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const {
        templateImage,
        boxes,
        activeBoxId,
        displayScale,
        previewEnabled,
        csvData,
        fontPreview,
        addBox,
        updateBox,
        deleteBox,
        setActiveBox,
        setDisplayScale,
        reset,
    } = useAppStore();

    const [dragMode, setDragMode] = useState<DragMode>('none');
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [activeHandle, setActiveHandle] = useState<HandleKey | null>(null);
    const [originalBox, setOriginalBox] = useState<TextBox | null>(null);
    const [tempBox, setTempBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    // =========================================================================
    // Coordinate Conversion
    // =========================================================================

    const screenToImage = useCallback((screenX: number, screenY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        return {
            x: (screenX - rect.left) / displayScale,
            y: (screenY - rect.top) / displayScale,
        };
    }, [displayScale]);

    // =========================================================================
    // Canvas Sizing
    // =========================================================================

    const fitImageToCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !templateImage) return;

        const containerRect = container.getBoundingClientRect();
        const padding = 48;

        const availableWidth = containerRect.width - padding * 2;
        const availableHeight = containerRect.height - padding * 2;

        const scaleX = availableWidth / templateImage.width;
        const scaleY = availableHeight / templateImage.height;
        const scale = Math.min(scaleX, scaleY, 1);

        setDisplayScale(scale);
        canvas.width = Math.floor(templateImage.width * scale);
        canvas.height = Math.floor(templateImage.height * scale);
    }, [templateImage, setDisplayScale]);

    // =========================================================================
    // Handle Positions
    // =========================================================================

    const getHandlePositions = (sel: { x: number; y: number; w: number; h: number }) => {
        const mx = sel.x + sel.w / 2;
        const my = sel.y + sel.h / 2;
        return {
            nw: { x: sel.x, y: sel.y },
            n: { x: mx, y: sel.y },
            ne: { x: sel.x + sel.w, y: sel.y },
            e: { x: sel.x + sel.w, y: my },
            se: { x: sel.x + sel.w, y: sel.y + sel.h },
            s: { x: mx, y: sel.y + sel.h },
            sw: { x: sel.x, y: sel.y + sel.h },
            w: { x: sel.x, y: my },
        };
    };

    // =========================================================================
    // Drawing
    // =========================================================================

    const drawBox = useCallback((
        ctx: CanvasRenderingContext2D,
        box: TextBox | { x: number; y: number; w: number; h: number; field?: string },
        isActive: boolean,
        previewText?: string
    ) => {
        const displayBox = {
            x: box.x * displayScale,
            y: box.y * displayScale,
            w: box.w * displayScale,
            h: box.h * displayScale,
        };

        // Fill
        ctx.fillStyle = isActive ? 'rgba(79, 70, 229, 0.2)' : 'rgba(59, 130, 246, 0.12)';
        ctx.fillRect(displayBox.x, displayBox.y, displayBox.w, displayBox.h);

        // Border
        ctx.strokeStyle = isActive ? '#4f46e5' : '#3b82f6';
        ctx.lineWidth = isActive ? 2 : 1.5;
        ctx.setLineDash(isActive ? [] : [4, 2]);
        ctx.strokeRect(displayBox.x, displayBox.y, displayBox.w, displayBox.h);
        ctx.setLineDash([]);

        // Field label on top
        const field = 'field' in box ? box.field : undefined;
        if (field) {
            const labelText = field;
            ctx.font = 'bold 12px Inter, system-ui, sans-serif';
            const textMetrics = ctx.measureText(labelText);
            const labelWidth = textMetrics.width + LABEL_PADDING * 2 + 4;
            const labelHeight = LABEL_HEIGHT + 4;

            ctx.fillStyle = isActive ? '#0f172a' : '#1e293b';
            ctx.beginPath();
            ctx.roundRect(displayBox.x, displayBox.y - labelHeight - 2, labelWidth, labelHeight, 4);
            ctx.fill();
            
            ctx.strokeStyle = isActive ? '#fbbf24' : '#38bdf8';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = isActive ? '#fbbf24' : '#38bdf8';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(labelText, displayBox.x + LABEL_PADDING + 2, displayBox.y - labelHeight / 2 - 2);
        }

        // Preview text inside box
        if (previewEnabled && previewText && 'fontSize' in box) {
            let currentFontSize = box.fontSize;
            const minFontSize = 10;
            
            const previewFontFamily = fontPreview?.boxId === box.id ? fontPreview.fontFamily : null;
            const actualFontFamily = 'fontFamily' in box ? box.fontFamily : '';
            const useFontFamily = previewFontFamily || actualFontFamily;
            
            const fontFamily = useFontFamily 
                ? getFontFamilyCSS(useFontFamily, getGoogleFont(useFontFamily)?.category)
                : 'system-ui, sans-serif';
            
            if (useFontFamily && !isFontLoaded(useFontFamily)) {
                loadGoogleFont(useFontFamily);
            }

            // Auto-shrink font to fit
            while (currentFontSize >= minFontSize) {
                const displayFontSize = currentFontSize * displayScale;
                ctx.font = `${displayFontSize}px ${fontFamily}`;
                const metrics = ctx.measureText(previewText);
                const textHeight = displayFontSize * 1.2;

                if (metrics.width <= displayBox.w - 10 && textHeight <= displayBox.h - 10) {
                    break;
                }
                currentFontSize -= 2;
            }

            const displayFontSize = currentFontSize * displayScale;
            ctx.font = `${displayFontSize}px ${fontFamily}`;
            ctx.fillStyle = box.fontColor;
            const textHeight = displayFontSize;

            const hAlign = 'hAlign' in box ? box.hAlign : 'center';
            const vAlign = 'vAlign' in box ? box.vAlign : 'bottom';

            let textX: number;
            if (hAlign === 'left') {
                ctx.textAlign = 'left';
                textX = displayBox.x + 5;
            } else if (hAlign === 'right') {
                ctx.textAlign = 'right';
                textX = displayBox.x + displayBox.w - 5;
            } else {
                ctx.textAlign = 'center';
                textX = displayBox.x + displayBox.w / 2;
            }

            let textY: number;
            ctx.textBaseline = 'alphabetic';
            if (vAlign === 'top') {
                textY = displayBox.y + textHeight + 5;
            } else if (vAlign === 'middle') {
                textY = displayBox.y + (displayBox.h + textHeight) / 2;
            } else {
                textY = displayBox.y + displayBox.h - 8;
            }

            ctx.fillText(previewText, textX, textY);
        }

        // Resize handles for active box
        if (isActive && 'id' in box) {
            const handles = getHandlePositions(displayBox);
            ctx.fillStyle = '#4f46e5';

            Object.values(handles).forEach(({ x, y }) => {
                ctx.beginPath();
                ctx.arc(x, y, HANDLE_SIZE / 2, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    }, [displayScale, previewEnabled, fontPreview]);

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !templateImage) return;

        // Clear and draw template
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(templateImage, 0, 0, canvas.width, canvas.height);

        // Draw inactive boxes
        boxes.forEach((box) => {
            if (box.id !== activeBoxId) {
                const previewText = csvData.length > 0 && box.field 
                    ? csvData[0][box.field] || '' 
                    : '';
                drawBox(ctx, box, false, previewText);
            }
        });

        // Draw active box
        const activeBox = boxes.find(b => b.id === activeBoxId);
        if (activeBox) {
            const previewText = csvData.length > 0 && activeBox.field 
                ? csvData[0][activeBox.field] || '' 
                : '';
            drawBox(ctx, activeBox, true, previewText);
        }

        // Draw temp box while drawing
        if (tempBox) {
            drawBox(ctx, tempBox, true);
        }
    }, [templateImage, boxes, activeBoxId, csvData, tempBox, drawBox]);

    // =========================================================================
    // Effects
    // =========================================================================

    useEffect(() => {
        fitImageToCanvas();
        const handleResize = () => fitImageToCanvas();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [fitImageToCanvas]);

    useEffect(() => {
        redraw();
    }, [redraw]);

    // =========================================================================
    // Mouse Handlers
    // =========================================================================

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!templateImage) return;

        const { x, y } = screenToImage(e.clientX, e.clientY);

        // Check resize handles for active box
        const activeBox = boxes.find(b => b.id === activeBoxId);
        if (activeBox) {
            const handles = getHandlePositions(activeBox);
            for (const [key, pos] of Object.entries(handles)) {
                if (Math.abs(x - pos.x) < HANDLE_SIZE && Math.abs(y - pos.y) < HANDLE_SIZE) {
                    setDragMode('resize');
                    setActiveHandle(key as HandleKey);
                    setOriginalBox(activeBox);
                    setDragStart({ x, y });
                    return;
                }
            }

            // Check if clicking inside active box to move
            if (x >= activeBox.x && x <= activeBox.x + activeBox.w &&
                y >= activeBox.y && y <= activeBox.y + activeBox.h) {
                setDragMode('move');
                setOriginalBox(activeBox);
                setDragStart({ x, y });
                return;
            }
        }

        // Check if clicking any box
        for (const box of boxes) {
            if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                setActiveBox(box.id);
                setDragMode('move');
                setOriginalBox(box);
                setDragStart({ x, y });
                return;
            }
        }

        // Start drawing new box
        setActiveBox(null);
        setDragMode('draw');
        setDragStart({ x, y });
        setTempBox({ x, y, w: 0, h: 0 });
    }, [templateImage, boxes, activeBoxId, screenToImage, setActiveBox]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (dragMode === 'none') return;

        const { x, y } = screenToImage(e.clientX, e.clientY);

        if (dragMode === 'draw') {
            const newBox = {
                x: Math.min(dragStart.x, x),
                y: Math.min(dragStart.y, y),
                w: Math.abs(x - dragStart.x),
                h: Math.abs(y - dragStart.y),
            };
            setTempBox(newBox);
        } else if (dragMode === 'move' && originalBox) {
            const dx = x - dragStart.x;
            const dy = y - dragStart.y;
            updateBox(originalBox.id, {
                x: originalBox.x + dx,
                y: originalBox.y + dy,
            });
        } else if (dragMode === 'resize' && originalBox && activeHandle) {
            const dx = x - dragStart.x;
            const dy = y - dragStart.y;
            let newBox = { ...originalBox };

            switch (activeHandle) {
                case 'nw':
                    newBox = { ...newBox, x: originalBox.x + dx, y: originalBox.y + dy, w: originalBox.w - dx, h: originalBox.h - dy };
                    break;
                case 'n':
                    newBox = { ...newBox, y: originalBox.y + dy, h: originalBox.h - dy };
                    break;
                case 'ne':
                    newBox = { ...newBox, y: originalBox.y + dy, w: originalBox.w + dx, h: originalBox.h - dy };
                    break;
                case 'e':
                    newBox = { ...newBox, w: originalBox.w + dx };
                    break;
                case 'se':
                    newBox = { ...newBox, w: originalBox.w + dx, h: originalBox.h + dy };
                    break;
                case 's':
                    newBox = { ...newBox, h: originalBox.h + dy };
                    break;
                case 'sw':
                    newBox = { ...newBox, x: originalBox.x + dx, w: originalBox.w - dx, h: originalBox.h + dy };
                    break;
                case 'w':
                    newBox = { ...newBox, x: originalBox.x + dx, w: originalBox.w - dx };
                    break;
            }

            // Ensure minimum size
            if (newBox.w >= 20 && newBox.h >= 20) {
                updateBox(originalBox.id, { x: newBox.x, y: newBox.y, w: newBox.w, h: newBox.h });
            }
        }
    }, [dragMode, dragStart, originalBox, activeHandle, screenToImage, updateBox]);

    const handleMouseUp = useCallback(() => {
        if (dragMode === 'draw' && tempBox && tempBox.w > 20 && tempBox.h > 20) {
            addBox(tempBox);
        }

        setDragMode('none');
        setTempBox(null);
        setOriginalBox(null);
        setActiveHandle(null);
    }, [dragMode, tempBox, addBox]);

    // =========================================================================
    // Keyboard Handler
    // =========================================================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (activeBoxId && (e.key === 'Delete' || e.key === 'Backspace')) {
                if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                    deleteBox(activeBoxId);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeBoxId, deleteBox]);

    // =========================================================================
    // Render
    // =========================================================================

    if (!templateImage) {
        return (
            <main className="flex-1 flex items-center justify-center bg-slate-100">
                <div className="text-center">
                    <div className="w-16 h-16 bg-slate-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">📄</span>
                    </div>
                    <h2 className="text-lg font-semibold text-slate-700 mb-1">No Template Selected</h2>
                    <p className="text-sm text-slate-500">Upload a certificate template to get started</p>
                </div>
            </main>
        );
    }

    return (
        <main
            ref={containerRef}
            className="flex-1 flex items-center justify-center bg-slate-100 relative overflow-auto"
        >
            <canvas
                ref={canvasRef}
                className="shadow-2xl rounded-lg cursor-crosshair"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />

            {/* Reset Button */}
            <button
                onClick={reset}
                className="absolute bottom-4 right-4 flex items-center gap-2 px-3 py-2 bg-white text-slate-600 rounded-lg shadow-md hover:bg-slate-50 transition-colors text-sm"
            >
                <RotateCcw className="w-4 h-4" />
                Start Over
            </button>
        </main>
    );
}

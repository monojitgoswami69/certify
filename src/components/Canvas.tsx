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

        const padding = 0;

        const containerRect = container.getBoundingClientRect();
        const availableWidth = containerRect.width - padding * 2;
        const availableHeight = containerRect.height - padding * 2;

        const isMobile = window.innerWidth < 1024;

        let scale;
        if (isMobile) {
            // Mobile: Fit to width only, allow vertical scrolling
            scale = availableWidth / templateImage.width;
        } else {
            // Desktop: Fit fully within view (contain), preventing scroll unless necessary
            const scaleX = availableWidth / templateImage.width;
            const scaleY = availableHeight / templateImage.height;
            scale = Math.min(scaleX, scaleY);
        }

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

            // Build font string
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
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;

            const size = HANDLE_SIZE; // Rectangular handles
            Object.values(handles).forEach(({ x, y }) => {
                ctx.fillRect(x - size / 2, y - size / 2, size, size);
                ctx.strokeRect(x - size / 2, y - size / 2, size, size);
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

    // Reset cursor when leaving
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleMouseLeave = () => {
            canvas.style.cursor = 'default';
        };

        canvas.addEventListener('mouseleave', handleMouseLeave);
        return () => canvas.removeEventListener('mouseleave', handleMouseLeave);
    }, []);

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

        // Start drawing new box - ONLY if data is imported
        if (csvData.length > 0) {
            setActiveBox(null);
            setDragMode('draw');
            setDragStart({ x, y });
            setTempBox({ x, y, w: 0, h: 0 });
        }
    }, [templateImage, boxes, activeBoxId, screenToImage, setActiveBox, csvData.length]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const { x, y } = screenToImage(e.clientX, e.clientY);

        // 1. Logical Updates (Dragging)
        if (dragMode !== 'none') {
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
        }

        // 2. Cursor Updates
        if (canvasRef.current) {
            const canvas = canvasRef.current;

            // While dragging, fix the cursor to the mode
            if (dragMode === 'resize' && activeHandle) {
                const cursorMap: Record<string, string> = {
                    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
                    e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
                    sw: 'nesw-resize', w: 'ew-resize'
                };
                canvas.style.cursor = cursorMap[activeHandle];
                return;
            }
            if (dragMode === 'move') {
                canvas.style.cursor = 'move';
                return;
            }
            if (dragMode === 'draw') {
                canvas.style.cursor = 'crosshair';
                return;
            }

            // Idle Hover Logic
            const activeBox = boxes.find(b => b.id === activeBoxId);
            if (activeBox) {
                const handles = getHandlePositions(activeBox);
                const hitBuffer = HANDLE_SIZE + 4; // Add a small buffer for easier hitting

                for (const [key, pos] of Object.entries(handles)) {
                    // Calculate distance in screen pixels
                    const dx = Math.abs(x - pos.x) * displayScale;
                    const dy = Math.abs(y - pos.y) * displayScale;

                    if (dx < hitBuffer && dy < hitBuffer) {
                        const cursorMap: Record<string, string> = {
                            nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
                            e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
                            sw: 'nesw-resize', w: 'ew-resize'
                        };
                        canvas.style.cursor = cursorMap[key];
                        return;
                    }
                }

                if (x >= activeBox.x && x <= activeBox.x + activeBox.w &&
                    y >= activeBox.y && y <= activeBox.y + activeBox.h) {
                    canvas.style.cursor = 'move';
                    return;
                }
            }

            // Check if hovering over any other box
            for (const box of boxes) {
                if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                    canvas.style.cursor = 'pointer';
                    return;
                }
            }

            // Default
            canvas.style.cursor = csvData.length > 0 ? 'crosshair' : 'not-allowed';
        }
    }, [dragMode, dragStart, originalBox, activeHandle, screenToImage, updateBox, boxes, activeBoxId, csvData.length, displayScale]);

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
            <main className="flex-1 bg-transparent p-4 lg:p-8 overflow-hidden min-h-[200px] flex flex-col">
                <div className="w-full flex-1 flex items-center justify-center bg-transparent relative group min-h-[160px]">


                    <div className="text-center animate-fade-in">
                        <h2 className="text-2xl font-bold text-slate-600 mb-3 font-serif tracking-tight">Workspace Ready</h2>
                        <p className="text-slate-500 max-w-sm mx-auto leading-relaxed text-sm font-bold">
                            Select a certificate template from the sidebar. <br />
                            Your design workspace will initialize within this area.
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main
            ref={containerRef}
            className="flex-1 flex items-center justify-center bg-transparent relative overflow-auto"
        >
            <canvas
                ref={canvasRef}
                className="rounded-lg cursor-crosshair border border-slate-200"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
        </main>
    );
}

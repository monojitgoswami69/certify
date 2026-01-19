import { useRef, useEffect, useCallback, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import type { TextBox } from '../types';

const HANDLE_SIZE = 8;
const LABEL_HEIGHT = 20;
const LABEL_PADDING = 6;

type DragMode = 'none' | 'draw' | 'move' | 'resize';
type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

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

    // Convert screen coordinates to image coordinates
    const screenToImage = useCallback((screenX: number, screenY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        return {
            x: (screenX - rect.left) / displayScale,
            y: (screenY - rect.top) / displayScale,
        };
    }, [displayScale]);

    // Fit image to canvas
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

    // Draw a single box with optional preview and label
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
            ctx.font = '11px Inter, system-ui, sans-serif';
            const textMetrics = ctx.measureText(labelText);
            const labelWidth = textMetrics.width + LABEL_PADDING * 2;

            // Label background
            ctx.fillStyle = isActive ? '#4f46e5' : '#3b82f6';
            ctx.beginPath();
            ctx.roundRect(displayBox.x, displayBox.y - LABEL_HEIGHT - 2, labelWidth, LABEL_HEIGHT, 4);
            ctx.fill();

            // Label text
            ctx.fillStyle = '#ffffff';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(labelText, displayBox.x + LABEL_PADDING, displayBox.y - LABEL_HEIGHT / 2 - 2);
        }

        // Preview text inside box
        if (previewEnabled && previewText && 'fontSize' in box) {
            let currentFontSize = box.fontSize;
            const minFontSize = 10;

            // Auto-shrink font to fit
            while (currentFontSize >= minFontSize) {
                const displayFontSize = currentFontSize * displayScale;
                ctx.font = `${displayFontSize}px "JetBrains Mono", monospace`;
                const metrics = ctx.measureText(previewText);
                const textHeight = displayFontSize * 1.2;

                if (metrics.width <= displayBox.w - 10 && textHeight <= displayBox.h - 10) {
                    break;
                }
                currentFontSize -= 2;
            }

            const displayFontSize = currentFontSize * displayScale;
            ctx.font = `${displayFontSize}px "JetBrains Mono", monospace`;
            ctx.fillStyle = box.fontColor;
            const textHeight = displayFontSize;

            // Get alignment from box (with defaults)
            const hAlign = 'hAlign' in box ? box.hAlign : 'center';
            const vAlign = 'vAlign' in box ? box.vAlign : 'bottom';

            // Calculate X position based on horizontal alignment
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

            // Calculate Y position based on vertical alignment
            let textY: number;
            ctx.textBaseline = 'alphabetic';
            if (vAlign === 'top') {
                textY = displayBox.y + textHeight + 5;
            } else if (vAlign === 'middle') {
                textY = displayBox.y + (displayBox.h + textHeight) / 2 - 2;
            } else {
                textY = displayBox.y + displayBox.h - 8;
            }

            ctx.fillText(previewText, textX, textY);
        }

        // Handles for active box
        if (isActive) {
            const handles = getHandlePositions(displayBox);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 2;

            Object.values(handles).forEach((h) => {
                ctx.beginPath();
                ctx.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
                ctx.fill();
                ctx.stroke();
            });
        }
    }, [displayScale, previewEnabled]);

    // Render canvas
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !templateImage) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(templateImage, 0, 0, canvas.width, canvas.height);

        // Draw all non-active boxes first
        boxes.forEach(box => {
            if (box.id !== activeBoxId) {
                const previewText = csvData.length > 0 && box.field ? csvData[0][box.field] : undefined;
                drawBox(ctx, box, false, previewText);
            }
        });

        // Draw active box on top
        const activeBox = boxes.find(b => b.id === activeBoxId);
        if (activeBox) {
            const previewText = csvData.length > 0 && activeBox.field ? csvData[0][activeBox.field] : undefined;
            drawBox(ctx, activeBox, true, previewText);
        }

        // Draw temporary box while drawing
        if (tempBox && dragMode === 'draw') {
            drawBox(ctx, tempBox, true);
        }
    }, [templateImage, boxes, activeBoxId, csvData, drawBox, tempBox, dragMode]);

    // Handle positions
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

    // Check if point is near a handle of the active box
    const getHandleAtPoint = useCallback((imgX: number, imgY: number): HandleKey | null => {
        const activeBox = boxes.find(b => b.id === activeBoxId);
        if (!activeBox) return null;

        const handles = getHandlePositions(activeBox);
        const threshold = HANDLE_SIZE / displayScale;

        for (const [key, pos] of Object.entries(handles)) {
            if (Math.abs(imgX - pos.x) < threshold && Math.abs(imgY - pos.y) < threshold) {
                return key as HandleKey;
            }
        }
        return null;
    }, [boxes, activeBoxId, displayScale]);

    // Find box at point
    const getBoxAtPoint = useCallback((imgX: number, imgY: number): TextBox | null => {
        // Check in reverse order (top-most first)
        for (let i = boxes.length - 1; i >= 0; i--) {
            const box = boxes[i];
            if (
                imgX >= box.x &&
                imgX <= box.x + box.w &&
                imgY >= box.y &&
                imgY <= box.y + box.h
            ) {
                return box;
            }
        }
        return null;
    }, [boxes]);

    // Mouse handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!templateImage) return;

        const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

        // Check for handle resize on active box
        const handle = getHandleAtPoint(imgX, imgY);
        if (handle) {
            const activeBox = boxes.find(b => b.id === activeBoxId);
            if (activeBox) {
                setDragMode('resize');
                setActiveHandle(handle);
                setOriginalBox({ ...activeBox });
                setDragStart({ x: imgX, y: imgY });
                return;
            }
        }

        // Check if clicking on a box
        const clickedBox = getBoxAtPoint(imgX, imgY);
        if (clickedBox) {
            // If clicking on already active box, prepare to move
            if (clickedBox.id === activeBoxId) {
                setDragMode('move');
                setDragStart({ x: imgX, y: imgY });
                setOriginalBox({ ...clickedBox });
            } else {
                // Select this box
                setActiveBox(clickedBox.id);
            }
            return;
        }

        // Start new box
        setActiveBox(null);
        setDragMode('draw');
        setDragStart({ x: imgX, y: imgY });
        setTempBox({ x: imgX, y: imgY, w: 0, h: 0 });
    }, [templateImage, screenToImage, getHandleAtPoint, getBoxAtPoint, boxes, activeBoxId, setActiveBox]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (dragMode === 'none' || !templateImage) return;

        const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);
        const clampedX = Math.max(0, Math.min(imgX, templateImage.width));
        const clampedY = Math.max(0, Math.min(imgY, templateImage.height));

        if (dragMode === 'draw') {
            const x = Math.min(dragStart.x, clampedX);
            const y = Math.min(dragStart.y, clampedY);
            const w = Math.abs(clampedX - dragStart.x);
            const h = Math.abs(clampedY - dragStart.y);
            setTempBox({ x, y, w, h });
        } else if (dragMode === 'move' && originalBox) {
            const dx = clampedX - dragStart.x;
            const dy = clampedY - dragStart.y;
            let newX = originalBox.x + dx;
            let newY = originalBox.y + dy;
            newX = Math.max(0, Math.min(newX, templateImage.width - originalBox.w));
            newY = Math.max(0, Math.min(newY, templateImage.height - originalBox.h));
            updateBox(originalBox.id, { x: newX, y: newY });
        } else if (dragMode === 'resize' && activeHandle && originalBox) {
            const dx = clampedX - dragStart.x;
            const dy = clampedY - dragStart.y;
            const newBox = { ...originalBox };

            if (activeHandle.includes('w')) {
                newBox.x = originalBox.x + dx;
                newBox.w = originalBox.w - dx;
            }
            if (activeHandle.includes('e')) {
                newBox.w = originalBox.w + dx;
            }
            if (activeHandle.includes('n')) {
                newBox.y = originalBox.y + dy;
                newBox.h = originalBox.h - dy;
            }
            if (activeHandle.includes('s')) {
                newBox.h = originalBox.h + dy;
            }

            // Enforce minimum size
            if (newBox.w < 20) {
                if (activeHandle.includes('w')) {
                    newBox.x = originalBox.x + originalBox.w - 20;
                }
                newBox.w = 20;
            }
            if (newBox.h < 20) {
                if (activeHandle.includes('n')) {
                    newBox.y = originalBox.y + originalBox.h - 20;
                }
                newBox.h = 20;
            }

            updateBox(originalBox.id, { x: newBox.x, y: newBox.y, w: newBox.w, h: newBox.h });
        }
    }, [dragMode, dragStart, originalBox, activeHandle, screenToImage, updateBox, templateImage]);

    const handleMouseUp = useCallback(() => {
        // If we were drawing a new box and it has some size, add it
        if (dragMode === 'draw' && tempBox && tempBox.w > 20 && tempBox.h > 20) {
            addBox(tempBox);
        }

        setDragMode('none');
        setActiveHandle(null);
        setOriginalBox(null);
        setTempBox(null);
    }, [dragMode, tempBox, addBox]);

    // Keyboard handler for delete
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && activeBoxId) {
                // Don't delete if we're in an input field
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                    return;
                }
                e.preventDefault();
                deleteBox(activeBoxId);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeBoxId, deleteBox]);

    // Effects
    useEffect(() => {
        fitImageToCanvas();
        window.addEventListener('resize', fitImageToCanvas);
        return () => window.removeEventListener('resize', fitImageToCanvas);
    }, [fitImageToCanvas]);

    useEffect(() => {
        render();
    }, [render]);

    if (!templateImage) {
        return (
            <div ref={containerRef} className="flex-1 flex items-center justify-center bg-slate-100">
                <div className="text-center p-12 bg-white rounded-2xl border-2 border-dashed border-slate-300">
                    <div className="w-16 h-16 mx-auto mb-4 text-slate-300">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                            <rect width="18" height="18" x="3" y="3" rx="2" />
                            <circle cx="9" cy="9" r="2" />
                            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                        </svg>
                    </div>
                    <p className="text-slate-500">Upload a certificate template to get started</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="flex-1 flex flex-col items-center justify-center bg-slate-100 p-6 overflow-hidden"
        >
            <canvas
                ref={canvasRef}
                className="bg-white shadow-xl rounded-lg cursor-crosshair"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                tabIndex={0}
            />

            {/* Reset button - below canvas */}
            <button
                onClick={reset}
                className="mt-4 flex items-center gap-2 px-3 py-1.5 text-slate-500 hover:text-slate-700 transition-colors"
            >
                <RotateCcw className="w-4 h-4" />
                <span className="text-sm">Reset All</span>
            </button>
        </div>
    );
}

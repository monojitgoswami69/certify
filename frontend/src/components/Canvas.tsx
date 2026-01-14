import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../store/appStore';
import type { Selection } from '../types';

const HANDLE_SIZE = 8;

type DragMode = 'none' | 'draw' | 'move' | 'resize';
type HandleKey = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function Canvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const {
        templateImage,
        selection,
        displayScale,
        previewEnabled,
        previewText,
        fontSize,
        fontColor,
        setSelection,
        setDisplayScale,
    } = useAppStore();

    const [dragMode, setDragMode] = useState<DragMode>('none');
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [activeHandle, setActiveHandle] = useState<HandleKey | null>(null);
    const [originalSelection, setOriginalSelection] = useState<Selection | null>(null);

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

    // Render canvas
    const render = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !templateImage) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(templateImage, 0, 0, canvas.width, canvas.height);

        if (selection && selection.w > 0 && selection.h > 0) {
            const displaySel = {
                x: selection.x * displayScale,
                y: selection.y * displayScale,
                w: selection.w * displayScale,
                h: selection.h * displayScale,
            };

            // Fill
            ctx.fillStyle = 'rgba(79, 70, 229, 0.15)';
            ctx.fillRect(displaySel.x, displaySel.y, displaySel.w, displaySel.h);

            // Border
            ctx.strokeStyle = '#4f46e5';
            ctx.lineWidth = 2;
            ctx.strokeRect(displaySel.x, displaySel.y, displaySel.w, displaySel.h);

            // Preview text
            if (previewEnabled && previewText) {
                let currentFontSize = fontSize;
                const minFontSize = 10;

                // Auto-shrink font to fit
                while (currentFontSize >= minFontSize) {
                    const displayFontSize = currentFontSize * displayScale;
                    ctx.font = `${displayFontSize}px "JetBrains Mono", monospace`;
                    const metrics = ctx.measureText(previewText);
                    const textHeight = displayFontSize * 1.2;

                    if (metrics.width <= displaySel.w - 10 && textHeight <= displaySel.h - 10) {
                        break;
                    }
                    currentFontSize -= 2;
                }

                const displayFontSize = currentFontSize * displayScale;
                ctx.font = `${displayFontSize}px "JetBrains Mono", monospace`;
                ctx.fillStyle = fontColor;
                ctx.textBaseline = 'alphabetic';
                ctx.textAlign = 'center';

                const centerX = displaySel.x + displaySel.w / 2;
                const bottomY = displaySel.y + displaySel.h - 8;
                ctx.fillText(previewText, centerX, bottomY);
            }

            // Handles
            const handles = getHandlePositions(displaySel);
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
    }, [templateImage, selection, displayScale, previewEnabled, previewText, fontSize, fontColor]);

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

    // Check if point is near a handle
    const getHandleAtPoint = useCallback((imgX: number, imgY: number): HandleKey | null => {
        if (!selection) return null;
        const handles = getHandlePositions(selection);
        const threshold = HANDLE_SIZE / displayScale;

        for (const [key, pos] of Object.entries(handles)) {
            if (Math.abs(imgX - pos.x) < threshold && Math.abs(imgY - pos.y) < threshold) {
                return key as HandleKey;
            }
        }
        return null;
    }, [selection, displayScale]);

    // Check if point is inside selection
    const isInsideSelection = useCallback((imgX: number, imgY: number): boolean => {
        if (!selection) return false;
        return (
            imgX >= selection.x &&
            imgX <= selection.x + selection.w &&
            imgY >= selection.y &&
            imgY <= selection.y + selection.h
        );
    }, [selection]);

    // Mouse handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!templateImage) return;

        const { x: imgX, y: imgY } = screenToImage(e.clientX, e.clientY);

        const handle = getHandleAtPoint(imgX, imgY);
        if (handle) {
            setDragMode('resize');
            setActiveHandle(handle);
            setOriginalSelection(selection ? { ...selection } : null);
            setDragStart({ x: imgX, y: imgY });
            return;
        }

        if (isInsideSelection(imgX, imgY)) {
            setDragMode('move');
            setDragStart({ x: imgX, y: imgY });
            setOriginalSelection(selection ? { ...selection } : null);
            return;
        }

        // Start new selection
        setDragMode('draw');
        setDragStart({ x: imgX, y: imgY });
        setSelection({ x: imgX, y: imgY, w: 0, h: 0 });
    }, [templateImage, screenToImage, getHandleAtPoint, isInsideSelection, selection, setSelection]);

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
            setSelection({ x, y, w, h });
        } else if (dragMode === 'move' && originalSelection) {
            const dx = clampedX - dragStart.x;
            const dy = clampedY - dragStart.y;
            let newX = originalSelection.x + dx;
            let newY = originalSelection.y + dy;
            newX = Math.max(0, Math.min(newX, templateImage.width - originalSelection.w));
            newY = Math.max(0, Math.min(newY, templateImage.height - originalSelection.h));
            setSelection({ ...originalSelection, x: newX, y: newY });
        } else if (dragMode === 'resize' && activeHandle && originalSelection) {
            const dx = clampedX - dragStart.x;
            const dy = clampedY - dragStart.y;
            const newSel = { ...originalSelection };

            if (activeHandle.includes('w')) {
                newSel.x = originalSelection.x + dx;
                newSel.w = originalSelection.w - dx;
            }
            if (activeHandle.includes('e')) {
                newSel.w = originalSelection.w + dx;
            }
            if (activeHandle.includes('n')) {
                newSel.y = originalSelection.y + dy;
                newSel.h = originalSelection.h - dy;
            }
            if (activeHandle.includes('s')) {
                newSel.h = originalSelection.h + dy;
            }

            // Enforce minimum size
            if (newSel.w < 20) {
                if (activeHandle.includes('w')) {
                    newSel.x = originalSelection.x + originalSelection.w - 20;
                }
                newSel.w = 20;
            }
            if (newSel.h < 20) {
                if (activeHandle.includes('n')) {
                    newSel.y = originalSelection.y + originalSelection.h - 20;
                }
                newSel.h = 20;
            }

            setSelection(newSel);
        }
    }, [dragMode, dragStart, originalSelection, activeHandle, screenToImage, setSelection, templateImage]);

    const handleMouseUp = useCallback(() => {
        setDragMode('none');
        setActiveHandle(null);
        setOriginalSelection(null);
    }, []);

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
            className="flex-1 flex items-center justify-center bg-slate-100 p-6 overflow-hidden"
        >
            <canvas
                ref={canvasRef}
                className="bg-white shadow-xl rounded-lg cursor-crosshair"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            />
        </div>
    );
}

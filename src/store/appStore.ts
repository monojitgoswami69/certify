/**
 * Zustand store for application state
 * Simplified version for download-only certificate generation
 */

import { create } from 'zustand';
import type { Font, CsvRow, TextBox } from '../types';

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a unique ID for text boxes
 */
const generateBoxId = (): string =>
    `box_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

// =============================================================================
// Store Interface
// =============================================================================

interface AppStore {
    // Template State
    templateFile: File | null;
    templateImage: HTMLImageElement | null;
    templateInfo: string;
    setTemplate: (file: File, image: HTMLImageElement, info: string) => void;
    clearTemplate: () => void;

    // Text Boxes State
    boxes: TextBox[];
    activeBoxId: string | null;
    displayScale: number;
    addBox: (box: Omit<TextBox, 'id' | 'field' | 'fontSize' | 'fontColor' | 'fontFamily' | 'hAlign' | 'vAlign'>) => void;
    updateBox: (id: string, updates: Partial<TextBox>) => void;
    deleteBox: (id: string) => void;
    setActiveBox: (id: string | null) => void;
    setDisplayScale: (scale: number) => void;

    // CSV Data State
    csvFile: File | null;
    csvHeaders: string[];
    csvData: CsvRow[];
    setCsvData: (file: File, headers: string[], data: CsvRow[]) => void;
    clearCsvData: () => void;

    // Default Font Settings (for new boxes)
    defaultFont: string;
    defaultFontSize: number;
    defaultFontColor: string;
    setDefaultFont: (font: string) => void;
    setDefaultFontSize: (size: number) => void;
    setDefaultFontColor: (color: string) => void;

    // Preview State
    previewEnabled: boolean;
    setPreviewEnabled: (enabled: boolean) => void;

    // Worker count for parallel generation (1 = single, 2+ = parallel)
    workerCount: number;
    setWorkerCount: (count: number) => void;

    // Generation status for UI coordination
    generationStatus: 'idle' | 'running' | 'completed';
    setGenerationStatus: (status: 'idle' | 'running' | 'completed') => void;

    // Font preview for hover effect (doesn't change actual box value)
    fontPreview: { boxId: string; fontFamily: string } | null;
    setFontPreview: (preview: { boxId: string; fontFamily: string } | null) => void;

    // UI State
    error: string | null;
    setError: (error: string | null) => void;

    // Fonts
    fonts: Font[];
    setFonts: (fonts: Font[]) => void;

    // Output Formats
    outputFormats: ('png' | 'jpg' | 'pdf')[];
    setOutputFormats: (formats: ('png' | 'jpg' | 'pdf')[]) => void;

    // Reset Actions
    reset: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialState = {
    templateFile: null,
    templateImage: null,
    templateInfo: '',
    boxes: [] as TextBox[],
    activeBoxId: null,
    displayScale: 1,
    csvFile: null,
    csvHeaders: [] as string[],
    csvData: [] as CsvRow[],
    defaultFont: 'Inter',
    defaultFontSize: 60,
    defaultFontColor: '#000000',
    previewEnabled: true,
    workerCount: 1,
    generationStatus: 'idle' as 'idle' | 'running' | 'completed',
    fontPreview: null as { boxId: string; fontFamily: string } | null,
    error: null,
    fonts: [] as Font[],
    outputFormats: ['jpg'] as ('png' | 'jpg' | 'pdf')[],
};

// =============================================================================
// Store Implementation
// =============================================================================

export const useAppStore = create<AppStore>((set, get) => ({
    ...initialState,

    // Template Actions
    setTemplate: (file, image, info) => set({
        templateFile: file,
        templateImage: image,
        templateInfo: info,
        boxes: [],
        activeBoxId: null,
    }),

    clearTemplate: () => set({
        templateFile: null,
        templateImage: null,
        templateInfo: '',
        boxes: [],
        activeBoxId: null,
    }),

    // Text Box Actions
    addBox: (boxData) => {
        const { defaultFont, defaultFontSize, defaultFontColor, csvHeaders } = get();
        const newBox: TextBox = {
            id: generateBoxId(),
            ...boxData,
            field: csvHeaders[0] || '',
            fontSize: defaultFontSize,
            fontColor: defaultFontColor,
            fontFamily: defaultFont,
            hAlign: 'center',
            vAlign: 'bottom',
        };
        set((state) => ({
            boxes: [...state.boxes, newBox],
            activeBoxId: newBox.id,
        }));
    },

    updateBox: (id, updates) => set((state) => ({
        boxes: state.boxes.map(box =>
            box.id === id ? { ...box, ...updates } : box
        ),
    })),

    deleteBox: (id) => set((state) => ({
        boxes: state.boxes.filter(box => box.id !== id),
        activeBoxId: state.activeBoxId === id ? null : state.activeBoxId,
    })),

    setActiveBox: (activeBoxId) => set({ activeBoxId }),

    setDisplayScale: (displayScale) => set({ displayScale }),

    // CSV Data Actions
    setCsvData: (file, headers, data) => set({
        csvFile: file,
        csvHeaders: headers,
        csvData: data
    }),

    clearCsvData: () => set({
        csvFile: null,
        csvHeaders: [],
        csvData: [],
    }),

    // Default Font Settings
    setDefaultFont: (defaultFont) => set({ defaultFont }),
    setDefaultFontSize: (defaultFontSize) => set({ defaultFontSize }),
    setDefaultFontColor: (defaultFontColor) => set({ defaultFontColor }),

    // Preview State
    setPreviewEnabled: (previewEnabled) => set({ previewEnabled }),
    setWorkerCount: (workerCount) => set({ workerCount }),
    setGenerationStatus: (generationStatus) => set({ generationStatus }),
    setFontPreview: (fontPreview) => set({ fontPreview }),

    // Output Formats Actions
    setOutputFormats: (outputFormats) => set({ outputFormats }),

    // UI State
    setError: (error) => set({ error }),

    // Fonts
    setFonts: (fonts) => {
        const defaultFont = fonts.length > 0 ? fonts[0].family : 'Inter';
        set((state) => ({
            fonts,
            defaultFont,
            // Update any boxes that have empty fontFamily
            boxes: state.boxes.map(box =>
                !box.fontFamily && defaultFont ? { ...box, fontFamily: defaultFont } : box
            ),
        }));
    },

    // Reset
    reset: () => set(initialState),
}));

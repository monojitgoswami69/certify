import { create } from 'zustand';
import type { Selection, Font, CsvRow } from '../types';

interface AppStore {
    // Template
    templateFile: File | null;
    templateImage: HTMLImageElement | null;
    templateInfo: string;
    setTemplate: (file: File, image: HTMLImageElement, info: string) => void;

    // Selection
    selection: Selection | null;
    displayScale: number;
    setSelection: (selection: Selection | null) => void;
    setDisplayScale: (scale: number) => void;

    // CSV
    csvFile: File | null;
    csvHeaders: string[];
    csvData: CsvRow[];
    selectedColumn: string;
    setCsvData: (file: File, headers: string[], data: CsvRow[]) => void;
    setSelectedColumn: (column: string) => void;

    // Settings
    selectedFont: string;
    fontSize: number;
    fontColor: string;
    previewText: string;
    previewEnabled: boolean;
    setSelectedFont: (font: string) => void;
    setFontSize: (size: number) => void;
    setFontColor: (color: string) => void;
    setPreviewText: (text: string) => void;
    setPreviewEnabled: (enabled: boolean) => void;

    // UI State
    isGenerating: boolean;
    progress: number;
    error: string | null;
    setGenerating: (generating: boolean, progress?: number) => void;
    setError: (error: string | null) => void;

    // API
    apiOnline: boolean;
    fonts: Font[];
    setApiStatus: (online: boolean) => void;
    setFonts: (fonts: Font[]) => void;

    // Reset
    reset: () => void;
}

const initialState = {
    templateFile: null,
    templateImage: null,
    templateInfo: '',
    selection: null,
    displayScale: 1,
    csvFile: null,
    csvHeaders: [],
    csvData: [],
    selectedColumn: '',
    selectedFont: '',
    fontSize: 60,
    fontColor: '#000000',
    previewText: '',
    previewEnabled: false,
    isGenerating: false,
    progress: 0,
    error: null,
    apiOnline: false,
    fonts: [],
};

export const useAppStore = create<AppStore>((set) => ({
    ...initialState,

    setTemplate: (file, image, info) => set({
        templateFile: file,
        templateImage: image,
        templateInfo: info,
        selection: null
    }),

    setSelection: (selection) => set({ selection }),
    setDisplayScale: (displayScale) => set({ displayScale }),

    setCsvData: (file, headers, data) => {
        const nameColumn = headers.find(h => h.toLowerCase().includes('name')) || headers[0] || '';
        set({ csvFile: file, csvHeaders: headers, csvData: data, selectedColumn: nameColumn });
    },
    setSelectedColumn: (selectedColumn) => set({ selectedColumn }),

    setSelectedFont: (selectedFont) => set({ selectedFont }),
    setFontSize: (fontSize) => set({ fontSize }),
    setFontColor: (fontColor) => set({ fontColor }),
    setPreviewText: (previewText) => set({ previewText }),
    setPreviewEnabled: (previewEnabled) => set({ previewEnabled }),

    setGenerating: (isGenerating, progress = 0) => set({ isGenerating, progress }),
    setError: (error) => set({ error }),

    setApiStatus: (apiOnline) => set({ apiOnline }),
    setFonts: (fonts) => {
        const selectedFont = fonts.length > 0 ? fonts[0].filename : '';
        set({ fonts, selectedFont });
    },

    reset: () => set(initialState),
}));

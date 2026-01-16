import { create } from 'zustand';
import type { Font, CsvRow, ViewMode, EmailSettings, EmailProgress, EmailConfig, TextBox } from '../types';

const defaultEmailSettings: EmailSettings = {
    subject: 'Your Certificate is Ready! 🎉',
    bodyPlain: `Hi {{name}},

Congratulations on your achievement!

Please find your certificate attached to this email.

Best regards,
The Team`,
    bodyHtml: '',
    attachPdf: true,
    attachJpg: true,
    delayMs: 2000,
};

const defaultEmailProgress: EmailProgress = {
    current: 0,
    total: 0,
    currentRecipient: '',
    status: 'idle',
    errors: [],
    sent: [],
};

// Generate unique ID for boxes
const generateBoxId = () => `box_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

interface AppStore {
    // Template
    templateFile: File | null;
    templateImage: HTMLImageElement | null;
    templateInfo: string;
    setTemplate: (file: File, image: HTMLImageElement, info: string) => void;
    clearTemplate: () => void;

    // Text Boxes (replaces single selection)
    boxes: TextBox[];
    activeBoxId: string | null;
    displayScale: number;
    addBox: (box: Omit<TextBox, 'id' | 'field' | 'fontSize' | 'fontColor' | 'fontFile'>) => void;
    updateBox: (id: string, updates: Partial<TextBox>) => void;
    deleteBox: (id: string) => void;
    setActiveBox: (id: string | null) => void;
    setDisplayScale: (scale: number) => void;

    // CSV
    csvFile: File | null;
    csvHeaders: string[];
    csvData: CsvRow[];
    setCsvData: (file: File, headers: string[], data: CsvRow[]) => void;
    clearCsvData: () => void;

    // Email Column (for email mode)
    emailColumn: string;
    setEmailColumn: (column: string) => void;

    // Default font settings (used when creating new boxes)
    defaultFont: string;
    defaultFontSize: number;
    defaultFontColor: string;
    setDefaultFont: (font: string) => void;
    setDefaultFontSize: (size: number) => void;
    setDefaultFontColor: (color: string) => void;

    // Preview
    previewEnabled: boolean;
    setPreviewEnabled: (enabled: boolean) => void;

    // UI State
    viewMode: ViewMode;
    error: string | null;
    setViewMode: (mode: ViewMode) => void;
    setError: (error: string | null) => void;

    // API
    apiOnline: boolean;
    fonts: Font[];
    emailConfig: EmailConfig | null;
    setApiStatus: (online: boolean) => void;
    setFonts: (fonts: Font[]) => void;
    setEmailConfig: (config: EmailConfig) => void;

    // Email Mode
    emailSettings: EmailSettings;
    emailProgress: EmailProgress;
    setEmailSettings: (settings: Partial<EmailSettings>) => void;
    setEmailProgress: (progress: Partial<EmailProgress>) => void;
    resetEmailProgress: () => void;

    // Reset
    reset: () => void;
    resetToDownload: () => void;
}

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
    emailColumn: '',
    defaultFont: '',
    defaultFontSize: 60,
    defaultFontColor: '#000000',
    previewEnabled: true,
    viewMode: 'certificate' as ViewMode,
    error: null,
    apiOnline: false,
    fonts: [] as Font[],
    emailConfig: null,
    emailSettings: defaultEmailSettings,
    emailProgress: defaultEmailProgress,
};

export const useAppStore = create<AppStore>((set, get) => ({
    ...initialState,

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

    addBox: (boxData) => {
        const { defaultFont, defaultFontSize, defaultFontColor, csvHeaders } = get();
        const newBox: TextBox = {
            id: generateBoxId(),
            ...boxData,
            field: csvHeaders[0] || '',
            fontSize: defaultFontSize,
            fontColor: defaultFontColor,
            fontFile: defaultFont,
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

    setCsvData: (file, headers, data) => {
        const emailCol = headers.find(h => h.toLowerCase().includes('email') || h.toLowerCase().includes('mail')) || '';
        set({ csvFile: file, csvHeaders: headers, csvData: data, emailColumn: emailCol });
    },

    clearCsvData: () => set({
        csvFile: null,
        csvHeaders: [],
        csvData: [],
        emailColumn: '',
    }),

    setEmailColumn: (emailColumn) => set({ emailColumn }),

    setDefaultFont: (defaultFont) => set({ defaultFont }),
    setDefaultFontSize: (defaultFontSize) => set({ defaultFontSize }),
    setDefaultFontColor: (defaultFontColor) => set({ defaultFontColor }),

    setPreviewEnabled: (previewEnabled) => set({ previewEnabled }),

    setViewMode: (viewMode) => set({ viewMode }),
    setError: (error) => set({ error }),

    setApiStatus: (apiOnline) => set({ apiOnline }),
    setFonts: (fonts) => {
        const defaultFont = fonts.length > 0 ? fonts[0].filename : '';
        set((state) => ({
            fonts,
            defaultFont,
            // Update any boxes that have empty fontFile
            boxes: state.boxes.map(box =>
                box.fontFile === '' && defaultFont ? { ...box, fontFile: defaultFont } : box
            ),
        }));
    },
    setEmailConfig: (emailConfig) => set({ emailConfig }),

    setEmailSettings: (settings) => set((state) => ({
        emailSettings: { ...state.emailSettings, ...settings }
    })),
    setEmailProgress: (progress) => set((state) => ({
        emailProgress: { ...state.emailProgress, ...progress }
    })),
    resetEmailProgress: () => set({ emailProgress: defaultEmailProgress }),

    reset: () => set(initialState),
    resetToDownload: () => set({ viewMode: 'certificate', emailProgress: defaultEmailProgress }),
}));

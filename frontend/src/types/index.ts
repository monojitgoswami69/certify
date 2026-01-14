export interface Selection {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface Font {
    filename: string;
    displayName: string;
}

export interface CsvRow {
    [key: string]: string;
}

export type StepStatus = 'pending' | 'active' | 'completed';

export interface AppState {
    // Template
    templateFile: File | null;
    templateImage: HTMLImageElement | null;
    templateInfo: string;

    // Selection
    selection: Selection | null;
    displayScale: number;

    // CSV
    csvFile: File | null;
    csvHeaders: string[];
    csvData: CsvRow[];
    selectedColumn: string;

    // Settings
    selectedFont: string;
    fontSize: number;
    fontColor: string;
    previewText: string;
    previewEnabled: boolean;

    // UI State
    isGenerating: boolean;
    progress: number;
    error: string | null;

    // API
    apiOnline: boolean;
    fonts: Font[];
}

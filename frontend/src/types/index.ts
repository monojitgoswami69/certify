export interface Selection {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface TextBox {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    field: string;        // CSV column to use
    fontSize: number;
    fontColor: string;
    fontFile: string;
}

export interface Font {
    filename: string;
    displayName: string;
}

export interface CsvRow {
    [key: string]: string;
}

export type StepStatus = 'pending' | 'active' | 'completed';

export type ViewMode = 'certificate' | 'email';

export interface EmailSettings {
    subject: string;
    bodyPlain: string;
    bodyHtml: string;
    attachPdf: boolean;
    attachJpg: boolean;
    delayMs: number; // Delay between emails in milliseconds (1000-10000)
}

export interface EmailProgress {
    current: number;
    total: number;
    currentRecipient: string;
    status: 'idle' | 'sending' | 'paused' | 'completed' | 'error';
    errors: Array<{ rowIndex: number; name: string; email: string; error: string }>;
    sent: Array<{ rowIndex: number; name: string; email: string }>;
}

export interface EmailConfig {
    configured: boolean;
    sender?: string;
    host?: string;
    message?: string;
}

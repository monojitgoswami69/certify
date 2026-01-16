import type { EmailConfig, TextBox, CsvRow } from '../types';

const API_BASE = '/api';

export async function checkApiHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${API_BASE}/`);
        return response.ok;
    } catch {
        return false;
    }
}

export async function fetchFonts(): Promise<{ filename: string; displayName: string }[]> {
    const response = await fetch(`${API_BASE}/fonts`);
    if (!response.ok) throw new Error('Failed to fetch fonts');
    const data = await response.json();
    return data.fonts || [];
}

export async function fetchEmailConfig(): Promise<EmailConfig> {
    const response = await fetch(`${API_BASE}/email-config`);
    if (!response.ok) throw new Error('Failed to fetch email config');
    return response.json();
}

// Text box configuration for API calls
export interface TextBoxConfig {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    fontSize: number;
    fontColor: string;
    fontFile: string;
}

export interface GenerateSingleParams {
    templateFile: File;
    textBoxes: TextBoxConfig[];
    includePdf: boolean;
    includeJpg: boolean;
    filename: string; // Base filename for the output
}

export interface GenerateSingleResult {
    filename: string;
    jpg?: string; // base64
    pdf?: string; // base64
}

export async function generateSingleCertificate(params: GenerateSingleParams): Promise<GenerateSingleResult> {
    const formData = new FormData();
    formData.append('template', params.templateFile);
    formData.append('text_boxes', JSON.stringify(params.textBoxes));
    formData.append('include_pdf', params.includePdf.toString());
    formData.append('include_jpg', params.includeJpg.toString());
    formData.append('filename', params.filename);

    const response = await fetch(`${API_BASE}/generate-single`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Generation failed');
    }

    return response.json();
}

export interface SendEmailParams {
    templateFile: File;
    recipientEmail: string;
    textBoxes: TextBoxConfig[];
    emailSubject: string;
    emailBodyPlain: string;
    emailBodyHtml: string;
    attachPdf: boolean;
    attachJpg: boolean;
    filename: string;
}

export async function sendCertificateEmail(params: SendEmailParams): Promise<{ status: string; message: string; recipient: string }> {
    const formData = new FormData();
    formData.append('template', params.templateFile);
    formData.append('recipient_email', params.recipientEmail);
    formData.append('text_boxes', JSON.stringify(params.textBoxes));
    formData.append('email_subject', params.emailSubject);
    formData.append('email_body_plain', params.emailBodyPlain);
    formData.append('email_body_html', params.emailBodyHtml);
    formData.append('attach_pdf', params.attachPdf.toString());
    formData.append('attach_jpg', params.attachJpg.toString());
    formData.append('filename', params.filename);

    const response = await fetch(`${API_BASE}/send-email`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to send email');
    }

    return response.json();
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
}

export function parseCsv(text: string): { headers: string[]; data: Record<string, string>[] } {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
        throw new Error('CSV must have at least a header row and one data row');
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] || '';
        });
        data.push(row);
    }

    return { headers, data };
}

/**
 * Replace template variables in a string.
 * Variables are in format {{variable_name}}
 */
export function replaceTemplateVariables(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? data[key] : match;
    });
}

/**
 * Extract template variable names from a string
 */
export function extractTemplateVariables(template: string): string[] {
    const matches = template.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
}

/**
 * Delay helper for frontend-controlled pacing
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate estimated time for email sending
 */
export function calculateEstimatedTime(recordCount: number, delayMs: number): string {
    const perRecordTime = 2000 + 1000 + 1000 + delayMs;
    const totalMs = recordCount * perRecordTime;

    const totalSeconds = Math.ceil(totalMs / 1000);
    const totalMinutes = Math.ceil(totalSeconds / 60);

    if (totalMinutes < 1) {
        return `~${totalSeconds} seconds`;
    } else if (totalMinutes < 60) {
        return `~${totalMinutes} minute${totalMinutes > 1 ? 's' : ''}`;
    } else {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return `~${hours} hour${hours > 1 ? 's' : ''}${mins > 0 ? ` ${mins} min` : ''}`;
    }
}

/**
 * Convert TextBox array and CSV row to TextBoxConfig array for API
 */
export function buildTextBoxConfigs(boxes: TextBox[], row: CsvRow): TextBoxConfig[] {
    return boxes.map(box => ({
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.w),
        h: Math.round(box.h),
        text: row[box.field] || '',
        fontSize: box.fontSize,
        fontColor: box.fontColor,
        fontFile: box.fontFile,
    }));
}

/**
 * Create a safe filename from text
 */
export function sanitizeFilename(text: string): string {
    const safe = text.replace(/[^a-zA-Z0-9\s\-_]/g, '');
    return safe.trim().replace(/\s+/g, '_').substring(0, 50) || 'certificate';
}

/**
 * Generate a CSV string from error data for download
 */
export function generateErrorReportCsv(
    errors: Array<{ rowIndex: number; name: string; email?: string; error: string }>,
    type: 'email' | 'generation'
): string {
    const headers = type === 'email'
        ? ['Row', 'Name', 'Email', 'Error']
        : ['Row', 'Name', 'Error'];

    const rows = errors.map(err =>
        type === 'email'
            ? [err.rowIndex.toString(), err.name, err.email || '', err.error]
            : [err.rowIndex.toString(), err.name, err.error]
    );

    const escapeCsv = (value: string) => {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    };

    const csvLines = [
        headers.join(','),
        ...rows.map(row => row.map(escapeCsv).join(','))
    ];

    return csvLines.join('\n');
}

/**
 * Download error report as CSV file
 */
export function downloadErrorReport(
    errors: Array<{ rowIndex: number; name: string; email?: string; error: string }>,
    type: 'email' | 'generation'
): void {
    const csv = generateErrorReportCsv(errors, type);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const filename = type === 'email'
        ? `failed_emails_${new Date().toISOString().split('T')[0]}.csv`
        : `failed_generation_${new Date().toISOString().split('T')[0]}.csv`;
    downloadBlob(blob, filename);
}

/**
 * Generate a text summary of errors for clipboard
 */
export function generateErrorSummary(
    errors: Array<{ rowIndex: number; name: string; email?: string; error: string }>,
    type: 'email' | 'generation'
): string {
    const lines = [
        `${type === 'email' ? 'Email Sending' : 'Certificate Generation'} Error Report`,
        `Generated: ${new Date().toLocaleString()}`,
        `Total Failures: ${errors.length}`,
        '',
        '---',
        ''
    ];

    for (const err of errors) {
        if (type === 'email') {
            lines.push(`Row ${err.rowIndex}: ${err.name} (${err.email})`);
        } else {
            lines.push(`Row ${err.rowIndex}: ${err.name}`);
        }
        lines.push(`  Error: ${err.error}`);
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Copy text to clipboard and return success status
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            return true;
        } catch {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    }
}

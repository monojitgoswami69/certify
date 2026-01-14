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

export async function generateCertificates(
    templateFile: File,
    csvFile: File,
    nameColumn: string,
    box: { x: number; y: number; w: number; h: number },
    fontSize: number,
    fontColor: string,
    fontFile: string
): Promise<{ blob: Blob; count: string }> {
    const formData = new FormData();
    formData.append('template', templateFile);
    formData.append('csv_file', csvFile);
    formData.append('name_column', nameColumn);
    formData.append('box_x', Math.round(box.x).toString());
    formData.append('box_y', Math.round(box.y).toString());
    formData.append('box_w', Math.round(box.w).toString());
    formData.append('box_h', Math.round(box.h).toString());
    formData.append('font_size', fontSize.toString());
    formData.append('font_color', fontColor);
    formData.append('font_file', fontFile);

    const response = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Generation failed');
    }

    const blob = await response.blob();
    const count = response.headers.get('X-Generated-Count') || '0';

    return { blob, count };
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

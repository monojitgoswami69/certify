
import { describe, it, expect } from 'vitest';
import { parseCsv, sanitizeFilename } from './utils';
import { JSDOM } from 'jsdom';

// Setup DOM environment for blob testing (mock URL)
const dom = new JSDOM();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).window = dom.window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).global.URL = {
    createObjectURL: () => 'blob:mock-url',
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    revokeObjectURL: () => { },
};

describe('parseCsv', () => {
    it('should parse simple CSV', () => {
        const input = 'Name,Email\nJohn,john@example.com\nJane,jane@example.com';
        const result = parseCsv(input);
        expect(result.headers).toEqual(['Name', 'Email']);
        expect(result.data).toHaveLength(2);
        expect(result.data[0]).toEqual({ Name: 'John', Email: 'john@example.com' });
    });

    it('should handle quoted fields with commas', () => {
        const input = 'Name,Role\n"Doe, John",Admin\n"Smith, Jane",User';
        const result = parseCsv(input);
        expect(result.headers).toEqual(['Name', 'Role']);
        expect(result.data).toHaveLength(2);
        expect(result.data[0]).toEqual({ Name: 'Doe, John', Role: 'Admin' });
    });

    it('should throw on empty input', () => {
        expect(() => parseCsv('')).toThrow();
    });
});

describe('sanitizeFilename', () => {
    it('should remove OS-reserved characters', () => {
        expect(sanitizeFilename('File/Name:?*pdf')).toBe('FileNamepdf');
        expect(sanitizeFilename('My Certificate!')).toBe('My_Certificate!');
    });

    it('should trim and replace spaces', () => {
        expect(sanitizeFilename('  Certificate  Name  ')).toBe('Certificate_Name');
    });

    it('should handle multiple spaces and underscores', () => {
        expect(sanitizeFilename('Cert  __  Name')).toBe('Cert_Name');
    });
});

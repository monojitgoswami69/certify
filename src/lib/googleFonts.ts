/**
 * Google Fonts Integration Service
 * 
 * Simple, instant font loading system using Google Fonts CDN.
 * - Injects font stylesheet immediately
 * - No verification delays
 * - Fonts render as soon as browser loads them
 */

// =============================================================================
// Types
// =============================================================================

export interface GoogleFont {
    family: string;
    category: 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';
    variants: string[];
    popularity: number;
}

export interface FontLoadResult {
    success: boolean;
    family: string;
    error?: string;
}

// =============================================================================
// Constants
// =============================================================================

const GOOGLE_FONTS_CSS_URL = 'https://fonts.googleapis.com/css2';

// Track which fonts have been requested (not necessarily loaded yet)
const requestedFonts = new Set<string>();

import googleFontsData from '../data/google-fonts.json';

// In-memory font list
const allGoogleFonts: GoogleFont[] = googleFontsData as GoogleFont[];

/**
 * Initialize fonts (sync now, but kept async for signature compatibility if needed)
 */
export async function initializeGoogleFonts(): Promise<GoogleFont[]> {
    return allGoogleFonts;
}

/**
 * Get all available fonts (sync)
 */
export function getAllGoogleFonts(): GoogleFont[] {
    return allGoogleFonts.length > 0 ? allGoogleFonts : CURATED_FONTS;
}

/**
 * Get font by family name
 */
export function getGoogleFont(family: string): GoogleFont | undefined {
    return getAllGoogleFonts().find(f => f.family === family);
}

// =============================================================================
// INSTANT Font Loading - No delays, no verification
// =============================================================================

/**
 * Load a Google Font INSTANTLY by injecting stylesheet
 * Does NOT wait for the font to actually load - just injects the link
 * The browser will render it as soon as it's ready
 */
export function loadGoogleFont(family: string): FontLoadResult {
    // Already requested
    if (requestedFonts.has(family)) {
        return { success: true, family };
    }

    // Check if link already exists
    if (document.querySelector(`link[data-font="${family}"]`)) {
        requestedFonts.add(family);
        return { success: true, family };
    }

    // Inject stylesheet immediately
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-font', family);
    link.href = `${GOOGLE_FONTS_CSS_URL}?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
    document.head.appendChild(link);

    requestedFonts.add(family);
    return { success: true, family };
}

/**
 * Check if font has been requested (link injected)
 */
export function isFontLoaded(family: string): boolean {
    return requestedFonts.has(family) || !!document.querySelector(`link[data-font="${family}"]`);
}

/**
 * Preload multiple fonts at once - INSTANT, no waiting
 */
export function preloadFonts(families: string[]): FontLoadResult[] {
    return families.map(family => loadGoogleFont(family));
}

// =============================================================================
// Font Search & Filtering
// =============================================================================

/**
 * Search fonts by name
 */
export function searchFonts(query: string, fonts: GoogleFont[]): GoogleFont[] {
    if (!query.trim()) return fonts;

    const lowerQuery = query.toLowerCase().trim();

    return fonts.filter(font =>
        font.family.toLowerCase().includes(lowerQuery) ||
        font.category.toLowerCase().includes(lowerQuery)
    ).sort((a, b) => {
        const aStartsWith = a.family.toLowerCase().startsWith(lowerQuery);
        const bStartsWith = b.family.toLowerCase().startsWith(lowerQuery);
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;
        return b.popularity - a.popularity;
    });
}

/**
 * Get fonts by category
 */
export function getFontsByCategory(
    category: GoogleFont['category'] | 'all',
    fonts: GoogleFont[]
): GoogleFont[] {
    if (category === 'all') return fonts;
    return fonts.filter(f => f.category === category);
}

/**
 * Get CSS font-family string with fallbacks
 */
export function getFontFamilyCSS(family: string, category?: GoogleFont['category']): string {
    const fallbacks: Record<string, string> = {
        'serif': 'Georgia, "Times New Roman", serif',
        'sans-serif': 'system-ui, -apple-system, sans-serif',
        'display': 'system-ui, sans-serif',
        'handwriting': 'cursive',
        'monospace': 'ui-monospace, "Courier New", monospace'
    };
    return `"${family}", ${fallbacks[category || 'sans-serif']}`;
}

/**
 * Get popular fonts (5-star rating)
 */
export function getPopularFonts(): GoogleFont[] {
    return getAllGoogleFonts().filter(f => f.popularity === 5);
}

/**
 * Get default fonts to preload
 */
export function getDefaultFonts(): GoogleFont[] {
    return getAllGoogleFonts().slice(0, 10);
}

/**
 * Get count of available fonts
 */
export function getAvailableFontsCount(): number {
    return allGoogleFonts.length;
}

// =============================================================================
// Curated Fallback List
// =============================================================================

const CURATED_FONTS: GoogleFont[] = [
    { family: 'Inter', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Roboto', category: 'sans-serif', variants: ['400', '500', '700'], popularity: 5 },
    { family: 'Open Sans', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Lato', category: 'sans-serif', variants: ['400', '700'], popularity: 5 },
    { family: 'Montserrat', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Poppins', category: 'sans-serif', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Playfair Display', category: 'serif', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Merriweather', category: 'serif', variants: ['400', '700'], popularity: 5 },
    { family: 'Dancing Script', category: 'handwriting', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Bebas Neue', category: 'display', variants: ['400'], popularity: 5 },
    { family: 'Roboto Mono', category: 'monospace', variants: ['400', '500', '600', '700'], popularity: 5 },
    { family: 'Source Code Pro', category: 'monospace', variants: ['400', '500', '600', '700'], popularity: 5 },
];

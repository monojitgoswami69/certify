/**
 * Type definitions for the Certificate Generator application
 */

// =============================================================================
// Alignment Types
// =============================================================================

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

// =============================================================================
// Text Box Types
// =============================================================================

/**
 * Represents a text box positioned on the certificate template.
 * Text boxes define where and how CSV data will be rendered.
 */
export interface TextBox {
    /** Unique identifier for the box */
    id: string;
    /** X coordinate (left edge) in image pixels */
    x: number;
    /** Y coordinate (top edge) in image pixels */
    y: number;
    /** Width in image pixels */
    w: number;
    /** Height in image pixels */
    h: number;
    /** CSV column name to use for this box */
    field: string;
    /** Maximum font size in pixels */
    fontSize: number;
    /** Text color in hex format (#RRGGBB) */
    fontColor: string;
    /** Font family name (e.g., 'Roboto', 'Open Sans') */
    fontFamily: string;
    /** Horizontal text alignment */
    hAlign: HorizontalAlign;
    /** Vertical text alignment */
    vAlign: VerticalAlign;
}

// =============================================================================
// Font Types
// =============================================================================

/** Font category as defined by Google Fonts */
export type FontCategory = 'serif' | 'sans-serif' | 'display' | 'handwriting' | 'monospace';

/**
 * Represents a Google Font available in the application.
 */
export interface Font {
    /** Font family name (e.g., 'Roboto', 'Open Sans') */
    family: string;
    /** Font category for grouping and fallbacks */
    category: FontCategory;
    /** Available font weights */
    variants: string[];
    /** Popularity rating (1-5 stars) */
    popularity: number;
}

// =============================================================================
// CSV Types
// =============================================================================

/**
 * A single row of CSV data as key-value pairs.
 */
export interface CsvRow {
    [key: string]: string;
}

// =============================================================================
// UI State Types
// =============================================================================

export type StepStatus = 'pending' | 'active' | 'completed';

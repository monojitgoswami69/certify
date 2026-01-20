/**
 * Certificate Generator Module
 * 
 * A simple, modular certificate generation library.
 * Only requires two inputs:
 * 1. Event name - to load config and template
 * 2. Participant name - validates existence then generates certificate
 * 
 * @module CertificateGenerator
 * @version 2.0.0
 * 
 * Usage:
 * ```javascript
 * import { CertificateGenerator } from './certificate.js';
 * 
 * const cert = new CertificateGenerator();
 * 
 * // Load an event's config and template
 * await cert.loadEvent('default');
 * 
 * // Generate certificate (validates name exists first)
 * const result = await cert.generate('John Doe');
 * if (result.success) {
 *   // result.canvas contains the generated certificate
 *   cert.downloadAsJpg('John_Doe');
 * } else {
 *   console.error(result.error); // "Name not found in certificate list"
 * }
 * ```
 */

'use strict';

/**
 * CertificateGenerator class
 * Simple API: loadEvent(eventName), generate(participantName)
 */
export class CertificateGenerator {
    constructor(basePath = 'events') {
        this.basePath = basePath;
        this.eventId = null;
        this.config = null;
        this.templateImg = null;
        this.fontLoaded = false;
        this.canvas = null;
        this.ctx = null;
        this.ready = false;
        this.validNames = new Set(); // For fast name lookup
    }

    /**
     * Load an event's configuration and template
     * @param {string} eventName - The event identifier (folder name in events/)
     * @returns {Promise<boolean>} - True if loaded successfully
     */
    async loadEvent(eventName) {
        this.eventId = eventName;
        this.ready = false;
        this.validNames.clear();

        try {
            // Load config.json from the event folder
            const configPath = `${this.basePath}/${eventName}/config.json`;
            const response = await fetch(configPath);
            if (!response.ok) {
                throw new Error(`Event "${eventName}" not found`);
            }
            this.config = await response.json();

            // Build valid names set for quick lookup
            if (this.config.names && Array.isArray(this.config.names)) {
                this.config.names.forEach(name => {
                    this.validNames.add(name.trim().toLowerCase());
                });
            }

            // Load font
            await this._loadFont();

            // Load template image
            await this._loadTemplate(eventName);

            this.ready = true;
            console.log(`Event "${eventName}" loaded: ${this.validNames.size} participants`);
            return true;

        } catch (error) {
            console.error(`Failed to load event "${eventName}":`, error);
            throw error;
        }
    }

    /**
     * Generate certificate for a participant
     * First validates name exists in the event's participant list
     * 
     * @param {string} participantName - Name of the participant
     * @returns {Object} - { success: boolean, canvas?: HTMLCanvasElement, error?: string }
     */
    generate(participantName) {
        if (!this.ready) {
            return { success: false, error: 'Event not loaded. Call loadEvent() first.' };
        }

        if (!participantName || typeof participantName !== 'string') {
            return { success: false, error: 'Invalid participant name' };
        }

        const trimmedName = participantName.trim();
        const normalizedName = trimmedName.toLowerCase();

        // Validate name exists in the list (prevent fake certificates)
        if (!this.validNames.has(normalizedName)) {
            return {
                success: false,
                error: `Name "${trimmedName}" not found in certificate list`
            };
        }

        // Find the exact name with original casing
        const exactName = this.config.names.find(
            n => n.trim().toLowerCase() === normalizedName
        ) || trimmedName;

        try {
            // Create canvas if needed
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
            }
            this.ctx = this.canvas.getContext('2d');

            // Set canvas size to match template
            this.canvas.width = this.templateImg.width;
            this.canvas.height = this.templateImg.height;

            // Draw template
            this.ctx.drawImage(this.templateImg, 0, 0);

            // Draw name on certificate
            this._drawText(exactName);

            return { success: true, canvas: this.canvas };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Load custom font
     * @private
     */
    async _loadFont() {
        const fontConfig = this.config.font;
        if (!fontConfig?.file) {
            this.fontLoaded = true;
            return;
        }

        try {
            const fontPath = fontConfig.file.startsWith('fonts/')
                ? fontConfig.file
                : `fonts/${fontConfig.file}`;

            const fontFace = new FontFace(
                fontConfig.family || 'CertificateFont',
                `url(${fontPath})`
            );
            await fontFace.load();
            document.fonts.add(fontFace);
            this.fontLoaded = true;
        } catch (error) {
            console.warn('Failed to load custom font, using fallback:', error);
            if (this.config.font) {
                this.config.font.family = 'Arial, sans-serif';
            }
            this.fontLoaded = true;
        }
    }

    /**
     * Load template image
     * @private
     */
    async _loadTemplate(eventName) {
        return new Promise((resolve, reject) => {
            this.templateImg = new Image();
            this.templateImg.crossOrigin = 'anonymous';

            this.templateImg.onload = () => {
                console.log(`Template loaded: ${this.templateImg.width}x${this.templateImg.height}`);
                resolve();
            };

            this.templateImg.onerror = () => {
                reject(new Error('Failed to load template image'));
            };

            // Template is always template.jpg in the event folder
            this.templateImg.src = `${this.basePath}/${eventName}/template.jpg`;
        });
    }

    /**
     * Draw text on the certificate
     * @private
     */
    _drawText(name) {
        const { textBox, font } = this.config;
        if (!textBox) return;

        const { x, y, w, h } = textBox;

        // Find font size that fits
        const fontSize = this._getFontSizeThatFits(name, w, h, font?.maxSize || 70);

        // Set font
        this.ctx.font = `${fontSize}px "${font?.family || 'Arial'}"`;
        this.ctx.fillStyle = font?.color || '#000000';
        this.ctx.textBaseline = 'alphabetic';

        // Measure text
        const metrics = this.ctx.measureText(name);
        const textWidth = metrics.width;

        // Position: center horizontal, bottom vertical
        const textX = x + (w - textWidth) / 2;
        const textY = y + h - 5;

        // Draw text
        this.ctx.fillText(name, textX, textY);
    }

    /**
     * Find font size that fits
     * @private
     */
    _getFontSizeThatFits(text, boxWidth, boxHeight, maxSize) {
        const minSize = 10;
        const padding = 10;
        const fontFamily = this.config.font?.family || 'Arial';

        for (let size = maxSize; size >= minSize; size -= 2) {
            this.ctx.font = `${size}px "${fontFamily}"`;
            const metrics = this.ctx.measureText(text);
            const textWidth = metrics.width;
            const textHeight = (metrics.actualBoundingBoxAscent || size * 0.8) +
                (metrics.actualBoundingBoxDescent || size * 0.2);

            if (textWidth <= boxWidth - padding && textHeight <= boxHeight - padding) {
                return size;
            }
        }
        return minSize;
    }

    /**
     * Download as JPG
     * @param {string} filename - Filename without extension
     */
    downloadAsJpg(filename) {
        if (!this.canvas) {
            throw new Error('No certificate generated');
        }
        const safeName = this._sanitizeFilename(filename);
        const link = document.createElement('a');
        link.download = `${safeName}.jpg`;
        link.href = this.canvas.toDataURL('image/jpeg', 0.92);
        link.click();
    }

    /**
     * Download as PDF (requires jsPDF)
     * @param {string} filename - Filename without extension
     */
    downloadAsPdf(filename) {
        if (!this.canvas) {
            throw new Error('No certificate generated');
        }
        if (!window.jspdf) {
            throw new Error('jsPDF library not loaded');
        }

        const { jsPDF } = window.jspdf;
        const safeName = this._sanitizeFilename(filename);
        const w = this.canvas.width;
        const h = this.canvas.height;

        const pdf = new jsPDF({
            orientation: w > h ? 'landscape' : 'portrait',
            unit: 'px',
            format: [w, h]
        });

        pdf.addImage(this.canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
        pdf.save(`${safeName}.pdf`);
    }

    /**
     * Get canvas as data URL
     */
    toDataURL(format = 'jpeg', quality = 0.92) {
        if (!this.canvas) throw new Error('No certificate generated');
        return this.canvas.toDataURL(`image/${format}`, quality);
    }

    /**
     * Get list of valid participant names
     */
    getParticipants() {
        return this.config?.names || [];
    }

    /**
     * Get event name/title
     */
    getEventName() {
        return this.config?.eventName || this.eventId;
    }

    /**
     * Check if a name is valid (exists in participant list)
     */
    isValidParticipant(name) {
        if (!name) return false;
        return this.validNames.has(name.trim().toLowerCase());
    }

    /**
     * Check if ready
     */
    isReady() {
        return this.ready;
    }

    /**
     * Sanitize filename
     * @private
     */
    _sanitizeFilename(name) {
        return name.replace(/ /g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
    }
}

// For non-module usage
if (typeof window !== 'undefined') {
    window.CertificateGenerator = CertificateGenerator;
}

export default CertificateGenerator;

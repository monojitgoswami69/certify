'use strict';

/**
 * Certificate Tracker Application
 * Runtime certificate generation using HTML5 Canvas
 * 
 * Replicates backend logic:
 * - Auto-fit text size (reduce font size until text fits in box)
 * - Horizontal center alignment
 * - Vertical bottom alignment
 */

// ==========================================
// Configuration - Loaded from config.json
// ==========================================
let config = {
    templateImage: '',
    font: {
        family: 'JetBrains Mono',
        file: '',
        maxSize: 70,
        color: '#000000'
    },
    textBox: {
        x: 580,
        y: 645,
        w: 840,
        h: 165
    },
    names: []
};

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const resultsGrid = document.getElementById('resultsGrid');
const noResults = document.getElementById('noResults');
const resultCount = document.getElementById('resultCount');
const modalOverlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalContent = document.getElementById('modalContent');
const modalClose = document.getElementById('modalClose');
const downloadJpgBtn = document.getElementById('downloadJpg');
const downloadPdfBtn = document.getElementById('downloadPdf');
const hiddenCanvas = document.getElementById('certificateCanvas');

// State
let templateImg = null;
let currentCertName = '';
let fontLoaded = false;

// ==========================================
// Initialization
// ==========================================

async function init() {
    try {
        await loadConfig();
        await loadFont();
        await loadTemplate();
        setupEventListeners();
        renderCertificates(config.names);
    } catch (error) {
        console.error('Initialization failed:', error);
        showError('Failed to initialize. Please check the console for details.');
    }
}

// Load configuration from config.json
async function loadConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) throw new Error('Config not found');
        const loadedConfig = await response.json();

        // Merge with defaults
        config = { ...config, ...loadedConfig };
        console.log('Config loaded:', config);
    } catch (error) {
        console.warn('Using default config, config.json not found:', error);
    }
}

// Load custom font
async function loadFont() {
    if (!config.font.file) {
        console.log('No custom font specified, using system fonts');
        fontLoaded = true;
        return;
    }

    try {
        const fontFace = new FontFace(config.font.family, `url(${config.font.file})`);
        await fontFace.load();
        document.fonts.add(fontFace);
        fontLoaded = true;
        console.log(`Font loaded: ${config.font.family}`);
    } catch (error) {
        console.warn('Failed to load custom font, using fallback:', error);
        config.font.family = 'Arial, sans-serif';
        fontLoaded = true;
    }
}

// Load certificate template image
async function loadTemplate() {
    return new Promise((resolve, reject) => {
        templateImg = new Image();
        templateImg.crossOrigin = 'anonymous';

        templateImg.onload = () => {
            console.log(`Template loaded: ${templateImg.width}x${templateImg.height}`);
            resolve();
        };

        templateImg.onerror = () => {
            reject(new Error('Failed to load template image'));
        };

        templateImg.src = config.templateImage;
    });
}

// ==========================================
// Event Listeners
// ==========================================

function setupEventListeners() {
    // Search input
    searchInput.addEventListener('input', debounce(handleSearch, 150));

    // Clear button
    searchClear.addEventListener('click', clearSearch);

    // Modal close
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Download buttons
    downloadJpgBtn.addEventListener('click', () => downloadCertificate('jpg'));
    downloadPdfBtn.addEventListener('click', () => downloadCertificate('pdf'));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
        }
    });
}

// ==========================================
// Certificate Generation (Canvas)
// ==========================================

/**
 * Generate certificate on canvas
 * Replicates backend logic:
 * - Get font size that fits text within box (width AND height)
 * - Horizontally center text
 * - Vertically align text to bottom of box
 */
function generateCertificate(name, canvas) {
    if (!templateImg || !fontLoaded) {
        console.error('Template or font not ready');
        return false;
    }

    const ctx = canvas.getContext('2d');

    // Set canvas size to match template
    canvas.width = templateImg.width;
    canvas.height = templateImg.height;

    // Draw template
    ctx.drawImage(templateImg, 0, 0);

    // Get text box dimensions
    const { x, y, w, h } = config.textBox;

    // Find font size that fits
    const fontSize = getFontSizeThatFits(ctx, name, w, h, config.font.maxSize);

    // Set font
    ctx.font = `${fontSize}px "${config.font.family}"`;
    ctx.fillStyle = config.font.color;
    ctx.textBaseline = 'alphabetic';

    // Measure text
    const metrics = ctx.measureText(name);
    const textWidth = metrics.width;
    const textHeight = fontSize; // Approximate height

    // Calculate position
    // Horizontal: center in box
    const textX = x + (w - textWidth) / 2;

    // Vertical: align to bottom of box (with 5px padding)
    const textY = y + h - 5;

    // Draw text
    ctx.fillText(name, textX, textY);

    return true;
}

/**
 * Find the largest font size that fits text within the box
 * Checks BOTH width AND height constraints
 */
function getFontSizeThatFits(ctx, text, boxWidth, boxHeight, maxFontSize) {
    const minFontSize = 10;
    const padding = 10;

    let fontSize = maxFontSize;

    while (fontSize >= minFontSize) {
        ctx.font = `${fontSize}px "${config.font.family}"`;
        const metrics = ctx.measureText(text);

        const textWidth = metrics.width;
        // For height, use actualBoundingBoxAscent + actualBoundingBoxDescent if available
        const textHeight = (metrics.actualBoundingBoxAscent || fontSize * 0.8) +
            (metrics.actualBoundingBoxDescent || fontSize * 0.2);

        // Check if text fits within box (with padding)
        if (textWidth <= boxWidth - padding && textHeight <= boxHeight - padding) {
            return fontSize;
        }

        fontSize -= 2; // Decrease by 2px increments (same as backend)
    }

    return minFontSize;
}

// ==========================================
// Download Functions
// ==========================================

function downloadCertificate(format) {
    if (!currentCertName) return;

    const safeFilename = currentCertName.replace(/ /g, '_').replace(/[^a-zA-Z0-9_-]/g, '');

    if (format === 'jpg') {
        // Download as JPG
        const link = document.createElement('a');
        link.download = `${safeFilename}.jpg`;
        link.href = hiddenCanvas.toDataURL('image/jpeg', 0.92);
        link.click();
    } else if (format === 'pdf') {
        // Download as PDF using jsPDF
        const { jsPDF } = window.jspdf;

        // Get canvas dimensions
        const imgWidth = hiddenCanvas.width;
        const imgHeight = hiddenCanvas.height;

        // Create PDF with same aspect ratio
        const orientation = imgWidth > imgHeight ? 'landscape' : 'portrait';
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'px',
            format: [imgWidth, imgHeight]
        });

        // Add image to PDF
        const imgData = hiddenCanvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);

        // Save PDF
        pdf.save(`${safeFilename}.pdf`);
    }
}

// ==========================================
// UI Functions
// ==========================================

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();

    searchClear.classList.toggle('visible', query.length > 0);

    if (!query) {
        renderCertificates(config.names);
        return;
    }

    const filtered = config.names.filter(name =>
        name.toLowerCase().includes(query)
    );

    renderCertificates(filtered, query);
}

function clearSearch() {
    searchInput.value = '';
    searchClear.classList.remove('visible');
    renderCertificates(config.names);
    searchInput.focus();
}

function renderCertificates(names, query = '') {
    resultsGrid.innerHTML = '';

    const total = config.names.length;
    const shown = names.length;

    if (query) {
        resultCount.textContent = `${shown} of ${total} certificates`;
    } else {
        resultCount.textContent = `${total} certificates available`;
    }

    noResults.classList.toggle('visible', names.length === 0 && query);

    // Limit displayed results for performance
    const maxDisplay = 50;
    const displayNames = names.slice(0, maxDisplay);

    displayNames.forEach((name, index) => {
        const card = createCertificateCard(name, query, index);
        resultsGrid.appendChild(card);
    });

    if (names.length > maxDisplay) {
        const moreNotice = document.createElement('div');
        moreNotice.className = 'certificate-card';
        moreNotice.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 1.5rem;';
        moreNotice.innerHTML = `
            <p style="color: var(--color-text-secondary);">
                Showing ${maxDisplay} of ${names.length} results. Refine your search to see more.
            </p>
        `;
        resultsGrid.appendChild(moreNotice);
    }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createCertificateCard(name, query, index) {
    const card = document.createElement('div');
    card.className = 'certificate-card';
    card.style.animationDelay = `${index * 0.03}s`;

    const initials = name.split(' ')
        .filter(word => word.length > 0)
        .map(word => word[0].toUpperCase())
        .join('')
        .slice(0, 2);

    // Sanitize user data to prevent XSS
    const safeInitials = escapeHtml(initials);
    const safeName = escapeHtml(name);
    const safeFilename = escapeHtml(name.replace(/ /g, '_'));
    const displayName = query ? highlightText(safeName, query) : safeName;

    card.innerHTML = `
        <div class="card-header">
            <div class="card-avatar">${safeInitials}</div>
            <div class="card-info">
                <div class="card-name">${displayName}</div>
                <div class="card-filename">${safeFilename}</div>
            </div>
        </div>
        <div class="card-actions">
            <button class="action-btn view-cert" type="button">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 12C1 12 5 4 12 4C19 4 23 12 23 12C23 12 19 20 12 20C5 20 1 12 1 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
                </svg>
                View Certificate
            </button>
        </div>
    `;

    const viewBtn = card.querySelector('.view-cert');
    viewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCertificateModal(name);
    });

    return card;
}

function highlightText(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openCertificateModal(name) {
    currentCertName = name;
    modalTitle.textContent = `Certificate - ${name}`;

    // Show loading state
    modalContent.innerHTML = '<div class="loading-spinner"></div>';

    // Show modal
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Generate certificate on hidden canvas
    setTimeout(() => {
        const success = generateCertificate(name, hiddenCanvas);

        if (success) {
            // Create display canvas in modal
            const displayCanvas = document.createElement('canvas');
            displayCanvas.className = 'certificate-preview';
            displayCanvas.width = hiddenCanvas.width;
            displayCanvas.height = hiddenCanvas.height;

            const displayCtx = displayCanvas.getContext('2d');
            displayCtx.drawImage(hiddenCanvas, 0, 0);

            modalContent.innerHTML = '';
            modalContent.appendChild(displayCanvas);
        } else {
            modalContent.innerHTML = `
                <div style="text-align: center; color: var(--color-text-secondary);">
                    <p>Failed to generate certificate</p>
                </div>
            `;
        }
    }, 50); // Small delay to allow modal to render first
}

function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    currentCertName = '';

    setTimeout(() => {
        modalContent.innerHTML = '';
    }, 250);
}

function showError(message) {
    resultsGrid.innerHTML = `
        <div class="certificate-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
            <p style="color: var(--color-text-secondary);">${message}</p>
        </div>
    `;
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', init);

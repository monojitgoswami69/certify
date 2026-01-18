/**
 * Certificate Tracker Application
 * Search and view certificates in real-time
 */

// Certificate data (will be populated from filesystem listing)
let certificates = [];

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

// Initialize the application
async function init() {
    await loadCertificates();
    setupEventListeners();
    renderCertificates(certificates);
}

// Load certificate data - tries JSON first (for Vercel), then directory listing, then CSV
async function loadCertificates() {
    // Try loading from pre-generated JSON file first (works on Vercel)
    try {
        const response = await fetch('certificates.json');
        if (response.ok) {
            certificates = await response.json();
            console.log(`Loaded ${certificates.length} certificates from JSON`);
            return;
        }
    } catch (error) {
        console.log('JSON load failed, trying directory listing...');
    }

    // Try directory listing (works with Python http.server)
    try {
        const response = await fetch('certificates_jpg/');
        if (!response.ok) {
            throw new Error('Failed to fetch directory listing');
        }

        const html = await response.text();

        // Parse the directory listing
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = doc.querySelectorAll('a');

        certificates = []; // Reset array

        links.forEach(link => {
            const href = link.getAttribute('href');
            // Only process .jpg files, skip parent directory links
            if (href && href.endsWith('.jpg') && !href.includes('/')) {
                const filename = decodeURIComponent(href);
                // Extract just the filename without extension
                const filenameWithoutExt = filename.replace('.jpg', '');
                // Convert underscores to spaces for display name
                const displayName = filenameWithoutExt.replace(/_/g, ' ');

                certificates.push({
                    name: displayName,
                    filename: filenameWithoutExt,
                    jpgPath: `certificates_jpg/${filename}`,
                    pdfPath: `certificates_pdf/${filenameWithoutExt}.pdf`
                });
            }
        });

        console.log(`Loaded ${certificates.length} certificates from directory listing`);

        // If no certificates found from directory, try CSV fallback
        if (certificates.length === 0) {
            console.log('No certificates found, using CSV fallback');
            await loadFromCSV();
        }
    } catch (error) {
        console.log('Directory listing failed, using CSV fallback:', error);
        await loadFromCSV();
    }
}

// Fallback: Load from CSV file
async function loadFromCSV() {
    try {
        const response = await fetch('../data.csv');
        if (!response.ok) {
            throw new Error('Failed to fetch CSV');
        }

        const text = await response.text();
        const lines = text.trim().split('\n');

        certificates = []; // Reset array

        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            const name = lines[i].trim();
            if (name) {
                const filename = name.replace(/ /g, '_');
                certificates.push({
                    name: name,
                    filename: filename,
                    jpgPath: `certificates_jpg/${filename}.jpg`,
                    pdfPath: `certificates_pdf/${filename}.pdf`
                });
            }
        }

        console.log(`Loaded ${certificates.length} certificates from CSV`);
    } catch (error) {
        console.error('Failed to load certificates:', error);
        showError();
    }
}

// Show error state
function showError() {
    resultsGrid.innerHTML = `
        <div class="certificate-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
            <p style="color: var(--color-text-secondary);">
                Unable to load certificates. Please ensure you're running a local server.
            </p>
        </div>
    `;
}

// Setup event listeners
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

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === '/' && document.activeElement !== searchInput) {
            e.preventDefault();
            searchInput.focus();
        }
    });
}

// Debounce utility
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

// Handle search
function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();

    // Toggle clear button
    searchClear.classList.toggle('visible', query.length > 0);

    if (!query) {
        renderCertificates(certificates);
        return;
    }

    const filtered = certificates.filter(cert =>
        cert.name.toLowerCase().includes(query)
    );

    renderCertificates(filtered, query);
}

// Clear search
function clearSearch() {
    searchInput.value = '';
    searchClear.classList.remove('visible');
    renderCertificates(certificates);
    searchInput.focus();
}

// Render certificates
function renderCertificates(certs, query = '') {
    resultsGrid.innerHTML = '';

    // Update count
    const total = certificates.length;
    const shown = certs.length;

    if (query) {
        resultCount.textContent = `${shown} of ${total} certificates`;
    } else {
        resultCount.textContent = `${total} certificates available`;
    }

    // Show/hide no results
    noResults.classList.toggle('visible', certs.length === 0 && query);

    // Limit displayed results for performance
    const maxDisplay = 50;
    const displayCerts = certs.slice(0, maxDisplay);

    displayCerts.forEach((cert, index) => {
        const card = createCertificateCard(cert, query, index);
        resultsGrid.appendChild(card);
    });

    // Show "more results" notice if needed
    if (certs.length > maxDisplay) {
        const moreNotice = document.createElement('div');
        moreNotice.className = 'certificate-card';
        moreNotice.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 1.5rem;';
        moreNotice.innerHTML = `
            <p style="color: var(--color-text-secondary);">
                Showing ${maxDisplay} of ${certs.length} results. Refine your search to see more specific results.
            </p>
        `;
        resultsGrid.appendChild(moreNotice);
    }
}

// Create certificate card
function createCertificateCard(cert, query, index) {
    const card = document.createElement('div');
    card.className = 'certificate-card';
    card.style.animationDelay = `${index * 0.03}s`;

    // Get initials from the clean name
    const initials = cert.name.split(' ')
        .filter(word => word.length > 0)
        .map(word => word[0].toUpperCase())
        .join('')
        .slice(0, 2);

    const displayName = query ? highlightText(cert.name, query) : cert.name;

    card.innerHTML = `
        <div class="card-header">
            <div class="card-avatar">${initials}</div>
            <div class="card-info">
                <div class="card-name">${displayName}</div>
                <div class="card-filename">${cert.filename}</div>
            </div>
        </div>
        <div class="card-actions">
            <button class="action-btn view-image" type="button">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
                    <path d="M21 15L16 10L5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                View Image
            </button>
            <button class="action-btn view-pdf" type="button">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M14 2V8H20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M9 15H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M9 11H15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                View PDF
            </button>
        </div>
    `;

    // Add event listeners to buttons
    const imageBtn = card.querySelector('.view-image');
    const pdfBtn = card.querySelector('.view-pdf');

    imageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal('image', cert.jpgPath, cert.name);
    });

    pdfBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal('pdf', cert.pdfPath, cert.name);
    });

    return card;
}

// Highlight matching text
function highlightText(text, query) {
    if (!query) return text;

    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

// Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Open modal
function openModal(type, path, name) {
    console.log(`Opening modal: type=${type}, path=${path}, name=${name}`);

    modalTitle.textContent = `${name} - ${type === 'image' ? 'Certificate Image' : 'Certificate PDF'}`;

    // Show loading state
    modalContent.innerHTML = '<div class="loading-spinner"></div>';

    // Show modal
    modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (type === 'image') {
        const img = new Image();
        img.onload = () => {
            console.log('Image loaded successfully');
            modalContent.innerHTML = '';
            modalContent.appendChild(img);
        };
        img.onerror = (e) => {
            console.error('Image load failed:', e);
            modalContent.innerHTML = `
                <div style="text-align: center; color: var(--color-text-secondary);">
                    <p style="font-size: 1.25rem; margin-bottom: 1rem;">Failed to load image</p>
                    <p style="font-size: 0.875rem; opacity: 0.7; font-family: monospace;">${path}</p>
                </div>
            `;
        };
        img.src = path;
        img.alt = `Certificate for ${name}`;
    } else {
        // PDF viewer using object tag for better compatibility
        modalContent.innerHTML = `
            <object data="${path}" type="application/pdf" width="100%" height="100%" style="min-height: 70vh; border-radius: 8px;">
                <div style="text-align: center; padding: 2rem;">
                    <p style="color: var(--color-text-secondary); margin-bottom: 1rem;">
                        Unable to display PDF inline.
                    </p>
                    <a href="${path}" target="_blank" style="color: var(--color-accent-primary); text-decoration: none; padding: 0.75rem 1.5rem; border: 1px solid var(--color-accent-primary); border-radius: 8px; display: inline-block;">
                        Open PDF in new tab
                    </a>
                </div>
            </object>
        `;
    }
}

// Close modal
function closeModal() {
    modalOverlay.classList.remove('active');
    document.body.style.overflow = '';

    // Clear content after animation
    setTimeout(() => {
        modalContent.innerHTML = '';
    }, 250);
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', init);

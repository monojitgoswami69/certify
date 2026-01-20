/**
 * Certificate Tracker Application
 * 
 * Dynamic event-based certificate viewer.
 * Uses modular components:
 * - CertificateGenerator (js/certificate.js) - loadEvent(name), generate(participant)
 * - EventManager (js/events.js) - loads event list
 */

'use strict';

import { CertificateGenerator } from './js/certificate.js';
import { EventManager } from './js/events.js';

// ==========================================
// Application State
// ==========================================

const state = {
    eventManager: new EventManager(),
    generator: new CertificateGenerator(),
    currentEventId: null,
    participants: [],
    currentName: ''
};

// DOM Elements cache
const el = {};

// ==========================================
// Initialization
// ==========================================

async function init() {
    cacheElements();

    try {
        // Load events list
        await state.eventManager.loadEvents();

        // Populate event dropdown
        populateEventSelector();

        // Setup event listeners
        setupEventListeners();

        // Load first event
        const events = state.eventManager.getEvents();
        if (events.length > 0) {
            await loadEvent(events[0].id);
        } else {
            showMessage('No events found', 'error');
        }
    } catch (error) {
        console.error('Init failed:', error);
        showMessage('Failed to initialize', 'error');
    }
}

function cacheElements() {
    el.eventSelector = document.getElementById('eventSelector');
    el.eventInfo = document.getElementById('eventInfo');
    el.searchInput = document.getElementById('searchInput');
    el.searchClear = document.getElementById('searchClear');
    el.resultsGrid = document.getElementById('resultsGrid');
    el.noResults = document.getElementById('noResults');
    el.resultCount = document.getElementById('resultCount');
    el.modalOverlay = document.getElementById('modalOverlay');
    el.modalTitle = document.getElementById('modalTitle');
    el.modalContent = document.getElementById('modalContent');
    el.modalClose = document.getElementById('modalClose');
    el.downloadJpg = document.getElementById('downloadJpg');
    el.downloadPdf = document.getElementById('downloadPdf');
}

// ==========================================
// Event Management
// ==========================================

function populateEventSelector() {
    const events = state.eventManager.getEvents();

    el.eventSelector.innerHTML = events.map(event => `
        <option value="${escapeHtml(event.id)}">
            ${escapeHtml(event.name)}
        </option>
    `).join('');
}

async function loadEvent(eventId) {
    // Show loading
    el.resultCount.textContent = 'Loading...';
    el.resultsGrid.innerHTML = `
        <div class="certificate-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
            <div class="loading-spinner"></div>
            <p style="color: var(--color-text-secondary); margin-top: 1rem;">Loading certificates...</p>
        </div>
    `;

    try {
        // Load event using the simple API
        await state.generator.loadEvent(eventId);

        state.currentEventId = eventId;
        state.participants = state.generator.getParticipants();

        // Show event description
        const event = state.eventManager.getEvent(eventId);
        if (event?.description) {
            el.eventInfo.textContent = event.description;
            el.eventInfo.style.display = 'block';
        } else {
            el.eventInfo.style.display = 'none';
        }

        // Clear search and render
        el.searchInput.value = '';
        el.searchClear.classList.remove('visible');
        renderParticipants(state.participants);

    } catch (error) {
        console.error('Failed to load event:', error);
        showMessage(`Failed to load event: ${error.message}`, 'error');
    }
}

// ==========================================
// Event Listeners
// ==========================================

function setupEventListeners() {
    // Event selector change
    el.eventSelector.addEventListener('change', (e) => {
        if (e.target.value) loadEvent(e.target.value);
    });

    // Search
    el.searchInput.addEventListener('input', debounce(handleSearch, 150));
    el.searchClear.addEventListener('click', clearSearch);

    // Modal
    el.modalClose.addEventListener('click', closeModal);
    el.modalOverlay.addEventListener('click', (e) => {
        if (e.target === el.modalOverlay) closeModal();
    });

    // Downloads
    el.downloadJpg.addEventListener('click', () => downloadCertificate('jpg'));
    el.downloadPdf.addEventListener('click', () => downloadCertificate('pdf'));

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === '/' && document.activeElement !== el.searchInput) {
            e.preventDefault();
            el.searchInput.focus();
        }
    });
}

// ==========================================
// Search
// ==========================================

function debounce(fn, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
    };
}

function handleSearch() {
    const query = el.searchInput.value.trim().toLowerCase();
    el.searchClear.classList.toggle('visible', query.length > 0);

    if (!query) {
        renderParticipants(state.participants);
        return;
    }

    const filtered = state.participants.filter(name =>
        name.toLowerCase().includes(query)
    );
    renderParticipants(filtered, query);
}

function clearSearch() {
    el.searchInput.value = '';
    el.searchClear.classList.remove('visible');
    renderParticipants(state.participants);
    el.searchInput.focus();
}

// ==========================================
// Rendering
// ==========================================

function renderParticipants(names, query = '') {
    const total = state.participants.length;
    const shown = names.length;

    el.resultCount.textContent = query
        ? `${shown} of ${total} certificates`
        : `${total} certificates available`;

    el.noResults.classList.toggle('visible', names.length === 0 && query);
    el.resultsGrid.innerHTML = '';

    // Limit display for performance
    const maxDisplay = 50;
    const displayNames = names.slice(0, maxDisplay);

    displayNames.forEach((name, index) => {
        el.resultsGrid.appendChild(createCard(name, query, index));
    });

    if (names.length > maxDisplay) {
        const notice = document.createElement('div');
        notice.className = 'certificate-card';
        notice.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 1.5rem;';
        notice.innerHTML = `<p style="color: var(--color-text-secondary);">
            Showing ${maxDisplay} of ${names.length} results. Refine your search to see more.
        </p>`;
        el.resultsGrid.appendChild(notice);
    }
}

function createCard(name, query, index) {
    const card = document.createElement('div');
    card.className = 'certificate-card';
    card.style.animationDelay = `${index * 0.03}s`;

    const initials = name.split(' ')
        .filter(w => w.length > 0)
        .map(w => w[0].toUpperCase())
        .join('')
        .slice(0, 2);

    const safeName = escapeHtml(name);
    const safeFilename = escapeHtml(name.replace(/ /g, '_'));
    const displayName = query ? highlightText(safeName, query) : safeName;

    card.innerHTML = `
        <div class="card-header">
            <div class="card-avatar">${escapeHtml(initials)}</div>
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

    card.querySelector('.view-cert').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(name);
    });

    return card;
}

// ==========================================
// Modal & Certificate Generation
// ==========================================

function openModal(name) {
    state.currentName = name;
    el.modalTitle.textContent = `Certificate - ${name}`;
    el.modalContent.innerHTML = '<div class="loading-spinner"></div>';

    el.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Generate certificate using simple API
    setTimeout(() => {
        const result = state.generator.generate(name);

        if (result.success) {
            const displayCanvas = document.createElement('canvas');
            displayCanvas.className = 'certificate-preview';
            displayCanvas.width = result.canvas.width;
            displayCanvas.height = result.canvas.height;
            displayCanvas.getContext('2d').drawImage(result.canvas, 0, 0);

            el.modalContent.innerHTML = '';
            el.modalContent.appendChild(displayCanvas);
        } else {
            el.modalContent.innerHTML = `
                <div style="text-align: center; color: var(--color-text-secondary);">
                    <p>⚠️ ${escapeHtml(result.error)}</p>
                </div>
            `;
        }
    }, 50);
}

function closeModal() {
    el.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
    state.currentName = '';
    setTimeout(() => { el.modalContent.innerHTML = ''; }, 250);
}

function downloadCertificate(format) {
    if (!state.currentName) return;

    try {
        if (format === 'jpg') {
            state.generator.downloadAsJpg(state.currentName);
        } else {
            state.generator.downloadAsPdf(state.currentName);
        }
    } catch (error) {
        alert(`Download failed: ${error.message}`);
    }
}

// ==========================================
// Utilities
// ==========================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function highlightText(text, query) {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
}

function showMessage(message, type = 'info') {
    el.resultsGrid.innerHTML = `
        <div class="certificate-card" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
            <p style="color: ${type === 'error' ? '#ef4444' : 'var(--color-text-secondary)'};">
                ${escapeHtml(message)}
            </p>
        </div>
    `;
    el.resultCount.textContent = type === 'error' ? 'Error' : '';
}

// ==========================================
// Start
// ==========================================

document.addEventListener('DOMContentLoaded', init);

/**
 * Certify - Certificate Generator Frontend
 * Connects to FastAPI backend for certificate generation
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const API_BASE_URL = 'http://localhost:8001';

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const $ = (id) => document.getElementById(id);

const elements = {
    templateInput: $('templateInput'),
    templateDropZone: $('templateDropZone'),
    templateInfo: $('templateInfo'),
    csvInput: $('csvInput'),
    csvDropZone: $('csvDropZone'),
    nameColumnSelect: $('nameColumnSelect'),
    fontSelect: $('fontSelect'),
    fontSizeInput: $('fontSizeInput'),
    fontColorInput: $('fontColorInput'),
    previewToggle: $('previewToggle'),
    previewInputGroup: $('previewInputGroup'),
    previewTextInput: $('previewTextInput'),
    canvas: $('mainCanvas'),
    canvasArea: $('canvasArea'),
    canvasPlaceholder: $('canvasPlaceholder'),
    fieldSelectorContainer: $('fieldSelectorContainer'),
    recordsCount: $('recordsCount'),
    progressBar: $('progressBar'),
    progressFill: $('progressFill'),
    errorMessage: $('errorMessage'),
    coordX: $('coordX'),
    coordY: $('coordY'),
    coordW: $('coordW'),
    coordH: $('coordH'),
    generateBtn: $('generateBtn'),
    resetBtn: $('resetBtn'),
    apiStatus: $('apiStatus'),
    apiStatusText: $('apiStatusText'),
    step1: $('step1'),
    step2: $('step2'),
    step3: $('step3'),
    step4: $('step4'),
};

const ctx = elements.canvas.getContext('2d');

// =============================================================================
// STATE
// =============================================================================

let state = {
    templateFile: null,    // Original File object for upload
    templateImage: null,   // Image for display
    csvFile: null,         // Original File object for upload
    csvData: [],           // Parsed data for display
    csvHeaders: [],
    apiOnline: false,

    // Display scale
    displayScale: 1,

    // Selection rectangle in ORIGINAL IMAGE coordinates
    selection: null,

    // Drawing state
    isDrawing: false,
    drawStart: { x: 0, y: 0 },
};

const HANDLE_SIZE = 8;

// =============================================================================
// API STATUS CHECK (runs ONCE on page load)
// =============================================================================

let fontsLoaded = false; // Cache flag to prevent multiple font loads

async function checkApiStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/`);
        if (response.ok) {
            state.apiOnline = true;
            elements.apiStatus.classList.add('online');
            elements.apiStatus.classList.remove('offline');
            elements.apiStatusText.textContent = 'API Connected';

            // Load fonts ONLY ONCE
            if (!fontsLoaded) {
                await loadFonts();
                fontsLoaded = true;
            }
        } else {
            throw new Error('API not responding');
        }
    } catch (error) {
        state.apiOnline = false;
        elements.apiStatus.classList.add('offline');
        elements.apiStatus.classList.remove('online');
        elements.apiStatusText.textContent = 'API Offline';
    }
}

async function loadFonts() {
    try {
        const response = await fetch(`${API_BASE_URL}/fonts`);
        if (response.ok) {
            const data = await response.json();
            const fonts = data.fonts || [];

            // Populate font dropdown
            elements.fontSelect.innerHTML = '';
            fonts.forEach(font => {
                const option = document.createElement('option');
                option.value = font.filename;
                option.textContent = font.displayName;
                elements.fontSelect.appendChild(option);
            });

            // If no fonts found, add a default
            if (fonts.length === 0) {
                const option = document.createElement('option');
                option.value = 'default';
                option.textContent = 'Default Font';
                elements.fontSelect.appendChild(option);
            }
        }
    } catch (error) {
        console.error('Failed to load fonts:', error);
    }
}

// Check API status ONCE on page load (no periodic polling to save API calls)
checkApiStatus();

// =============================================================================
// COORDINATE CONVERSION
// =============================================================================

function screenToImage(screenX, screenY) {
    const rect = elements.canvas.getBoundingClientRect();
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;

    return {
        x: canvasX / state.displayScale,
        y: canvasY / state.displayScale
    };
}

// =============================================================================
// RENDERING
// =============================================================================

function render() {
    if (!state.templateImage) return;

    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

    // Draw scaled image
    ctx.drawImage(
        state.templateImage,
        0, 0,
        state.templateImage.width, state.templateImage.height,
        0, 0,
        elements.canvas.width, elements.canvas.height
    );

    // Draw selection if exists
    if (state.selection && state.selection.w > 0 && state.selection.h > 0) {
        const displaySel = {
            x: state.selection.x * state.displayScale,
            y: state.selection.y * state.displayScale,
            w: state.selection.w * state.displayScale,
            h: state.selection.h * state.displayScale
        };

        // Fill
        ctx.fillStyle = 'rgba(79, 70, 229, 0.15)';
        ctx.fillRect(displaySel.x, displaySel.y, displaySel.w, displaySel.h);

        // Border
        ctx.strokeStyle = '#4f46e5';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(displaySel.x, displaySel.y, displaySel.w, displaySel.h);

        // Draw preview text if toggle is enabled and text exists
        const previewEnabled = elements.previewToggle && elements.previewToggle.checked;
        const previewText = elements.previewTextInput ? elements.previewTextInput.value.trim() : '';

        if (previewEnabled && previewText) {
            const maxFontSize = parseInt(elements.fontSizeInput.value) || 60;
            const fontColor = elements.fontColorInput.value || '#000000';

            // Auto-shrink font to fit within box (check BOTH width AND height)
            let fontSize = maxFontSize;
            const minFontSize = 10;
            let textWidth, textHeight, displayFontSize;

            // Find the largest font size that fits
            while (fontSize >= minFontSize) {
                displayFontSize = fontSize * state.displayScale;
                ctx.font = `${displayFontSize}px "JetBrains Mono", monospace`;
                const metrics = ctx.measureText(previewText);
                textWidth = metrics.width;
                textHeight = displayFontSize * 1.2; // Approximate height with line spacing

                // Check if text fits within box (both width AND height with padding)
                if (textWidth <= displaySel.w - 10 && textHeight <= displaySel.h - 10) {
                    break;
                }
                fontSize -= 2;
            }

            displayFontSize = fontSize * state.displayScale;
            ctx.font = `${displayFontSize}px "JetBrains Mono", monospace`;
            ctx.fillStyle = fontColor;
            ctx.textBaseline = 'alphabetic'; // Use alphabetic for consistent bottom alignment
            ctx.textAlign = 'center';

            // Horizontal center, vertical: stick to bottom of box
            const centerX = displaySel.x + displaySel.w / 2;
            const bottomY = displaySel.y + displaySel.h - 8; // Padding from bottom

            ctx.fillText(previewText, centerX, bottomY);
        }

        // Handles (draw after text so they're on top)
        drawHandles(displaySel);
    }
}

function drawHandles(sel) {
    const handles = getHandlePositions(sel);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;

    for (const key in handles) {
        const h = handles[key];
        ctx.beginPath();
        ctx.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.fill();
        ctx.stroke();
    }
}

function getHandlePositions(sel) {
    const mx = sel.x + sel.w / 2;
    const my = sel.y + sel.h / 2;
    return {
        nw: { x: sel.x, y: sel.y },
        n: { x: mx, y: sel.y },
        ne: { x: sel.x + sel.w, y: sel.y },
        e: { x: sel.x + sel.w, y: my },
        se: { x: sel.x + sel.w, y: sel.y + sel.h },
        s: { x: mx, y: sel.y + sel.h },
        sw: { x: sel.x, y: sel.y + sel.h },
        w: { x: sel.x, y: my }
    };
}

function updateCoordDisplay() {
    if (state.selection) {
        elements.coordX.value = Math.round(state.selection.x);
        elements.coordY.value = Math.round(state.selection.y);
        elements.coordW.value = Math.round(state.selection.w);
        elements.coordH.value = Math.round(state.selection.h);
    } else {
        elements.coordX.value = '';
        elements.coordY.value = '';
        elements.coordW.value = '';
        elements.coordH.value = '';
    }
}

function updateSelectionFromInputs() {
    if (!state.templateImage) return;

    const x = parseInt(elements.coordX.value) || 0;
    const y = parseInt(elements.coordY.value) || 0;
    const w = parseInt(elements.coordW.value) || 100;
    const h = parseInt(elements.coordH.value) || 50;

    // Validate bounds
    const maxX = state.templateImage.width - 20;
    const maxY = state.templateImage.height - 20;

    state.selection = {
        x: Math.max(0, Math.min(x, maxX)),
        y: Math.max(0, Math.min(y, maxY)),
        w: Math.max(20, Math.min(w, state.templateImage.width - x)),
        h: Math.max(20, Math.min(h, state.templateImage.height - y))
    };

    render();
}

// Add event listeners for coordinate inputs
elements.coordX.addEventListener('input', updateSelectionFromInputs);
elements.coordY.addEventListener('input', updateSelectionFromInputs);
elements.coordW.addEventListener('input', updateSelectionFromInputs);
elements.coordH.addEventListener('input', updateSelectionFromInputs);

// =============================================================================
// IMAGE UPLOAD
// =============================================================================

function handleImageUpload(file) {
    if (!file || !file.type.startsWith('image/')) return;

    // Store original file for API upload
    state.templateFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            state.templateImage = img;
            state.selection = null;

            fitImageToCanvas();

            elements.canvasPlaceholder.classList.add('hidden');
            elements.canvas.classList.add('visible');
            elements.templateInfo.textContent = `${file.name} (${img.width}×${img.height})`;
            elements.templateInfo.classList.remove('hidden');

            elements.step1.classList.remove('active');
            elements.step1.classList.add('completed');
            elements.step2.classList.add('active');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function fitImageToCanvas() {
    if (!state.templateImage) return;

    const areaRect = elements.canvasArea.getBoundingClientRect();
    const padding = 48;

    const availableWidth = areaRect.width - padding * 2;
    const availableHeight = areaRect.height - padding * 2;

    const scaleX = availableWidth / state.templateImage.width;
    const scaleY = availableHeight / state.templateImage.height;
    state.displayScale = Math.min(scaleX, scaleY, 1);

    elements.canvas.width = Math.floor(state.templateImage.width * state.displayScale);
    elements.canvas.height = Math.floor(state.templateImage.height * state.displayScale);

    render();
}

// Drop zone events
elements.templateDropZone.addEventListener('click', () => elements.templateInput.click());
elements.templateInput.addEventListener('change', (e) => handleImageUpload(e.target.files[0]));

elements.templateDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.templateDropZone.classList.add('dragover');
});
elements.templateDropZone.addEventListener('dragleave', () => {
    elements.templateDropZone.classList.remove('dragover');
});
elements.templateDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.templateDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleImageUpload(e.dataTransfer.files[0]);
});

// =============================================================================
// DRAWING / SELECTION
// =============================================================================

let activeHandle = null;
let moveStart = null;

function getHoveredHandle(imgX, imgY) {
    if (!state.selection) return null;

    const threshold = HANDLE_SIZE / state.displayScale * 1.5;
    const handles = {
        nw: { x: state.selection.x, y: state.selection.y },
        n: { x: state.selection.x + state.selection.w / 2, y: state.selection.y },
        ne: { x: state.selection.x + state.selection.w, y: state.selection.y },
        e: { x: state.selection.x + state.selection.w, y: state.selection.y + state.selection.h / 2 },
        se: { x: state.selection.x + state.selection.w, y: state.selection.y + state.selection.h },
        s: { x: state.selection.x + state.selection.w / 2, y: state.selection.y + state.selection.h },
        sw: { x: state.selection.x, y: state.selection.y + state.selection.h },
        w: { x: state.selection.x, y: state.selection.y + state.selection.h / 2 }
    };

    for (const key in handles) {
        const h = handles[key];
        if (Math.abs(imgX - h.x) < threshold && Math.abs(imgY - h.y) < threshold) {
            return key;
        }
    }
    return null;
}

function isInsideSelection(imgX, imgY) {
    if (!state.selection) return false;
    const s = state.selection;
    return imgX >= s.x && imgX <= s.x + s.w && imgY >= s.y && imgY <= s.y + s.h;
}

function updateCursor(imgX, imgY) {
    const handle = getHoveredHandle(imgX, imgY);
    if (handle) {
        const cursors = {
            nw: 'nwse-resize', ne: 'nesw-resize', se: 'nwse-resize', sw: 'nesw-resize',
            n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
        };
        elements.canvas.style.cursor = cursors[handle];
    } else if (isInsideSelection(imgX, imgY)) {
        elements.canvas.style.cursor = 'move';
    } else {
        elements.canvas.style.cursor = 'crosshair';
    }
}

elements.canvas.addEventListener('mousedown', (e) => {
    if (!state.templateImage) return;

    const imgCoords = screenToImage(e.clientX, e.clientY);

    const handle = getHoveredHandle(imgCoords.x, imgCoords.y);
    if (handle) {
        activeHandle = handle;
        return;
    }

    if (isInsideSelection(imgCoords.x, imgCoords.y)) {
        moveStart = {
            mouseX: imgCoords.x,
            mouseY: imgCoords.y,
            selX: state.selection.x,
            selY: state.selection.y
        };
        return;
    }

    state.isDrawing = true;
    state.drawStart = { x: imgCoords.x, y: imgCoords.y };
    state.selection = { x: imgCoords.x, y: imgCoords.y, w: 0, h: 0 };
});

elements.canvas.addEventListener('mousemove', (e) => {
    if (!state.templateImage) return;

    const imgCoords = screenToImage(e.clientX, e.clientY);

    if (activeHandle) {
        resizeSelection(imgCoords, activeHandle);
        render();
        updateCoordDisplay();
        return;
    }

    if (moveStart) {
        const dx = imgCoords.x - moveStart.mouseX;
        const dy = imgCoords.y - moveStart.mouseY;
        state.selection.x = moveStart.selX + dx;
        state.selection.y = moveStart.selY + dy;
        render();
        updateCoordDisplay();
        return;
    }

    if (state.isDrawing) {
        const x = Math.min(state.drawStart.x, imgCoords.x);
        const y = Math.min(state.drawStart.y, imgCoords.y);
        const w = Math.abs(imgCoords.x - state.drawStart.x);
        const h = Math.abs(imgCoords.y - state.drawStart.y);

        state.selection = { x, y, w, h };
        render();
        updateCoordDisplay();
        return;
    }

    updateCursor(imgCoords.x, imgCoords.y);
});

window.addEventListener('mouseup', () => {
    if (state.isDrawing) {
        state.isDrawing = false;

        if (state.selection && (state.selection.w < 10 || state.selection.h < 10)) {
            state.selection = null;
        }

        render();
        updateCoordDisplay();

        if (state.selection) {
            elements.step2.classList.remove('active');
            elements.step2.classList.add('completed');
            elements.step3.classList.add('active');
        }
    }

    activeHandle = null;
    moveStart = null;
});

function resizeSelection(imgCoords, handle) {
    const s = state.selection;
    const minSize = 20;

    const right = s.x + s.w;
    const bottom = s.y + s.h;

    if (handle.includes('w')) {
        const newX = Math.min(imgCoords.x, right - minSize);
        s.w = right - newX;
        s.x = newX;
    }
    if (handle.includes('e')) {
        s.w = Math.max(minSize, imgCoords.x - s.x);
    }
    if (handle.includes('n')) {
        const newY = Math.min(imgCoords.y, bottom - minSize);
        s.h = bottom - newY;
        s.y = newY;
    }
    if (handle.includes('s')) {
        s.h = Math.max(minSize, imgCoords.y - s.y);
    }
}

// =============================================================================
// CSV HANDLER
// =============================================================================

function handleCSVUpload(file) {
    if (!file) return;

    // Store original file for API upload
    state.csvFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        const lines = text.split('\n').filter(line => line.trim());

        if (lines.length < 2) {
            showError('CSV file must have at least a header row and one data row.');
            return;
        }

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        state.csvHeaders = headers;

        // Parse data (simple CSV parsing)
        state.csvData = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = values[idx] || '';
            });
            state.csvData.push(row);
        }

        // Populate dropdown
        elements.nameColumnSelect.innerHTML = '';
        let foundName = false;

        headers.forEach(header => {
            const option = document.createElement('option');
            option.value = header;
            option.textContent = header;

            if (!foundName && header.toLowerCase().includes('name')) {
                option.selected = true;
                foundName = true;
            }

            elements.nameColumnSelect.appendChild(option);
        });

        elements.fieldSelectorContainer.classList.remove('hidden');
        elements.recordsCount.textContent = `✓ ${state.csvData.length} records loaded`;

        elements.step3.classList.remove('active');
        elements.step3.classList.add('completed');
        elements.step4.classList.add('active');
        elements.generateBtn.disabled = false;

        hideError();
    };
    reader.readAsText(file);
}

elements.csvDropZone.addEventListener('click', () => elements.csvInput.click());
elements.csvInput.addEventListener('change', (e) => handleCSVUpload(e.target.files[0]));

elements.csvDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.csvDropZone.classList.add('dragover');
});
elements.csvDropZone.addEventListener('dragleave', () => {
    elements.csvDropZone.classList.remove('dragover');
});
elements.csvDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.csvDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleCSVUpload(e.dataTransfer.files[0]);
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorMessage.classList.remove('hidden');
}

function hideError() {
    elements.errorMessage.classList.add('hidden');
}

// =============================================================================
// CERTIFICATE GENERATION (API CALL)
// =============================================================================

elements.generateBtn.addEventListener('click', async () => {
    if (!state.templateFile || !state.csvFile || !state.selection) {
        showError('Please complete all steps first.');
        return;
    }

    if (!state.apiOnline) {
        showError('API is offline. Please ensure the backend server is running.');
        return;
    }

    hideError();

    const originalText = elements.generateBtn.innerHTML;
    elements.generateBtn.innerHTML = '<span>Generating...</span>';
    elements.generateBtn.disabled = true;
    elements.progressBar.classList.remove('hidden');
    elements.progressFill.style.width = '50%'; // Indeterminate progress

    try {
        const formData = new FormData();
        formData.append('template', state.templateFile);
        formData.append('csv_file', state.csvFile);
        formData.append('name_column', elements.nameColumnSelect.value);
        formData.append('box_x', Math.round(state.selection.x));
        formData.append('box_y', Math.round(state.selection.y));
        formData.append('box_w', Math.round(state.selection.w));
        formData.append('box_h', Math.round(state.selection.h));
        formData.append('font_size', elements.fontSizeInput.value);
        formData.append('font_color', elements.fontColorInput.value);
        formData.append('font_file', elements.fontSelect.value);

        const response = await fetch(`${API_BASE_URL}/generate`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Generation failed');
        }

        // Get the zip file
        const blob = await response.blob();
        const generatedCount = response.headers.get('X-Generated-Count') || '?';

        // Download the file
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'certificates.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

        elements.progressFill.style.width = '100%';

        setTimeout(() => {
            alert(`Successfully generated ${generatedCount} certificates!`);
        }, 100);

    } catch (error) {
        showError(`Error: ${error.message}`);
    } finally {
        elements.generateBtn.innerHTML = originalText;
        elements.generateBtn.disabled = false;
        elements.progressBar.classList.add('hidden');
        elements.progressFill.style.width = '0%';
    }
});

// =============================================================================
// RESET
// =============================================================================

elements.resetBtn.addEventListener('click', () => {
    if (confirm('Reset everything and start over?')) {
        location.reload();
    }
});

// =============================================================================
// WINDOW RESIZE
// =============================================================================

window.addEventListener('resize', () => {
    if (state.templateImage) {
        fitImageToCanvas();
    }
});

// =============================================================================
// LIVE PREVIEW UPDATES
// =============================================================================

// Handle preview toggle
elements.previewToggle.addEventListener('change', () => {
    const enabled = elements.previewToggle.checked;

    if (enabled) {
        elements.previewInputGroup.classList.add('enabled');
        elements.previewTextInput.disabled = false;
        elements.previewTextInput.focus();
    } else {
        elements.previewInputGroup.classList.remove('enabled');
        elements.previewTextInput.disabled = true;
    }

    render();
});

// Re-render when preview text changes
elements.previewTextInput.addEventListener('input', () => {
    render();
});

// Re-render when font size changes
elements.fontSizeInput.addEventListener('input', () => {
    render();
});

// Re-render when font color changes
elements.fontColorInput.addEventListener('input', () => {
    render();
});

// Re-render when font selection changes
elements.fontSelect.addEventListener('change', () => {
    render();
});

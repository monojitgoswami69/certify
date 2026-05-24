# Certify Demo

Certify Demo is a sophisticated, client-side application engineered for the efficient generation of bulk certificates. Built with React and TypeScript, this tool operates entirely within the browser, eliminating the need for backend infrastructure while ensuring data privacy and rapid processing.

## Overview

This application addresses the need for a streamlined, secure, and scalable solution for generating personalized documents. By leveraging modern web technologies, it allows users to map dynamic data from CSV files onto custom image templates, rendering high-fidelity certificates in both raster (JPG/PNG) and vector (PDF) formats entirely in the browser.

## Key Features

- **Client-Side Processing:** All data manipulation and image generation occur locally on the user's machine for maximum privacy.
- **Batch Processing:** Handles large datasets via CSV import, generating hundreds to thousands of unique certificates in a single workflow.
- **Typography Engine:** Integrated with the Google Fonts library, offering access to over 1,200 typefaces for precise design control.
- **Interactive Editor:** Features a drag-and-drop interface for intuitive field positioning and styling.
- **Archive Generation:** Automatically bundles generated assets into a structured ZIP file for convenient download.
- **Deduplication:** Skips duplicate certificates when the mapped (printed) fields are identical.
- **Chunked Output:** Large batches are split into multiple ZIP parts (about 1 GB each) per format to keep memory usage bounded.
- **Resilience:** Includes robust error handling and a retry mechanism to ensure process completion without data loss.

## Technical Stack

The project utilizes a modern suite of technologies designed for performance and maintainability:

- **Core:** React 19, TypeScript
- **Build System:** Vite
- **State Management:** Zustand
- **Styling:** Tailwind CSS 4
- **Graphics & PDF:** HTML5 Canvas, jsPDF
- **Compression:** client-zip

## Getting Started

### Prerequisites

Ensure you have the following installed on your development environment:

- Node.js (Version 18 or higher recommended)
- npm or yarn package manager

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   ```

2. Navigate to the project directory:
   ```bash
   cd certify
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

### Development

To start the local development server:

```bash
npm run dev
```

The application will be accessible at `http://localhost:5173`.

### Production Build

To compile the application for production deployment:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## Usage Guide

1. **Template Upload:** Begin by creating a base certificate design in your preferred graphics software. Upload this image (JPG, PNG, or WebP) to the application.
2. **Data Import:** Upload a CSV file containing the variable data (e.g., names, dates, course titles). Ensure the first row contains unique headers.
3. **Layout Configuration:** Use the interactive canvas to draw text zones. Map these zones to the corresponding columns in your CSV file.
4. **Styling:** Customize the typography, size, color, and alignment for each data field to match your brand guidelines.
5. **Generation:** Initiate the batch process. The application will render each certificate and compile them into a downloadable ZIP archive.
   - If multiple rows produce identical values for the mapped fields, only one certificate is generated.
   - Large runs may download as multiple ZIP parts per format.

## Project Structure

```
certify/
├── public/                 # Static assets and font metadata
├── src/
│   ├── components/         # Reusable UI components
│   ├── lib/                # Core logic for generation and fonts
│   ├── store/              # State management configuration
│   ├── types/              # TypeScript definitions
│   ├── App.tsx             # Main application entry
│   └── main.tsx            # DOM rendering
├── package.json            # Dependency manifest
└── vite.config.ts          # Build configuration
```

## Deployment

This application is static and can be deployed to any standard web hosting service.

### Static Hosting

After running `npm run build`, the contents of the `dist/` directory can be served via:
- Netlify
- GitHub Pages
- AWS S3 / CloudFront
- Nginx / Apache

## Browser Notes

- Chrome/Edge/Brave support streaming ZIP writes via the File System Access API; Firefox/Safari fall back to in-memory ZIP creation.
- Worker count is capped to avoid browser JPEG encoder saturation; lower caps can reduce throughput on high-core CPUs.

## License

This project is distributed under the GNU General Public License v3 (GPL-3.0). See [LICENSE](LICENSE) for details.

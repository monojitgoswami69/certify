# Certify Demo

A **fully client-side** certificate generation tool built with React and TypeScript. Generate personalized certificates in bulk directly in your browser — no backend required.

## ✨ Features

- **100% Browser-Based** — No server required, all processing happens locally
- **Batch Generation** — Generate hundreds of certificates from a CSV file
- **Google Fonts** — Access to 1,200+ fonts via Google Fonts CDN
- **Interactive Canvas** — Drag & drop text box positioning
- **ZIP Download** — Certificates bundled as JPG + PDF in a ZIP file
- **Pause & Resume** — Control batch generation with pause/resume/cancel
- **Retry Failed** — Automatically retry failed generations
- **Live Preview** — See font styling and positioning in real-time

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ (recommended: 20+)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd certify-demo/frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run preview  # Preview production build
```

## 📖 How to Use

### Step 1: Upload Template
Upload a certificate template image (JPG, PNG, or WebP). This is your base design with placeholders for dynamic text.

### Step 2: Import Data
Upload a CSV file with recipient information. The first row should contain column headers (e.g., `Name`, `Email`, `Course`, `Date`).

**Example CSV:**
```csv
Name,Course,Date,Certificate ID
John Doe,Web Development,2025-01-15,CERT-001
Jane Smith,Data Science,2025-01-15,CERT-002
```

### Step 3: Define Text Boxes
Click and drag on the canvas to create text boxes. Each box represents a field from your CSV that will be placed on the certificate.

### Step 4: Customize Styling
For each text box, configure:
- **Field** — Select which CSV column to use
- **Font** — Choose from 1,200+ Google Fonts
- **Size** — Font size in pixels
- **Color** — Text color (hex or picker)
- **Alignment** — Horizontal (left/center/right) and vertical (top/middle/bottom)
- **Auto-fit** — Automatically shrink text to fit within box bounds

### Step 5: Generate & Download
Click "Generate Certificates" to process all rows. Certificates are:
- Generated as both JPG and PDF
- Bundled into a ZIP file
- Automatically downloaded when complete

## 🏗️ Project Structure

```
frontend/
├── public/
│   └── google-fonts.json      # Font metadata (1,200+ fonts)
├── src/
│   ├── components/
│   │   ├── BoxCustomizer.tsx  # Text box property editor
│   │   ├── Canvas.tsx         # Interactive canvas for positioning
│   │   ├── CsvUpload.tsx      # CSV file upload & parsing
│   │   ├── FontSelector.tsx   # Virtualized font dropdown
│   │   ├── GenerateButton.tsx # Batch generation with progress
│   │   ├── TemplateUpload.tsx # Template image upload
│   │   ├── StepCard.tsx       # Step indicator UI
│   │   └── ...
│   ├── lib/
│   │   ├── certificateGenerator.ts  # Core generation logic
│   │   ├── googleFonts.ts           # Font loading & search
│   │   └── utils.ts                 # Helper functions
│   ├── store/
│   │   └── appStore.ts        # Zustand state management
│   ├── types/
│   │   └── index.ts           # TypeScript definitions
│   ├── App.tsx                # Main application
│   └── main.tsx               # Entry point
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 🔧 Technology Stack

| Technology | Purpose |
|------------|---------|
| **React 19** | UI framework |
| **TypeScript** | Type safety |
| **Vite** | Build tool & dev server |
| **Zustand** | Lightweight state management |
| **Tailwind CSS 4** | Utility-first styling |
| **jsPDF** | Client-side PDF generation |
| **JSZip** | ZIP file creation |
| **Lucide React** | Icon library |
| **HTML5 Canvas** | Certificate rendering |

## 🎨 Font System

The app uses Google Fonts CDN for instant font loading:

1. **Pre-loaded Metadata** — `google-fonts.json` contains metadata for 1,200+ fonts
2. **On-Demand Loading** — Fonts are loaded only when selected
3. **Curated Defaults** — Popular fonts are prioritized in the dropdown
4. **Search & Filter** — Quickly find fonts by name
5. **Live Preview** — See fonts applied to canvas in real-time

### Adding Custom Fonts

To add custom fonts, you can:

1. Place font files in `public/fonts/`
2. Reference them in a CSS `@font-face` rule
3. The system will recognize locally available fonts

## 📋 CSV Requirements

- **Format**: Standard CSV with comma separation
- **Headers**: First row must contain column names
- **Encoding**: UTF-8 recommended
- **Fields**: Any number of columns; map them to text boxes

### Example Templates

**Event Certificate:**
```csv
Name,Event,Date,Location
John Doe,Tech Conference 2025,January 15,San Francisco
```

**Course Completion:**
```csv
Name,Course,Hours,Instructor,Certificate ID
Jane Smith,Python Basics,40,Dr. Johnson,CERT-2025-001
```

## ⚙️ Configuration

### Environment Variables

No environment variables are required — the app runs entirely in the browser.

### Customization

Edit `tailwind.config.js` to customize the theme:

```javascript
theme: {
  extend: {
    colors: {
      primary: {
        // Your custom primary color palette
      }
    }
  }
}
```

## 🚢 Deployment

### Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

A `vercel.json` is included for optimal configuration.

### Static Hosting

Build and deploy the `dist/` folder to any static hosting:
- Netlify
- GitHub Pages
- Cloudflare Pages
- AWS S3 + CloudFront

## 🐛 Troubleshooting

### Fonts not loading
- Check your internet connection (fonts load from Google CDN)
- Ensure the font exists in `google-fonts.json`
- Try a different browser

### Large CSV files slow to process
- Consider splitting into smaller batches
- Use the pause/resume feature to manage memory
- Close other browser tabs to free resources

### PDF generation issues
- Ensure the template image is not corrupted
- Try a smaller image size (under 5MB recommended)
- Check browser console for specific errors

## 📝 License

MIT License — feel free to use for personal or commercial projects.

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

Built with ❤️ using React, TypeScript, and modern web APIs.

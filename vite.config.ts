
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es', // Use ES modules for workers (required for code-splitting)
  },
  server: {
    port: 3000,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy vendor libs for better caching
          'vendor-pdf': ['jspdf'],
          'vendor-csv': ['papaparse'],
        },
      },
    },
  },
  // jsPDF pulls in html2canvas + dompurify for its html() method.
  // We only use addImage(), so stub them out to save ~250KB.
  resolve: {
    alias: {
      'html2canvas': '/dev/null',
      'dompurify': '/dev/null',
    },
  },
})

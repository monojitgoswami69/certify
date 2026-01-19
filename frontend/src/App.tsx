import { useEffect, useState } from 'react';
import { FileSpreadsheet, Eye, EyeOff, X, Image, Loader2 } from 'lucide-react';
import { StepCard } from './components/StepCard';
import { TemplateUpload } from './components/TemplateUpload';
import { CsvUpload } from './components/CsvUpload';
import { BoxCustomizer } from './components/BoxCustomizer';
import { Canvas } from './components/Canvas';
import { GenerateButton } from './components/GenerateButton';
import { EmailSidebar } from './components/EmailSidebar';
import { EmailPreviewPane } from './components/EmailPreviewPane';
import { CsvPreviewPopup } from './components/CsvPreviewPopup';
import { useAppStore } from './store/appStore';
import { checkApiHealth, fetchFonts } from './lib/api';

// Mobile detection - show desktop-only message
function MobileOverlay() {
  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6 lg:hidden">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-white mb-3">
          Desktop Experience Required
        </h1>
        <p className="text-slate-300 mb-6 leading-relaxed">
          This certificate designer requires a larger screen for the best experience.
          The canvas-based design tools and multi-step workflow are optimized for desktop use.
        </p>
        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <p className="text-sm text-slate-400">
            Please open this page on a <span className="text-white font-medium">desktop or laptop computer</span> with a screen width of at least 1024px.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const {
    templateImage,
    templateFile,
    boxes,
    csvData,
    csvFile,
    viewMode,
    error,
    previewEnabled,
    setApiStatus,
    setFonts,
    setPreviewEnabled,
    clearTemplate,
    clearCsvData,
  } = useAppStore();

  const [showCsvPreview, setShowCsvPreview] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Check screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Determine step statuses based on completion
  const step1Complete = !!templateImage;
  const step2Complete = csvData.length > 0;
  const step3Complete = boxes.length > 0;
  const validBoxes = boxes.filter(b => b.field);
  const step4Complete = validBoxes.length > 0;

  const step1Status = step1Complete ? 'completed' : 'active';
  const step2Status = !step1Complete ? 'pending' : step2Complete ? 'completed' : 'active';
  const step3Status = !step2Complete ? 'pending' : step3Complete ? 'completed' : 'active';
  const step4Status = !step3Complete ? 'pending' : step4Complete ? 'completed' : 'active';
  const step5Status = !step4Complete ? 'pending' : 'active';

  // Initialize API connection once
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const online = await checkApiHealth();
        if (!mounted) return;

        setApiStatus(online);

        if (online) {
          const fonts = await fetchFonts();
          if (mounted) setFonts(fonts);
        }
      } catch (err) {
        // Log error but continue - app can still work partially
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to initialize:', err);
        }
      } finally {
        if (mounted) setInitializing(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [setApiStatus, setFonts]);

  // Show loading state during initialization
  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-3" />
          <p className="text-slate-600">Connecting to server...</p>
        </div>
      </div>
    );
  }

  // Show mobile overlay on small screens
  if (isMobile) {
    return <MobileOverlay />;
  }

  // Email mode view
  if (viewMode === 'email') {
    return (
      <div className="h-screen flex flex-col bg-slate-50">
        <main className="flex-1 flex overflow-hidden">
          <EmailSidebar />
          <EmailPreviewPane />
        </main>
      </div>
    );
  }

  // Certificate mode view (default)
  return (
    <div className="h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-[420px] bg-white border-r border-slate-200 overflow-y-auto p-4 space-y-4 flex-shrink-0">
        {/* Step 1: Upload Template */}
        <StepCard number={1} title="Upload Template" status={step1Status}>
          {templateImage ? (
            <div
              className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-default group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Image className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm text-slate-700 truncate">
                  {templateFile?.name || 'Template'}
                </span>
              </div>
              <button
                onClick={clearTemplate}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <TemplateUpload />
          )}
        </StepCard>

        {/* Step 2: Import Data */}
        <StepCard number={2} title="Import Data" status={step2Status}>
          {csvData.length > 0 ? (
            <div
              className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors group"
              onClick={() => setShowCsvPreview(true)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span className="text-sm text-slate-700 truncate">
                  {csvFile?.name || 'Data'} ({csvData.length} records)
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearCsvData();
                }}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <CsvUpload />
          )}
        </StepCard>

        {/* Step 3: Define Text Areas */}
        <StepCard number={3} title="Define Text Areas" status={step3Status}>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Draw rectangles on the template where text should appear.
            </p>

            {/* Preview Toggle */}
            <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-600">Preview Data</span>
              <button
                onClick={() => setPreviewEnabled(!previewEnabled)}
                className={`p-1.5 rounded-md transition-colors ${previewEnabled
                  ? 'bg-primary-100 text-primary-600'
                  : 'bg-slate-200 text-slate-500'
                  }`}
              >
                {previewEnabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </StepCard>

        {/* Step 4: Customize Box */}
        <StepCard number={4} title="Customize Box" status={step4Status}>
          <BoxCustomizer />
        </StepCard>

        {/* Step 5: Generate */}
        <StepCard number={5} title="Generate & Deliver" status={step5Status}>
          <GenerateButton />
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}
        </StepCard>
      </aside>

      {/* Canvas Area */}
      <Canvas />

      {/* CSV Preview Popup */}
      <CsvPreviewPopup
        isOpen={showCsvPreview}
        onClose={() => setShowCsvPreview(false)}
      />
    </div>
  );
}

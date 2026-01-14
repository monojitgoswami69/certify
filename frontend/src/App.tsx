import { useEffect } from 'react';
import { Header } from './components/Header';
import { StepCard } from './components/StepCard';
import { TemplateUpload } from './components/TemplateUpload';
import { CsvUpload } from './components/CsvUpload';
import { CoordinateInputs } from './components/CoordinateInputs';
import { StyleControls } from './components/StyleControls';
import { Canvas } from './components/Canvas';
import { GenerateButton } from './components/GenerateButton';
import { useAppStore } from './store/appStore';
import { checkApiHealth, fetchFonts } from './lib/api';

export default function App() {
  const {
    templateImage,
    templateInfo,
    selection,
    csvHeaders,
    csvData,
    selectedColumn,
    error,
    setApiStatus,
    setFonts,
    setSelectedColumn,
  } = useAppStore();

  // Determine step statuses
  const step1Status = templateImage ? 'completed' : 'active';
  const step2Status = !templateImage ? 'pending' : selection ? 'completed' : 'active';
  const step3Status = !selection ? 'pending' : csvData.length > 0 ? 'completed' : 'active';
  const step4Status = csvData.length === 0 ? 'pending' : 'active';

  // Initialize API connection once
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const online = await checkApiHealth();
      if (!mounted) return;

      setApiStatus(online);

      if (online) {
        try {
          const fonts = await fetchFonts();
          if (mounted) setFonts(fonts);
        } catch (err) {
          console.error('Failed to load fonts:', err);
        }
      }
    };

    init();
    return () => { mounted = false; };
  }, [setApiStatus, setFonts]);

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <Header />

      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[400px] bg-white border-r border-slate-200 overflow-y-auto p-4 space-y-4 flex-shrink-0">
          {/* Step 1: Upload Template */}
          <StepCard number={1} title="Upload Template" status={step1Status}>
            {templateImage ? (
              <p className="text-sm text-emerald-600 font-medium">✓ {templateInfo}</p>
            ) : (
              <TemplateUpload />
            )}
          </StepCard>

          {/* Step 2: Define Name Area */}
          <StepCard number={2} title="Define Name Area" status={step2Status}>
            <p className="text-sm text-slate-500 mb-3">
              Click and drag on the template to draw a rectangle where names will appear.
            </p>
            <CoordinateInputs />
          </StepCard>

          {/* Step 3: Import Data */}
          <StepCard number={3} title="Import Data" status={step3Status}>
            {csvData.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Name Column</label>
                  <select
                    value={selectedColumn}
                    onChange={(e) => setSelectedColumn(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                  >
                    {csvHeaders.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
                <p className="text-sm text-emerald-600 font-medium">
                  ✓ {csvData.length} records loaded
                </p>
              </div>
            ) : (
              <CsvUpload />
            )}
          </StepCard>

          {/* Step 4: Customize & Generate */}
          <StepCard number={4} title="Customize & Generate" status={step4Status}>
            <StyleControls />
            <div className="mt-4">
              <GenerateButton />
            </div>
            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}
          </StepCard>
        </aside>

        {/* Canvas Area */}
        <Canvas />
      </main>
    </div>
  );
}

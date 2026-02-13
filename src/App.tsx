/**
 * Certificate Generator App
 * 
 * A client-side certificate generation tool that allows users to:
 * 1. Upload a certificate template image
 * 2. Import CSV data with names and other fields
 * 3. Define text areas on the template
 * 4. Customize fonts, sizes, and colors
 * 5. Generate and download certificates as JPG/PDF
 * 
 * No backend required - all processing happens in the browser.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { FileSpreadsheet, Eye, EyeOff, X, Image, RotateCcw, ArrowLeft } from 'lucide-react';
import { StepCard } from './components/StepCard';
import { TemplateUpload } from './components/TemplateUpload';
import { CsvUpload } from './components/CsvUpload';
import { BoxCustomizer } from './components/BoxCustomizer';
import { Canvas } from './components/Canvas';
import { GenerateButton } from './components/GenerateButton';
import { CsvPreviewPopup } from './components/CsvPreviewPopup';
import { useAppStore } from './store/appStore';
import { initializeGoogleFonts, preloadFonts, getPopularFonts } from './lib/googleFonts';
import { LandingPage } from './components/LandingPage';

// =============================================================================
// Mobile Overlay Component
// =============================================================================



// =============================================================================
// Main Application Component
// =============================================================================

export default function App() {
    const {
        templateImage,
        templateFile,
        boxes,
        csvData,
        csvFile,
        error,
        previewEnabled,
        workerCount,
        generationStatus,
        setFonts,
        setPreviewEnabled,
        setWorkerCount,
        clearTemplate,
        clearCsvData,
        outputFormats,
        setOutputFormats,
        reset,
    } = useAppStore();

    const [showCsvPreview, setShowCsvPreview] = useState(false);
    const [currentView, setCurrentView] = useState<'landing' | 'editor'>('landing');
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [transitionStep, setTransitionStep] = useState<'idle' | 'exiting' | 'entering' | 'exiting-back' | 'entering-back'>('idle');

    type OutputFormat = 'png' | 'jpg' | 'pdf';

    const handleStart = async () => {
        if (isTransitioning) return;

        // Push history state so browser back button works
        window.history.pushState({ view: 'editor' }, '');

        setIsTransitioning(true);
        setTransitionStep('exiting');

        await new Promise(r => setTimeout(r, 700));

        setCurrentView('editor');
        setTransitionStep('entering');

        await new Promise(r => setTimeout(r, 800));

        setIsTransitioning(false);
        setTransitionStep('idle');
    };

    const handleExit = useCallback(async () => {
        if (isTransitioning || currentView === 'landing') return;

        setIsTransitioning(true);
        setTransitionStep('exiting-back');

        await new Promise(r => setTimeout(r, 700));

        setCurrentView('landing');
        setTransitionStep('entering-back');

        await new Promise(r => setTimeout(r, 800));

        setIsTransitioning(false);
        setTransitionStep('idle');
    }, [isTransitioning, currentView]);

    // Keep a stable ref to handleExit for the popstate listener
    const handleExitRef = useRef(handleExit);
    useEffect(() => {
        handleExitRef.current = handleExit;
    }, [handleExit]);

    // Listen for browser back button
    useEffect(() => {
        const onPopState = (e: PopStateEvent) => {
            if (currentView === 'editor' && (!e.state || e.state.view !== 'editor')) {
                handleExitRef.current();
            }
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [currentView]);

    // Get max workers — capped to half of reported cores (browser JPEG pool saturates at ~half)
    const maxWorkers = typeof navigator !== 'undefined'
        ? Math.max(2, Math.min(Math.floor((navigator.hardwareConcurrency || 4) / 2), 16))
        : 4;


    // Load Google Fonts on mount
    useEffect(() => {
        initializeGoogleFonts().then((fonts) => {
            setFonts(fonts);

            // Preload popular fonts for instant availability
            const popularFonts = getPopularFonts();
            preloadFonts(popularFonts.map(f => f.family));
        });
    }, [setFonts]);

    // Determined step status...
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

    if (currentView === 'landing') {
        const landingClasses = transitionStep === 'exiting'
            ? 'animate-page-out'
            : transitionStep === 'entering-back'
                ? 'animate-back-in'
                : '';
        return (
            <div className={landingClasses}>
                <LandingPage onStart={handleStart} />
            </div>
        );
    }



    const editorClasses = transitionStep === 'entering'
        ? 'animate-page-in'
        : transitionStep === 'exiting-back'
            ? 'animate-back-out'
            : '';

    const brandingHeaderContent = (
        <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
                <button
                    onClick={handleExit}
                    className="p-1.5 -ml-1 hover:bg-slate-100 rounded-lg transition-colors group cursor-pointer"
                    title="Exit to Landing Page"
                >
                    <ArrowLeft className="w-5 h-5 text-slate-400 group-hover:text-slate-600" />
                </button>
                <div className="flex items-center gap-2">
                    <img src="/certify-logo.webp" alt="Certify Logo" className="w-7 h-7 object-contain" />
                    <div className="flex flex-col">
                        <span
                            className="font-bold tracking-tight text-slate-800 leading-none"
                            style={{ fontFamily: "'Nova Mono', monospace", fontSize: '18px' }}
                        >
                            CERTIFY
                        </span>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                            Mass Generator
                        </p>
                    </div>
                </div>
            </div>

            <button
                onClick={reset}
                title="Reset all progress"
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all active:scale-95 cursor-pointer"
            >
                <RotateCcw className="w-5 h-5" />
            </button>
        </div>
    );

    const stepListContent = (
        <>
            {/* Step 1: Upload Template */}
            <StepCard number={1} title="Upload Template" status={step1Status}>
                {templateImage ? (
                    <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg cursor-default group">
                        <div className="flex items-center gap-2 min-w-0">
                            <Image className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <span className="text-sm text-slate-700 truncate">
                                {templateFile?.name || 'Template'}
                            </span>
                        </div>
                        <button
                            onClick={clearTemplate}
                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 cursor-pointer"
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
                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0 cursor-pointer"
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
                    <p className="text-sm text-slate-500 font-bold">
                        Draw rectangles on the template where text should appear.
                    </p>

                    {/* Preview Toggle */}
                    <div className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                        <span className="text-sm text-slate-600 font-medium">Preview with data</span>
                        <button
                            onClick={() => setPreviewEnabled(!previewEnabled)}
                            className={`p-1.5 rounded-md transition-colors cursor-pointer ${previewEnabled
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
            <StepCard number={5} title="Download Certificates" status={step5Status}>
                {/* Format Selector */}
                <div className="mb-4 p-3 bg-slate-50 rounded-2xl border border-slate-200">
                    <label className="block text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-widest text-center">Output Formats</label>
                    <div className="grid grid-cols-3 gap-1 p-1 bg-white border border-slate-200 rounded-xl">
                        {['png', 'jpg', 'pdf'].map((fmt) => {
                            const isSelected = outputFormats.includes(fmt as OutputFormat);
                            return (
                                <div
                                    key={fmt}
                                    role="checkbox"
                                    aria-checked={isSelected}
                                    aria-label={`Output format: ${fmt.toUpperCase()}`}
                                    tabIndex={0}
                                    onClick={() => {
                                        const newFormats = isSelected
                                            ? outputFormats.filter(f => f !== fmt)
                                            : [...outputFormats, fmt as OutputFormat];
                                        setOutputFormats(newFormats);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            const newFormats = isSelected
                                                ? outputFormats.filter(f => f !== fmt)
                                                : [...outputFormats, fmt as OutputFormat];
                                            setOutputFormats(newFormats);
                                        }
                                    }}
                                    className={`flex items-center justify-center gap-1.5 py-2 px-1 rounded-lg transition-all duration-300 cursor-pointer ${isSelected
                                        ? 'bg-primary-50 ring-1 ring-primary-200'
                                        : 'hover:bg-slate-50'
                                        }`}
                                >
                                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${isSelected
                                        ? 'bg-primary-600 border-primary-600'
                                        : 'bg-white border-slate-400'
                                        }`}>
                                        {isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full animate-fade-in" />}
                                    </div>
                                    <span
                                        className={`text-[10px] font-black uppercase tracking-tight transition-colors ${isSelected ? 'text-primary-700' : 'text-slate-900'}`}
                                    >
                                        {fmt}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-[9px] text-slate-500 mt-2 italic text-center opacity-70 font-bold">Select at least one format</p>
                </div>

                {/* Worker count selector - only show when idle */}
                {generationStatus === 'idle' && (
                    <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-slate-700">Parallel Workers</span>
                            <span className="text-sm font-medium text-primary-600">{workerCount}</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max={maxWorkers}
                            value={workerCount}
                            onChange={(e) => setWorkerCount(parseInt(e.target.value))}
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
                        />
                        <div className="flex justify-between text-xs text-slate-400 mt-1">
                            <span>1</span>
                            <span>{maxWorkers}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2 text-center w-full">
                            {workerCount === 1
                                ? 'Single worker mode - lower resource usage'
                                : `${workerCount} workers - faster but uses more resources`
                            }
                        </p>
                    </div>
                )}

                <GenerateButton />
                {error && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                        {error}
                    </div>
                )}
            </StepCard>
        </>
    );

    return (
        <div className={`h-screen flex flex-col lg:flex-row bg-slate-50 transition-all duration-700 ${editorClasses} overflow-hidden`}>
            {/* Desktop Sidebar (Left) */}
            <aside className="hidden lg:flex flex-col w-[420px] bg-white border-r border-slate-200 overflow-y-auto px-5 py-4 space-y-4 flex-shrink-0">
                <div className="pb-4 border-b border-slate-100 mb-2">
                    {brandingHeaderContent}
                </div>
                {stepListContent}
            </aside>

            {/* Main Content Area (Canvas top, Header top on mobile, Steps bottom on mobile) */}
            <main className="flex-1 block overflow-y-auto lg:overflow-hidden relative bg-slate-50">
                {/* Mobile Header (Sticky top) */}
                <div className="lg:hidden sticky top-0 z-[60] bg-white border-b border-slate-200 px-[10px] py-3 h-14 flex items-center shadow-sm">
                    {brandingHeaderContent}
                </div>

                {/* Canvas - order 1 on mobile */}
                <div
                    className="sticky top-14 z-[50] lg:static flex-shrink-0 w-full lg:flex-1 h-auto lg:h-full bg-[#F3F4F7] flex flex-col px-[10px] lg:px-5 py-5 lg:py-8 border-b border-slate-200 lg:border-none shadow-sm lg:shadow-none"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(203, 213, 225, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(203, 213, 225, 0.3) 1px, transparent 1px)',
                        backgroundSize: '20px 20px'
                    }}
                >
                    <Canvas />
                </div>

                {/* Mobile Step List - order 2 on mobile */}
                <div className="lg:hidden relative z-[40] px-[10px] py-4 space-y-4 bg-slate-50 pb-20">
                    {stepListContent}
                </div>

                {/* CSV Preview Popup */}
                <CsvPreviewPopup
                    isOpen={showCsvPreview}
                    onClose={() => setShowCsvPreview(false)}
                />
            </main>
        </div>
    );
}

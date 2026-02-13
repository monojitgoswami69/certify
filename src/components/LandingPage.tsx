import React from 'react';
import { ArrowRight, Box, Cpu, Download, Globe, ShieldCheck, Zap, Github } from 'lucide-react';

interface LandingPageProps {
    onStart: () => void;
}

export const LandingPage = React.memo(({ onStart }: LandingPageProps) => {
    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-primary-100 selection:text-primary-700">
            {/* Navigation */}
            <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <img src="/certify-logo.webp" alt="Certify Logo" className="w-8 h-8 object-contain" />
                    <span
                        className="font-bold tracking-tight text-slate-800"
                        style={{ fontFamily: "'Nova Mono', monospace", fontSize: '22px' }}
                    >
                        CERTIFY
                    </span>
                </div>
            </nav>

            {/* Hero Section */}
            <header className="relative pt-32 pb-12 px-6 overflow-hidden text-center">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full -z-10 pointer-events-none opacity-50">
                    <div className="absolute top-20 left-10 w-96 h-96 bg-primary-200 rounded-full mix-blend-multiply filter blur-3xl animate-drift-fade" />
                    <div className="absolute top-40 right-10 w-96 h-96 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl animate-drift-fade delay-500" />
                </div>

                <div className="max-w-4xl mx-auto space-y-8">
                    <h1 className="text-6xl md:text-7xl font-bold tracking-tight text-slate-900 leading-[1.1] opacity-0 animate-slide-up font-serif">
                        Generate Mass <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 via-indigo-600 to-violet-600">
                            Certificates in Seconds
                        </span>
                    </h1>

                    <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed opacity-0 animate-slide-up delay-100">
                        A powerful, 100% client-side tool to design and batch generate
                        personalized certificates from CSV data. No backend, no sign ins, just pure productivity.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 opacity-0 animate-slide-up delay-200">
                        <button
                            onClick={onStart}
                            className="w-full sm:w-auto px-10 py-5 bg-slate-900 text-white rounded-2xl font-bold text-lg hover:bg-slate-800 hover:shadow-2xl hover:shadow-slate-900/20 transition-all active:scale-95 flex items-center justify-center gap-2 group cursor-pointer"
                        >
                            Get Started Now
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Features Section */}
            <section id="features" className="pb-8 pt-0 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid md:grid-cols-3 gap-5">
                        <FeatureCard
                            icon={<Zap className="w-6 h-6" />}
                            title="Insanely Fast"
                            description="Uses Web Workers for parallel generation. Generate 1,000+ certificates in literal seconds without locking your browser."
                        />
                        <FeatureCard
                            icon={<ShieldCheck className="w-6 h-6" />}
                            title="Private by Design"
                            description="100% client-side. Your template images and recipient data never leave your browser. Perfect for sensitive documents."
                        />
                        <FeatureCard
                            icon={<Download className="w-6 h-6" />}
                            title="Bundle & Export"
                            description="Download everything as a single optimized ZIP file. High-quality JPG and PDF formats supported out of the box."
                        />
                        <FeatureCard
                            icon={<Globe className="w-6 h-6" />}
                            title="Google Fonts"
                            description="Access the entire Google Fonts library (1,000+) instantly. Support for all weights and styles."
                        />
                        <FeatureCard
                            icon={<Box className="w-6 h-6" />}
                            title="Visual Canvas"
                            description="Drag and drop text boxes directly onto your template. Responsive alignment and auto-fitting font sizes."
                        />
                        <FeatureCard
                            icon={<Cpu className="w-6 h-6" />}
                            title="No Server Needed"
                            description="Works offline after the first load. All processing happens in your browser for maximum security."
                        />
                    </div>
                </div>
            </section>

            {/* How to Generate Section */}
            <section className="py-12 px-6 bg-slate-50/50 text-slate-900 overflow-hidden relative border-y border-slate-100">
                <div className="max-w-7xl mx-auto relative z-10">
                    <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-6">
                        <div className="space-y-3">
                            <h2
                                className="font-bold text-primary-600 uppercase tracking-[0.3em] text-sm pl-[5px]"
                                style={{ fontFamily: "'Kode Mono', monospace" }}
                            >
                                Process Workflow
                            </h2>
                            <h3 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-600 font-serif">
                                Simple steps to mass production
                            </h3>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative pl-[3px]">
                        <div className="group relative">
                            <div className="space-y-2">
                                <span className="block text-primary-600 font-mono text-sm tracking-tighter font-bold" style={{ fontFamily: "'Kode Mono', monospace" }}>01. IMPORT</span>
                                <h4 className="text-xl font-bold group-hover:text-primary-700 transition-colors font-square">Upload Template</h4>
                                <p className="text-slate-500 leading-relaxed text-sm">
                                    Start by choosing your certificate design. Supports high-resolution JPG and PNG formats for crisp printing results.
                                </p>
                            </div>
                        </div>

                        <div className="group relative">
                            <div className="space-y-2">
                                <span className="block text-indigo-600 font-mono text-sm tracking-tighter font-bold" style={{ fontFamily: "'Kode Mono', monospace" }}>02. LOAD DATA</span>
                                <h4 className="text-xl font-bold group-hover:text-indigo-700 transition-colors font-square">Connect CSV</h4>
                                <p className="text-slate-500 leading-relaxed text-sm">
                                    Import your recipient list. We automatically detect headers like Name, Rank, and Date for easy mapping.
                                </p>
                            </div>
                        </div>

                        <div className="group relative">
                            <div className="space-y-2">
                                <span className="block text-violet-600 font-mono text-sm tracking-tighter font-bold" style={{ fontFamily: "'Kode Mono', monospace" }}>03. DESIGN</span>
                                <h4 className="text-xl font-bold group-hover:text-violet-700 transition-colors font-square">Live Designer</h4>
                                <p className="text-slate-500 leading-relaxed text-sm">
                                    Drag and drop fields onto the canvas. Adjust fonts, alignments, and colors with a real-time preview of your data.
                                </p>
                            </div>
                        </div>

                        <div className="group relative">
                            <div className="space-y-2">
                                <span className="block text-emerald-600 font-mono text-sm tracking-tighter font-bold" style={{ fontFamily: "'Kode Mono', monospace" }}>04. FINALIZE</span>
                                <h4 className="text-xl font-bold group-hover:text-emerald-700 transition-colors font-square">Mass Export</h4>
                                <p className="text-slate-500 leading-relaxed text-sm">
                                    Download all certificates in seconds. We pack everything into an optimized ZIP file, ready for distribution.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Ready to Generate Section */}
            <section className="py-10 px-6 overflow-hidden bg-white">
                <div
                    className="max-w-5xl mx-auto px-12 py-12 bg-primary-50/50 border border-primary-100 rounded-[3rem] text-center relative group shadow-xl shadow-primary-900/5"
                >
                    <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary-100/50 rounded-full blur-3xl" />
                    <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-indigo-100/50 rounded-full blur-3xl" />

                    <div className="relative z-10 space-y-6">
                        <h2 className="text-4xl md:text-5xl font-bold text-slate-900 font-serif">Ready to generate?</h2>
                        <p className="text-slate-500 text-lg max-w-xl mx-auto leading-relaxed">
                            Join CERTIFY now to generate high-quality certificates at scale in seconds.
                        </p>
                        <button
                            onClick={onStart}
                            className="bg-slate-900 text-white px-10 py-4 rounded-2xl font-bold text-lg hover:bg-slate-800 hover:shadow-2xl hover:shadow-slate-900/20 transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto cursor-pointer"
                        >
                            Get Started
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="py-16 px-6 border-t border-slate-100 bg-slate-50/30">
                <div
                    className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-center gap-6 text-slate-500"
                    style={{ fontFamily: "'Kode Mono', monospace" }}
                >
                    <div className="flex items-center gap-3">
                        <span className="font-bold tracking-tight">© 2026 MONOJIT GOSWAMI</span>
                        <span className="text-slate-300 mx-1">•</span>
                        <a
                            href="https://github.com/monojitgoswami69/certify"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 hover:text-slate-900 transition-all group pointer-events-auto cursor-pointer"
                        >
                            <Github className="w-5 h-5 transition-transform group-hover:scale-110" />
                            <span
                                className="font-bold underline underline-offset-4 decoration-slate-200 group-hover:decoration-slate-900"
                            >
                                CERTIFY
                            </span>
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
});

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
    return (
        <div className="group relative p-6 bg-white rounded-[2rem] border border-slate-300 shadow-sm hover:shadow-2xl hover:shadow-primary-500/10 hover:-translate-y-1 transition-all duration-500">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-[2rem]" />
            <div className="relative z-10">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-primary-600 mb-4 group-hover:bg-primary-600 group-hover:text-white group-hover:rotate-6 transition-all duration-500 shadow-inner">
                    {icon}
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-1.5 group-hover:text-primary-700 transition-colors font-square">
                    {title}
                </h3>
                <p className="text-slate-600 leading-relaxed group-hover:text-slate-700 transition-colors">
                    {description}
                </p>
            </div>
            <div className="absolute bottom-6 right-8 opacity-0 group-hover:opacity-10 scale-0 group-hover:scale-150 transition-all duration-700 pointer-events-none">
                {icon}
            </div>
        </div>
    );
}

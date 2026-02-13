/**
 * FontSelector Component
 * 
 * A modern font selector with:
 * - Instant preview on hover
 * - Search and category filtering
 * - Virtualized list for performance
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, ChevronDown, Check, Loader2 } from 'lucide-react';
import type { FontCategory } from '../types';
import {
    loadGoogleFont,
    isFontLoaded,
    searchFonts,
    initializeGoogleFonts,
    getAllGoogleFonts,
    type GoogleFont
} from '../lib/googleFonts';

// =============================================================================
// Types
// =============================================================================

interface FontSelectorProps {
    value: string;
    onChange: (fontFamily: string) => void;
    onPreview?: (fontFamily: string | null) => void;
    className?: string;
}

// =============================================================================
// Constants
// =============================================================================

const CATEGORIES: { value: FontCategory | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'sans-serif', label: 'Sans' },
    { value: 'serif', label: 'Serif' },
    { value: 'display', label: 'Display' },
    { value: 'handwriting', label: 'Script' },
    { value: 'monospace', label: 'Mono' },
];

const CATEGORY_LABELS: Record<string, string> = {
    'sans-serif': 'Sans',
    'serif': 'Serif',
    'display': 'Display',
    'handwriting': 'Script',
    'monospace': 'Mono',
};

const ITEM_HEIGHT = 32;
const VISIBLE_ITEMS = 5;
const BUFFER_ITEMS = 4;

// =============================================================================
// Font Option Component
// =============================================================================

interface FontOptionProps {
    font: GoogleFont;
    isSelected: boolean;
    isLoading: boolean;
    onSelect: () => void;
    onHover: () => void;
    style: React.CSSProperties;
}

function FontOption({ font, isSelected, isLoading, onSelect, onHover, style }: FontOptionProps) {
    useEffect(() => {
        if (!isFontLoaded(font.family)) {
            loadGoogleFont(font.family);
        }
    }, [font.family]);

    return (
        <button
            type="button"
            onClick={onSelect}
            onMouseEnter={onHover}
            data-font-family={font.family}
            style={style}
            className={`
                absolute w-full px-3 text-left flex items-center justify-between gap-2
                ${isSelected
                    ? 'bg-primary-100 text-primary-700'
                    : 'hover:bg-slate-100 text-slate-700'}
            `}
        >
            <span
                className="text-sm truncate flex-1"
                style={{ fontFamily: `"${font.family}", system-ui` }}
            >
                {font.family}
            </span>

            <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                    {CATEGORY_LABELS[font.category] || font.category}
                </span>
                {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 text-primary-500 animate-spin" />
                ) : isSelected ? (
                    <Check className="w-3.5 h-3.5 text-primary-600" />
                ) : null}
            </div>
        </button>
    );
}

// =============================================================================
// Main Component
// =============================================================================

export function FontSelector({ value, onChange, onPreview, className = '' }: FontSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<FontCategory | 'all'>('all');
    const [loadingFont, setLoadingFont] = useState<string | null>(null);
    const [isLoadingFontList, setIsLoadingFontList] = useState(true);
    const [availableFonts, setAvailableFonts] = useState<GoogleFont[]>(getAllGoogleFonts());
    const [scrollTop, setScrollTop] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Initialize Google Fonts list
    useEffect(() => {
        let cancelled = false;

        initializeGoogleFonts().then((fonts) => {
            if (!cancelled) {
                setAvailableFonts(fonts);
                setIsLoadingFontList(false);
            }
        });

        return () => { cancelled = true; };
    }, []);

    // Load selected font
    useEffect(() => {
        if (value) {
            loadGoogleFont(value);
        }
    }, [value]);

    // Filter fonts
    const filteredFonts = useMemo(() => {
        let fonts = availableFonts;

        if (category !== 'all') {
            fonts = fonts.filter(f => f.category === category);
        }

        if (search.trim()) {
            fonts = searchFonts(search, fonts);
        }

        return fonts;
    }, [search, category, availableFonts]);

    // Virtualization calculations
    const listHeight = VISIBLE_ITEMS * ITEM_HEIGHT;
    const totalHeight = filteredFonts.length * ITEM_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_ITEMS);
    const endIndex = Math.min(
        filteredFonts.length,
        Math.ceil((scrollTop + listHeight) / ITEM_HEIGHT) + BUFFER_ITEMS
    );
    const visibleFonts = filteredFonts.slice(startIndex, endIndex);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    // Scroll to selected font when opened
    useEffect(() => {
        if (isOpen && value && listRef.current) {
            const selectedIndex = filteredFonts.findIndex(f => f.family === value);
            if (selectedIndex >= 0) {
                // Use requestAnimationFrame to ensure DOM is ready
                requestAnimationFrame(() => {
                    if (listRef.current) {
                        const scrollPos = Math.max(0, (selectedIndex - Math.floor(VISIBLE_ITEMS / 2)) * ITEM_HEIGHT);
                        listRef.current.scrollTop = scrollPos;
                        setScrollTop(scrollPos);
                    }
                });
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]); // Only run when isOpen changes to true

    const handleCategoryChange = (newCategory: FontCategory | 'all') => {
        setCategory(newCategory);
        if (listRef.current) {
            listRef.current.scrollTop = 0;
            setScrollTop(0);
        }
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
        if (listRef.current) {
            listRef.current.scrollTop = 0;
            setScrollTop(0);
        }
    };

    const handleSelect = useCallback((font: GoogleFont) => {
        setLoadingFont(font.family);
        loadGoogleFont(font.family);
        onChange(font.family);
        setIsOpen(false);
        setSearch('');
        onPreview?.(null);
        setLoadingFont(null);
    }, [onChange, onPreview]);

    const handleHover = useCallback((font: GoogleFont) => {
        loadGoogleFont(font.family);
        onPreview?.(font.family);
    }, [onPreview]);

    const handleMouseLeave = useCallback(() => {
        onPreview?.(null);
    }, [onPreview]);

    const closeDropdown = useCallback(() => {
        setIsOpen(false);
        setSearch('');
        onPreview?.(null);
    }, [onPreview]);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                closeDropdown();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen, closeDropdown]);

    // Focus search when opened
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            setTimeout(() => searchInputRef.current?.focus(), 0);
        }
    }, [isOpen]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            closeDropdown();
        }
    }, [closeDropdown]);

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            {/* Label with font count */}
            <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-500">Font</label>
                <div className="text-xs text-slate-400 flex items-center gap-1">
                    {isLoadingFontList ? (
                        <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Loading fonts...</span>
                        </>
                    ) : (
                        <span>{availableFonts.length} available</span>
                    )}
                </div>
            </div>

            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-3 py-2 text-sm text-left bg-white border border-slate-200 rounded-lg 
                    focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400
                    flex items-center justify-between gap-2 hover:border-slate-300 transition-colors"
            >
                <span
                    className="flex-1 truncate"
                    style={{ fontFamily: isFontLoaded(value) && value ? `"${value}", system-ui` : 'inherit' }}
                >
                    {value || 'Select font...'}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div
                    className="absolute z-[100] left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
                    onKeyDown={handleKeyDown}
                    onMouseLeave={handleMouseLeave}
                >
                    {/* Search */}
                    <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={search}
                                onChange={handleSearchChange}
                                placeholder="Search fonts..."
                                className="w-full pl-8 pr-8 py-1.5 text-sm border border-slate-200 rounded-md
                                    focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                            />
                            {search && (
                                <button
                                    type="button"
                                    onClick={() => setSearch('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Category Pills */}
                    <div className="p-2 border-b border-slate-100">
                        <div className="flex flex-wrap gap-1">
                            {CATEGORIES.map(cat => (
                                <button
                                    key={cat.value}
                                    type="button"
                                    onClick={() => handleCategoryChange(cat.value)}
                                    className={`
                                        px-2 py-0.5 text-xs font-medium rounded transition-colors
                                        ${category === cat.value
                                            ? 'bg-primary-600 text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}
                                    `}
                                >
                                    {cat.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font List */}
                    <div
                        ref={listRef}
                        className="overflow-y-auto"
                        style={{ height: listHeight }}
                        onScroll={handleScroll}
                    >
                        {isLoadingFontList ? (
                            <div className="p-4 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Loading fonts...
                            </div>
                        ) : filteredFonts.length === 0 ? (
                            <div className="p-4 text-center text-sm text-slate-500">
                                No fonts found
                            </div>
                        ) : (
                            <div style={{ height: totalHeight, position: 'relative' }}>
                                {visibleFonts.map((font, i) => (
                                    <FontOption
                                        key={font.family}
                                        font={font}
                                        isSelected={font.family === value}
                                        isLoading={loadingFont === font.family}
                                        onSelect={() => handleSelect(font)}
                                        onHover={() => handleHover(font)}
                                        style={{
                                            top: (startIndex + i) * ITEM_HEIGHT,
                                            height: ITEM_HEIGHT,
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

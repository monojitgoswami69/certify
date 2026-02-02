#!/usr/bin/env python3
"""
Certificate Generator using Pillow

Fast certificate generation using PIL/Pillow with multiprocessing.

Usage:
    python generate_certs.py
    python generate_certs.py --template custom.jpg --csv names.csv --output ./certs
"""

import csv
import os
import time
import argparse
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import multiprocessing
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

# =============================================================================
# Configuration
# =============================================================================

BOX_X = 579
BOX_Y = 611
BOX_W = 840
BOX_H = 199

DEFAULT_TEMPLATE = "template.jpg"
DEFAULT_CSV = "data.csv"
DEFAULT_OUTPUT_DIR = "output"
DEFAULT_FIELD = "first_name"
DEFAULT_FONT_SIZE = 72
DEFAULT_FONT_COLOR = (0, 0, 0)
JPEG_QUALITY = 92

import platform
import sys

def find_system_font() -> str:
    """Find a suitable font for the current OS."""
    system = platform.system()
    
    if system == "Windows":
        candidates = [
            "C:/Windows/Fonts/arial.ttf",
            "C:/Windows/Fonts/Arial.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/calibri.ttf",
        ]
    elif system == "Darwin":  # macOS
        candidates = [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/SFNS.ttf",
        ]
    else:  # Linux and others
        candidates = [
            "/usr/share/fonts/TTF/Arial.TTF",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf",
            "/usr/share/fonts/noto/NotoSans-Bold.ttf",
            "/usr/share/fonts/google-noto/NotoSans-Bold.ttf",
        ]
    
    for path in candidates:
        if os.path.exists(path):
            return path
    
    return ""  # Will fall back to PIL default

# =============================================================================
# Worker state
# =============================================================================

_worker_template_bytes = None
_worker_template_img = None  # Decoded template
_worker_font_path = None
_worker_font_cache = {}  # Pre-loaded fonts by size

def init_worker(template_bytes: bytes, font_path: str, max_font_size: int):
    """Initialize worker with template bytes and pre-load fonts."""
    global _worker_template_bytes, _worker_template_img, _worker_font_path, _worker_font_cache
    _worker_template_bytes = template_bytes
    _worker_font_path = font_path
    
    # Pre-decode template image ONCE
    _worker_template_img = Image.open(BytesIO(template_bytes)).convert("RGB")
    
    # Pre-load common font sizes to avoid first-use penalty
    for size in range(20, max_font_size + 1, 4):
        try:
            _worker_font_cache[size] = ImageFont.truetype(font_path, size)
        except:
            _worker_font_cache[size] = ImageFont.load_default()


def get_font(size: int):
    """Get cached font or create new one."""
    if size in _worker_font_cache:
        return _worker_font_cache[size]
    try:
        font = ImageFont.truetype(_worker_font_path, size)
    except:
        font = ImageFont.load_default()
    _worker_font_cache[size] = font
    return font


def find_font_size(draw: ImageDraw.ImageDraw, text: str, max_size: int, box_w: int, box_h: int) -> int:
    """Find largest font size that fits."""
    size = max_size
    while size >= 20:
        font = get_font(size)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        
        if text_w <= box_w - 20 and text_h <= box_h - 20:
            return size
        size -= 4
    return 20


def process_batch(batch: list) -> list:
    """Process a batch of certificates."""
    global _worker_template_img
    
    results = []
    font_size_cache = {}  # Cache font size by text length
    
    for item in batch:
        name, output_path, max_font_size = item
        
        try:
            # Copy pre-decoded template (much faster than re-decoding JPEG)
            img = _worker_template_img.copy()
            draw = ImageDraw.Draw(img)
            
            # Get font size (cached by text length)
            cache_key = len(name)
            if cache_key not in font_size_cache:
                font_size_cache[cache_key] = find_font_size(draw, name, max_font_size, BOX_W, BOX_H)
            font_size = font_size_cache[cache_key]
            
            font = get_font(font_size)
            
            # Calculate text position (centered)
            bbox = draw.textbbox((0, 0), name, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]
            
            text_x = BOX_X + (BOX_W - text_w) // 2
            text_y = BOX_Y + (BOX_H - text_h) // 2
            
            # Draw text
            draw.text((text_x, text_y), name, font=font, fill=DEFAULT_FONT_COLOR)
            
            # Save
            img.save(output_path, "JPEG", quality=JPEG_QUALITY)
            
            results.append({"success": True})
        except Exception as e:
            results.append({"success": False, "error": str(e), "name": name})
    
    return results


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description="Generate certificates using Pillow")
    parser.add_argument("--template", default=DEFAULT_TEMPLATE)
    parser.add_argument("--csv", default=DEFAULT_CSV)
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--field", default=DEFAULT_FIELD)
    parser.add_argument("--font", default=None)  # Auto-detect if not specified
    parser.add_argument("--font-size", type=int, default=DEFAULT_FONT_SIZE)
    parser.add_argument("--workers", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=200)  # Larger batches = less IPC
    
    args = parser.parse_args()
    
    if not os.path.exists(args.template):
        print(f"ERROR: Template not found: {args.template}")
        exit(1)
    if not os.path.exists(args.csv):
        print(f"ERROR: CSV not found: {args.csv}")
        exit(1)
    
    # Find font
    if args.font is None or not os.path.exists(args.font):
        args.font = find_system_font()
        if not args.font:
            print("WARNING: No suitable font found, using PIL default")
    
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(args.csv, "r", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    
    if args.field not in rows[0]:
        print(f"ERROR: Field '{args.field}' not found")
        exit(1)
    
    if args.limit:
        rows = rows[:args.limit]
    
    total = len(rows)
    worker_count = args.workers or multiprocessing.cpu_count()
    
    # Load template into memory
    with open(args.template, "rb") as f:
        template_bytes = f.read()
    
    print(f"Generating {total} certificates...")
    print(f"  Workers: {worker_count}")
    print(f"  Font: {args.font}")
    print()
    
    # Prepare tasks
    tasks = []
    for i, row in enumerate(rows):
        name = row[args.field]
        safe_name = "".join(c if c.isalnum() or c in " -_" else "_" for c in name)
        output_path = str(output_dir / f"{i+1:05d}_{safe_name}.jpg")
        tasks.append((name, output_path, args.font_size))
    
    # Split into batches
    batches = [tasks[i:i + args.batch_size] for i in range(0, len(tasks), args.batch_size)]
    
    start_time = time.perf_counter()
    completed = 0
    errors = 0
    
    # Use fork on Linux/macOS (much faster startup), spawn on Windows
    if sys.platform in ('linux', 'darwin'):
        ctx = multiprocessing.get_context("fork")
    else:
        ctx = multiprocessing.get_context("spawn")
    
    with ProcessPoolExecutor(
        max_workers=worker_count,
        mp_context=ctx,
        initializer=init_worker,
        initargs=(template_bytes, args.font, args.font_size)
    ) as executor:
        # Submit all batches
        futures = {executor.submit(process_batch, batch): len(batch) for batch in batches}
        
        for future in as_completed(futures):
            batch_size = futures[future]
            try:
                results = future.result()
                for r in results:
                    completed += 1
                    if not r.get("success"):
                        errors += 1
                        if errors <= 5:
                            print(f"  ERROR: {r.get('error')}")
            except Exception as e:
                errors += batch_size
                completed += batch_size
            
            elapsed = time.perf_counter() - start_time
            rate = completed / elapsed if elapsed > 0 else 0
            # Only print every 1000 or at end
            if completed % 1000 == 0 or completed >= total:
                print(f"  Progress: {completed}/{total} ({rate:.0f} certs/sec)")
    
    elapsed = time.perf_counter() - start_time
    rate = total / elapsed if elapsed > 0 else 0
    
    print()
    print("=" * 50)
    print(f"COMPLETED: {total - errors} certificates")
    if errors:
        print(f"ERRORS: {errors}")
    print(f"TIME: {elapsed:.2f}s ({rate:.1f} certs/sec)")
    print("=" * 50)


if __name__ == "__main__":
    main()

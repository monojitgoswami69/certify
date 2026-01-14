"""
Certify Backend - FastAPI Certificate Generator
"""

import io
import csv
import zipfile
import re
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw, ImageFont

app = FastAPI(
    title="Certify API",
    description="Generate personalized certificates from a template and CSV data",
    version="1.0.0"
)

# CORS - allow frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Path to fonts folder
REPO_ROOT = Path(__file__).parent.parent
FONTS_DIR = REPO_ROOT / "fonts"


def sanitize_filename(name: str) -> str:
    """Create a safe filename from a name."""
    safe = re.sub(r'[^a-zA-Z0-9\s\-_]', '', name)
    safe = safe.strip().replace(' ', '_')
    return safe[:50] if safe else 'certificate'


def get_available_fonts() -> list[dict]:
    """Get list of available fonts from the fonts directory."""
    fonts = []
    if FONTS_DIR.exists():
        for font_file in FONTS_DIR.glob("*.ttf"):
            # Create display name from filename
            display_name = font_file.stem.replace('-', ' ').replace('_', ' ')
            # Simplify common patterns
            display_name = re.sub(r'NerdFontPropo', '', display_name)
            display_name = re.sub(r'\s+', ' ', display_name).strip()
            fonts.append({
                "filename": font_file.name,
                "displayName": display_name or font_file.stem
            })
        
        # Also check for .otf fonts
        for font_file in FONTS_DIR.glob("*.otf"):
            display_name = font_file.stem.replace('-', ' ').replace('_', ' ')
            display_name = re.sub(r'NerdFontPropo', '', display_name)
            display_name = re.sub(r'\s+', ' ', display_name).strip()
            fonts.append({
                "filename": font_file.name,
                "displayName": display_name or font_file.stem
            })
    
    return sorted(fonts, key=lambda x: x["displayName"])


def load_font(font_filename: str, font_size: int) -> ImageFont.FreeTypeFont:
    """Load a specific font from the fonts directory."""
    font_path = FONTS_DIR / font_filename
    
    if font_path.exists():
        try:
            return ImageFont.truetype(str(font_path), font_size)
        except (OSError, IOError):
            pass
    
    # Fallback to system fonts
    fallback_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    
    for path in fallback_paths:
        try:
            return ImageFont.truetype(path, font_size)
        except (OSError, IOError):
            continue
    
    return ImageFont.load_default()


def get_font_for_text(
    name: str, 
    box_w: int, 
    box_h: int, 
    max_font_size: int,
    font_filename: str
) -> tuple[ImageFont.FreeTypeFont, int]:
    """
    Find the largest font size that fits the text within the box.
    Checks BOTH width AND height constraints.
    Returns (font, actual_font_size).
    """
    font_size = max_font_size
    min_font_size = 10
    
    while font_size >= min_font_size:
        font = load_font(font_filename, font_size)
        
        # Create a temporary draw context to measure text
        tmp_img = Image.new('RGB', (1, 1))
        tmp_draw = ImageDraw.Draw(tmp_img)
        bbox = tmp_draw.textbbox((0, 0), name, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        
        # Check if text fits within the box (with padding) - BOTH width AND height
        if text_w <= box_w - 10 and text_h <= box_h - 10:
            return font, font_size
        
        font_size -= 2  # Decrease by 2px increments
    
    # Return minimum size font if nothing fits
    return load_font(font_filename, min_font_size), min_font_size


def draw_certificate(
    template: Image.Image,
    name: str,
    box: tuple[int, int, int, int],  # x, y, w, h
    max_font_size: int,
    color: str,
    font_filename: str
) -> Image.Image:
    """
    Draw a name in the box on the template.
    - Horizontally centered
    - Vertically aligned to bottom of box
    - Font size auto-reduced if text doesn't fit (checks width AND height)
    """
    img = template.copy()
    draw = ImageDraw.Draw(img)
    
    x, y, w, h = box
    
    # Get font that fits the text within the box
    font, _ = get_font_for_text(name, w, h, max_font_size, font_filename)
    
    # Get text dimensions
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    
    # Horizontal: center in box
    text_x = x + (w - text_w) // 2
    
    # Vertical: align to bottom of box (stick to lower Y)
    text_y = y + h - text_h - 5  # 5px padding from bottom
    
    # Account for the bbox offset (some fonts have non-zero origin)
    text_x -= bbox[0]
    text_y -= bbox[1]
    
    draw.text((text_x, text_y), name, font=font, fill=color)
    
    return img


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Certify API is running"}


@app.get("/fonts")
async def list_fonts():
    """Get list of available fonts."""
    fonts = get_available_fonts()
    return JSONResponse(content={"fonts": fonts})


@app.post("/generate")
async def generate_certificates(
    template: UploadFile = File(..., description="Certificate template image"),
    csv_file: UploadFile = File(..., description="CSV file with names"),
    name_column: str = Form(..., description="Column name containing names"),
    box_x: int = Form(..., description="Selection box X coordinate"),
    box_y: int = Form(..., description="Selection box Y coordinate"),
    box_w: int = Form(..., description="Selection box width"),
    box_h: int = Form(..., description="Selection box height"),
    font_size: int = Form(60, description="Maximum font size in pixels"),
    font_color: str = Form("#000000", description="Font color as hex code"),
    font_file: str = Form("JetBrainsMonoNerdFontPropo-Medium.ttf", description="Font filename"),
):
    """
    Generate certificates for all names in the CSV file.
    Returns a ZIP file containing certificates in both JPG and PDF formats.
    """
    
    if not template.content_type or not template.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Template must be an image file")
    
    try:
        template_bytes = await template.read()
        template_img = Image.open(io.BytesIO(template_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load template image: {str(e)}")
    
    try:
        csv_bytes = await csv_file.read()
        csv_text = csv_bytes.decode("utf-8")
        reader = csv.DictReader(io.StringIO(csv_text))
        rows = list(reader)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {str(e)}")
    
    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")
    
    if name_column not in rows[0]:
        raise HTTPException(
            status_code=400, 
            detail=f"Column '{name_column}' not found in CSV. Available columns: {list(rows[0].keys())}"
        )
    
    zip_buffer = io.BytesIO()
    box = (box_x, box_y, box_w, box_h)
    generated_count = 0
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            name = row.get(name_column, "").strip()
            if not name:
                continue
            
            cert_img = draw_certificate(template_img, name, box, font_size, font_color, font_file)
            safe_name = sanitize_filename(name)
            
            # Save as JPEG
            jpg_buffer = io.BytesIO()
            cert_img.save(jpg_buffer, format="JPEG", quality=92)
            jpg_buffer.seek(0)
            zf.writestr(f"certificates_jpg/{safe_name}.jpg", jpg_buffer.getvalue())
            
            # Save as PDF
            pdf_buffer = io.BytesIO()
            cert_img.save(pdf_buffer, format="PDF", resolution=100.0)
            pdf_buffer.seek(0)
            zf.writestr(f"certificates_pdf/{safe_name}.pdf", pdf_buffer.getvalue())
            
            generated_count += 1
    
    if generated_count == 0:
        raise HTTPException(status_code=400, detail="No valid names found in CSV")
    
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": "attachment; filename=certificates.zip",
            "X-Generated-Count": str(generated_count)
        }
    )


@app.post("/preview")
async def preview_certificate(
    template: UploadFile = File(..., description="Certificate template image"),
    name: str = Form(..., description="Name to preview"),
    box_x: int = Form(..., description="Selection box X coordinate"),
    box_y: int = Form(..., description="Selection box Y coordinate"),
    box_w: int = Form(..., description="Selection box width"),
    box_h: int = Form(..., description="Selection box height"),
    font_size: int = Form(60, description="Maximum font size in pixels"),
    font_color: str = Form("#000000", description="Font color as hex code"),
    font_file: str = Form("JetBrainsMonoNerdFontPropo-Medium.ttf", description="Font filename"),
):
    """Generate a single certificate preview."""
    
    try:
        template_bytes = await template.read()
        template_img = Image.open(io.BytesIO(template_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load template image: {str(e)}")
    
    box = (box_x, box_y, box_w, box_h)
    cert_img = draw_certificate(template_img, name, box, font_size, font_color, font_file)
    
    img_buffer = io.BytesIO()
    cert_img.save(img_buffer, format="JPEG", quality=92)
    img_buffer.seek(0)
    
    return StreamingResponse(
        img_buffer,
        media_type="image/jpeg",
        headers={"Content-Disposition": f"inline; filename=preview.jpg"}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

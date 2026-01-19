"""
Certify Backend - FastAPI Certificate Generator
"""

import io
import os
import csv
import zipfile
import re
import smtplib
import ssl
import base64
import json
from pathlib import Path
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageDraw, ImageFont

# Load environment variables from .env file
load_dotenv()

app = FastAPI(
    title="Certify API",
    description="Generate personalized certificates from a template and CSV data",
    version="2.0.0"
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
    text: str, 
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
        bbox = tmp_draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        
        # Check if text fits within the box (with padding) - BOTH width AND height
        if text_w <= box_w - 10 and text_h <= box_h - 10:
            return font, font_size
        
        font_size -= 2  # Decrease by 2px increments
    
    # Return minimum size font if nothing fits
    return load_font(font_filename, min_font_size), min_font_size


def draw_text_box(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: int, y: int, w: int, h: int,
    max_font_size: int,
    color: str,
    font_filename: str,
    h_align: str = "center",
    v_align: str = "bottom"
) -> None:
    """
    Draw text in a box on the image.
    - h_align: 'left', 'center', or 'right'
    - v_align: 'top', 'middle', or 'bottom'
    - Font size auto-reduced if text doesn't fit
    """
    if not text.strip():
        return
    
    # Get font that fits the text within the box
    font, _ = get_font_for_text(text, w, h, max_font_size, font_filename)
    
    # Get text dimensions
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    
    # Horizontal alignment
    if h_align == "left":
        text_x = x + 5  # 5px padding from left
    elif h_align == "right":
        text_x = x + w - text_w - 5  # 5px padding from right
    else:  # center (default)
        text_x = x + (w - text_w) // 2
    
    # Vertical alignment
    if v_align == "top":
        text_y = y + 5  # 5px padding from top
    elif v_align == "middle":
        text_y = y + (h - text_h) // 2
    else:  # bottom (default)
        text_y = y + h - text_h - 5  # 5px padding from bottom
    
    # Account for the bbox offset (some fonts have non-zero origin)
    text_x -= bbox[0]
    text_y -= bbox[1]
    
    draw.text((text_x, text_y), text, font=font, fill=color)


def draw_certificate_multi(
    template: Image.Image,
    text_boxes: list[dict],
) -> Image.Image:
    """
    Draw multiple text boxes on the template.
    Each text_box should have: x, y, w, h, text, fontSize, fontColor, fontFile, hAlign, vAlign
    """
    img = template.copy()
    draw = ImageDraw.Draw(img)
    
    for box in text_boxes:
        draw_text_box(
            draw,
            text=box.get("text", ""),
            x=int(box.get("x", 0)),
            y=int(box.get("y", 0)),
            w=int(box.get("w", 100)),
            h=int(box.get("h", 50)),
            max_font_size=int(box.get("fontSize", 60)),
            color=box.get("fontColor", "#000000"),
            font_filename=box.get("fontFile", ""),
            h_align=box.get("hAlign", "center"),
            v_align=box.get("vAlign", "bottom")
        )
    
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


@app.get("/fonts/{font_filename}")
async def get_font_file(font_filename: str):
    """Serve a font file for client-side rendering."""
    # Security: Validate filename to prevent path traversal
    if not font_filename or '..' in font_filename or '/' in font_filename or '\\' in font_filename:
        raise HTTPException(status_code=400, detail="Invalid font filename")
    
    # Only allow safe characters in filename
    safe_pattern = re.compile(r'^[a-zA-Z0-9_\-\.]+\.(ttf|otf)$', re.IGNORECASE)
    if not safe_pattern.match(font_filename):
        raise HTTPException(status_code=400, detail="Invalid font filename format")
    
    font_path = FONTS_DIR / font_filename
    
    # Security: Ensure resolved path is still within FONTS_DIR
    try:
        font_path.resolve().relative_to(FONTS_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid font path")
    
    if not font_path.exists():
        raise HTTPException(status_code=404, detail=f"Font not found: {font_filename}")
    
    # Determine content type
    suffix = font_path.suffix.lower()
    media_type = "font/ttf" if suffix == ".ttf" else "font/otf" if suffix == ".otf" else "application/octet-stream"
    
    return FileResponse(
        font_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"}  # Cache for 1 day
    )


@app.post("/generate-single")
async def generate_single_certificate(
    template: UploadFile = File(..., description="Certificate template image"),
    text_boxes: str = Form(..., description="JSON array of text box configurations"),
    include_pdf: bool = Form(True, description="Include PDF version"),
    include_jpg: bool = Form(True, description="Include JPG version"),
    filename: str = Form("certificate", description="Base filename for output"),
):
    """
    Generate a single certificate with multiple text boxes.
    Returns both JPG and PDF as base64 strings.
    
    text_boxes format: [{"x": 100, "y": 200, "w": 300, "h": 50, "text": "John Doe", 
                         "fontSize": 60, "fontColor": "#000000", "fontFile": "font.ttf"}, ...]
    """
    
    if not include_pdf and not include_jpg:
        raise HTTPException(status_code=400, detail="At least one format (PDF or JPG) must be selected")
    
    # Parse text boxes JSON
    try:
        boxes = json.loads(text_boxes)
        if not isinstance(boxes, list):
            raise ValueError("text_boxes must be a JSON array")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid text_boxes JSON: {str(e)}")
    
    # Load template
    try:
        template_bytes = await template.read()
        template_img = Image.open(io.BytesIO(template_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load template image: {str(e)}")
    
    # Generate certificate with all text boxes
    cert_img = draw_certificate_multi(template_img, boxes)
    safe_name = sanitize_filename(filename)
    
    result = {
        "filename": safe_name,
    }
    
    # Generate JPG
    if include_jpg:
        jpg_buffer = io.BytesIO()
        cert_img.save(jpg_buffer, format="JPEG", quality=92)
        jpg_buffer.seek(0)
        result["jpg"] = base64.b64encode(jpg_buffer.getvalue()).decode("utf-8")
    
    # Generate PDF
    if include_pdf:
        pdf_buffer = io.BytesIO()
        cert_img.save(pdf_buffer, format="PDF", resolution=100.0)
        pdf_buffer.seek(0)
        result["pdf"] = base64.b64encode(pdf_buffer.getvalue()).decode("utf-8")
    
    return JSONResponse(content=result)


def get_smtp_config():
    """Get SMTP configuration from environment variables."""
    smtp_host = os.environ.get("EMAIL_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("EMAIL_PORT", "465"))
    smtp_user = os.environ.get("EMAIL_USER", "")
    smtp_pass = os.environ.get("EMAIL_PASS", "")
    use_tls = os.environ.get("EMAIL_USE_TLS", "true").lower() == "true"
    
    if not smtp_user or not smtp_pass:
        raise HTTPException(
            status_code=500, 
            detail="Email credentials not configured. Set EMAIL_USER and EMAIL_PASS environment variables."
        )
    
    return {
        "host": smtp_host,
        "port": smtp_port,
        "user": smtp_user,
        "pass": smtp_pass,
        "use_tls": use_tls
    }


@app.get("/email-config")
async def check_email_config():
    """Check if email is configured (without exposing credentials)."""
    smtp_user = os.environ.get("EMAIL_USER", "")
    smtp_host = os.environ.get("EMAIL_HOST", "smtp.gmail.com")
    
    if not smtp_user:
        return JSONResponse(content={
            "configured": False,
            "message": "Email not configured"
        })
    
    # Mask the email for privacy
    parts = smtp_user.split("@")
    if len(parts) == 2:
        masked = parts[0][:3] + "***@" + parts[1]
    else:
        masked = smtp_user[:3] + "***"
    
    return JSONResponse(content={
        "configured": True,
        "sender": masked,
        "host": smtp_host
    })


@app.post("/send-email")
async def send_certificate_email(
    template: UploadFile = File(..., description="Certificate template image"),
    recipient_email: str = Form(..., description="Recipient email address"),
    text_boxes: str = Form(..., description="JSON array of text box configurations"),
    email_subject: str = Form(..., description="Email subject"),
    email_body_plain: str = Form(..., description="Email body plain text"),
    email_body_html: str = Form("", description="Email body HTML (optional)"),
    attach_pdf: bool = Form(True, description="Attach PDF version"),
    attach_jpg: bool = Form(True, description="Attach JPG version"),
    filename: str = Form("certificate", description="Base filename for attachments"),
):
    """
    Send a single certificate via email with multiple text boxes.
    This endpoint handles one email at a time - the frontend controls the delay between calls.
    """
    
    if not attach_pdf and not attach_jpg:
        raise HTTPException(status_code=400, detail="At least one attachment type (PDF or JPG) must be selected")
    
    # Parse text boxes JSON
    try:
        boxes = json.loads(text_boxes)
        if not isinstance(boxes, list):
            raise ValueError("text_boxes must be a JSON array")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid text_boxes JSON: {str(e)}")
    
    # Get SMTP config from environment
    smtp = get_smtp_config()
    
    # Load template
    try:
        template_bytes = await template.read()
        template_img = Image.open(io.BytesIO(template_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load template image: {str(e)}")
    
    # Generate certificate with all text boxes
    cert_img = draw_certificate_multi(template_img, boxes)
    safe_name = sanitize_filename(filename)
    
    # Create email
    message = MIMEMultipart("alternative")
    message["Subject"] = email_subject
    message["From"] = smtp["user"]
    message["To"] = recipient_email
    
    # Attach text parts
    message.attach(MIMEText(email_body_plain, "plain"))
    
    # Only attach HTML if provided
    if email_body_html.strip():
        message.attach(MIMEText(email_body_html, "html"))
    
    # Attach JPG if requested
    if attach_jpg:
        jpg_buffer = io.BytesIO()
        cert_img.save(jpg_buffer, format="JPEG", quality=92)
        jpg_buffer.seek(0)
        
        part = MIMEBase("application", "octet-stream")
        part.set_payload(jpg_buffer.getvalue())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={safe_name}.jpg")
        message.attach(part)
    
    # Attach PDF if requested
    if attach_pdf:
        pdf_buffer = io.BytesIO()
        cert_img.save(pdf_buffer, format="PDF", resolution=100.0)
        pdf_buffer.seek(0)
        
        part = MIMEBase("application", "octet-stream")
        part.set_payload(pdf_buffer.getvalue())
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={safe_name}.pdf")
        message.attach(part)
    
    # Send email
    try:
        context = ssl.create_default_context()
        
        if smtp["use_tls"]:
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], context=context) as server:
                server.login(smtp["user"], smtp["pass"])
                server.sendmail(smtp["user"], recipient_email, message.as_string())
        else:
            with smtplib.SMTP(smtp["host"], smtp["port"]) as server:
                server.starttls(context=context)
                server.login(smtp["user"], smtp["pass"])
                server.sendmail(smtp["user"], recipient_email, message.as_string())
        
        return JSONResponse(content={
            "status": "success",
            "message": f"Email sent to {recipient_email}",
            "recipient": recipient_email
        })
        
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="SMTP authentication failed. Check server credentials.")
    except smtplib.SMTPException as e:
        raise HTTPException(status_code=500, detail=f"SMTP error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)


# New simplified email endpoint - receives pre-generated certificates
class SendEmailV2Request(BaseModel):
    recipient_email: str
    email_subject: str
    email_body_plain: str
    email_body_html: str = ""
    filename: str = "certificate"
    jpg_base64: Optional[str] = None  # Pre-generated JPG as base64
    pdf_base64: Optional[str] = None  # Pre-generated PDF as base64


@app.post("/send-email-v2")
async def send_email_v2(request: SendEmailV2Request):
    """
    Send an email with pre-generated certificate attachments.
    Certificates are generated client-side and sent as base64 encoded strings.
    This eliminates the need for PIL/image processing on the server.
    """
    
    if not request.jpg_base64 and not request.pdf_base64:
        raise HTTPException(status_code=400, detail="At least one attachment (jpg_base64 or pdf_base64) must be provided")
    
    # Get SMTP config from environment
    smtp = get_smtp_config()
    safe_name = sanitize_filename(request.filename)
    
    # Create email
    message = MIMEMultipart("alternative")
    message["Subject"] = request.email_subject
    message["From"] = smtp["user"]
    message["To"] = request.recipient_email
    
    # Attach text parts
    message.attach(MIMEText(request.email_body_plain, "plain"))
    
    # Only attach HTML if provided
    if request.email_body_html.strip():
        message.attach(MIMEText(request.email_body_html, "html"))
    
    # Attach JPG if provided
    if request.jpg_base64:
        try:
            jpg_data = base64.b64decode(request.jpg_base64)
            part = MIMEBase("application", "octet-stream")
            part.set_payload(jpg_data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f"attachment; filename={safe_name}.jpg")
            message.attach(part)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid jpg_base64: {str(e)}")
    
    # Attach PDF if provided
    if request.pdf_base64:
        try:
            pdf_data = base64.b64decode(request.pdf_base64)
            part = MIMEBase("application", "octet-stream")
            part.set_payload(pdf_data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f"attachment; filename={safe_name}.pdf")
            message.attach(part)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid pdf_base64: {str(e)}")
    
    # Send email
    try:
        context = ssl.create_default_context()
        
        if smtp["use_tls"]:
            with smtplib.SMTP_SSL(smtp["host"], smtp["port"], context=context) as server:
                server.login(smtp["user"], smtp["pass"])
                server.sendmail(smtp["user"], request.recipient_email, message.as_string())
        else:
            with smtplib.SMTP(smtp["host"], smtp["port"]) as server:
                server.starttls(context=context)
                server.login(smtp["user"], smtp["pass"])
                server.sendmail(smtp["user"], request.recipient_email, message.as_string())
        
        return JSONResponse(content={
            "status": "success",
            "message": f"Email sent to {request.recipient_email}",
            "recipient": request.recipient_email
        })
        
    except smtplib.SMTPAuthenticationError:
        raise HTTPException(status_code=401, detail="SMTP authentication failed. Check server credentials.")
    except smtplib.SMTPException as e:
        raise HTTPException(status_code=500, detail=f"SMTP error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


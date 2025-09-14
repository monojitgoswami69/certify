import csv
import os
from PIL import Image, ImageDraw, ImageFont

# --- CONFIGURATION ---
TEMPLATE = "certificate.jpg"
CSV_FILE = "data.csv"
OUTPUT_DIR_PDF = "certificates_pdf"
OUTPUT_DIR_JPG = "certificates_jpg"
SUCCESS_LOG = "output_success.csv"
FAILURE_LOG = "output_failure.csv"
# Place your .ttf font file in the same directory as this script.
# Update the filename below if it's different.
FONT_PATH = "JetBrainsMonoNerdFontPropo-Medium.ttf"
FIXED_FONT_SIZE = 70
TEXT_COLOR = "black"
NAME_BOX = (580, 645, 1420, 810)

# --- CERTIFICATE GENERATION ---
def make_certificate(name, template_img, font):
    img = template_img.copy()
    draw = ImageDraw.Draw(img)
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x1, y1, x2, y2 = NAME_BOX
    box_w = x2 - x1
    box_h = y2 - y1
    text_x = x1 + (box_w - text_w) // 2
    text_y = y1 + (box_h - text_h) // 2
    draw.text((text_x, text_y), name, font=font, fill=TEXT_COLOR)
    safe_filename = name.replace(' ', '_').replace('/', '_')
    pdf_filepath = os.path.join(OUTPUT_DIR_PDF, f"{safe_filename}.pdf")
    jpg_filepath = os.path.join(OUTPUT_DIR_JPG, f"{safe_filename}.jpg")
    os.makedirs(OUTPUT_DIR_PDF, exist_ok=True)
    img.save(pdf_filepath, "PDF", resolution=100.0)
    os.makedirs(OUTPUT_DIR_JPG, exist_ok=True)
    img.save(jpg_filepath, "JPEG")
    print(f"Successfully created certificates for: {name}")

def main():
    try:
        template_img = Image.open(TEMPLATE).convert("RGB")
        font = ImageFont.truetype(FONT_PATH, FIXED_FONT_SIZE)
    except FileNotFoundError as e:
        print(f"Error: A required file was not found: {e}.")
        return

    try:
        with open(CSV_FILE, mode='r', encoding='utf-8') as infile, \
             open(SUCCESS_LOG, mode='w', newline='', encoding='utf-8') as success_file, \
             open(FAILURE_LOG, mode='w', newline='', encoding='utf-8') as failure_file:
            
            reader = csv.DictReader(infile)
            
            headers = reader.fieldnames
            if 'name' not in headers or 'email' not in headers:
                print(f"Error: The CSV file '{CSV_FILE}' must contain 'name' and 'email' columns.")
                return

            fieldnames = ['name', 'email']
            success_writer = csv.DictWriter(success_file, fieldnames=fieldnames)
            failure_writer = csv.DictWriter(failure_file, fieldnames=fieldnames)
            success_writer.writeheader()
            failure_writer.writeheader()
            
            print("Starting certificate generation...")
            
            for row in reader:
                name = row.get("name", "").strip()
                email = row.get("email", "").strip()
                record = {'name': name, 'email': email}

                try:
                    if not name:
                        raise ValueError("The 'name' field is empty or missing for this row.")
                    
                    make_certificate(name, template_img, font)
                    success_writer.writerow(record)
                    
                except Exception as e:
                    print(f"--> FAILED for record '{row}'. Reason: {e}")
                    failure_writer.writerow(record)

    except FileNotFoundError:
        print(f"Error: The input file '{CSV_FILE}' was not found.")
    except Exception as e:
        print(f"A critical error occurred: {e}")

    print("\nProcessing complete.")

if __name__ == "__main__":
    main()

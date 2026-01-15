import os
import csv
import smtplib
import ssl
import time
import random
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from dotenv import load_dotenv

# --- CONFIGURATION ---
SUCCESS_LOG = "output_success.csv"
PDF_DIR = "certificates_pdf"
JPG_DIR = "certificates_jpg"
SENT_LOG = "sent_log.csv"

# --- EMAIL CONTENT ---
EMAIL_SUBJECT = "Your Certificate of Achievement is Here!"

def get_email_body(name):
    return f"Hi {name},\n\nCongratulations!\n\nPlease find your certificate of achievement attached.\n\nBest regards,\nThe Team"

def get_email_body_html(name):
    return f"<html><body><p>Hi {name},</p><p><strong>Congratulations!</strong></p><p>Please find your certificate of achievement attached.</p><p>Best regards,<br>The Team</p></body></html>"

def get_already_sent_emails():
    if not os.path.exists(SENT_LOG):
        return set()
    with open(SENT_LOG, mode='r', encoding='utf-8') as f:
        reader = csv.reader(f)
        try:
            next(reader)
        except StopIteration:
            return set()
        return {row[1] for row in reader if row}

def send_email(server, sender_email, recipient_email, recipient_name, pdf_path, jpg_path):
    if not os.path.exists(pdf_path) or not os.path.exists(jpg_path):
        print(f"--> Skipping '{recipient_name}': Certificate file(s) not found.")
        return False
    message = MIMEMultipart("alternative")
    message["Subject"] = EMAIL_SUBJECT
    message["From"] = sender_email
    message["To"] = recipient_email
    message.attach(MIMEText(get_email_body(recipient_name), "plain"))
    message.attach(MIMEText(get_email_body_html(recipient_name), "html"))
    with open(pdf_path, "rb") as attachment:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(attachment.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f"attachment; filename= {os.path.basename(pdf_path)}")
    message.attach(part)
    with open(jpg_path, "rb") as attachment:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(attachment.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f"attachment; filename= {os.path.basename(jpg_path)}")
    message.attach(part)
    server.sendmail(sender_email, recipient_email, message.as_string())
    print(f"Successfully sent email to {recipient_name} at {recipient_email}")
    return True

def main():
    load_dotenv()
    sender_email = os.getenv("EMAIL_USER")
    sender_password = os.getenv("EMAIL_PASS")
    email_host = os.getenv("EMAIL_HOST")
    email_port = int(os.getenv("EMAIL_PORT", 465))
    if not all([sender_email, sender_password, email_host]):
        print("Error: Email credentials must be set in the .env file.")
        return

    already_sent = get_already_sent_emails()
    print(f"Found {len(already_sent)} emails in the sent log to be skipped.")

    context = ssl.create_default_context()
    try:
        with open(SUCCESS_LOG, mode='r', encoding='utf-8') as success_file, \
             open(SENT_LOG, mode='a', newline='', encoding='utf-8') as sent_log_file, \
             smtplib.SMTP_SSL(email_host, email_port, context=context) as server:

            reader = csv.DictReader(success_file)
            
            headers = reader.fieldnames
            if 'name' not in headers or 'email' not in headers:
                print(f"Error: The success log '{SUCCESS_LOG}' must contain 'name' and 'email' columns.")
                return

            server.login(sender_email, sender_password)
            print("Successfully connected to the email server.")
            
            sent_writer = csv.writer(sent_log_file)
            if os.path.getsize(SENT_LOG) == 0:
                sent_writer.writerow(['name', 'email'])

            for row in reader:
                name = row.get("name", "").strip()
                email = row.get("email", "").strip()

                if not name or not email:
                    print(f"Skipping invalid row: {row}")
                    continue
                
                if email in already_sent:
                    continue
                
                try:
                    safe_filename = name.replace(' ', '_').replace('/', '_')
                    pdf_file = os.path.join(PDF_DIR, f"{safe_filename}.pdf")
                    jpg_file = os.path.join(JPG_DIR, f"{safe_filename}.jpg")
                    if send_email(server, sender_email, email, name, pdf_file, jpg_file):
                        sent_writer.writerow([name, email])
                        sent_log_file.flush()
                    time.sleep(random.random())
                except Exception as e:
                    print(f"--> FAILED for '{name}' ({email}). Reason: {e}")

    except FileNotFoundError:
        print(f"Error: The success log '{SUCCESS_LOG}' was not found.")
    except smtplib.SMTPAuthenticationError:
        print("--> CRITICAL FAILURE: SMTP Authentication failed. Check credentials in .env file.")
    except Exception as e:
        print(f"A critical error occurred: {e}")

if __name__ == "__main__":
    main()

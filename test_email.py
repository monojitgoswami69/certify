import os
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
# PUT YOUR OWN EMAIL HERE FOR TESTING
TEST_RECIPIENT_EMAIL = "" 

# PATH TO A SINGLE REAL PDF FILE TO TEST WITH
TEST_PDF_PATH = "certificates_pdf/test1.pdf" 

def get_long_email_body(iteration):
    return f"""
    Dear Student,

    We hope this email finds you well.

    We are writing to you today to formally present your Certificate of Achievement. This document represents the hard work, dedication, and time you have invested in this program. We strictly verify all participants, and we are pleased to confirm that you have successfully met all the necessary criteria.

    Please find the attached PDF document which contains your official certification. We recommend downloading it and keeping a backup for your future records.

    If you have any questions regarding this certificate or future events, please do not hesitate to reach out to the support team.

    (System Note: This is test email #{iteration} of 10)

    Best regards,
    The Organizing Committee
    Academy of Technology
    """

def send_test_email(server, sender_email, recipient_email, pdf_path, iteration):
    if not os.path.exists(pdf_path):
        print(f"Error: PDF file not found at {pdf_path}")
        return False

    message = MIMEMultipart()
    # Varying the subject helps avoid "duplicate content" spam filters
    message["Subject"] = f"Certificate Verification - Internal Test {iteration}/10"
    message["From"] = sender_email
    message["To"] = recipient_email

    # Attach the longer body
    message.attach(MIMEText(get_long_email_body(iteration), "plain"))

    # Attach ONLY the PDF
    with open(pdf_path, "rb") as attachment:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(attachment.read())
    
    encoders.encode_base64(part)
    part.add_header(
        "Content-Disposition",
        f"attachment; filename= {os.path.basename(pdf_path)}",
    )
    message.attach(part)

    server.sendmail(sender_email, recipient_email, message.as_string())
    print(f"--> Sent email {iteration} to {recipient_email}")
    return True

def main():
    load_dotenv()
    sender_email = os.getenv("EMAIL_USER")
    sender_password = os.getenv("EMAIL_PASS")
    email_host = os.getenv("EMAIL_HOST")
    email_port = int(os.getenv("EMAIL_PORT", 465))

    if not all([sender_email, sender_password, email_host]):
        print("Error: Check your .env file credentials.")
        return

    context = ssl.create_default_context()
    
    try:
        with smtplib.SMTP_SSL(email_host, email_port, context=context) as server:
            server.login(sender_email, sender_password)
            print("Login successful. Starting 10-email loop...")

            for i in range(5):
                success = send_test_email(
                    server, 
                    sender_email, 
                    TEST_RECIPIENT_EMAIL, 
                    TEST_PDF_PATH, 
                    i
                )
                
                if success:
                    # Sleep for 10-15 seconds to simulate human sending speed
                    sleep_time = 0
                    print(f"    Waiting {sleep_time} seconds...")
                    time.sleep(sleep_time)
                else:
                    break

            print("Test complete.")

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()
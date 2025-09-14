# Certify

**A Python automation tool for bulk certificate generation and email distribution for SCCSE AOT**

## Prerequisites

- **Python 3.6 or higher**
- **pip** (Python package installer)

## Installation

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd certify
```

### 2. Set Up Virtual Environment (Recommended)

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Linux/macOS:
source venv/bin/activate

# On Windows:
venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

## Project Setup

### Required Files

Before running the scripts, ensure you have the following files in your project directory:

#### 1. Certificate Template
- **File**: `certificate.jpg`
- **Description**: Your certificate background image
- **Format**: JPG format recommended
- **Placement**: Root directory of the project

#### 2. Font File
- **File**: `JetBrainsMonoNerdFontPropo-Medium.ttf` (or your preferred TrueType font)
- **Description**: Font used for rendering names on certificates
- **Format**: `.ttf` (TrueType Font)
- **Placement**: Root directory of the project
- **Note**: If using a different font, update the `FONT_PATH` variable in `generate_certificates.py`

#### 3. Data File
- **File**: `data.csv`
- **Description**: Contains participant information
- **Required Columns**: `name` and `email` (column order doesn't matter)
- **Example**:
  ```csv
  name,email
  John Doe,john.doe@example.com
  Jane Smith,jane.smith@example.com
  ```

#### 4. Environment Configuration
- **File**: `.env`
- **Description**: Contains email server credentials
- **Content**:
  ```env
  EMAIL_HOST=smtp.gmail.com
  EMAIL_PORT=465
  EMAIL_USER=your_email@gmail.com
  EMAIL_PASS=your_16_digit_app_password
  ```

**Important for Gmail Users**: You must generate an "App Password" for `EMAIL_PASS`, not use your regular account password. See [Google's App Password Guide](https://support.google.com/accounts/answer/185833) for instructions.

### Configuration Options

You can customize the certificate generation by modifying variables in `generate_certificates.py`:

- `FIXED_FONT_SIZE`: Size of the text (default: 70)
- `TEXT_COLOR`: Color of the name text (default: "black")
- `NAME_BOX`: Coordinates for text placement (x1, y1, x2, y2): (x1,y1) -> top left corner, (x2,y2) -> bottom right corner

## Usage

The project runs in two stages:

### Stage 1: Generate Certificates

Run the certificate generation script:

```bash
python generate_certificates.py
```

**What it does:**
- Reads participant data from `data.csv`
- Creates personalized certificates for each participant
- Saves certificates in two formats:
  - PDF files in `certificates_pdf/` directory
  - JPG files in `certificates_jpg/` directory
- Creates log files:
  - `output_success.csv`: Successfully processed participants
  - `output_failure.csv`: Failed processing attempts

### Stage 2: Email Certificates

After certificates are generated, send them via email:

```bash
python email_certificates.py
```

**What it does:**
- Reads successful participants from `output_success.csv`
- Sends multipart emails (HTML + plain text) with certificate attachments
- Attaches both PDF and JPG versions of each certificate
- Creates `sent_log.csv` to track sent emails and prevent duplicates

## Output Structure

After running both scripts, your project directory will contain:

```
certify/
├── certificate.jpg                    # Template image
├── data.csv                          # Input data
├── generate_certificates.py          # Generation script
├── email_certificates.py             # Email script
├── requirements.txt                  # Dependencies
├── .env                             # Email credentials
├── certificates_pdf/                # Generated PDF certificates
│   ├── John_Doe.pdf
│   └── Jane_Smith.pdf
├── certificates_jpg/                # Generated JPG certificates
│   ├── John_Doe.jpg
│   └── Jane_Smith.jpg
├── output_success.csv               # Successful generations log
├── output_failure.csv               # Failed generations log
└── sent_log.csv                     # Email sending log
```

## Error Handling & Recovery

### Resumable Operations
- **Certificate Generation**: Skips existing certificate files if re-run
- **Email Sending**: Checks `sent_log.csv` to avoid sending duplicate emails

### Common Issues

#### 1. Missing Files
- Ensure `certificate.jpg`, font file, and `data.csv` are in the root directory
- Check file names match exactly (case-sensitive on Linux/macOS)

#### 2. Email Authentication Errors
- Verify `.env` file contains correct credentials
- For Gmail: Use App Password, not regular password
- Check if 2-factor authentication is enabled

#### 3. Font Rendering Issues
- Ensure font file exists and path is correct in `generate_certificates.py`
- Try using a different TrueType font if current one fails

#### 4. CSV Format Issues
- Ensure CSV contains `name` and `email` columns
- Check for proper UTF-8 encoding if using special characters

## Dependencies

- **Pillow**: Image processing and certificate generation
- **python-dotenv**: Environment variable management for email credentials


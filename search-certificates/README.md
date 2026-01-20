# Certificate Tracker - Dynamic Event System

A modular, event-based certificate viewer with name validation to prevent fake certificates.

## How It Works

The system has a simple two-input API:
1. **Event Name** → loads `config.json` and `template.jpg` from that event's folder
2. **Participant Name** → validates name exists in the JSON, then generates certificate

Certificates are generated **only** for names that exist in the event's participant list.

## Project Structure

```
search-certificates/
├── index.html              # Main page with event selector
├── app.js                  # Main application
├── styles.css              # Styling
├── js/
│   ├── certificate.js      # Modular generator (portable)
│   └── events.js           # Event list loader
├── events/
│   ├── events.json         # List of available events
│   ├── default/            # Default event folder
│   │   ├── config.json     # Event config with participant names
│   │   └── template.jpg    # Certificate template
│   ├── hackathon_2024/     # Example: another event
│   │   ├── config.json
│   │   └── template.jpg
│   └── ...
└── fonts/
    └── JetBrainsMonoNerdFontPropo-Medium.ttf
```

## Adding a New Event

### Method 1: Using Export (Recommended)

1. Open the certificate generator frontend
2. Upload your template and CSV data
3. Configure text boxes
4. Click **"Export Event Config"**
5. Enter the event name when prompted
6. Download and extract the ZIP
7. Copy the event folder to `search-certificates/events/`
8. Add entry to `events/events.json` (see `_add_to_events.json.txt` in the ZIP)

### Method 2: Manual

1. Create folder `events/{event_id}/`

2. Create `config.json`:
```json
{
  "eventName": "My Event 2024",
  "font": {
    "family": "JetBrains Mono",
    "file": "JetBrainsMonoNerdFontPropo-Medium.ttf",
    "maxSize": 70,
    "color": "#000000"
  },
  "textBox": {
    "x": 580,
    "y": 645,
    "w": 840,
    "h": 165
  },
  "names": [
    "John Doe",
    "Jane Smith"
  ]
}
```

3. Add `template.jpg` to the same folder

4. Register in `events/events.json`:
```json
{
  "events": [
    {
      "id": "my_event_2024",
      "name": "My Event 2024",
      "description": "Event description"
    }
  ]
}
```

## Using the Module (Portable)

The `certificate.js` can be imported into any webpage:

```javascript
import { CertificateGenerator } from './js/certificate.js';

const cert = new CertificateGenerator();

// Step 1: Load event (config + template)
await cert.loadEvent('default');

// Step 2: Generate (validates name first!)
const result = cert.generate('John Doe');

if (result.success) {
  document.body.appendChild(result.canvas);
  cert.downloadAsPdf('John_Doe');
} else {
  console.error(result.error);
  // "Name not found in certificate list"
}
```

### API

| Method | Description |
|--------|-------------|
| `loadEvent(eventId)` | Load event's config and template |
| `generate(name)` | Validate name & generate certificate |
| `downloadAsJpg(filename)` | Download as JPG |
| `downloadAsPdf(filename)` | Download as PDF (requires jsPDF) |
| `getParticipants()` | Get list of valid names |
| `isValidParticipant(name)` | Check if name is in the list |

### Security

The `generate()` function returns an error if the name doesn't exist in the participant list, preventing fake certificates:

```javascript
const result = cert.generate('Fake Name');
// result = { success: false, error: "Name not found in certificate list" }
```

## Running Locally

```bash
cd search-certificates
python3 -m http.server 8080
# Open http://localhost:8080
```

# Web Automation testing tool

Automated Security & UI Testing tool for any public website.

## Features

- **Security Scan** (always runs): HTTP headers, TLS/HTTPS, cookies, info-disclosure, CORS
- **UI Test Report**: Fetches page HTML, identifies all interactive components, generates a test plan, executes Playwright tests
- **UI Test Script**: Embeds the generated Playwright `.spec.js` inside the PDF report
- **Auto-cleanup**: PDF and test scripts are deleted from server immediately after download

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright Chromium browser
npx playwright install chromium

# 3. Start the server
npm start

# 4. Open browser
open http://localhost:3000
```

## Project Structure

```
auto-tester-demo/
├── server.js                     # Express server & API routes
├── public/
│   └── index.html                # Frontend UI
├── src/
│   ├── securityTester.js         # HTTP security header analysis (fetch)
│   ├── uiAnalyzer.js             # HTML component discovery (node-html-parser)
│   ├── testPlanGenerator.js      # Structured test plan generation
│   ├── playwrightScriptGenerator.js  # @playwright/test script output
│   ├── testRunner.js             # Playwright API test execution
│   └── reportGenerator.js        # PDF report creation (pdfkit)
├── temp/                         # Session temp files (auto-deleted after download)
└── package.json
```

## API

### POST /api/analyze
```json
{
  "url": "https://target-site.com",
  "uiTestReport": true,
  "uiTestScript": true
}
```
Returns `{ "success": true, "sessionId": "...", "reportFile": "auto-tester-report.pdf" }`

### GET /api/download/:sessionId/:filename
Downloads the PDF report. **Files are deleted immediately after download.**

## Security Checks

| Check | Severity |
|-------|----------|
| Content-Security-Policy | HIGH if missing |
| Strict-Transport-Security | HIGH if missing |
| X-Frame-Options | MEDIUM if missing |
| X-Content-Type-Options | MEDIUM if missing |
| TLS Certificate validity | HIGH if invalid |
| Cookie Secure/HttpOnly/SameSite | HIGH/MEDIUM |
| Server/X-Powered-By disclosure | MEDIUM |
| CORS wildcard | MEDIUM |

## UI Test Categories

1. **3.1 Input Field Validation** – Valid/invalid data, required fields, max length
2. **3.2 Navigation Check** – Links, buttons, broken link detection
3. **3.3 Spelling & Grammar** – Common typos, empty button labels

## Requirements

- Node.js 18+
- npm
- Playwright Chromium (auto-installs on `npm install`)

## Environment Variables

- `PORT` (optional)
- `RECAPTCHA_TOKEN` (optional; injected into the browser to prefill `_recaptchaToken`)
- `RECAPTCHA_SECRET_KEY` (optional; used server-side to verify reCAPTCHA tokens; if blank, the server falls back to Google's v2 test secret)

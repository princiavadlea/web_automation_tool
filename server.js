const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

require('dotenv').config();

const { runBasicTest }    = require('./src/basicTester');
const { runSecurityTest } = require('./src/securityTester');
const { analyzeUI }       = require('./src/uiAnalyzer');
const { generateTestPlan }          = require('./src/testPlanGenerator');
const { generatePlaywrightScript }  = require('./src/playwrightScriptGenerator');
const { runUITests }      = require('./src/testRunner');
const { generateReport }  = require('./src/reportGenerator');

const app = express();
const PORT = process.env.PORT || 6000;

// ── reCAPTCHA ─────────────────────────────────────────────────────────────────
// For local / CI testing use the always-pass test secret provided by Google.
// In production set RECAPTCHA_SECRET_KEY in your environment to your real key.
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

async function verifyRecaptcha(token) {
  // A missing token in a dev / CI environment with the test secret still passes.
  if (!token) return false;
  try {
    const resp = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(RECAPTCHA_SECRET)}&response=${encodeURIComponent(token)}`,
    });
    const data = await resp.json();
    return data.success === true;
  } catch (err) {
    console.error('reCAPTCHA verification error:', err.message);
    return false;
  }
}

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, 'public');

// Serve index.html with injected reCAPTCHA token from environment variables.
// This is needed because the browser cannot read `process.env.*` directly.
function renderIndexHtml() {
  const indexHtmlPath = path.join(publicDir, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  const tokenLiteral = JSON.stringify(process.env.RECAPTCHA_TOKEN ?? null);
  return indexHtml.replace(/__RECAPTCHA_TOKEN__/g, tokenLiteral);
}

app.get('/', (_req, res) => res.type('html').send(renderIndexHtml()));
app.get('/index.html', (_req, res) => res.type('html').send(renderIndexHtml()));
app.use(express.static(publicDir));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ─── Main Analysis Endpoint ───────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { url, uiTestReport, uiTestScript, recaptchaToken } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required.' });
  }

  // Validate URL format
  let parsedURL;
  try {
    parsedURL = new URL(url);
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid URL format. Please include https://' });
  }

  // ── reCAPTCHA gate ────────────────────────────────────────────────────────
  const captchaOk = await verifyRecaptcha(recaptchaToken);
  if (!captchaOk) {
    return res.status(403).json({ success: false, error: 'reCAPTCHA verification failed. Please try again.' });
  }

  const sessionId = uuidv4();
  const sessionDir = path.join(TEMP_DIR, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    console.log(`\n[${sessionId}] Starting analysis for: ${url}`);
    console.log(`[${sessionId}] UI Report: ${uiTestReport} | UI Script: ${uiTestScript}`);

    // ── Step 2.1: Basic HTML / CSS / JS analysis (always runs) ───────────────
    console.log(`[${sessionId}] Step 2.1 – Running basic HTML/CSS/JS analysis...`);
    const basicResults = await runBasicTest(url);

    // ── Step 2.2: Security tests (always runs) ────────────────────────────────
    console.log(`[${sessionId}] Step 2.2 – Running security tests...`);
    const securityResults = await runSecurityTest(url);

    let components      = null;
    let testPlan        = null;
    let playwrightScript = null;
    let testResults     = null;

    const runUIFlow = uiTestReport || uiTestScript;

    if (runUIFlow) {
      // ── Step 2.3a: Fetch and analyze page HTML ──────────────────────────────
      console.log(`[${sessionId}] Step 2.3 – Analyzing UI components...`);
      components = await analyzeUI(url);

      // ── Step 2.3b: Generate test plan ────────────────────────────────────────
      console.log(`[${sessionId}] Generating test plan...`);
      testPlan = generateTestPlan(components, url);

      // ── Step 2.3c: Generate Playwright script ─────────────────────────────
      console.log(`[${sessionId}] Generating Playwright script...`);
      playwrightScript = generatePlaywrightScript(url, components, testPlan);

      // Write script file to session folder
      const scriptPath = path.join(sessionDir, 'ui-tests.spec.js');
      fs.writeFileSync(scriptPath, playwrightScript, 'utf8');

      // ── Step 2.3d: Execute Playwright tests ───────────────────────────────
      console.log(`[${sessionId}] Executing UI tests...`);
      testResults = await runUITests(url, components, testPlan);
    }

    // ── Generate PDF Report ───────────────────────────────────────────────────
    console.log(`[${sessionId}] Generating PDF report...`);
    const reportPath = path.join(sessionDir, 'auto-tester-report.pdf');
    await generateReport({
      url,
      basicResults,
      securityResults,
      components,
      testPlan,
      testResults,
      playwrightScript: uiTestScript ? playwrightScript : null,
      reportPath,
      includeScript: !!uiTestScript,
    });

    console.log(`[${sessionId}] Report generated successfully.`);

    return res.json({
      success: true,
      sessionId,
      reportFile: 'auto-tester-report.pdf',
    });
  } catch (err) {
    console.error(`[${sessionId}] Error:`, err);
    // Cleanup on error
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    return res.status(500).json({ success: false, error: err.message || 'Internal server error.' });
  }
});

// ─── Download Endpoint (auto-cleanup after send) ──────────────────────────────
app.get('/api/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;

  // Sanitize – no path traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join(TEMP_DIR, sessionId, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or already downloaded.' });
  }

  res.download(filePath, safeFilename, (err) => {
    if (err) {
      console.error('Download error:', err);
    }
    // ── Cleanup entire session directory after download ──────────────────────
    const sessionDir = path.join(TEMP_DIR, sessionId);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[${sessionId}] Session files cleaned up.`);
    } catch (cleanErr) {
      console.error('Cleanup error:', cleanErr);
    }
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0' }));

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Web Automation testing tool  v1.0.0           ║`);
  console.log(`║   http://localhost:${PORT}               ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

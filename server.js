const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const { runSecurityTest } = require('./src/securityTester');
const { analyzeUI } = require('./src/uiAnalyzer');
const { generateTestPlan } = require('./src/testPlanGenerator');
const { generatePlaywrightScript } = require('./src/playwrightScriptGenerator');
const { runUITests } = require('./src/testRunner');
const { generateReport } = require('./src/reportGenerator');

const app = express();
const PORT = process.env.PORT || 6000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ─── Main Analysis Endpoint ───────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { url, uiTestReport, uiTestScript } = req.body;

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

  const sessionId = uuidv4();
  const sessionDir = path.join(TEMP_DIR, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    console.log(`\n[${sessionId}] Starting analysis for: ${url}`);
    console.log(`[${sessionId}] UI Report: ${uiTestReport} | UI Script: ${uiTestScript}`);

    // ── Step 1: Always run security tests ─────────────────────────────────────
    console.log(`[${sessionId}] Running security tests...`);
    const securityResults = await runSecurityTest(url);

    let components = null;
    let testPlan = null;
    let playwrightScript = null;
    let testResults = null;

    const runUIFlow = uiTestReport || uiTestScript;

    if (runUIFlow) {
      // ── Step 2: Fetch and analyze page HTML ─────────────────────────────────
      console.log(`[${sessionId}] Analyzing UI components...`);
      components = await analyzeUI(url);

      // ── Step 3: Generate test plan ───────────────────────────────────────────
      console.log(`[${sessionId}] Generating test plan...`);
      testPlan = generateTestPlan(components, url);

      // ── Step 4: Generate Playwright script ──────────────────────────────────
      console.log(`[${sessionId}] Generating Playwright script...`);
      playwrightScript = generatePlaywrightScript(url, components, testPlan);

      // Write script file to session folder
      const scriptPath = path.join(sessionDir, 'ui-tests.spec.js');
      fs.writeFileSync(scriptPath, playwrightScript, 'utf8');

      // ── Step 5: Execute Playwright tests ────────────────────────────────────
      console.log(`[${sessionId}] Executing UI tests...`);
      testResults = await runUITests(url, components, testPlan);
    }

    // ── Step 6: Generate PDF Report ───────────────────────────────────────────
    console.log(`[${sessionId}] Generating PDF report...`);
    const reportPath = path.join(sessionDir, 'auto-tester-report.pdf');
    await generateReport({
      url,
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

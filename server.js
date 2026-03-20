const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

require('dotenv').config();

const { runBasicTest }             = require('./src/basicTester');
const { runSecurityTest }          = require('./src/securityTester');
const { analyzeUI }                = require('./src/uiAnalyzer');
const { generateTestPlan }         = require('./src/testPlanGenerator');
const { generatePlaywrightScript } = require('./src/playwrightScriptGenerator');
const { runUITests }               = require('./src/testRunner');
const { generateReport }           = require('./src/reportGenerator');

const app  = express();
const PORT = process.env.PORT || 6000;

// ── reCAPTCHA ─────────────────────────────────────────────────────────────────
// Google provides a permanent test key-pair that always passes verification:
//   Site key  : 6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI
//   Secret key: 6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe
//
// For production set RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY in .env.
// IMPORTANT: site key and secret key must come from the SAME reCAPTCHA pair.
// Set RECAPTCHA_DISABLED=true to bypass the widget on shared hosting / CI.

const RECAPTCHA_SITE_KEY   = process.env.RECAPTCHA_SITE_KEY   || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';
const RECAPTCHA_SECRET     = process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe';
const RECAPTCHA_DISABLED   = process.env.RECAPTCHA_DISABLED   === 'true';
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

// ── GitHub Actions – Playwright webhook runner ────────────────────────────────
// When GITHUB_TOKEN + GITHUB_REPO are set the app offloads Playwright test
// *execution* to a free GitHub Actions workflow and receives results via webhook.
// Steps 2.1, 2.2, 2.3a-c (basic + security + UI analysis + plan + script gen)
// still run synchronously on Hostinger; only `runUITests` is delegated.
//
// Required env vars (Hostinger + GitHub):
//   GITHUB_TOKEN           → PAT with  actions:write  scope
//   GITHUB_REPO            → "owner/repo" (e.g. "princia/auto-tester-demo")
//   GITHUB_REF             → branch to dispatch on (default: "main")
//   GITHUB_PLAYWRIGHT_WORKFLOW → workflow filename (default: "playwright-runner.yml")
//   APP_BASE_URL           → public URL of THIS server (e.g. "https://yourdomain.com")
//   WEBHOOK_SECRET         → shared secret to authenticate webhook POST

const GITHUB_TOKEN               = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO                = process.env.GITHUB_REPO  || '';
const GITHUB_REF                 = process.env.GITHUB_REF   || 'main';
const GITHUB_PLAYWRIGHT_WORKFLOW = process.env.GITHUB_PLAYWRIGHT_WORKFLOW || 'playwright-runner.yml';
const APP_BASE_URL               = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const WEBHOOK_SECRET             = process.env.WEBHOOK_SECRET || 'change-me-in-production';

// True when the app can delegate Playwright execution to GitHub Actions
const useGitHubActionsForPlaywright = () => !!(GITHUB_TOKEN && GITHUB_REPO);

async function verifyRecaptcha(token) {
  if (RECAPTCHA_DISABLED) return true;
  if (!token) return false;
  try {
    const resp = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(RECAPTCHA_SECRET)}&response=${encodeURIComponent(token)}`,
    });
    const data = await resp.json();
    if (!data.success) {
      console.warn('[reCAPTCHA] Verification failed:', data['error-codes'] || 'unknown');
    }
    return data.success === true;
  } catch (err) {
    console.error('[reCAPTCHA] Network error during verification:', err.message);
    return false;
  }
}

// Trigger workflow_dispatch on GitHub Actions
async function triggerGitHubActionsPlaywright(sessionId, url, includeScript) {
  const webhookUrl = `${APP_BASE_URL}/api/webhook/playwright/${sessionId}`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_PLAYWRIGHT_WORKFLOW}/dispatches`;

  console.log(`[${sessionId}] Triggering GitHub Actions workflow: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization':        `Bearer ${GITHUB_TOKEN}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type':         'application/json',
    },
    body: JSON.stringify({
      ref: GITHUB_REF,
      inputs: {
        target_url:      url,
        session_id:      sessionId,
        webhook_url:     webhookUrl,
        include_script:  String(!!includeScript),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  console.log(`[${sessionId}] GitHub Actions workflow dispatched. Webhook: ${webhookUrl}`);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));   // 20 MB – webhook payloads include test results

const publicDir = path.join(__dirname, 'public');

// Server-side placeholder injection (browser cannot read process.env directly)
function renderIndexHtml() {
  const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  return indexHtml
    .replace(/__RECAPTCHA_SITE_KEY__/g, RECAPTCHA_SITE_KEY)
    .replace(/__RECAPTCHA_DISABLED__/g, String(RECAPTCHA_DISABLED));
}

app.get('/', (_req, res) => res.type('html').send(renderIndexHtml()));
app.get('/index.html', (_req, res) => res.type('html').send(renderIndexHtml()));
app.use(express.static(publicDir));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─── Main Analysis Endpoint ───────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { url, uiTestReport, uiTestScript, recaptchaToken } = req.body;

  if (!url) return res.status(400).json({ success: false, error: 'URL is required.' });

  try { new URL(url); }
  catch { return res.status(400).json({ success: false, error: 'Invalid URL format. Please include https://' }); }

  const captchaOk = await verifyRecaptcha(recaptchaToken);
  if (!captchaOk) {
    return res.status(403).json({ success: false, error: 'reCAPTCHA verification failed. Please try again.' });
  }

  const sessionId  = uuidv4();
  const sessionDir = path.join(TEMP_DIR, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  try {
    console.log(`\n[${sessionId}] Starting analysis for: ${url}`);
    console.log(`[${sessionId}] UI Report: ${uiTestReport} | UI Script: ${uiTestScript}`);

    // ── Step 2.1: Basic HTML/CSS/JS analysis (always) ────────────────────────
    console.log(`[${sessionId}] Step 2.1 – Basic analysis...`);
    const basicResults = await runBasicTest(url);

    // ── Step 2.2: Security scan (always) ─────────────────────────────────────
    console.log(`[${sessionId}] Step 2.2 – Security scan...`);
    const securityResults = await runSecurityTest(url);

    const runUIFlow = uiTestReport || uiTestScript;

    let components       = null;
    let testPlan         = null;
    let playwrightScript = null;
    let testResults      = null;

    if (runUIFlow) {
      // ── Step 2.3a: UI component analysis ─────────────────────────────────
      console.log(`[${sessionId}] Step 2.3 – UI component analysis...`);
      components = await analyzeUI(url);

      // ── Step 2.3b: Test plan generation ──────────────────────────────────
      console.log(`[${sessionId}] Generating test plan...`);
      testPlan = generateTestPlan(components, url);

      // ── Step 2.3c: Playwright script generation ───────────────────────────
      console.log(`[${sessionId}] Generating Playwright script...`);
      playwrightScript = generatePlaywrightScript(url, components, testPlan);
      fs.writeFileSync(path.join(sessionDir, 'ui-tests.spec.js'), playwrightScript, 'utf8');

      // ── Step 2.3d: Execute Playwright tests ───────────────────────────────
      if (useGitHubActionsForPlaywright()) {
        // ── ASYNC PATH: delegate to GitHub Actions ──────────────────────────
        // Persist all data the webhook handler will need to build the final PDF
        fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify({
          url, includeScript: !!uiTestScript, createdAt: new Date().toISOString(),
        }));
        fs.writeFileSync(path.join(sessionDir, 'basic.json'),     JSON.stringify(basicResults));
        fs.writeFileSync(path.join(sessionDir, 'security.json'),  JSON.stringify(securityResults));
        fs.writeFileSync(path.join(sessionDir, 'components.json'),JSON.stringify(components));
        fs.writeFileSync(path.join(sessionDir, 'testplan.json'),  JSON.stringify(testPlan));
        if (uiTestScript) {
          fs.writeFileSync(path.join(sessionDir, 'script.js'), playwrightScript, 'utf8');
        }

        // Trigger the GitHub Actions workflow (returns immediately)
        await triggerGitHubActionsPlaywright(sessionId, url, !!uiTestScript);

        // Mark session as pending
        fs.writeFileSync(path.join(sessionDir, 'status.json'), JSON.stringify({
          status: 'pending',
          message: 'Playwright tests are running in GitHub Actions. Results arrive in 2–3 minutes.',
        }));

        console.log(`[${sessionId}] Session pending – waiting for GitHub Actions webhook.`);
        return res.json({
          success: true,
          sessionId,
          status:  'pending',
          message: 'Steps 2.1 and 2.2 complete. Playwright UI tests are queued in GitHub Actions (≈ 2–3 min). The page will auto-check for results.',
        });
      } else {
        // ── SYNC PATH: run Playwright locally ────────────────────────────────
        console.log(`[${sessionId}] Executing UI tests locally...`);
        testResults = await runUITests(url, components, testPlan);
      }
    }

    // ── Generate PDF (synchronous path only) ─────────────────────────────────
    console.log(`[${sessionId}] Generating PDF report...`);
    const reportPath = path.join(sessionDir, 'auto-tester-report.pdf');
    await generateReport({
      url, basicResults, securityResults, components, testPlan, testResults,
      playwrightScript: uiTestScript ? playwrightScript : null,
      reportPath,
      includeScript: !!uiTestScript,
    });

    console.log(`[${sessionId}] Report ready.`);
    return res.json({ success: true, sessionId, reportFile: 'auto-tester-report.pdf' });

  } catch (err) {
    console.error(`[${sessionId}] Error:`, err);
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    return res.status(500).json({ success: false, error: err.message || 'Internal server error.' });
  }
});

// ─── GitHub Actions Webhook Endpoint ─────────────────────────────────────────
// GitHub Actions calls this when Playwright tests finish (2–3 min after dispatch).
app.post('/api/webhook/playwright/:sessionId', async (req, res) => {
  const { sessionId }                                   = req.params;
  const { secret, testResults, playwrightScript: script } = req.body;

  // Authenticate with shared secret
  if (secret !== WEBHOOK_SECRET) {
    console.warn(`[${sessionId}] Webhook rejected – invalid secret.`);
    return res.status(403).json({ error: 'Invalid webhook secret.' });
  }

  const sessionDir  = path.join(TEMP_DIR, sessionId);
  const statusPath  = path.join(sessionDir, 'status.json');

  if (!fs.existsSync(statusPath)) {
    return res.status(404).json({ error: 'Session not found or already cleaned up.' });
  }

  try {
    // Load persisted data
    const meta           = JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'),       'utf8'));
    const basicResults   = JSON.parse(fs.readFileSync(path.join(sessionDir, 'basic.json'),      'utf8'));
    const securityResults= JSON.parse(fs.readFileSync(path.join(sessionDir, 'security.json'),   'utf8'));
    const components     = JSON.parse(fs.readFileSync(path.join(sessionDir, 'components.json'), 'utf8'));
    const testPlan       = JSON.parse(fs.readFileSync(path.join(sessionDir, 'testplan.json'),   'utf8'));

    // Build PDF
    console.log(`[${sessionId}] Webhook received – generating PDF...`);
    const reportPath = path.join(sessionDir, 'auto-tester-report.pdf');
    await generateReport({
      url:             meta.url,
      basicResults,
      securityResults,
      components,
      testPlan,
      testResults:     testResults || null,
      playwrightScript: meta.includeScript ? (script || null) : null,
      reportPath,
      includeScript:   meta.includeScript,
    });

    fs.writeFileSync(statusPath, JSON.stringify({
      status:      'complete',
      reportFile:  'auto-tester-report.pdf',
      completedAt: new Date().toISOString(),
    }));

    console.log(`[${sessionId}] PDF ready via webhook.`);
    return res.json({ success: true });

  } catch (err) {
    console.error(`[${sessionId}] Webhook processing error:`, err);
    fs.writeFileSync(statusPath, JSON.stringify({ status: 'error', error: err.message }));
    return res.status(500).json({ error: err.message });
  }
});

// ─── Session Status Polling Endpoint ──────────────────────────────────────────
// Frontend polls this while waiting for GitHub Actions to finish.
app.get('/api/status/:sessionId', (req, res) => {
  const sessionDir = path.join(TEMP_DIR, req.params.sessionId);
  const statusPath = path.join(sessionDir, 'status.json');

  if (!fs.existsSync(statusPath)) {
    return res.status(404).json({ status: 'not_found' });
  }

  const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

  // Auto-timeout: if still pending after 15 minutes, give up
  if (statusData.status === 'pending') {
    const metaPath = path.join(sessionDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const ageMs = Date.now() - new Date(meta.createdAt).getTime();
      if (ageMs > 15 * 60 * 1000) {
        return res.json({
          status: 'timeout',
          error:  'GitHub Actions did not respond within 15 minutes. ' +
                  'Check your Actions logs for errors, or verify that GITHUB_TOKEN / GITHUB_REPO / APP_BASE_URL are set correctly.',
        });
      }
    }
  }

  return res.json(statusData);
});

// ─── Download Endpoint (auto-cleanup after send) ──────────────────────────────
app.get('/api/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath     = path.join(TEMP_DIR, sessionId, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or already downloaded.' });
  }

  res.download(filePath, safeFilename, (err) => {
    if (err) console.error('Download error:', err);
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
app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  version: '1.0.0',
  githubActionsEnabled: useGitHubActionsForPlaywright(),
}));

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   Web Automation testing tool  v1.0.0           ║`);
  console.log(`║   http://localhost:${PORT}               ║`);
  console.log(`╚══════════════════════════════════════╝`);
  if (useGitHubActionsForPlaywright()) {
    console.log(`\n[GH Actions] Playwright runner: ENABLED → ${GITHUB_REPO}`);
    console.log(`[GH Actions] Webhook base URL:  ${APP_BASE_URL}\n`);
  } else {
    console.log(`\n[GH Actions] Playwright runner: DISABLED (running locally)\n`);
  }
});

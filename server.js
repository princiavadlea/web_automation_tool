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
// Validate GITHUB_REPO format before making API calls
function validateGitHubRepo(repo) {
  if (!repo) throw new Error('GITHUB_REPO is not set in .env');
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    throw new Error(
      `GITHUB_REPO must be in "owner/repo" format (e.g. "acme/auto-tester-demo"). ` +
      `Got: "${repo}"`
    );
  }
}

// Trigger workflow_dispatch on GitHub Actions
async function triggerGitHubActionsPlaywright(sessionId, url, includeScript) {
  validateGitHubRepo(GITHUB_REPO);

  const webhookUrl = `${APP_BASE_URL}/api/webhook/playwright/${sessionId}`;
  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_PLAYWRIGHT_WORKFLOW}/dispatches`;

  console.log(`[${sessionId}] Triggering GitHub Actions workflow: ${apiUrl}`);
  console.log(`[${sessionId}] Branch: ${GITHUB_REF} | Webhook: ${webhookUrl}`);

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
    // Translate common GitHub API error codes into actionable messages
    if (response.status === 401) {
      throw new Error(
        'GitHub API authentication failed (HTTP 401). ' +
        'Check that GITHUB_TOKEN is set correctly in .env and has not expired.'
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GitHub API access denied (HTTP 403). ' +
        'Ensure your GITHUB_TOKEN has the "workflow" scope (repo → Settings → Developer settings → PAT).'
      );
    }
    if (response.status === 404) {
      throw new Error(
        `GitHub API returned 404 for workflow dispatch. This means one of:\n` +
        `  1. The workflow file ".github/workflows/${GITHUB_PLAYWRIGHT_WORKFLOW}" does not exist ` +
        `on the "${GITHUB_REF}" branch of "${GITHUB_REPO}" — push it to GitHub first.\n` +
        `  2. GITHUB_REPO is wrong — current value: "${GITHUB_REPO}" (expected: "owner/repo").\n` +
        `  3. GITHUB_REF branch "${GITHUB_REF}" does not exist in the repository.\n` +
        `Run GET https://autotestertool.omega-x.com/api/config-check to diagnose.`
      );
    }
    if (response.status === 422) {
      throw new Error(
        `GitHub API validation error (HTTP 422): ${text}. ` +
        `Usually means the ref "${GITHUB_REF}" does not exist in "${GITHUB_REPO}".`
      );
    }
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  console.log(`[${sessionId}] GitHub Actions workflow dispatched successfully.`);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));   // 20 MB – webhook payloads include test results

const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─── Main Analysis Endpoint ───────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { url, uiTestReport, uiTestScript } = req.body;

  if (!url) return res.status(400).json({ success: false, error: 'URL is required.' });

  try { new URL(url); }
  catch { return res.status(400).json({ success: false, error: 'Invalid URL format. Please include https://' }); }

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

// ─── GitHub Config Diagnostic Endpoint ────────────────────────────────────────
// Hit GET /api/config-check to verify the GitHub Actions webhook integration.
// Does NOT trigger any workflow — read-only checks only.
app.get('/api/config-check', async (_req, res) => {
  const checks = {
    githubToken:     { ok: false, detail: '' },
    githubRepo:      { ok: false, detail: '' },
    githubRef:       { ok: false, detail: '' },
    workflowFile:    { ok: false, detail: '' },
    appBaseUrl:      { ok: false, detail: '' },
    webhookSecret:   { ok: false, detail: '' },
  };

  // 1. Token present
  if (!GITHUB_TOKEN) {
    checks.githubToken.detail = 'NOT SET — add GITHUB_TOKEN to .env';
  } else {
    checks.githubToken.ok     = true;
    checks.githubToken.detail = `Set (length ${GITHUB_TOKEN.length})`;
  }

  // 2. Repo format
  if (!GITHUB_REPO) {
    checks.githubRepo.detail = 'NOT SET — add GITHUB_REPO=owner/repo to .env';
  } else if (!/^[^/]+\/[^/]+$/.test(GITHUB_REPO)) {
    checks.githubRepo.detail = `Bad format: "${GITHUB_REPO}" — must be "owner/repo" (no https://)`;
  } else {
    checks.githubRepo.ok     = true;
    checks.githubRepo.detail = GITHUB_REPO;
  }

  // 3. APP_BASE_URL
  const defaultBase = `http://localhost:${PORT}`;
  if (APP_BASE_URL === defaultBase) {
    checks.appBaseUrl.detail = `Using default (${defaultBase}) — set APP_BASE_URL to your public domain`;
  } else {
    checks.appBaseUrl.ok     = true;
    checks.appBaseUrl.detail = APP_BASE_URL;
  }

  // 4. Webhook secret
  if (WEBHOOK_SECRET === 'change-me-in-production') {
    checks.webhookSecret.detail = 'Using default placeholder — set a real WEBHOOK_SECRET in .env and in GitHub repo secrets';
  } else {
    checks.webhookSecret.ok     = true;
    checks.webhookSecret.detail = `Set (length ${WEBHOOK_SECRET.length})`;
  }

  // 5+6. Live GitHub API checks (only if token + repo are present)
  if (checks.githubToken.ok && checks.githubRepo.ok) {
    const ghHeaders = {
      'Authorization':        `Bearer ${GITHUB_TOKEN}`,
      'Accept':               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // 5. Verify branch exists
    try {
      const branchRes = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/branches/${GITHUB_REF}`,
        { headers: ghHeaders }
      );
      if (branchRes.ok) {
        checks.githubRef.ok     = true;
        checks.githubRef.detail = `Branch "${GITHUB_REF}" exists in ${GITHUB_REPO}`;
      } else if (branchRes.status === 404) {
        checks.githubRef.detail =
          `Branch "${GITHUB_REF}" not found in ${GITHUB_REPO}. ` +
          `Check GITHUB_REF in .env (current: "${GITHUB_REF}").`;
      } else {
        checks.githubRef.detail = `GitHub API returned HTTP ${branchRes.status}`;
      }
    } catch (err) {
      checks.githubRef.detail = `Network error: ${err.message}`;
    }

    // 6. Verify workflow file exists on that branch
    try {
      const wfPath = `.github/workflows/${GITHUB_PLAYWRIGHT_WORKFLOW}`;
      const wfRes  = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/contents/${wfPath}?ref=${GITHUB_REF}`,
        { headers: ghHeaders }
      );
      if (wfRes.ok) {
        checks.workflowFile.ok     = true;
        checks.workflowFile.detail = `"${wfPath}" exists on branch "${GITHUB_REF}" ✓`;
      } else if (wfRes.status === 404) {
        checks.workflowFile.detail =
          `"${wfPath}" NOT FOUND on branch "${GITHUB_REF}". ` +
          `You must commit and push the workflow file to GitHub before using this feature. ` +
          `Run: git add .github/workflows/${GITHUB_PLAYWRIGHT_WORKFLOW} scripts/run-playwright-webhook.js && git commit -m "Add GHA runner" && git push origin ${GITHUB_REF}`;
      } else {
        checks.workflowFile.detail = `GitHub API returned HTTP ${wfRes.status}`;
      }
    } catch (err) {
      checks.workflowFile.detail = `Network error: ${err.message}`;
    }
  } else {
    checks.githubRef.detail  = 'Skipped (fix GITHUB_TOKEN and GITHUB_REPO first)';
    checks.workflowFile.detail = 'Skipped (fix GITHUB_TOKEN and GITHUB_REPO first)';
  }

  const allOk = Object.values(checks).every(c => c.ok);
  return res.status(allOk ? 200 : 422).json({
    ready:   allOk,
    summary: allOk
      ? '✅ All checks passed — GitHub Actions webhook integration is ready.'
      : '❌ One or more checks failed — see individual items below.',
    checks,
    config: {
      GITHUB_REPO,
      GITHUB_REF,
      GITHUB_PLAYWRIGHT_WORKFLOW,
      APP_BASE_URL,
    },
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

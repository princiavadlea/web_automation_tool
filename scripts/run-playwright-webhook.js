#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
//  run-playwright-webhook.js
//
//  Executed by the GitHub Actions playwright-runner.yml workflow.
//  Runs the full Playwright UI test pipeline against TARGET_URL and POSTs
//  the structured JSON results to WEBHOOK_URL so Hostinger can build the PDF.
//
//  Environment variables (all injected by the GitHub Actions workflow):
//    TARGET_URL      – URL to test
//    SESSION_ID      – UUID linking this run to the Hostinger session
//    WEBHOOK_URL     – Full URL of POST /api/webhook/playwright/:sessionId
//    WEBHOOK_SECRET  – Shared secret validated by the webhook handler
//    INCLUDE_SCRIPT  – "true" | "false" – embed generated .spec.js in the PDF
//
//  Exit codes:
//    0 – Results (pass or fail) successfully POSTed to webhook
//    1 – Fatal error AND webhook POST also failed (double failure)
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const { analyzeUI }               = require('../src/uiAnalyzer');
const { generateTestPlan }        = require('../src/testPlanGenerator');
const { generatePlaywrightScript } = require('../src/playwrightScriptGenerator');
const { runUITests }              = require('../src/testRunner');

// ── Environment ───────────────────────────────────────────────────────────────
const TARGET_URL     = process.env.TARGET_URL     || '';
const SESSION_ID     = process.env.SESSION_ID     || '';
const WEBHOOK_URL    = process.env.WEBHOOK_URL    || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'change-me-in-production';
const INCLUDE_SCRIPT = process.env.INCLUDE_SCRIPT === 'true';

// ── Logging helpers ───────────────────────────────────────────────────────────
const log  = (...args) => console.log('[run-playwright]', ...args);
const logE = (...args) => console.error('[run-playwright] ERROR:', ...args);

// ── Validate required inputs ──────────────────────────────────────────────────
function validateEnv() {
  const missing = [];
  if (!TARGET_URL)  missing.push('TARGET_URL');
  if (!SESSION_ID)  missing.push('SESSION_ID');
  if (!WEBHOOK_URL) missing.push('WEBHOOK_URL');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  try {
    new URL(TARGET_URL);
  } catch {
    throw new Error(`TARGET_URL is not a valid URL: "${TARGET_URL}"`);
  }
  try {
    new URL(WEBHOOK_URL);
  } catch {
    throw new Error(`WEBHOOK_URL is not a valid URL: "${WEBHOOK_URL}"`);
  }
}

// ── POST results to Hostinger webhook ─────────────────────────────────────────
async function postToWebhook(payload) {
  const body = JSON.stringify(payload);
  log(`POSTing results to ${WEBHOOK_URL} (${body.length} bytes)`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30 s timeout

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AutoTesterDemo-GitHubActions/1.0',
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`Webhook returned HTTP ${res.status}: ${text}`);
    }

    log(`Webhook accepted – HTTP ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Build a structured error payload (mirrors testRunner.makeErrorResult) ─────
function buildErrorPayload(detail) {
  return {
    secret: WEBHOOK_SECRET,
    testResults: {
      results: [{
        testId: 'GHA-ERR',
        name:   'GitHub Actions Runner Error',
        category: 'System',
        status: 'FAIL',
        detail,
        duration: 0,
      }],
      summary: { PASS: 0, FAIL: 1, WARN: 0, SKIP: 0 },
      totalTests: 1,
      ranAt: new Date().toISOString(),
    },
    playwrightScript: null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`Starting – session=${SESSION_ID} url=${TARGET_URL}`);

  // ── Step 1: Validate env ────────────────────────────────────────────────────
  validateEnv();

  let testResults     = null;
  let playwrightScript = null;

  try {
    // ── Step 2: Analyse UI (fetch + parse HTML for interactive components) ────
    log('Step 2a: Analysing UI components…');
    const components = await analyzeUI(TARGET_URL);
    log(`  Found ${components.inputs?.length ?? 0} inputs, ${components.buttons?.length ?? 0} buttons`);

    // ── Step 3: Generate test plan ────────────────────────────────────────────
    log('Step 2b: Generating test plan…');
    const testPlan = generateTestPlan(components);
    log(`  Generated ${testPlan?.tests?.length ?? 0} test cases`);

    // ── Step 4: Generate Playwright script (conditionally embed in PDF) ───────
    if (INCLUDE_SCRIPT) {
      log('Step 2c: Generating Playwright script (INCLUDE_SCRIPT=true)…');
      playwrightScript = generatePlaywrightScript(TARGET_URL, components, testPlan);
      log(`  Script generated (${playwrightScript?.length ?? 0} chars)`);
    } else {
      log('Step 2c: Skipping script generation (INCLUDE_SCRIPT=false)');
    }

    // ── Step 5: Run UI tests with Playwright Chromium ────────────────────────
    log('Step 2d: Running Playwright UI tests…');
    testResults = await runUITests(TARGET_URL, components, testPlan);
    const { summary, totalTests } = testResults;
    log(`  Done – ${totalTests} tests | PASS=${summary.PASS} FAIL=${summary.FAIL} WARN=${summary.WARN} SKIP=${summary.SKIP}`);

  } catch (err) {
    logE(`Pipeline error: ${err.message}`);
    logE(err.stack);

    // Send error payload so the session doesn't hang forever on Hostinger
    const payload = buildErrorPayload(
      `GitHub Actions runner encountered an error: ${err.message}`
    );
    try {
      await postToWebhook(payload);
      log('Error payload delivered to webhook.');
    } catch (webhookErr) {
      logE(`Failed to deliver error payload to webhook: ${webhookErr.message}`);
      process.exit(1);
    }
    return; // Exit cleanly after delivering error
  }

  // ── Step 6: POST results to Hostinger webhook ─────────────────────────────
  const payload = {
    secret: WEBHOOK_SECRET,
    testResults,
    playwrightScript: INCLUDE_SCRIPT ? playwrightScript : null,
  };

  try {
    await postToWebhook(payload);
  } catch (webhookErr) {
    logE(`Failed to deliver results to webhook: ${webhookErr.message}`);
    // Log summary to stdout so it appears in the GitHub Actions run log
    log('Test results (could not deliver to webhook):');
    log(JSON.stringify(testResults.summary, null, 2));
    process.exit(1);
  }

  log('All done. Exiting cleanly.');
}

main().catch(err => {
  logE(`Unhandled top-level error: ${err.message}`);
  logE(err.stack);
  process.exit(1);
});

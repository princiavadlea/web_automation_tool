/**
 * testRunner.js
 * Executes UI tests directly against the target URL using the
 * Playwright API (headless Chromium). Returns structured results.
 */

let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = null;
}

const STATUS = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', WARN: 'WARN' };

// ─── Helper ───────────────────────────────────────────────────────────────────
function result(testId, name, category, status, detail, duration = 0) {
  return { testId, name, category, status, detail, duration };
}

async function safeAction(fn, fallback = null) {
  try { return await fn(); } catch { return fallback; }
}

// ─── Test: Page load ──────────────────────────────────────────────────────────
async function testPageLoad(page, url) {
  const start = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const duration = Date.now() - start;
    const status = resp ? resp.status() : 0;

    if (status >= 400) {
      return result('PL-01', 'Page Load', 'Page Load', STATUS.FAIL,
        `Page returned HTTP ${status}`, duration);
    }
    return result('PL-01', 'Page Load', 'Page Load', STATUS.PASS,
      `Page loaded successfully in ${duration}ms (HTTP ${status})`, duration);
  } catch (err) {
    return result('PL-01', 'Page Load', 'Page Load', STATUS.FAIL,
      `Failed to load page: ${err.message}`, Date.now() - start);
  }
}

// ─── Test: Input field validation ─────────────────────────────────────────────
async function testInputField(page, input, index) {
  const results = [];
  const label = input.label || input.name || input.placeholder || `input[${index}]`;
  const selector = input.selector;

  const validValues = {
    email: 'test@example.com', password: 'TestPass123!', tel: '+15551234567',
    url: 'https://example.com', number: '42', date: '2024-06-15',
    search: 'search query', text: 'Valid test input', default: 'Test Input',
  };
  const validValue = validValues[input.type] || validValues.default;

  // Test 1: Field visible & interactable
  const startVis = Date.now();
  const isVisible = await safeAction(() => page.locator(selector).first().isVisible(), false);
  if (!isVisible) {
    results.push(result(`INP-${index}-VIS`, `Input "${label}" – Visibility`, 'Input Field Validation',
      STATUS.SKIP, `Element not visible on page (${selector})`, Date.now() - startVis));
    return results;
  }
  results.push(result(`INP-${index}-VIS`, `Input "${label}" – Visible`, 'Input Field Validation',
    STATUS.PASS, `Field "${label}" is visible and accessible`, Date.now() - startVis));

  // Test 2: Accepts valid data
  const startVal = Date.now();
  try {
    await page.locator(selector).first().fill(validValue);
    const entered = await safeAction(() => page.locator(selector).first().inputValue(), '');
    if (entered.length > 0) {
      results.push(result(`INP-${index}-VAL`, `Input "${label}" – Accepts Valid Data`, 'Input Field Validation',
        STATUS.PASS, `Field accepted valid ${input.type} value: "${validValue}"`, Date.now() - startVal));
    } else {
      results.push(result(`INP-${index}-VAL`, `Input "${label}" – Accepts Valid Data`, 'Input Field Validation',
        STATUS.WARN, `Field filled but value appears empty`, Date.now() - startVal));
    }
  } catch (err) {
    results.push(result(`INP-${index}-VAL`, `Input "${label}" – Accepts Valid Data`, 'Input Field Validation',
      STATUS.FAIL, `Could not fill field: ${err.message}`, Date.now() - startVal));
  }

  // Test 3: Native validation (for typed inputs)
  if (['email', 'tel', 'url', 'number'].includes(input.type)) {
    const startInv = Date.now();
    try {
      await page.locator(selector).first().fill('invalid@@input!!');
      const isValid = await page.locator(selector).first()
        .evaluate(el => (el && typeof el.checkValidity === 'function') ? el.checkValidity() : true);
      results.push(result(`INP-${index}-INV`, `Input "${label}" – Rejects Invalid Data`, 'Input Field Validation',
        isValid ? STATUS.WARN : STATUS.PASS,
        isValid
          ? `Field accepted invalid ${input.type} value (no native validation enforcement)`
          : `Field correctly rejected invalid ${input.type} value`,
        Date.now() - startInv));
    } catch (err) {
      results.push(result(`INP-${index}-INV`, `Input "${label}" – Rejects Invalid Data`, 'Input Field Validation',
        STATUS.SKIP, `Could not test invalid input: ${err.message}`, Date.now() - startInv));
    }
  }

  // Test 4: Required attribute
  if (input.required) {
    const startReq = Date.now();
    const isReq = await safeAction(() =>
      page.locator(selector).first().evaluate(el => el.required), false);
    results.push(result(`INP-${index}-REQ`, `Input "${label}" – Required Attribute`, 'Input Field Validation',
      isReq ? STATUS.PASS : STATUS.FAIL,
      isReq ? 'Required attribute is set on field' : 'Field expected to be required but required attribute missing',
      Date.now() - startReq));
  }

  // Test 5: Max length
  if (input.maxlength) {
    const startMax = Date.now();
    const maxLen = parseInt(input.maxlength);
    const longString = 'A'.repeat(maxLen + 20);
    try {
      await page.locator(selector).first().fill(longString);
      const entered = await safeAction(() => page.locator(selector).first().inputValue(), '');
      const withinLimit = entered.length <= maxLen;
      results.push(result(`INP-${index}-MAX`, `Input "${label}" – Max Length ${maxLen}`, 'Input Field Validation',
        withinLimit ? STATUS.PASS : STATUS.FAIL,
        withinLimit
          ? `Input correctly capped at ${entered.length} chars (max: ${maxLen})`
          : `Input exceeded maxlength: got ${entered.length} chars (max: ${maxLen})`,
        Date.now() - startMax));
    } catch (err) {
      results.push(result(`INP-${index}-MAX`, `Input "${label}" – Max Length`, 'Input Field Validation',
        STATUS.SKIP, `Could not test max length: ${err.message}`, Date.now() - startMax));
    }
  }

  return results;
}

// ─── Test: Select / Dropdown ──────────────────────────────────────────────────
async function testSelect(page, sel, index) {
  const label = sel.label || sel.name || sel.id || `select[${index}]`;
  const start = Date.now();
  try {
    const count = await safeAction(() => page.locator(sel.selector).first().locator('option').count(), 0);
    if (count === 0) {
      return [result(`SEL-${index}`, `Dropdown "${label}" – Has Options`, 'Input Field Validation',
        STATUS.FAIL, 'Dropdown has no options', Date.now() - start)];
    }
    return [result(`SEL-${index}`, `Dropdown "${label}" – Has Options`, 'Input Field Validation',
      STATUS.PASS, `Dropdown has ${count} option(s)`, Date.now() - start)];
  } catch (err) {
    return [result(`SEL-${index}`, `Dropdown "${label}"`, 'Input Field Validation',
      STATUS.SKIP, `Could not test dropdown: ${err.message}`, Date.now() - start)];
  }
}

// ─── Test: Checkbox toggle ────────────────────────────────────────────────────
async function testCheckbox(page, cb, index) {
  const label = cb.label || cb.name || `checkbox[${index}]`;
  const start = Date.now();
  try {
    const checkbox = page.locator(cb.selector).first();
    const isVisible = await safeAction(() => checkbox.isVisible(), false);
    if (!isVisible) {
      return [result(`CB-${index}`, `Checkbox "${label}"`, 'Input Field Validation',
        STATUS.SKIP, 'Checkbox not visible', Date.now() - start)];
    }
    await checkbox.check();
    const checked = await checkbox.isChecked();
    await checkbox.uncheck();
    const unchecked = !(await checkbox.isChecked());
    return [result(`CB-${index}`, `Checkbox "${label}" – Toggle`, 'Input Field Validation',
      (checked && unchecked) ? STATUS.PASS : STATUS.FAIL,
      checked && unchecked ? 'Checkbox toggles correctly' : 'Checkbox toggle failed',
      Date.now() - start)];
  } catch (err) {
    return [result(`CB-${index}`, `Checkbox "${label}"`, 'Input Field Validation',
      STATUS.SKIP, `Could not test checkbox: ${err.message}`, Date.now() - start)];
  }
}

// ─── Test: Navigation links ───────────────────────────────────────────────────
async function testNavLinks(page, url, navLinks) {
  const results = [];
  for (let i = 0; i < Math.min(navLinks.length, 6); i++) {
    const link = navLinks[i];
    const text = link.text || link.href || `link-${i}`;
    const start = Date.now();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const el = page.locator(link.selector).first();
      const isVisible = await safeAction(() => el.isVisible(), false);
      if (!isVisible) {
        results.push(result(`NAV-${i + 1}`, `Nav link "${text}"`, 'Navigation Check',
          STATUS.SKIP, 'Link not visible on page', Date.now() - start));
        continue;
      }
      const [response] = await Promise.all([
        page.waitForNavigation({ timeout: 8000 }).catch(() => null),
        el.click(),
      ]);
      const status = response ? response.status() : 200;
      results.push(result(`NAV-${i + 1}`, `Nav link "${text}"`, 'Navigation Check',
        status < 400 ? STATUS.PASS : STATUS.FAIL,
        status < 400
          ? `Navigated successfully (HTTP ${status})`
          : `Navigation returned HTTP ${status}`,
        Date.now() - start));
    } catch (err) {
      results.push(result(`NAV-${i + 1}`, `Nav link "${text}"`, 'Navigation Check',
        STATUS.FAIL, `Navigation failed: ${err.message}`, Date.now() - start));
    }
  }
  return results;
}

// ─── Test: Broken links (HEAD requests) ──────────────────────────────────────
async function testBrokenLinks(page, url, allLinks) {
  const results = [];
  const baseOrigin = new URL(url).origin;
  const checked = new Set();

  for (const link of allLinks.slice(0, 20)) {
    const href = link.href;
    if (!href || checked.has(href)) continue;
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    checked.add(href);

    const fullUrl = href.startsWith('http') ? href : new URL(href, url).href;
    const start = Date.now();
    try {
      const resp = await page.request.head(fullUrl, { timeout: 6000 });
      const status = resp.status();
      results.push(result(`LNK-${results.length + 1}`, `Link: ${fullUrl.substring(0, 60)}`, 'Navigation Check',
        status < 400 ? STATUS.PASS : STATUS.FAIL,
        `HTTP HEAD → ${status}`,
        Date.now() - start));
    } catch (err) {
      results.push(result(`LNK-${results.length + 1}`, `Link: ${fullUrl.substring(0, 60)}`, 'Navigation Check',
        STATUS.WARN, `HEAD request failed: ${err.message}`, Date.now() - start));
    }
  }
  return results;
}

// ─── Test: Spelling ───────────────────────────────────────────────────────────
async function testSpelling(page, spellingIssues) {
  const results = [];

  if (spellingIssues.length === 0) {
    results.push(result('SPL-01', 'Spelling – No common typos detected', 'Spelling & Grammar',
      STATUS.PASS, 'No known spelling issues found in UI text'));
  } else {
    spellingIssues.forEach((issue, i) => {
      results.push(result(`SPL-${i + 1}`, `Possible typo: "${issue.word}"`, 'Spelling & Grammar',
        STATUS.WARN,
        `"${issue.word}" may be a typo. Suggestion: "${issue.suggestion}". Found in: "${issue.foundIn}"`));
    });
  }

  // Empty button labels
  const start = Date.now();
  try {
    const emptyBtns = await page.locator('button:visible').filter({ hasText: /^\s*$/ }).count();
    results.push(result('SPL-BTN', 'Button labels – Not empty', 'Spelling & Grammar',
      emptyBtns === 0 ? STATUS.PASS : STATUS.WARN,
      emptyBtns === 0 ? 'All visible buttons have label text' : `${emptyBtns} button(s) have empty labels`,
      Date.now() - start));
  } catch {
    results.push(result('SPL-BTN', 'Button labels check', 'Spelling & Grammar', STATUS.SKIP, 'Could not check button labels'));
  }

  return results;
}

// ─── Main runner ──────────────────────────────────────────────────────────────
async function runUITests(url, components, testPlan) {
  if (!playwright) {
    return [{
      testId: 'SYS-01', name: 'Playwright Setup',
      category: 'System', status: STATUS.FAIL,
      detail: 'Playwright package not found. Run: npm install playwright && npx playwright install chromium',
      duration: 0,
    }];
  }

  const allResults = [];
  let browser;

  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      userAgent: 'AutoTesterDemo/1.0 Playwright Runner',
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // ── Page load ──────────────────────────────────────────────────────────
    const loadResult = await testPageLoad(page, url);
    allResults.push(loadResult);
    if (loadResult.status === STATUS.FAIL) {
      return allResults; // Can't continue if page won't load
    }

    // ── Reload to clean state ──────────────────────────────────────────────
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // ── Input field tests ─────────────────────────────────────────────────
    for (let i = 0; i < Math.min(components.inputs.length, 8); i++) {
      const r = await testInputField(page, components.inputs[i], i + 1);
      allResults.push(...r);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    // ── Textarea tests ────────────────────────────────────────────────────
    for (let i = 0; i < Math.min(components.textareas.length, 4); i++) {
      const ta = components.textareas[i];
      const label = ta.label || ta.name || `textarea-${i}`;
      const start = Date.now();
      try {
        const el = page.locator(ta.selector).first();
        const isVis = await safeAction(() => el.isVisible(), false);
        if (!isVis) {
          allResults.push(result(`TA-${i + 1}`, `Textarea "${label}"`, 'Input Field Validation',
            STATUS.SKIP, 'Textarea not visible', Date.now() - start));
        } else {
          await el.fill('Line one\nLine two\nLine three');
          const val = await el.inputValue();
          allResults.push(result(`TA-${i + 1}`, `Textarea "${label}" – Multi-line input`, 'Input Field Validation',
            val.includes('Line one') ? STATUS.PASS : STATUS.WARN,
            val.includes('Line one') ? 'Textarea accepts multi-line input' : 'Multi-line text may not be preserved',
            Date.now() - start));
        }
      } catch (err) {
        allResults.push(result(`TA-${i + 1}`, `Textarea "${label}"`, 'Input Field Validation',
          STATUS.SKIP, `Could not test: ${err.message}`, Date.now() - start));
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    // ── Select tests ──────────────────────────────────────────────────────
    for (let i = 0; i < Math.min(components.selects.length, 4); i++) {
      const r = await testSelect(page, components.selects[i], i + 1);
      allResults.push(...r);
    }

    // ── Checkbox tests ────────────────────────────────────────────────────
    for (let i = 0; i < Math.min(components.checkboxes.length, 4); i++) {
      const r = await testCheckbox(page, components.checkboxes[i], i + 1);
      allResults.push(...r);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    // ── Navigation tests ──────────────────────────────────────────────────
    if (components.navLinks.length > 0) {
      const navResults = await testNavLinks(page, url, components.navLinks);
      allResults.push(...navResults);
    }

    // ── Broken link check ─────────────────────────────────────────────────
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const linkResults = await testBrokenLinks(page, url, components.allLinks);
    allResults.push(...linkResults);

    // ── Spelling ──────────────────────────────────────────────────────────
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const spellResults = await testSpelling(page, components.spellingIssues);
    allResults.push(...spellResults);

    await context.close();
  } catch (err) {
    allResults.push({
      testId: 'SYS-ERR', name: 'Test Runner Error', category: 'System',
      status: STATUS.FAIL, detail: `Unexpected error: ${err.message}`, duration: 0,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // ── Compute summary ────────────────────────────────────────────────────
  const summary = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  allResults.forEach(r => { if (summary[r.status] !== undefined) summary[r.status]++; });

  return { results: allResults, summary, totalTests: allResults.length, ranAt: new Date().toISOString() };
}

module.exports = { runUITests };

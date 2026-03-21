/**
 * reportGenerator.js
 * Generates a professional PDF report using pdfkit.
 * Sections: Cover, Executive Summary,
 *           2.1 Basic HTML/CSS/JS Analysis,
 *           2.2 Security Results,
 *           2.3 UI Test Plan + Playwright Test Results (optional),
 *           Script (optional).
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  bg:         '#0F1117',
  card:       '#1A1D27',
  accent:     '#6C63FF',
  accentLight:'#A78BFA',
  pass:       '#22C55E',
  passLight:  '#DCFCE7',
  fail:       '#EF4444',
  failLight:  '#FEE2E2',
  warn:       '#F59E0B',
  warnLight:  '#FEF3C7',
  info:       '#3B82F6',
  infoLight:  '#DBEAFE',
  skip:       '#6B7280',
  skipLight:  '#F3F4F6',
  high:       '#EF4444',
  medium:     '#F59E0B',
  low:        '#3B82F6',
  critical:   '#7C3AED',
  white:      '#FFFFFF',
  darkText:   '#1E293B',
  mutedText:  '#64748B',
  border:     '#E2E8F0',
};

const SEV_COLOR = {
  PASS:     C.pass,
  INFO:     C.info,
  LOW:      C.low,
  MEDIUM:   C.medium,
  HIGH:     C.high,
  CRITICAL: C.critical,
  FAIL:     C.fail,
  WARN:     C.warn,
  SKIP:     C.skip,
};

const SEV_BG = {
  PASS:     C.passLight,
  INFO:     C.infoLight,
  LOW:      C.infoLight,
  MEDIUM:   C.warnLight,
  HIGH:     C.failLight,
  CRITICAL: '#EDE9FE',
  FAIL:     C.failLight,
  WARN:     C.warnLight,
  SKIP:     C.skipLight,
};

// ─── Drawing helpers ──────────────────────────────────────────────────────────
function badge(doc, text, color, bgColor, x, y, w = 60) {
  const h = 14;
  doc.save()
     .roundedRect(x, y - 10, w, h, 3)
     .fill(bgColor)
     .restore();
  doc.fontSize(7).fillColor(color)
     .text(text, x, y - 8, { width: w, align: 'center' });
}

function sectionHeader(doc, title, subtitle, y) {
  // Purple left bar
  doc.save()
     .rect(50, y, 4, subtitle ? 36 : 22)
     .fill(C.accent)
     .restore();

  doc.fontSize(16).fillColor(C.accent)
     .font('Helvetica-Bold')
     .text(title, 62, y);

  if (subtitle) {
    doc.fontSize(9).fillColor(C.mutedText)
       .font('Helvetica')
       .text(subtitle, 62, y + 20);
  }
  return y + (subtitle ? 46 : 30);
}

function divider(doc, y) {
  doc.save()
     .moveTo(50, y).lineTo(545, y)
     .strokeColor(C.border).lineWidth(0.5)
     .stroke()
     .restore();
  return y + 12;
}

function checkPage(doc, y, needed = 60) {
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    return 50;
  }
  return y;
}

// ─── Cover page ───────────────────────────────────────────────────────────────
function addCoverPage(doc, { url, scannedAt, hasUI, includeScript }) {
  // Dark background
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0F1117');

  // Accent bar top
  doc.rect(0, 0, doc.page.width, 6).fill(C.accent);

  // Title
  doc.fontSize(32).font('Helvetica-Bold').fillColor(C.white)
     .text('Web Automation', 50, 100, { align: 'center' });
  doc.fontSize(32).fillColor(C.accentLight)
     .text('Testing Tool', 50, 138, { align: 'center' });

  doc.fontSize(11).font('Helvetica').fillColor('#94A3B8')
     .text('Automated Security & UI Testing Report - By Princia Vadlea', 50, 190, { align: 'center' });

  // URL card
  const cardY = 240;
  doc.save()
     .roundedRect(100, cardY, doc.page.width - 200, 50, 8)
     .fill('#1A1D27')
     .restore();
  doc.fontSize(8).fillColor(C.mutedText)
     .text('TARGET URL', 120, cardY + 10);
  doc.fontSize(10).fillColor(C.accentLight)
     .font('Helvetica-Bold')
     .text(url.substring(0, 65), 120, cardY + 24, { width: doc.page.width - 240 });

  // Meta info
  const metaY = 320;
  const d = new Date(scannedAt);
  const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  doc.fontSize(9).font('Helvetica').fillColor('#64748B')
     .text(`Scanned on: ${dateStr} at ${timeStr}`, 50, metaY, { align: 'center' });

  // Contents
  const contentsY = metaY + 40;
  doc.fontSize(10).fillColor('#94A3B8')
     .text('Report Contents:', 50, contentsY, { align: 'center' });

  const items = [
    '✓  2.1 Basic HTML/CSS/JS Analysis',
    '✓  2.2 Security Header Analysis',
    '✓  2.2 TLS / HTTPS Verification',
    '✓  2.2 Cookie Security Assessment',
    '✓  2.2 Information Disclosure Check',
  ];
  if (hasUI) {
    items.push('✓  2.3 UI Component Analysis');
    items.push('✓  2.3 Test Plan (Input, Navigation, Spelling)');
    items.push('✓  2.3 Playwright Test Execution Results');
  }
  if (includeScript) items.push('✓  2.3 Playwright Test Script Source');

  items.forEach((item, i) => {
    doc.fontSize(9).fillColor('#CBD5E1')
       .text(item, 50, contentsY + 20 + i * 16, { align: 'center' });
  });

  // Footer
  doc.fontSize(7).fillColor('#334155')
     .text('auto-tester-demo v1.0.0  ·  Files deleted from server after download',
           50, doc.page.height - 40, { align: 'center' });

  doc.addPage();
}

// ─── Executive Summary ────────────────────────────────────────────────────────
function addExecutiveSummary(doc, { basicResults, securityResults, testResults }) {
  let y = 50;
  y = sectionHeader(doc, 'Executive Summary', null, y);
  y = divider(doc, y);

  // ── 2.1 Basic Analysis summary card ─────────────────────────────────────────
  const basSum = basicResults ? (basicResults.summary || {}) : {};
  const basTotal = basicResults ? (basicResults.totalFindings || 0) : 0;
  const basIssues = (basSum.HIGH || 0) + (basSum.CRITICAL || 0) + (basSum.MEDIUM || 0) + (basSum.LOW || 0);

  doc.save().roundedRect(50, y, 495, 70, 8)
     .fill(basIssues > 0 ? '#1A1D27' : '#0F2117').restore();
  doc.save().roundedRect(50, y, 4, 70, 2).fill(basIssues > 0 ? C.warn : C.pass).restore();

  doc.fontSize(11).font('Helvetica-Bold')
     .fillColor(basIssues > 0 ? C.warn : C.pass)
     .text('2.1  Basic HTML/CSS/JS Analysis', 62, y + 8);
  doc.fontSize(9).font('Helvetica').fillColor(C.mutedText)
     .text(`${basTotal} finding(s) · ${basIssues} issue(s) · response ${basicResults ? basicResults.responseTime : '–'}ms`, 62, y + 26);

  const basCols = [
    { label: 'CRITICAL', val: basSum.CRITICAL || 0, col: C.critical },
    { label: 'HIGH',     val: basSum.HIGH     || 0, col: C.high },
    { label: 'MEDIUM',   val: basSum.MEDIUM   || 0, col: C.medium },
    { label: 'LOW',      val: basSum.LOW      || 0, col: C.low },
    { label: 'INFO',     val: basSum.INFO     || 0, col: C.info },
  ];
  basCols.forEach((c, i) => {
    const cx = 62 + i * 86;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(c.col).text(String(c.val), cx, y + 45);
    doc.fontSize(7).font('Helvetica').fillColor(C.mutedText).text(c.label, cx, y + 57);
  });

  y += 88;

  // ── 2.2 Security summary card ────────────────────────────────────────────────
  const secSum = securityResults.summary || {};
  const secTotal = Object.values(secSum).reduce((a, b) => a + b, 0);
  const secPassed = secSum.PASS || 0;
  const secIssues = (secSum.HIGH || 0) + (secSum.CRITICAL || 0) + (secSum.MEDIUM || 0) + (secSum.LOW || 0);

  doc.save().roundedRect(50, y, 495, 70, 8)
     .fill(secIssues > 0 ? '#1A1D27' : '#0F2117').restore();
  doc.save().roundedRect(50, y, 4, 70, 2).fill(secIssues > 0 ? C.warn : C.pass).restore();

  doc.fontSize(11).font('Helvetica-Bold')
     .fillColor(secIssues > 0 ? C.warn : C.pass)
     .text('2.2  Security Scan', 62, y + 8);
  doc.fontSize(9).font('Helvetica').fillColor(C.mutedText)
     .text(`${secTotal} checks performed · ${secPassed} passed · ${secIssues} issue(s) found`, 62, y + 26);

  // Mini counts
  const cols = [
    { label: 'CRITICAL', val: secSum.CRITICAL || 0, col: C.critical },
    { label: 'HIGH',     val: secSum.HIGH     || 0, col: C.high },
    { label: 'MEDIUM',   val: secSum.MEDIUM   || 0, col: C.medium },
    { label: 'LOW',      val: secSum.LOW      || 0, col: C.low },
    { label: 'PASS',     val: secSum.PASS     || 0, col: C.pass },
  ];
  cols.forEach((c, i) => {
    const cx = 62 + i * 86;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(c.col).text(String(c.val), cx, y + 45);
    doc.fontSize(7).font('Helvetica').fillColor(C.mutedText).text(c.label, cx, y + 57);
  });

  y += 88;

  // UI Test summary card (if available)
  if (testResults && testResults.summary) {
    const uiSum = testResults.summary;
    const total = testResults.totalTests || 0;
    const passes = uiSum.PASS || 0;
    const fails = uiSum.FAIL || 0;

    doc.save().roundedRect(50, y, 495, 70, 8)
       .fill('#1A1D27').restore();
    doc.save().roundedRect(50, y, 4, 70, 2)
       .fill(fails > 0 ? C.fail : C.pass).restore();

    doc.fontSize(11).font('Helvetica-Bold')
       .fillColor(fails > 0 ? C.fail : C.pass)
       .text('UI Test Execution', 62, y + 8);
    doc.fontSize(9).font('Helvetica').fillColor(C.mutedText)
       .text(`${total} tests run · ${passes} passed · ${fails} failed · ${uiSum.WARN || 0} warnings`, 62, y + 26);

    const uiCols = [
      { label: 'PASS', val: passes,           col: C.pass },
      { label: 'FAIL', val: fails,             col: C.fail },
      { label: 'WARN', val: uiSum.WARN  || 0, col: C.warn },
      { label: 'SKIP', val: uiSum.SKIP  || 0, col: C.skip },
    ];
    uiCols.forEach((c, i) => {
      const cx = 62 + i * 86;
      doc.fontSize(9).font('Helvetica-Bold').fillColor(c.col).text(String(c.val), cx, y + 45);
      doc.fontSize(7).font('Helvetica').fillColor(C.mutedText).text(c.label, cx, y + 57);
    });
    y += 88;
  }

  // Recommendations preview
  const highFindings = securityResults.findings
    .filter(f => ['HIGH', 'CRITICAL'].includes(f.status))
    .slice(0, 3);

  if (highFindings.length > 0) {
    y = checkPage(doc, y, 40 + highFindings.length * 22);
    y += 12;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.fail)
       .text('Top Issues Requiring Immediate Attention', 50, y);
    y += 18;

    highFindings.forEach(f => {
      doc.fontSize(9).font('Helvetica').fillColor(C.darkText)
         .text(`• [${f.status}] ${f.test}: ${f.detail.substring(0, 80)}`, 58, y,
                { width: 480 });
      y += 18;
    });
  }

  doc.addPage();
}

// ─── 2.1 Basic HTML/CSS/JS Analysis Results ───────────────────────────────────
function addBasicTestResults(doc, basicResults) {
  let y = 50;
  y = sectionHeader(doc,
    '2.1  Basic HTML / CSS / JS Analysis',
    `URL: ${basicResults.url}  ·  Response: ${basicResults.responseTime}ms  ·  ${basicResults.totalFindings} finding(s)`,
    y);
  y = divider(doc, y);

  if (!basicResults.findings || basicResults.findings.length === 0) {
    doc.fontSize(10).font('Helvetica').fillColor(C.pass)
       .text('✓  No issues found in basic analysis.', 58, y);
    doc.addPage();
    return;
  }

  // Group by category
  const groups = {};
  basicResults.findings.forEach(f => {
    (groups[f.category] = groups[f.category] || []).push(f);
  });

  for (const [category, findings] of Object.entries(groups)) {
    y = checkPage(doc, y, 30 + findings.length * 44);

    // Category header
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.darkText)
       .text(category, 50, y);
    y += 18;

    findings.forEach(finding => {
      y = checkPage(doc, y, 44);

      const color = SEV_COLOR[finding.status] || C.mutedText;
      const bg    = SEV_BG[finding.status]    || '#F8FAFC';

      doc.save().roundedRect(50, y - 2, 495, 38, 4).fill(bg).restore();
      doc.save().rect(50, y - 2, 3, 38).fill(color).restore();

      badge(doc, finding.status, color, '#FFFFFF', 450, y + 12, 90);

      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.darkText)
         .text(finding.test, 60, y + 2, { width: 380 });

      doc.fontSize(8).font('Helvetica').fillColor(C.mutedText)
         .text(finding.detail.substring(0, 110), 60, y + 16, { width: 380 });

      if (finding.recommendation) {
        doc.fontSize(7).fillColor(color)
           .text(`▶ ${finding.recommendation.substring(0, 100)}`, 60, y + 27, { width: 380 });
      }

      y += 46;
    });

    y += 8;
  }

  doc.addPage();
}

// ─── 2.2 Security Results ─────────────────────────────────────────────────────
function addSecurityResults(doc, securityResults) {
  let y = 50;
  y = sectionHeader(doc, '2.2  Security Test Results',
    `URL: ${securityResults.url}  ·  Response: ${securityResults.responseTime}ms  ·  HTTP ${securityResults.statusCode || 'N/A'}`, y);
  y = divider(doc, y);

  // Group by category
  const groups = {};
  securityResults.findings.forEach(f => {
    (groups[f.category] = groups[f.category] || []).push(f);
  });

  for (const [category, findings] of Object.entries(groups)) {
    y = checkPage(doc, y, 30 + findings.length * 44);

    // Category header
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.darkText)
       .text(category, 50, y);
    y += 18;

    findings.forEach(finding => {
      y = checkPage(doc, y, 44);

      const color = SEV_COLOR[finding.status] || C.mutedText;
      const bg    = SEV_BG[finding.status]    || '#F8FAFC';

      // Row background
      doc.save().roundedRect(50, y - 2, 495, 38, 4).fill(bg).restore();

      // Left status bar
      doc.save().rect(50, y - 2, 3, 38).fill(color).restore();

      // Badge
      badge(doc, finding.status, color, '#FFFFFF', 450, y + 12, 90);

      // Test name
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.darkText)
         .text(finding.test, 60, y + 2, { width: 380 });

      // Detail
      doc.fontSize(8).font('Helvetica').fillColor(C.mutedText)
         .text(finding.detail.substring(0, 110), 60, y + 16, { width: 380 });

      // Recommendation
      if (finding.recommendation) {
        doc.fontSize(7).fillColor(color)
           .text(`▶ ${finding.recommendation.substring(0, 100)}`, 60, y + 27, { width: 380 });
      }

      y += 46;
    });

    y += 8;
  }

  doc.addPage();
}

// ─── Test Plan ────────────────────────────────────────────────────────────────
function addTestPlan(doc, testPlan, components) {
  let y = 50;
  y = sectionHeader(doc, '2.3  Generated Test Plan',
    `${testPlan.totalTests} test cases · ${testPlan.highPriority} high-priority`, y);
  y = divider(doc, y);

  // Component stats
  const stats = components.stats;
  const statItems = [
    ['Inputs',      stats.inputCount],
    ['Textareas',   stats.textareaCount],
    ['Selects',     stats.selectCount],
    ['Checkboxes',  stats.checkboxCount],
    ['Buttons',     stats.buttonCount],
    ['Nav Links',   stats.navLinkCount],
    ['Forms',       stats.formCount],
  ].filter(s => s[1] > 0);

  if (statItems.length > 0) {
    doc.save().roundedRect(50, y, 495, 36, 6).fill('#F8FAFC').restore();
    doc.fontSize(8).font('Helvetica-Bold').fillColor(C.mutedText)
       .text('COMPONENTS DISCOVERED', 60, y + 6);
    const colW = Math.min(90, 440 / statItems.length);
    statItems.forEach((s, i) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(C.accent)
         .text(String(s[1]), 60 + i * colW, y + 20);
      doc.fontSize(7).font('Helvetica').fillColor(C.mutedText)
         .text(s[0], 60 + i * colW, y + 30);
    });
    y += 50;
  }

  // Sections
  testPlan.sections.forEach(section => {
    y = checkPage(doc, y, 50);

    // Section title
    doc.save().roundedRect(50, y, 495, 28, 4).fill(C.accent).restore();
    doc.fontSize(11).font('Helvetica-Bold').fillColor(C.white)
       .text(`${section.id}  ${section.title}`, 58, y + 7, { width: 440 });
    y += 36;

    doc.fontSize(8.5).font('Helvetica').fillColor(C.mutedText)
       .text(section.description, 58, y, { width: 480 });
    y += 20;

    // Test cases (show first 15 per section)
    section.testCases.slice(0, 15).forEach((tc, i) => {
      y = checkPage(doc, y, 36);

      const isEven = i % 2 === 0;
      doc.save().roundedRect(50, y - 1, 495, 32, 3)
         .fill(isEven ? '#FFFFFF' : '#F8FAFC').restore();
      doc.save().rect(50, y - 1, 2, 32)
         .fill(tc.priority === 'High' ? C.fail : tc.priority === 'Medium' ? C.warn : C.info)
         .restore();

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.darkText)
         .text(`[${tc.id}] ${tc.testCase}`, 58, y + 3, { width: 390 });

      const priColor = tc.priority === 'High' ? C.fail : tc.priority === 'Medium' ? C.warn : C.info;
      doc.fontSize(7).font('Helvetica-Bold').fillColor(priColor)
         .text(tc.priority.toUpperCase(), 460, y + 3, { width: 80 });

      doc.fontSize(7.5).font('Helvetica').fillColor(C.mutedText)
         .text(`Expected: ${tc.expected.substring(0, 90)}`, 58, y + 18, { width: 470 });

      y += 36;
    });

    if (section.testCases.length > 15) {
      doc.fontSize(8).fillColor(C.mutedText)
         .text(`… and ${section.testCases.length - 15} more test case(s)`, 58, y + 4);
      y += 18;
    }

    y += 12;
  });

  doc.addPage();
}

// ─── Test Results ─────────────────────────────────────────────────────────────
function addTestResults(doc, testResults) {
  let y = 50;
  const { results, summary, totalTests, ranAt } = testResults;
  const d = new Date(ranAt);

  y = sectionHeader(doc, '2.3  Playwright Test Execution Results',
    `${totalTests} tests executed at ${d.toLocaleTimeString()}  ·  Pass: ${summary.PASS}  Fail: ${summary.FAIL}  Warn: ${summary.WARN}  Skip: ${summary.SKIP}`,
    y);
  y = divider(doc, y);

  // Summary bar
  const barW = 440;
  const total = totalTests || 1;
  const segments = [
    { label: 'PASS', count: summary.PASS || 0, color: C.pass },
    { label: 'FAIL', count: summary.FAIL || 0, color: C.fail },
    { label: 'WARN', count: summary.WARN || 0, color: C.warn },
    { label: 'SKIP', count: summary.SKIP || 0, color: C.skip },
  ];

  doc.save().roundedRect(50, y, barW + 10, 16, 4).fill('#E2E8F0').restore();
  let bx = 52;
  segments.forEach(s => {
    const w = Math.round((s.count / total) * barW);
    if (w > 0) {
      doc.save().rect(bx, y + 1, w, 14).fill(s.color).restore();
      bx += w;
    }
  });
  y += 24;

  // Legend
  segments.forEach((s, i) => {
    doc.save().circle(60 + i * 110, y + 5, 4).fill(s.color).restore();
    doc.fontSize(8).fillColor(C.mutedText)
       .text(`${s.label}: ${s.count}`, 68 + i * 110, y + 1);
  });
  y += 22;

  // Group by category
  const groups = {};
  results.forEach(r => {
    (groups[r.category] = groups[r.category] || []).push(r);
  });

  for (const [category, categoryResults] of Object.entries(groups)) {
    y = checkPage(doc, y, 30 + categoryResults.length * 36);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(C.darkText)
       .text(category, 50, y);
    y += 16;

    categoryResults.forEach((r, i) => {
      y = checkPage(doc, y, 34);

      const color = SEV_COLOR[r.status] || C.mutedText;
      const bg    = SEV_BG[r.status]    || '#F8FAFC';
      const isEven = i % 2 === 0;

      doc.save().roundedRect(50, y - 1, 495, 30, 3)
         .fill(isEven ? bg : '#FAFAFA').restore();
      doc.save().rect(50, y - 1, 3, 30).fill(color).restore();

      // Status badge
      doc.save().roundedRect(450, y + 4, 88, 14, 3).fill(color).restore();
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#FFFFFF')
         .text(r.status, 452, y + 7, { width: 84, align: 'center' });

      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(C.darkText)
         .text(`[${r.testId}] ${r.name}`, 58, y + 3, { width: 380 });

      doc.fontSize(7.5).font('Helvetica').fillColor(C.mutedText)
         .text(r.detail.substring(0, 100), 58, y + 17, { width: 380 });

      y += 34;
    });

    y += 10;
  }
}

// ─── Playwright Script ────────────────────────────────────────────────────────
function addPlaywrightScript(doc, scriptContent) {
  doc.addPage();
  let y = 50;
  y = sectionHeader(doc, 'Playwright Test Script', 'Generated test script – save as ui-tests.spec.js', y);
  y = divider(doc, y);

  doc.save().roundedRect(50, y, 495, 30, 4).fill('#1E293B').restore();
  doc.fontSize(8).font('Helvetica').fillColor('#94A3B8')
     .text('$ npx playwright test ui-tests.spec.js', 62, y + 10);
  y += 44;

  const lines = scriptContent.split('\n');
  let lineCount = 0;

  for (const line of lines) {
    y = checkPage(doc, y, 12);

    // Syntax highlighting (basic)
    const trimmed = line.trimStart();
    let color = '#1E293B'; // default

    if (trimmed.startsWith('//')) {
      color = '#6B7280';
    } else if (trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ')) {
      color = '#93C5FD'; // blue - declarations
    } else if (trimmed.startsWith('test(') || trimmed.startsWith('test.')) {
      color = '#C084FC'; // purple - test blocks
    } else if (trimmed.includes('await ')) {
      color = '#6EE7B7'; // green - async
    } else if (trimmed.startsWith('expect(')) {
      color = '#FCA5A5'; // red - assertions
    } else if (trimmed.startsWith('async ') || trimmed.startsWith('function')) {
      color = '#FDE68A'; // yellow
    }

    // Print with line number for long files
    if (lines.length > 30 && lineCount % 5 === 0) {
      doc.fontSize(6).fillColor('#374151')
         .text(String(lineCount + 1).padStart(3, ' '), 52, y, { width: 20 });
    }

    doc.fontSize(7).font('Courier').fillColor(color)
       .text(line.substring(0, 110), lines.length > 30 ? 76 : 58, y, { width: 460 });
    y += 10;
    lineCount++;

    if (lineCount > 400) {
      doc.fontSize(8).fillColor(C.mutedText)
         .text(`… script truncated (${lines.length - lineCount} more lines). See downloaded .spec.js file for full script.`,
               58, y + 4);
      break;
    }
  }
}

// ─── Main generateReport ──────────────────────────────────────────────────────
async function generateReport({
  url, basicResults, securityResults,
  components, testPlan, testResults,
  playwrightScript, reportPath, includeScript,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: 'Web Automation testing tool – Security & UI Test Report',
        Author: '- Princia Vadlea',
        Subject: `Security and UI Test Report for ${url}`,
        Creator: 'Web Automation testing tool v1.0.0',
      },
    });

    const stream = fs.createWriteStream(reportPath);
    doc.pipe(stream);

    stream.on('error', reject);
    stream.on('finish', resolve);

    const hasUI = !!(testPlan && testResults);

    // ── Cover page ────────────────────────────────────────────────────────
    addCoverPage(doc, {
      url,
      scannedAt: securityResults.scannedAt || new Date().toISOString(),
      hasUI,
      includeScript: !!includeScript,
    });

    // ── Executive Summary ─────────────────────────────────────────────────
    addExecutiveSummary(doc, { basicResults, securityResults, testResults });

    // ── 2.1 Basic HTML/CSS/JS Analysis ───────────────────────────────────
    if (basicResults) {
      addBasicTestResults(doc, basicResults);
    }

    // ── 2.2 Security Results ──────────────────────────────────────────────
    addSecurityResults(doc, securityResults);

    // ── 2.3 Test Plan (if UI tests were run) ──────────────────────────────
    if (testPlan && components) {
      addTestPlan(doc, testPlan, components);
    }

    // ── 2.3 Test Execution Results ────────────────────────────────────────
    if (testResults && testResults.results) {
      addTestResults(doc, testResults);
    }

    // ── Playwright Script (if both checkboxes checked) ────────────────────
    if (includeScript && playwrightScript) {
      addPlaywrightScript(doc, playwrightScript);
    }

    // ── Back cover / footer ───────────────────────────────────────────────
    const currentY = doc.y || 700;
    if (currentY < doc.page.height - 80) {
      doc.fontSize(7).fillColor(C.mutedText)
         .text(`Report generated by Web Automation testing tool v1.0.0  ·  ${new Date().toISOString()}`,
               50, doc.page.height - 40, { align: 'center', width: 495 });
    }

    doc.end();
  });
}

module.exports = { generateReport };

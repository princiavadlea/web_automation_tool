/**
 * testPlanGenerator.js
 * Generates a structured test plan from the UI components discovered
 * by uiAnalyzer. Covers three main categories:
 *  3.1 Input Field Validation
 *  3.2 Navigation Check
 *  3.3 Spelling & Grammar
 */

function generateTestPlan(components, url) {
  const plan = {
    url,
    pageTitle: components.pageTitle,
    generatedAt: new Date().toISOString(),
    sections: [],
  };

  // ── 3.1 Input Field Validation ────────────────────────────────────────────
  const inputCases = [];

  // Text-like inputs
  components.inputs.forEach(input => {
    const label = input.label || input.name || input.placeholder || input.id || `input[type=${input.type}]`;

    // Valid data test
    inputCases.push({
      id: `INP-${inputCases.length + 1}`,
      component: label,
      selector: input.selector,
      type: 'Input Field',
      testCase: `Verify "${label}" accepts valid data`,
      steps: [
        `Navigate to ${url}`,
        `Locate element: ${input.selector}`,
        `Enter valid ${input.type} value`,
        `Verify field accepts the input without error`,
      ],
      expected: 'Field accepts valid data without validation errors',
      priority: 'High',
    });

    // Invalid data test
    if (['email', 'tel', 'url', 'number', 'date'].includes(input.type)) {
      inputCases.push({
        id: `INP-${inputCases.length + 1}`,
        component: label,
        selector: input.selector,
        type: 'Input Field',
        testCase: `Verify "${label}" rejects invalid ${input.type} data`,
        steps: [
          `Navigate to ${url}`,
          `Locate element: ${input.selector}`,
          `Enter invalid ${input.type} value (e.g. "invalid@@##data")`,
          `Attempt to submit the form`,
          `Verify validation error appears`,
        ],
        expected: `Validation error displayed for invalid ${input.type} format`,
        priority: 'High',
      });
    }

    // Required field test
    if (input.required) {
      inputCases.push({
        id: `INP-${inputCases.length + 1}`,
        component: label,
        selector: input.selector,
        type: 'Input Field',
        testCase: `Verify "${label}" is required and cannot be left empty`,
        steps: [
          `Navigate to ${url}`,
          `Leave "${label}" empty`,
          `Attempt to submit form`,
          `Verify required-field error is shown`,
        ],
        expected: 'Required field validation error displayed',
        priority: 'High',
      });
    }

    // Max length test
    if (input.maxlength) {
      inputCases.push({
        id: `INP-${inputCases.length + 1}`,
        component: label,
        selector: input.selector,
        type: 'Input Field',
        testCase: `Verify "${label}" respects maxlength of ${input.maxlength}`,
        steps: [
          `Navigate to ${url}`,
          `Enter a string of ${parseInt(input.maxlength) + 10} characters into "${label}"`,
          `Verify field truncates or rejects input exceeding ${input.maxlength} characters`,
        ],
        expected: `Input is limited to ${input.maxlength} characters`,
        priority: 'Medium',
      });
    }
  });

  // Textareas
  components.textareas.forEach(ta => {
    const label = ta.label || ta.name || ta.placeholder || ta.id || 'textarea';
    inputCases.push({
      id: `INP-${inputCases.length + 1}`,
      component: label,
      selector: ta.selector,
      type: 'Textarea',
      testCase: `Verify textarea "${label}" accepts multi-line text`,
      steps: [
        `Navigate to ${url}`,
        `Locate element: ${ta.selector}`,
        `Enter multi-line text (3+ lines)`,
        `Verify all content is stored and displayed correctly`,
      ],
      expected: 'Textarea accepts and displays multi-line input correctly',
      priority: 'Medium',
    });

    if (ta.required) {
      inputCases.push({
        id: `INP-${inputCases.length + 1}`,
        component: label,
        selector: ta.selector,
        type: 'Textarea',
        testCase: `Verify textarea "${label}" required validation`,
        steps: [
          `Navigate to ${url}`,
          `Leave "${label}" empty`,
          `Submit the form`,
          `Verify required error is displayed`,
        ],
        expected: 'Required field validation shown for empty textarea',
        priority: 'High',
      });
    }
  });

  // Dropdowns
  components.selects.forEach(sel => {
    const label = sel.label || sel.name || sel.id || 'select';
    inputCases.push({
      id: `INP-${inputCases.length + 1}`,
      component: label,
      selector: sel.selector,
      type: 'Dropdown / Select',
      testCase: `Verify dropdown "${label}" displays correct options`,
      steps: [
        `Navigate to ${url}`,
        `Locate dropdown: ${sel.selector}`,
        `Click the dropdown to open option list`,
        `Verify all expected options are present (${sel.options.slice(0, 3).join(', ')}…)`,
        `Select each option and verify it is applied`,
      ],
      expected: 'Dropdown renders all options; selected value is applied',
      priority: 'Medium',
    });
  });

  // Checkboxes
  components.checkboxes.forEach(cb => {
    const label = cb.label || cb.name || cb.id || 'checkbox';
    inputCases.push({
      id: `INP-${inputCases.length + 1}`,
      component: label,
      selector: cb.selector,
      type: 'Checkbox',
      testCase: `Verify checkbox "${label}" can be checked and unchecked`,
      steps: [
        `Navigate to ${url}`,
        `Click checkbox: ${cb.selector}`,
        `Verify checkbox becomes checked`,
        `Click again`,
        `Verify checkbox becomes unchecked`,
      ],
      expected: 'Checkbox toggles between checked and unchecked states',
      priority: 'Low',
    });
  });

  plan.sections.push({
    id: '3.1',
    title: 'Input Field Validation',
    description: 'Verify that all input components accept correct data, reject invalid inputs, and respect constraints.',
    testCases: inputCases,
  });

  // ── 3.2 Navigation Check ──────────────────────────────────────────────────
  const navCases = [];

  // Button navigation
  components.buttons.forEach(btn => {
    const text = btn.text || btn.id || `button[type=${btn.type}]`;
    navCases.push({
      id: `NAV-${navCases.length + 1}`,
      component: text,
      selector: btn.selector,
      type: 'Button',
      testCase: `Verify button "${text}" triggers expected action`,
      steps: [
        `Navigate to ${url}`,
        `Locate button: ${btn.selector}`,
        `Click the button`,
        `Verify page responds correctly (no 404, redirect works, action completes)`,
      ],
      expected: 'Button triggers the expected navigation or action',
      priority: btn.type === 'submit' ? 'High' : 'Medium',
    });
  });

  // Nav links
  components.navLinks.slice(0, 15).forEach(link => {
    navCases.push({
      id: `NAV-${navCases.length + 1}`,
      component: link.text || link.href,
      selector: link.selector,
      type: 'Navigation Link',
      testCase: `Verify nav link "${link.text || link.href}" navigates correctly`,
      steps: [
        `Navigate to ${url}`,
        `Click navigation link: "${link.text}" (href: ${link.href})`,
        `Verify page loads without HTTP errors`,
        `Verify URL changes to expected destination`,
      ],
      expected: `Link navigates to ${link.href} without errors`,
      priority: 'Medium',
    });
  });

  // Broken link detection
  navCases.push({
    id: `NAV-${navCases.length + 1}`,
    component: 'All page links',
    selector: 'a[href]',
    type: 'Link Integrity',
    testCase: 'Check for broken links (404 / unreachable)',
    steps: [
      `Navigate to ${url}`,
      `Collect all anchor href values`,
      `HTTP HEAD request each link`,
      `Flag any link returning 4xx or 5xx status`,
    ],
    expected: 'All navigation links return HTTP 2xx or 3xx responses',
    priority: 'High',
  });

  plan.sections.push({
    id: '3.2',
    title: 'Navigation Check',
    description: 'Confirm that menus, links, and buttons navigate users to the correct pages.',
    testCases: navCases,
  });

  // ── 3.3 Spelling & Grammar ────────────────────────────────────────────────
  const spellCases = [];

  // Add detected issues
  components.spellingIssues.forEach((issue, i) => {
    spellCases.push({
      id: `SPL-${i + 1}`,
      component: `Word: "${issue.word}"`,
      selector: 'n/a',
      type: 'Spelling',
      testCase: `Possible typo detected: "${issue.word}"`,
      steps: [
        `Search the page for "${issue.word}"`,
        `Verify if the intended word is "${issue.suggestion}"`,
        `Correct the spelling if needed`,
      ],
      expected: `"${issue.word}" should be "${issue.suggestion}" (verify context)`,
      foundIn: issue.foundIn,
      priority: 'Low',
    });
  });

  // General grammar checks
  const generalSpellCases = [
    {
      id: `SPL-${spellCases.length + 1}`,
      component: 'All button labels',
      selector: 'button, input[type="submit"]',
      type: 'UI Copy',
      testCase: 'Verify button labels are clear and concise',
      steps: [
        `Enumerate all buttons on the page`,
        `Check each label is descriptive (not "Click here", "Submit", "Go" without context)`,
        `Verify consistent capitalization style (title case or sentence case)`,
      ],
      expected: 'All buttons have meaningful, consistent labels',
      priority: 'Low',
    },
    {
      id: `SPL-${spellCases.length + 2}`,
      component: 'All form labels & placeholders',
      selector: 'label, [placeholder]',
      type: 'UI Copy',
      testCase: 'Verify form labels and placeholders have no typos',
      steps: [
        `Review all <label> texts and placeholder attributes`,
        `Check for spelling errors, grammatical issues, and unclear language`,
        `Ensure placeholder text is instructive (e.g. "Enter your email")`,
      ],
      expected: 'All labels and placeholders are grammatically correct and clear',
      priority: 'Low',
    },
    {
      id: `SPL-${spellCases.length + 3}`,
      component: 'Page headings & paragraph text',
      selector: 'h1, h2, h3, p',
      type: 'Content',
      testCase: 'Manual review: check all headings and body text for typos',
      steps: [
        `Read through all visible text on the page`,
        `Pay attention to headings (H1–H3), paragraph text, and list items`,
        `Run through a spell checker tool or browser extension`,
      ],
      expected: 'No spelling or grammatical errors in visible content',
      priority: 'Low',
    },
  ];

  spellCases.push(...generalSpellCases);

  plan.sections.push({
    id: '3.3',
    title: 'Spelling & Grammar',
    description: 'Check all text for typos in labels, buttons, and content.',
    testCases: spellCases,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  plan.totalTests = plan.sections.reduce((sum, s) => sum + s.testCases.length, 0);
  plan.highPriority = plan.sections
    .flatMap(s => s.testCases)
    .filter(t => t.priority === 'High').length;

  return plan;
}

module.exports = { generateTestPlan };

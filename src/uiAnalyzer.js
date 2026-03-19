/**
 * uiAnalyzer.js
 * Fetches a page with node-fetch and parses with node-html-parser
 * to identify interactive UI components.
 */

const { Agent } = require('undici');
const { parse } = require('node-html-parser');

const INSECURE_DISPATCHER = new Agent({ connect: { rejectUnauthorized: false } });

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clean(str) {
  return (str || '').replace(/\s+/g, ' ').trim().substring(0, 120);
}

function getAttr(el, ...names) {
  for (const n of names) {
    const v = el.getAttribute(n);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function buildSelector(el, tag) {
  const id = el.getAttribute('id');
  if (id) return `#${id}`;
  const name = el.getAttribute('name');
  if (name) return `${tag}[name="${name}"]`;
  const type = el.getAttribute('type');
  if (type) return `${tag}[type="${type}"]`;
  return tag;
}

function findLabel(root, el) {
  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return clean(ariaLabel);
  // for= matching
  const id = el.getAttribute('id');
  if (id) {
    const lbl = root.querySelector(`label[for="${id}"]`);
    if (lbl) return clean(lbl.text);
  }
  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ref = root.querySelector(`#${labelledBy}`);
    if (ref) return clean(ref.text);
  }
  // placeholder fallback
  const ph = el.getAttribute('placeholder');
  if (ph) return clean(ph);
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function analyzeUI(url) {
  const response = await fetchWithTimeout(url, {
    dispatcher: url.startsWith('https') ? INSECURE_DISPATCHER : undefined,
    headers: {
      'User-Agent': 'AutoTesterDemo/1.0 UI Analyzer',
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
  }, 15000);

  if (!response.ok) {
    throw new Error(`Failed to fetch page: HTTP ${response.status}`);
  }

  const html = await response.text();
  const root = parse(html, { script: false, style: false, comment: false });

  const titleEl = root.querySelector('title');
  const pageTitle = titleEl ? clean(titleEl.text) : '(no title)';

  // ── Inputs ────────────────────────────────────────────────────────────────
  const inputs = [];
  const SKIP_TYPES = new Set(['submit', 'button', 'reset', 'image', 'hidden', 'file']);
  root.querySelectorAll('input').forEach(el => {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (SKIP_TYPES.has(type)) return;
    inputs.push({
      type,
      id: el.getAttribute('id') || null,
      name: el.getAttribute('name') || null,
      placeholder: el.getAttribute('placeholder') || null,
      label: findLabel(root, el),
      required: el.hasAttribute('required'),
      maxlength: el.getAttribute('maxlength') || null,
      pattern: el.getAttribute('pattern') || null,
      selector: buildSelector(el, 'input'),
    });
  });

  // ── Textareas ─────────────────────────────────────────────────────────────
  const textareas = [];
  root.querySelectorAll('textarea').forEach(el => {
    textareas.push({
      id: el.getAttribute('id') || null,
      name: el.getAttribute('name') || null,
      placeholder: el.getAttribute('placeholder') || null,
      label: findLabel(root, el),
      required: el.hasAttribute('required'),
      maxlength: el.getAttribute('maxlength') || null,
      selector: buildSelector(el, 'textarea'),
    });
  });

  // ── Selects ───────────────────────────────────────────────────────────────
  const selects = [];
  root.querySelectorAll('select').forEach(el => {
    const options = el.querySelectorAll('option').map(o => clean(o.text)).filter(Boolean).slice(0, 10);
    selects.push({
      id: el.getAttribute('id') || null,
      name: el.getAttribute('name') || null,
      label: findLabel(root, el),
      options,
      required: el.hasAttribute('required'),
      selector: buildSelector(el, 'select'),
    });
  });

  // ── Checkboxes & Radios ───────────────────────────────────────────────────
  const checkboxes = [];
  const radios = [];
  root.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach(el => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const item = {
      id: el.getAttribute('id') || null,
      name: el.getAttribute('name') || null,
      value: el.getAttribute('value') || null,
      label: findLabel(root, el),
      required: el.hasAttribute('required'),
      selector: buildSelector(el, 'input'),
    };
    if (type === 'checkbox') checkboxes.push(item);
    else radios.push(item);
  });

  // ── Buttons ───────────────────────────────────────────────────────────────
  const buttons = [];
  root.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"]').forEach(el => {
    const text = clean(el.text || el.getAttribute('value') || el.getAttribute('aria-label') || '');
    buttons.push({
      type: el.getAttribute('type') || 'button',
      text,
      id: el.getAttribute('id') || null,
      selector: buildSelector(el, el.tagName.toLowerCase()),
    });
  });

  // ── Nav Links ─────────────────────────────────────────────────────────────
  const navLinks = [];
  const seenHrefs = new Set();
  const NAV_SELECTORS = ['nav a', 'header a', '[role="navigation"] a', '.nav a', '.navbar a', '.menu a'];
  NAV_SELECTORS.forEach(sel => {
    try {
      root.querySelectorAll(sel).forEach(el => {
        const href = el.getAttribute('href') || '';
        const text = clean(el.text || el.getAttribute('aria-label') || '');
        if (href && text && !href.startsWith('#') && !seenHrefs.has(href)) {
          seenHrefs.add(href);
          navLinks.push({ text, href, selector: `a[href="${href}"]` });
        }
      });
    } catch {}
  });

  // ── All links ─────────────────────────────────────────────────────────────
  const allLinks = [];
  root.querySelectorAll('a[href]').forEach(el => {
    const href = el.getAttribute('href') || '';
    const text = clean(el.text || el.getAttribute('aria-label') || '');
    if (href && !href.startsWith('javascript:') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
      allLinks.push({ text, href, selector: `a[href="${href}"]` });
    }
  });

  // ── Forms ─────────────────────────────────────────────────────────────────
  const forms = [];
  root.querySelectorAll('form').forEach(el => {
    forms.push({
      id: el.getAttribute('id') || null,
      action: el.getAttribute('action') || '',
      method: (el.getAttribute('method') || 'GET').toUpperCase(),
      hasInputs: el.querySelectorAll('input, textarea, select').length,
      hasSubmit: el.querySelectorAll('[type="submit"]').length > 0,
      selector: `form${el.getAttribute('id') ? '#' + el.getAttribute('id') : ''}`,
    });
  });

  // ── Text content for spell check ──────────────────────────────────────────
  // Strip scripts/styles manually from text
  const rawText = root.text.replace(/\s+/g, ' ').trim().substring(0, 8000);

  const uiLabels = [];
  ['label', 'button', 'h1', 'h2', 'h3', 'h4', 'p', 'li', 'th', 'td'].forEach(tag => {
    try {
      root.querySelectorAll(tag).forEach(el => {
        const text = clean(el.text);
        if (text && text.length > 1 && text.length < 200) uiLabels.push(text);
      });
    } catch {}
  });

  // aria-label attributes
  root.querySelectorAll('[aria-label]').forEach(el => {
    const text = clean(el.getAttribute('aria-label') || '');
    if (text) uiLabels.push(text);
  });

  // placeholder attributes
  root.querySelectorAll('[placeholder]').forEach(el => {
    const text = clean(el.getAttribute('placeholder') || '');
    if (text) uiLabels.push(text);
  });

  const spellingIssues = detectSpellingIssues([...new Set(uiLabels)]);

  return {
    url,
    pageTitle,
    inputs,
    textareas,
    selects,
    checkboxes,
    radios,
    buttons,
    navLinks,
    allLinks: allLinks.slice(0, 50),
    forms,
    pageText: rawText,
    uiLabels: [...new Set(uiLabels)].slice(0, 100),
    spellingIssues,
    stats: {
      inputCount: inputs.length,
      textareaCount: textareas.length,
      selectCount: selects.length,
      checkboxCount: checkboxes.length,
      radioCount: radios.length,
      buttonCount: buttons.length,
      navLinkCount: navLinks.length,
      formCount: forms.length,
      totalLinks: allLinks.length,
    },
  };
}

// ─── Spelling heuristics ──────────────────────────────────────────────────────
const COMMON_TYPOS = {
  'teh': 'the', 'recieve': 'receive', 'occured': 'occurred', 'seperate': 'separate',
  'definately': 'definitely', 'accomodate': 'accommodate', 'occurance': 'occurrence',
  'publically': 'publicly', 'neccessary': 'necessary', 'adress': 'address',
  'begining': 'beginning', 'beleive': 'believe', 'calender': 'calendar',
  'cemetary': 'cemetery', 'collegue': 'colleague', 'comming': 'coming',
  'concious': 'conscious', 'dissapear': 'disappear', 'enviroment': 'environment',
  'existance': 'existence', 'finaly': 'finally', 'goverment': 'government',
  'happend': 'happened', 'independant': 'independent', 'knowlege': 'knowledge',
  'liscense': 'license', 'maintainance': 'maintenance', 'millenium': 'millennium',
  'mispelled': 'misspelled', 'occassion': 'occasion', 'peice': 'piece',
  'persue': 'pursue', 'plagarism': 'plagiarism', 'posession': 'possession',
  'priviledge': 'privilege', 'proffesor': 'professor', 'reccomend': 'recommend',
  'relevent': 'relevant', 'responsability': 'responsibility', 'restaraunt': 'restaurant',
  'rythm': 'rhythm', 'sieze': 'seize', 'succesful': 'successful',
  'suprise': 'surprise', 'tendancy': 'tendency', 'tommorrow': 'tomorrow',
  'truely': 'truly', 'untill': 'until', 'vaccum': 'vacuum', 'wierd': 'weird',
};

function detectSpellingIssues(labels) {
  const issues = [];
  const seen = new Set();
  labels.forEach(label => {
    const words = label.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    words.forEach(word => {
      if (COMMON_TYPOS[word] && !seen.has(word)) {
        seen.add(word);
        issues.push({ word, suggestion: COMMON_TYPOS[word], foundIn: label.substring(0, 60) });
      }
    });
  });
  return issues;
}

module.exports = { analyzeUI };

/**
 * basicTester.js
 * Step 2.1 – Static analysis of page source code.
 * Checks: old/vulnerable JS libraries, spelling, color contrast (WCAG AA),
 *         deprecated HTML, missing meta tags, accessibility/UX issues,
 *         performance hints, and SRI integrity attributes.
 *
 * No browser required – everything runs against raw HTML from node-fetch.
 */

'use strict';

const { Agent }  = require('undici');
const { parse }  = require('node-html-parser');

const INSECURE_DISPATCHER = new Agent({ connect: { rejectUnauthorized: false } });

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const SEV = { PASS: 'PASS', INFO: 'INFO', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

// ══════════════════════════════════════════════════════════════════════════════
//  1. OLD / VULNERABLE JS LIBRARY DETECTION
// ══════════════════════════════════════════════════════════════════════════════

const OLD_LIB_PATTERNS = [
  {
    re: /jquery[.\-/]?([12])\.\d+(?:\.\d+)?(?:\.min)?\.js/i,
    name: 'jQuery 1.x / 2.x',
    severity: SEV.HIGH,
    detail: v => `${v} detected – contains multiple known XSS and prototype-pollution CVEs (end-of-life).`,
    rec: 'Upgrade to jQuery 3.7+ or migrate to vanilla JS / native fetch.',
  },
  {
    re: /jquery[.\-/]?3\.[0-5]\.\d+(?:\.min)?\.js/i,
    name: 'jQuery 3.0 – 3.5 (outdated)',
    severity: SEV.MEDIUM,
    detail: v => `${v} detected – several CVEs fixed in later 3.x releases.`,
    rec: 'Upgrade to jQuery 3.7+.',
  },
  {
    re: /bootstrap[.\-/]?([23])\.\d+(?:\.\d+)?(?:\.min)?\.(?:js|css)/i,
    name: 'Bootstrap 2.x / 3.x',
    severity: SEV.MEDIUM,
    detail: v => `${v} detected – Bootstrap 2/3 is end-of-life and has known XSS issues in tooltip/popover.`,
    rec: 'Migrate to Bootstrap 5.x.',
  },
  {
    re: /bootstrap[.\-/]?4\.\d+(?:\.\d+)?(?:\.min)?\.(?:js|css)/i,
    name: 'Bootstrap 4.x',
    severity: SEV.LOW,
    detail: v => `${v} detected – Bootstrap 4 is in maintenance-only mode.`,
    rec: 'Consider migrating to Bootstrap 5 for modern CSS Grid support.',
  },
  {
    re: /angular(?:js)?[.\-/]?1\.\d+(?:\.\d+)?(?:\.min)?\.js/i,
    name: 'AngularJS 1.x',
    severity: SEV.HIGH,
    detail: v => `${v} detected – AngularJS reached end-of-life December 31 2021 with no further security patches.`,
    rec: 'Migrate to Angular 17+ or another supported framework.',
  },
  {
    re: /(?:react(?:\.development|\.production\.min)?\.js|react[.\-/](?:1[0-7])\.\d)/i,
    name: 'React (outdated build)',
    severity: SEV.LOW,
    detail: v => `${v} detected – older React version or development build in production.`,
    rec: 'Upgrade to React 18+ and use the production-minified build.',
  },
  {
    re: /vue(?:\.runtime)?[.\-/]?2\.\d+(?:\.\d+)?(?:\.min)?\.js/i,
    name: 'Vue.js 2.x',
    severity: SEV.MEDIUM,
    detail: v => `${v} detected – Vue 2 reached end-of-life December 31 2023.`,
    rec: 'Migrate to Vue 3.',
  },
  {
    re: /moment(?:\.min)?\.js/i,
    name: 'Moment.js',
    severity: SEV.INFO,
    detail: () => 'Moment.js is in maintenance-only mode and adds significant bundle weight.',
    rec: 'Replace with date-fns, Luxon, or Day.js for a smaller, maintained alternative.',
  },
  {
    re: /prototype(?:\.min)?\.js|prototype-\d/i,
    name: 'Prototype.js',
    severity: SEV.HIGH,
    detail: () => 'Prototype.js is unmaintained and conflicts with modern JavaScript builtins.',
    rec: 'Remove Prototype.js entirely and use native JavaScript.',
  },
  {
    re: /mootools[.\-/]?\d+(?:\.min)?\.js/i,
    name: 'MooTools',
    severity: SEV.MEDIUM,
    detail: () => 'MooTools is unmaintained (last release 2016) and extends native prototypes dangerously.',
    rec: 'Remove MooTools and migrate to vanilla JS or a maintained library.',
  },
  {
    re: /dojo[.\-/]?\d+\.\d+(?:\.min)?\.js/i,
    name: 'Dojo Toolkit (outdated)',
    severity: SEV.LOW,
    detail: () => 'Dojo Toolkit detected – rarely maintained, heavy dependency.',
    rec: 'Evaluate modern alternatives.',
  },
];

function checkOldLibraries(root) {
  const findings = [];
  const scripts = root.querySelectorAll('script[src], link[href]');
  const checked = new Set();

  scripts.forEach(el => {
    const src = (el.getAttribute('src') || el.getAttribute('href') || '').toLowerCase();
    if (!src || checked.has(src)) return;
    checked.add(src);

    for (const lib of OLD_LIB_PATTERNS) {
      const m = src.match(lib.re);
      if (m) {
        const version = m[0].replace(/^.*?([\d.]+(?:\.min)?\.(?:js|css)).*$/i, '$1');
        findings.push({
          category: 'JavaScript Libraries',
          test: `${lib.name} detected`,
          status: lib.severity,
          detail: lib.detail(version),
          recommendation: lib.rec,
        });
        break;
      }
    }

    // SRI check for external CDN scripts
    if ((src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) &&
        !el.getAttribute('integrity') && el.tagName === 'SCRIPT') {
      findings.push({
        category: 'JavaScript Libraries',
        test: `Missing SRI integrity attribute on external script`,
        status: SEV.LOW,
        detail: `External script loaded without Subresource Integrity (SRI): …${src.slice(-60)}`,
        recommendation: 'Add integrity and crossorigin attributes to verify third-party script content.',
      });
    }
  });

  if (findings.filter(f => f.category === 'JavaScript Libraries' && f.status !== SEV.PASS).length === 0) {
    findings.push({
      category: 'JavaScript Libraries',
      test: 'No known outdated libraries detected',
      status: SEV.PASS,
      detail: 'No references to known outdated or end-of-life JavaScript libraries found.',
      recommendation: null,
    });
  }
  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
//  2. HTML STRUCTURE & BEST PRACTICES
// ══════════════════════════════════════════════════════════════════════════════

const DEPRECATED_TAGS = ['font','center','marquee','blink','strike','tt','big','small','frame','frameset','noframes','acronym','applet','basefont','dir','isindex','listing','menu','plaintext','s','xmp'];

function checkHtmlStructure(html, root) {
  const findings = [];

  // DOCTYPE
  findings.push({
    category: 'HTML Structure',
    test: 'DOCTYPE declaration',
    status: html.trimStart().toLowerCase().startsWith('<!doctype html') ? SEV.PASS : SEV.MEDIUM,
    detail: html.trimStart().toLowerCase().startsWith('<!doctype html')
      ? 'HTML5 DOCTYPE is present.'
      : 'DOCTYPE missing or non-HTML5. Browsers may enter quirks mode.',
    recommendation: html.trimStart().toLowerCase().startsWith('<!doctype html') ? null : 'Add <!DOCTYPE html> as the first line of every HTML page.',
  });

  // lang attribute
  const htmlEl = root.querySelector('html');
  const lang = htmlEl ? htmlEl.getAttribute('lang') : null;
  findings.push({
    category: 'HTML Structure',
    test: 'html[lang] attribute',
    status: lang ? SEV.PASS : SEV.MEDIUM,
    detail: lang ? `Language declared: "${lang}".` : 'Missing lang attribute on <html>. Screen readers cannot determine the document language.',
    recommendation: lang ? null : 'Add lang="en" (or appropriate language code) to <html>.',
  });

  // charset
  const charset = root.querySelector('meta[charset]') || root.querySelector('meta[http-equiv="Content-Type"]');
  findings.push({
    category: 'HTML Structure',
    test: 'Character encoding meta tag',
    status: charset ? SEV.PASS : SEV.MEDIUM,
    detail: charset ? 'Character encoding is declared.' : 'Missing <meta charset="UTF-8">. May cause mojibake on non-ASCII content.',
    recommendation: charset ? null : 'Add <meta charset="UTF-8"> as early as possible inside <head>.',
  });

  // viewport
  const viewport = root.querySelector('meta[name="viewport"]');
  findings.push({
    category: 'HTML Structure',
    test: 'Viewport meta tag',
    status: viewport ? SEV.PASS : SEV.MEDIUM,
    detail: viewport ? `Viewport: ${viewport.getAttribute('content') || '(empty)'}` : 'Missing viewport meta tag – site may not scale correctly on mobile devices.',
    recommendation: viewport ? null : 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  });

  // description
  const desc = root.querySelector('meta[name="description"]');
  findings.push({
    category: 'HTML Structure',
    test: 'Meta description',
    status: desc ? SEV.PASS : SEV.INFO,
    detail: desc ? `Description: "${(desc.getAttribute('content') || '').substring(0,80)}…"` : 'No meta description tag found. Affects SEO and social sharing previews.',
    recommendation: desc ? null : 'Add <meta name="description" content="…"> with a 120–160 character summary.',
  });

  // title
  const titleEl = root.querySelector('title');
  const titleText = titleEl ? titleEl.text.trim() : '';
  findings.push({
    category: 'HTML Structure',
    test: 'Page title',
    status: titleText ? SEV.PASS : SEV.MEDIUM,
    detail: titleText ? `Title: "${titleText.substring(0,80)}"` : 'Page has no <title> tag. Required for browser tabs, bookmarks, and SEO.',
    recommendation: titleText ? null : 'Add a descriptive <title> tag inside <head>.',
  });

  // Deprecated tags
  const foundDeprecated = [];
  DEPRECATED_TAGS.forEach(tag => {
    if (root.querySelectorAll(tag).length > 0) foundDeprecated.push(`<${tag}>`);
  });
  if (foundDeprecated.length > 0) {
    findings.push({
      category: 'HTML Structure',
      test: 'Deprecated HTML elements',
      status: SEV.MEDIUM,
      detail: `Deprecated elements found: ${foundDeprecated.join(', ')}. These are removed from HTML5.`,
      recommendation: 'Replace deprecated tags with CSS-equivalent styling or semantic HTML5 elements.',
    });
  } else {
    findings.push({
      category: 'HTML Structure',
      test: 'Deprecated HTML elements',
      status: SEV.PASS,
      detail: 'No deprecated HTML4/XHTML elements detected.',
      recommendation: null,
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
//  3. ACCESSIBILITY / UX
// ══════════════════════════════════════════════════════════════════════════════

function checkAccessibility(root) {
  const findings = [];

  // Images without alt
  const imgs = root.querySelectorAll('img');
  const missingAlt = imgs.filter(img => !img.hasAttribute('alt')).length;
  findings.push({
    category: 'Accessibility / UX',
    test: `Images – alt attribute (${imgs.length} found)`,
    status: missingAlt === 0 ? SEV.PASS : (missingAlt > 3 ? SEV.MEDIUM : SEV.LOW),
    detail: missingAlt === 0
      ? `All ${imgs.length} image(s) have alt attributes.`
      : `${missingAlt} of ${imgs.length} image(s) are missing the alt attribute. Screen readers cannot describe them.`,
    recommendation: missingAlt > 0 ? 'Add descriptive alt text to all meaningful images. Use alt="" for decorative images.' : null,
  });

  // Inputs without labels
  const inputs = root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset])');
  const unlabelled = inputs.filter(inp => {
    const id = inp.getAttribute('id');
    const hasLabel = id && root.querySelector(`label[for="${id}"]`);
    const hasAria  = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby');
    const inLabel  = false; // simplified – can't easily check parent in node-html-parser
    return !hasLabel && !hasAria;
  }).length;

  findings.push({
    category: 'Accessibility / UX',
    test: `Form inputs – label association (${inputs.length} found)`,
    status: unlabelled === 0 ? SEV.PASS : (unlabelled > 2 ? SEV.MEDIUM : SEV.LOW),
    detail: unlabelled === 0
      ? `All form inputs appear to have labels or ARIA attributes.`
      : `${unlabelled} input(s) may lack an associated <label>, aria-label, or aria-labelledby. Affects screen readers and voice input.`,
    recommendation: unlabelled > 0 ? 'Associate every form control with a <label for="id"> or aria-label attribute.' : null,
  });

  // Buttons without text
  const btns = root.querySelectorAll('button');
  const emptyBtns = btns.filter(b => {
    const text = b.text.trim();
    const ariaLabel = b.getAttribute('aria-label');
    return !text && !ariaLabel;
  }).length;

  findings.push({
    category: 'Accessibility / UX',
    test: `Buttons – accessible label (${btns.length} found)`,
    status: emptyBtns === 0 ? SEV.PASS : SEV.MEDIUM,
    detail: emptyBtns === 0
      ? 'All buttons have visible text or aria-label.'
      : `${emptyBtns} button(s) have no text content or aria-label. Inaccessible to keyboard and screen reader users.`,
    recommendation: emptyBtns > 0 ? 'Add visible text or aria-label to all buttons, especially icon-only buttons.' : null,
  });

  // Non-descriptive links
  const NON_DESCRIPTIVE = ['click here','here','read more','more','link','learn more','this','page'];
  const allLinks = root.querySelectorAll('a');
  const ndLinks = allLinks.filter(a => NON_DESCRIPTIVE.includes((a.text || '').trim().toLowerCase())).length;
  findings.push({
    category: 'Accessibility / UX',
    test: 'Links – descriptive text',
    status: ndLinks === 0 ? SEV.PASS : SEV.LOW,
    detail: ndLinks === 0
      ? 'No non-descriptive link text detected.'
      : `${ndLinks} link(s) use generic text like "click here" or "read more". Unhelpful for screen reader users navigating by links.`,
    recommendation: ndLinks > 0 ? 'Replace generic link text with descriptive text that explains the link destination.' : null,
  });

  // Inline event handlers (onclick= in HTML) – UX/security concern
  const inlineEvents = root.querySelectorAll('[onclick],[onmouseover],[onkeyup],[onkeydown]').length;
  if (inlineEvents > 0) {
    findings.push({
      category: 'Accessibility / UX',
      test: 'Inline event handlers',
      status: SEV.LOW,
      detail: `${inlineEvents} element(s) use inline event handlers (onclick, onmouseover, etc.). Makes CSP harder to enforce.`,
      recommendation: 'Move event handlers to JavaScript files and use addEventListener instead of inline attributes.',
    });
  }

  // Console.log in inline scripts
  const scriptTags = root.querySelectorAll('script:not([src])');
  let hasConsoleLog = false;
  scriptTags.forEach(s => {
    if (s.text && s.text.includes('console.log')) hasConsoleLog = true;
  });
  if (hasConsoleLog) {
    findings.push({
      category: 'Accessibility / UX',
      test: 'console.log in production scripts',
      status: SEV.LOW,
      detail: 'console.log() calls found in inline scripts. May expose debug information to end users.',
      recommendation: 'Remove or replace console.log with a proper logging library that can be disabled in production.',
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
//  4. COLOR CONTRAST (WCAG 2.1 AA)
// ══════════════════════════════════════════════════════════════════════════════

const NAMED_COLORS = {
  white:[255,255,255], black:[0,0,0], red:[255,0,0], green:[0,128,0],
  lime:[0,255,0], blue:[0,0,255], yellow:[255,255,0], orange:[255,165,0],
  purple:[128,0,128], fuchsia:[255,0,255], magenta:[255,0,255],
  aqua:[0,255,255], cyan:[0,255,255], maroon:[128,0,0], navy:[0,0,128],
  teal:[0,128,128], silver:[192,192,192], gray:[128,128,128], grey:[128,128,128],
  darkgray:[169,169,169], darkgrey:[169,169,169], lightgray:[211,211,211],
  lightgrey:[211,211,211], whitesmoke:[245,245,245], gainsboro:[220,220,220],
  pink:[255,192,203], salmon:[250,128,114], coral:[255,127,80],
  tomato:[255,99,71], crimson:[220,20,60], darkred:[139,0,0],
  goldenrod:[218,165,32], darkgoldenrod:[184,134,11], khaki:[240,230,140],
  olive:[128,128,0], limegreen:[50,205,50], darkgreen:[0,100,0],
  seagreen:[46,139,87], steelblue:[70,130,180], royalblue:[65,105,225],
  darkblue:[0,0,139], indigo:[75,0,130], slateblue:[106,90,205],
  transparent: null,
};

function parseColor(str) {
  if (!str) return null;
  str = str.trim().toLowerCase().replace(/\s+/g,'');
  if (NAMED_COLORS.hasOwnProperty(str)) return NAMED_COLORS[str];

  let m = str.match(/^#([0-9a-f]{6})$/);
  if (m) return [parseInt(m[1].slice(0,2),16),parseInt(m[1].slice(2,4),16),parseInt(m[1].slice(4,6),16)];

  m = str.match(/^#([0-9a-f]{3})$/);
  if (m) return [parseInt(m[1][0]+m[1][0],16),parseInt(m[1][1]+m[1][1],16),parseInt(m[1][2]+m[1][2],16)];

  m = str.match(/^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/);
  if (m) return [+m[1],+m[2],+m[3]];

  return null;
}

function relativeLuminance([r,g,b]) {
  return [r,g,b].reduce((L,c,i) => {
    c = c/255;
    return L + (c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4)) * [0.2126,0.7152,0.0722][i];
  }, 0);
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1), l2 = relativeLuminance(c2);
  const hi = Math.max(l1,l2), lo = Math.min(l1,l2);
  return (hi+0.05)/(lo+0.05);
}

function checkColorContrast(html, root) {
  const findings = [];
  const pairs = [];

  // 1. Collect pairs from inline style attributes
  root.querySelectorAll('[style]').forEach(el => {
    const s = (el.getAttribute('style') || '').toLowerCase();
    const cM   = s.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
    const bgM  = s.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/);
    if (cM && bgM) {
      const fg = parseColor(cM[1].trim());
      const bg = parseColor(bgM[1].trim());
      if (fg && bg) pairs.push({ fg, bg, source: 'inline style on <' + (el.tagName||'element').toLowerCase() + '>' });
    }
  });

  // 2. Parse <style> blocks for simple paired rules
  root.querySelectorAll('style').forEach(styleEl => {
    const css = styleEl.text || '';
    // Match a single block that has both color and background-color
    const ruleRe = /([^{]+)\{([^}]+)\}/g;
    let ruleM;
    while ((ruleM = ruleRe.exec(css)) !== null) {
      const body = ruleM[2].toLowerCase();
      const cM   = body.match(/(?:^|;)\s*color\s*:\s*([^;!]+)/);
      const bgM  = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+)/);
      if (cM && bgM) {
        const fg = parseColor(cM[1].trim());
        const bg = parseColor(bgM[1].trim());
        if (fg && bg) pairs.push({ fg, bg, source: `CSS rule for "${ruleM[1].trim().substring(0,40)}"` });
      }
    }
  });

  if (pairs.length === 0) {
    findings.push({
      category: 'Color Contrast',
      test: 'WCAG AA contrast analysis',
      status: SEV.INFO,
      detail: 'No extractable inline color+background pairs found for automated contrast analysis.',
      recommendation: 'Manually verify color contrast using a tool such as the WebAIM Contrast Checker (webaim.org/resources/contrastchecker).',
    });
    return findings;
  }

  let failCount = 0;
  const seen = new Set();
  pairs.forEach(({ fg, bg, source }) => {
    const key = `${fg.join(',')}-${bg.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);

    const ratio = contrastRatio(fg, bg);
    const passAA = ratio >= 4.5;
    const passAA_large = ratio >= 3.0;

    if (!passAA) {
      failCount++;
      findings.push({
        category: 'Color Contrast',
        test: `Low contrast: ${source}`,
        status: passAA_large ? SEV.LOW : SEV.MEDIUM,
        detail: `Contrast ratio ${ratio.toFixed(2)}:1 (WCAG AA requires ≥4.5:1 for normal text, ≥3:1 for large text). Source: ${source}.`,
        recommendation: 'Adjust foreground or background colour to meet WCAG AA: aim for ≥4.5:1 for body text.',
      });
    }
  });

  if (failCount === 0) {
    findings.push({
      category: 'Color Contrast',
      test: 'WCAG AA contrast analysis',
      status: SEV.PASS,
      detail: `All ${seen.size} extracted colour pair(s) meet WCAG AA contrast requirements (≥4.5:1).`,
      recommendation: null,
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
//  5. SPELLING (common typos in visible UI text)
// ══════════════════════════════════════════════════════════════════════════════

const TYPOS = {
  teh:'the', recieve:'receive', occured:'occurred', seperate:'separate',
  definately:'definitely', accomodate:'accommodate', occurance:'occurrence',
  publically:'publicly', neccessary:'necessary', adress:'address',
  begining:'beginning', beleive:'believe', calender:'calendar',
  collegue:'colleague', comming:'coming', concious:'conscious',
  dissapear:'disappear', enviroment:'environment', existance:'existence',
  finaly:'finally', goverment:'government', happend:'happened',
  independant:'independent', knowlege:'knowledge', liscense:'license',
  maintainance:'maintenance', millenium:'millennium', mispelled:'misspelled',
  occassion:'occasion', peice:'piece', persue:'pursue', posession:'possession',
  priviledge:'privilege', reccomend:'recommend', relevent:'relevant',
  restaraunt:'restaurant', rythm:'rhythm', sieze:'seize', succesful:'successful',
  suprise:'surprise', tendancy:'tendency', tommorrow:'tomorrow', truely:'truly',
  untill:'until', wierd:'weird', achive:'achieve', acheive:'achieve',
  agrement:'agreement', allready:'already', alot:'a lot', alright:'all right',
  amature:'amateur', arguement:'argument', basicly:'basically',
  belive:'believe', buisness:'business', catagory:'category',
  cemetary:'cemetery', commitee:'committee', competance:'competence',
  completly:'completely', concious:'conscious', consistant:'consistent',
  copywrite:'copyright', critisism:'criticism', curiousity:'curiosity',
  definate:'definite', dilemna:'dilemma', disipline:'discipline',
  embarassment:'embarrassment', equiptment:'equipment', excercise:'exercise',
  explaination:'explanation', familar:'familiar', foriegn:'foreign',
  fourty:'forty', freind:'friend', fullfil:'fulfill', gaurd:'guard',
  grammer:'grammar', gurantee:'guarantee', harrass:'harass',
};

function checkSpelling(root) {
  const findings = [];
  const labels = [];

  ['label','button','h1','h2','h3','h4','p','li','th','td','a','span','title','option'].forEach(tag => {
    try {
      root.querySelectorAll(tag).forEach(el => {
        const t = (el.text||'').replace(/\s+/g,' ').trim();
        if (t && t.length > 1 && t.length < 300) labels.push(t);
      });
    } catch {}
  });

  // placeholder + aria-label
  root.querySelectorAll('[placeholder]').forEach(el => labels.push(el.getAttribute('placeholder')||''));
  root.querySelectorAll('[aria-label]').forEach(el => labels.push(el.getAttribute('aria-label')||''));
  root.querySelectorAll('[title]').forEach(el => labels.push(el.getAttribute('title')||''));

  const seen = new Set();
  const typoFindings = [];

  labels.forEach(label => {
    const words = (label||'').toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    words.forEach(word => {
      if (TYPOS[word] && !seen.has(word)) {
        seen.add(word);
        typoFindings.push({
          category: 'Spelling & Grammar',
          test: `Possible typo: "${word}"`,
          status: SEV.LOW,
          detail: `"${word}" may be a typo. Suggested correction: "${TYPOS[word]}". Found in: "${label.substring(0,60)}"`,
          recommendation: `Replace "${word}" with "${TYPOS[word]}".`,
        });
      }
    });
  });

  if (typoFindings.length === 0) {
    findings.push({
      category: 'Spelling & Grammar',
      test: 'Common typos scan',
      status: SEV.PASS,
      detail: 'No entries from the known-typos dictionary were found in UI text.',
      recommendation: null,
    });
  } else {
    findings.push(...typoFindings);
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
//  6. PERFORMANCE & BEST PRACTICES
// ══════════════════════════════════════════════════════════════════════════════

function checkPerformance(root) {
  const findings = [];

  // Render-blocking scripts in <head> without defer/async
  const headScripts = root.querySelectorAll('head script[src]');
  const blocking = headScripts.filter(s =>
    !s.hasAttribute('defer') && !s.hasAttribute('async') && !s.getAttribute('type')?.includes('module')
  );
  findings.push({
    category: 'Performance & Best Practices',
    test: `Render-blocking scripts in <head>`,
    status: blocking.length === 0 ? SEV.PASS : (blocking.length > 2 ? SEV.MEDIUM : SEV.LOW),
    detail: blocking.length === 0
      ? 'All <head> scripts use defer or async attributes.'
      : `${blocking.length} script(s) in <head> lack defer/async and may delay page render.`,
    recommendation: blocking.length > 0 ? 'Add defer or async to <script src="…"> tags, or move scripts before </body>.' : null,
  });

  // HTTP (not HTTPS) resources embedded on page
  const allSrc = root.querySelectorAll('[src],[href]');
  const mixedContent = allSrc.filter(el => {
    const v = el.getAttribute('src') || el.getAttribute('href') || '';
    return v.startsWith('http://');
  });
  if (mixedContent.length > 0) {
    findings.push({
      category: 'Performance & Best Practices',
      test: 'Mixed content (HTTP resources on HTTPS page)',
      status: SEV.HIGH,
      detail: `${mixedContent.length} resource(s) use plain HTTP URLs. Browsers block or warn on mixed content.`,
      recommendation: 'Update all resource URLs to use HTTPS or protocol-relative URLs (//).',
    });
  } else {
    findings.push({
      category: 'Performance & Best Practices',
      test: 'Mixed content check',
      status: SEV.PASS,
      detail: 'No plain HTTP resources detected on the page.',
      recommendation: null,
    });
  }

  // Missing favicon
  const favicon = root.querySelector('link[rel*="icon"]');
  findings.push({
    category: 'Performance & Best Practices',
    test: 'Favicon',
    status: favicon ? SEV.PASS : SEV.INFO,
    detail: favicon ? 'Favicon link tag present.' : 'No favicon link tag found. Browsers will make an extra /favicon.ico request.',
    recommendation: favicon ? null : 'Add <link rel="icon" href="/favicon.ico"> inside <head>.',
  });

  // Open Graph tags
  const ogTitle = root.querySelector('meta[property="og:title"]');
  const ogImage = root.querySelector('meta[property="og:image"]');
  if (!ogTitle || !ogImage) {
    findings.push({
      category: 'Performance & Best Practices',
      test: 'Open Graph meta tags',
      status: SEV.INFO,
      detail: `Missing Open Graph tags:${!ogTitle ? ' og:title' : ''}${!ogImage ? ' og:image' : ''}. Affects link previews on social media.`,
      recommendation: 'Add og:title, og:description, og:image, and og:url meta tags.',
    });
  } else {
    findings.push({
      category: 'Performance & Best Practices',
      test: 'Open Graph meta tags',
      status: SEV.PASS,
      detail: 'og:title and og:image are present.',
      recommendation: null,
    });
  }

  // Tables used for layout (non-role presentation)
  const layoutTables = root.querySelectorAll('table:not([role])').length;
  if (layoutTables > 0) {
    findings.push({
      category: 'Performance & Best Practices',
      test: 'Tables without ARIA role',
      status: SEV.INFO,
      detail: `${layoutTables} table(s) found without role="presentation" or role="grid". Ensure tables are used for data, not layout.`,
      recommendation: 'If a table is used for layout, add role="presentation". Use CSS Grid/Flexbox for layout instead.',
    });
  }

  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════════════════════

async function runBasicTest(url) {
  const startTime = Date.now();
  let html = '';
  let fetchError = null;

  try {
    const resp = await fetchWithTimeout(url, {
      dispatcher: url.startsWith('https') ? INSECURE_DISPATCHER : undefined,
      headers: {
        'User-Agent': 'WebAutoTester/1.0 BasicAnalyzer',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    }, 15000);

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    html = await resp.text();
  } catch (err) {
    fetchError = err.message;
  }

  const responseTime = Date.now() - startTime;
  const findings = [];

  if (fetchError) {
    findings.push({
      category: 'Connectivity',
      test: 'Page fetch',
      status: SEV.CRITICAL,
      detail: `Could not fetch page for analysis: ${fetchError}`,
      recommendation: 'Ensure the URL is publicly accessible.',
    });
    return { url, findings, summary: { CRITICAL:1,HIGH:0,MEDIUM:0,LOW:0,INFO:0,PASS:0 }, scannedAt: new Date().toISOString(), responseTime };
  }

  const root = parse(html, { script: false, style: false, comment: false });

  findings.push(...checkOldLibraries(root));
  findings.push(...checkHtmlStructure(html, root));
  findings.push(...checkAccessibility(root));
  findings.push(...checkColorContrast(html, root));
  findings.push(...checkSpelling(root));
  findings.push(...checkPerformance(root));

  const summary = { PASS:0, INFO:0, LOW:0, MEDIUM:0, HIGH:0, CRITICAL:0 };
  findings.forEach(f => { if (summary[f.status] !== undefined) summary[f.status]++; });

  return {
    url,
    findings,
    summary,
    totalFindings: findings.length,
    scannedAt: new Date().toISOString(),
    responseTime,
  };
}

module.exports = { runBasicTest };

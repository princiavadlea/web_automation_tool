/**
 * securityTester.js
 * Performs HTTP security header analysis and TLS/protocol checks.
 */

const { Agent } = require('undici');

// Allow self-signed/untrusted certs so we can still check headers,
// but we separately verify the TLS certificate chain below.
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

// ─── Severity levels ──────────────────────────────────────────────────────────
const SEV = { PASS: 'PASS', INFO: 'INFO', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

// ─── Security Header Definitions ──────────────────────────────────────────────
const SECURITY_HEADERS = [
  {
    name: 'Content-Security-Policy',
    key: 'content-security-policy',
    description: 'Prevents XSS attacks by controlling which resources the browser can load.',
    recommendation: "Add a strict CSP header, e.g. Content-Security-Policy: default-src 'self'",
    missingSeverity: SEV.HIGH,
  },
  {
    name: 'Strict-Transport-Security',
    key: 'strict-transport-security',
    description: 'Enforces HTTPS connections and prevents protocol downgrade attacks.',
    recommendation: "Add: Strict-Transport-Security: max-age=31536000; includeSubDomains; preload",
    missingSeverity: SEV.HIGH,
  },
  {
    name: 'X-Frame-Options',
    key: 'x-frame-options',
    description: 'Prevents clickjacking by disabling embedding in iframes.',
    recommendation: "Add: X-Frame-Options: DENY or SAMEORIGIN",
    missingSeverity: SEV.MEDIUM,
  },
  {
    name: 'X-Content-Type-Options',
    key: 'x-content-type-options',
    description: 'Prevents MIME-type sniffing vulnerabilities.',
    recommendation: "Add: X-Content-Type-Options: nosniff",
    missingSeverity: SEV.MEDIUM,
  },
  {
    name: 'X-XSS-Protection',
    key: 'x-xss-protection',
    description: 'Enables browser XSS filter (legacy browsers). Deprecated in modern browsers.',
    recommendation: "Add: X-XSS-Protection: 1; mode=block",
    missingSeverity: SEV.LOW,
  },
  {
    name: 'Referrer-Policy',
    key: 'referrer-policy',
    description: 'Controls how much referrer information is sent with requests.',
    recommendation: "Add: Referrer-Policy: strict-origin-when-cross-origin",
    missingSeverity: SEV.LOW,
  },
  {
    name: 'Permissions-Policy',
    key: 'permissions-policy',
    description: 'Controls which browser features and APIs can be used by the page.',
    recommendation: "Add: Permissions-Policy: camera=(), microphone=(), geolocation=()",
    missingSeverity: SEV.LOW,
  },
  {
    name: 'Cross-Origin-Opener-Policy',
    key: 'cross-origin-opener-policy',
    description: 'Isolates your browsing context to prevent cross-origin attacks.',
    recommendation: "Add: Cross-Origin-Opener-Policy: same-origin",
    missingSeverity: SEV.LOW,
  },
  {
    name: 'Cross-Origin-Resource-Policy',
    key: 'cross-origin-resource-policy',
    description: 'Prevents other sites from loading your resources.',
    recommendation: "Add: Cross-Origin-Resource-Policy: same-origin",
    missingSeverity: SEV.LOW,
  },
];

// ─── Cookie analysis ──────────────────────────────────────────────────────────
function analyzeCookies(headers) {
  const setCookieRaw =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  const results = [];

  setCookieRaw.forEach((cookie, idx) => {
    const name = cookie.split('=')[0].trim();
    const lower = cookie.toLowerCase();

    const hasSecure   = lower.includes('secure');
    const hasHttpOnly = lower.includes('httponly');
    const hasSameSite = lower.includes('samesite');

    if (!hasSecure) {
      results.push({
        category: 'Cookie Security',
        test: `Cookie "${name}" – Secure flag`,
        status: SEV.HIGH,
        detail: 'Cookie is transmitted over HTTP. Add the Secure flag to restrict to HTTPS.',
        recommendation: `Set-Cookie: ${name}=...; Secure; HttpOnly; SameSite=Strict`,
      });
    }
    if (!hasHttpOnly) {
      results.push({
        category: 'Cookie Security',
        test: `Cookie "${name}" – HttpOnly flag`,
        status: SEV.MEDIUM,
        detail: 'Cookie is accessible via JavaScript. Add HttpOnly to prevent XSS theft.',
        recommendation: `Set-Cookie: ${name}=...; Secure; HttpOnly; SameSite=Strict`,
      });
    }
    if (!hasSameSite) {
      results.push({
        category: 'Cookie Security',
        test: `Cookie "${name}" – SameSite flag`,
        status: SEV.MEDIUM,
        detail: 'Cookie lacks SameSite protection, making it vulnerable to CSRF.',
        recommendation: `Set-Cookie: ${name}=...; Secure; HttpOnly; SameSite=Strict`,
      });
    }
    if (hasSecure && hasHttpOnly && hasSameSite) {
      results.push({
        category: 'Cookie Security',
        test: `Cookie "${name}" – All flags present`,
        status: SEV.PASS,
        detail: 'Cookie has Secure, HttpOnly, and SameSite flags.',
        recommendation: null,
      });
    }
  });

  return results;
}

// ─── Information disclosure checks ───────────────────────────────────────────
function checkInfoDisclosure(headers) {
  const findings = [];

  const server = headers.get('server');
  if (server) {
    const exposesVersion = /[\d.]{2,}/.test(server);
    findings.push({
      category: 'Information Disclosure',
      test: 'Server header',
      status: exposesVersion ? SEV.MEDIUM : SEV.LOW,
      detail: `Server: ${server}. ${exposesVersion ? 'Version number exposed, aiding attacker fingerprinting.' : 'No version exposed, but header should be removed.'}`,
      recommendation: 'Remove or obfuscate the Server header entirely.',
    });
  } else {
    findings.push({
      category: 'Information Disclosure',
      test: 'Server header',
      status: SEV.PASS,
      detail: 'Server header is not present – good practice.',
      recommendation: null,
    });
  }

  const poweredBy = headers.get('x-powered-by');
  if (poweredBy) {
    findings.push({
      category: 'Information Disclosure',
      test: 'X-Powered-By header',
      status: SEV.MEDIUM,
      detail: `X-Powered-By: ${poweredBy}. Discloses technology stack to attackers.`,
      recommendation: 'Remove X-Powered-By header (e.g. app.disable(\'x-powered-by\') in Express).',
    });
  } else {
    findings.push({
      category: 'Information Disclosure',
      test: 'X-Powered-By header',
      status: SEV.PASS,
      detail: 'X-Powered-By header is not present.',
      recommendation: null,
    });
  }

  const aspVersion = headers.get('x-aspnet-version') || headers.get('x-aspnetmvc-version');
  if (aspVersion) {
    findings.push({
      category: 'Information Disclosure',
      test: 'ASP.NET version header',
      status: SEV.MEDIUM,
      detail: `ASP.NET version disclosed: ${aspVersion}`,
      recommendation: 'Suppress ASP.NET version headers in Web.config.',
    });
  }

  return findings;
}

// ─── HTTPS / TLS check ────────────────────────────────────────────────────────
function checkTLS(url, responseURL, statusCode) {
  const findings = [];
  const isHTTPS = url.startsWith('https://');
  const finalHTTPS = (responseURL || url).startsWith('https://');

  if (!isHTTPS) {
    findings.push({
      category: 'TLS / Protocol',
      test: 'HTTPS usage',
      status: SEV.CRITICAL,
      detail: 'Site is served over plain HTTP. All traffic is unencrypted.',
      recommendation: 'Migrate to HTTPS immediately and set up an automatic HTTP→HTTPS redirect.',
    });
  } else if (!finalHTTPS) {
    findings.push({
      category: 'TLS / Protocol',
      test: 'HTTPS redirect',
      status: SEV.HIGH,
      detail: 'Request started with HTTPS but was redirected to HTTP.',
      recommendation: 'Ensure server redirects HTTP→HTTPS and not the reverse.',
    });
  } else {
    findings.push({
      category: 'TLS / Protocol',
      test: 'HTTPS usage',
      status: SEV.PASS,
      detail: 'Site is served over HTTPS.',
      recommendation: null,
    });
  }

  return findings;
}

// ─── CSP analysis ─────────────────────────────────────────────────────────────
function analyzeCSP(cspValue) {
  if (!cspValue) return [];
  const findings = [];

  if (cspValue.includes("'unsafe-inline'")) {
    findings.push({
      category: 'Content Security Policy',
      test: "CSP – 'unsafe-inline' detected",
      status: SEV.HIGH,
      detail: "CSP contains 'unsafe-inline', which significantly weakens XSS protection.",
      recommendation: "Remove 'unsafe-inline' and use nonces or hashes instead.",
    });
  }

  if (cspValue.includes("'unsafe-eval'")) {
    findings.push({
      category: 'Content Security Policy',
      test: "CSP – 'unsafe-eval' detected",
      status: SEV.HIGH,
      detail: "CSP contains 'unsafe-eval', allowing execution of arbitrary code strings.",
      recommendation: "Remove 'unsafe-eval'. Refactor code to avoid eval(), setTimeout(string), etc.",
    });
  }

  if (cspValue.includes('*')) {
    findings.push({
      category: 'Content Security Policy',
      test: 'CSP – Wildcard (*) source',
      status: SEV.MEDIUM,
      detail: 'CSP contains a wildcard (*) which allows resources from any origin.',
      recommendation: 'Replace wildcard with explicit trusted domains.',
    });
  }

  return findings;
}

// ─── Main entry point ─────────────────────────────────────────────────────────
async function runSecurityTest(url) {
  const startTime = Date.now();
  const findings = [];

  let response;
  let fetchError = null;

  // First, try strict TLS to check cert validity
  let tlsCertValid = true;
  let tlsCertError = null;
  try {
    await fetchWithTimeout(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'AutoTesterDemo/1.0 Security Scanner' },
      // no agent = strict TLS
    }, 8000);
  } catch (err) {
    if (err.message.includes('certificate') || err.message.includes('SSL') || err.message.includes('TLS')) {
      tlsCertValid = false;
      tlsCertError = err.message;
    }
  }

  try {
    response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'follow',
      dispatcher: url.startsWith('https') ? INSECURE_DISPATCHER : undefined,
      headers: {
        'User-Agent': 'AutoTesterDemo/1.0 Security Scanner',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
    }, 15000);
  } catch (err) {
    fetchError = err.message;
  }

  // Record TLS certificate finding
  if (url.startsWith('https')) {
    findings.push({
      category: 'TLS / Protocol',
      test: 'TLS Certificate Validity',
      status: tlsCertValid ? SEV.PASS : SEV.HIGH,
      detail: tlsCertValid
        ? 'TLS certificate is valid and trusted.'
        : `TLS certificate issue detected: ${tlsCertError}`,
      recommendation: tlsCertValid ? null : 'Ensure a valid, CA-signed TLS certificate is installed.',
    });
  }

  const responseTime = Date.now() - startTime;

  // ── TLS check (can be done without a valid response) ──────────────────────
  findings.push(...checkTLS(url, response?.url, response?.status));

  if (fetchError) {
    findings.push({
      category: 'Connectivity',
      test: 'Page reachability',
      status: SEV.CRITICAL,
      detail: `Failed to reach ${url}: ${fetchError}`,
      recommendation: 'Ensure the URL is publicly accessible and the server is running.',
    });
    return { url, responseTime: 0, statusCode: null, findings, fetchError };
  }

  const { status: statusCode, headers } = response;

  // ── Response time ─────────────────────────────────────────────────────────
  findings.push({
    category: 'Performance',
    test: 'Response time',
    status: responseTime > 3000 ? SEV.MEDIUM : responseTime > 1500 ? SEV.LOW : SEV.PASS,
    detail: `Initial response received in ${responseTime}ms.${responseTime > 3000 ? ' This may indicate a performance issue.' : ''}`,
    recommendation: responseTime > 3000 ? 'Investigate server-side performance and caching.' : null,
  });

  // ── HTTP status ───────────────────────────────────────────────────────────
  if (statusCode >= 400) {
    findings.push({
      category: 'Connectivity',
      test: 'HTTP status code',
      status: statusCode >= 500 ? SEV.HIGH : SEV.MEDIUM,
      detail: `Server returned HTTP ${statusCode}.`,
      recommendation: 'Investigate and fix server errors before deployment.',
    });
  } else {
    findings.push({
      category: 'Connectivity',
      test: 'HTTP status code',
      status: SEV.PASS,
      detail: `Server returned HTTP ${statusCode}.`,
      recommendation: null,
    });
  }

  // ── Security header checks ────────────────────────────────────────────────
  for (const hd of SECURITY_HEADERS) {
    const value = headers.get(hd.key);
    if (value) {
      findings.push({
        category: 'Security Headers',
        test: hd.name,
        status: SEV.PASS,
        detail: `Present: ${value.substring(0, 120)}${value.length > 120 ? '…' : ''}`,
        recommendation: null,
      });

      // Deep CSP analysis
      if (hd.key === 'content-security-policy') {
        findings.push(...analyzeCSP(value));
      }
    } else {
      findings.push({
        category: 'Security Headers',
        test: hd.name,
        status: hd.missingSeverity,
        detail: `Header is missing. ${hd.description}`,
        recommendation: hd.recommendation,
      });
    }
  }

  // ── Info disclosure ───────────────────────────────────────────────────────
  findings.push(...checkInfoDisclosure(headers));

  // ── Cookie analysis ───────────────────────────────────────────────────────
  const cookieFindings = analyzeCookies(headers);
  if (cookieFindings.length === 0) {
    findings.push({
      category: 'Cookie Security',
      test: 'Set-Cookie headers',
      status: SEV.INFO,
      detail: 'No Set-Cookie headers were observed in the initial response.',
      recommendation: null,
    });
  } else {
    findings.push(...cookieFindings);
  }

  // ── CORS check ────────────────────────────────────────────────────────────
  const cors = headers.get('access-control-allow-origin');
  if (cors === '*') {
    findings.push({
      category: 'CORS',
      test: 'Access-Control-Allow-Origin',
      status: SEV.MEDIUM,
      detail: "CORS is set to '*', allowing any origin to make cross-origin requests.",
      recommendation: 'Restrict CORS to specific trusted origins.',
    });
  } else if (cors) {
    findings.push({
      category: 'CORS',
      test: 'Access-Control-Allow-Origin',
      status: SEV.PASS,
      detail: `CORS restricted to: ${cors}`,
      recommendation: null,
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const counts = { PASS: 0, INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  findings.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });

  return {
    url,
    responseTime,
    statusCode,
    findings,
    summary: counts,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = { runSecurityTest };

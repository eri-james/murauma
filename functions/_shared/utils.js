/**
 * Shared utilities for MURA Cloudflare Workers
 * 
 * This module provides sanitization, rate limiting, hCaptcha verification,
 * and common response helpers used across all API endpoints.
 */

// ============================================================
// CONFIGURATION
// ============================================================

const RATE_LIMIT_MAX = 3;        // Max submissions per window
const RATE_LIMIT_WINDOW_SEC = 600; // 10 minutes in seconds
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50000;
const MAX_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 500;
const MAX_TRAINER_ID_LENGTH = 12;

// Allowed MIME types for profile picture uploads
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ============================================================
// RESPONSE HELPERS
// ============================================================

/**
 * Creates a JSON response with CORS headers.
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Creates an error response.
 */
function errorResponse(message, status = 400) {
  return jsonResponse({ result: 'error', message }, status);
}

/**
 * Creates a success response.
 */
function successResponse(message, extra = {}) {
  return jsonResponse({ result: 'success', message, ...extra });
}

// ============================================================
// INPUT VALIDATION
// ============================================================

/**
 * Validates and trims a string field.
 */
function validateField(value, maxLength, fieldName) {
  if (!value || typeof value !== 'string') {
    return { valid: false, value: '', error: `${fieldName} is required.` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: false, value: '', error: `${fieldName} cannot be empty.` };
  }
  if (trimmed.length > maxLength) {
    return { valid: false, value: '', error: `${fieldName} must be ${maxLength} characters or less.` };
  }
  return { valid: true, value: trimmed, error: null };
}

/**
 * Validates a 12-digit trainer ID.
 */
function validateTrainerId(value) {
  const result = validateField(value, MAX_TRAINER_ID_LENGTH, 'Trainer ID');
  if (!result.valid) return result;
  if (!/^\d{12}$/.test(result.value)) {
    return { valid: false, value: '', error: 'Trainer ID must be exactly 12 digits.' };
  }
  return result;
}

// ============================================================
// HTML SANITIZATION (Server-side defense-in-depth)
// ============================================================

/**
 * Allowed HTML tags for writing content (Markdown-generated).
 * Tags not in this list will be stripped but their text content preserved.
 */
const ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'sup', 'sub',
]);

/**
 * Allowed HTML attributes per tag.
 * Keys are tag names, values are Sets of allowed attribute names.
 */
const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  td: new Set(['align', 'colspan', 'rowspan']),
  th: new Set(['align', 'colspan', 'rowspan']),
};

/**
 * Dangerous URL schemes that should be stripped.
 */
const DANGEROUS_URL_SCHEMES = /^(javascript|data|vbscript):/i;

/**
 * Sanitizes HTML content using a whitelist approach.
 * - Strips all tags not in ALLOWED_TAGS (preserving text content)
 * - Removes all attributes not in ALLOWED_ATTRS for each tag
 * - Removes dangerous URL schemes (javascript:, data:) from href/src
 * - This complements client-side DOMPurify for defense-in-depth
 */
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';

  // Process the HTML tag by tag using a regex scanner
  // This handles both self-closing and regular tags
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g, (fullMatch, tagName) => {
    const lowerTag = tagName.toLowerCase();

    // Closing tags: always allow if the tag itself is allowed
    if (fullMatch.startsWith('</')) {
      if (ALLOWED_TAGS.has(lowerTag)) {
        return `</${lowerTag}>`;
      }
      return ''; // Strip disallowed closing tags
    }

    // Opening or self-closing tags
    if (!ALLOWED_TAGS.has(lowerTag)) {
      return ''; // Strip disallowed tags entirely
    }

    // Parse attributes from the tag
    const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
    const allowedTagAttrs = ALLOWED_ATTRS[lowerTag] || new Set();
    const safeAttrs = [];
    let match;

    while ((match = attrRegex.exec(fullMatch)) !== null) {
      const attrName = match[1].toLowerCase();
      if (!allowedTagAttrs.has(attrName)) continue;

      // Extract the attribute value
      const valueMatch = match[0].match(/=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/);
      let value = valueMatch ? (valueMatch[1] ?? valueMatch[2] ?? valueMatch[3]) : '';

      // Sanitize URL attributes
      if ((attrName === 'href' || attrName === 'src') && DANGEROUS_URL_SCHEMES.test(value.trim())) {
        continue; // Drop dangerous URLs entirely
      }

      safeAttrs.push(`${attrName}="${value.replace(/"/g, '&quot;')}"`);
    }

    const isSelfClosing = fullMatch.endsWith('/>') || lowerTag === 'br' || lowerTag === 'hr' || lowerTag === 'img';
    if (isSelfClosing) {
      return safeAttrs.length > 0 ? `<${lowerTag} ${safeAttrs.join(' ')} />` : `<${lowerTag} />`;
    }
    return safeAttrs.length > 0 ? `<${lowerTag} ${safeAttrs.join(' ')}>` : `<${lowerTag}>`;
  });
}

/**
 * Sanitizes plain text by escaping HTML entities.
 * Use for fields that should be plain text only (names, bios, etc.)
 */
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Checks and enforces rate limiting using D1.
 * Returns true if the request is allowed, false if rate-limited.
 */
async function checkRateLimit(db, clientKey) {
  // Clean up expired entries first
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff).run();

  // Check current count for this client
  const existing = await db
    .prepare('SELECT request_count, window_start FROM rate_limits WHERE client_key = ?')
    .bind(clientKey)
    .first();

  if (existing) {
    const windowStart = new Date(existing.window_start);
    const now = new Date();
    const elapsed = (now - windowStart) / 1000;

    if (elapsed < RATE_LIMIT_WINDOW_SEC && existing.request_count >= RATE_LIMIT_MAX) {
      return false; // Rate limit exceeded
    }

    if (elapsed >= RATE_LIMIT_WINDOW_SEC) {
      // Window expired, reset counter
      await db
        .prepare('UPDATE rate_limits SET request_count = 1, window_start = ? WHERE client_key = ?')
        .bind(new Date().toISOString(), clientKey)
        .run();
    } else {
      // Within window, increment counter
      await db
        .prepare('UPDATE rate_limits SET request_count = request_count + 1 WHERE client_key = ?')
        .bind(clientKey)
        .run();
    }
  } else {
    // First request from this client
    await db
      .prepare('INSERT INTO rate_limits (client_key, request_count, window_start) VALUES (?, 1, ?)')
      .bind(clientKey, new Date().toISOString())
      .run();
  }

  return true;
}

/**
 * Extracts a client identifier for rate limiting.
 * Cloudflare Workers reliably provide the true client IP via CF-Connecting-IP.
 */
function getClientKey(request) {
  return request.headers.get('CF-Connecting-IP') || 
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 
         'anonymous';
}

// ============================================================
// hCAPTCHA VERIFICATION
// ============================================================

/**
 * Verifies an hCaptcha token with the hCaptcha API.
 */
async function verifyHcaptcha(token, secret) {
  if (!secret) {
    console.error('hCaptcha secret key not configured in Worker secrets.');
    return false;
  }

  if (!token) {
    return false;
  }

  try {
    const response = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });

    const result = await response.json();
    return result.success === true;
  } catch (error) {
    console.error('hCaptcha verification error:', error.message);
    return false;
  }
}

// ============================================================
// EXPORTS
// ============================================================

export {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_SEC,
  MAX_TITLE_LENGTH,
  MAX_CONTENT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_BIO_LENGTH,
  MAX_TRAINER_ID_LENGTH,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  jsonResponse,
  errorResponse,
  successResponse,
  validateField,
  validateTrainerId,
  sanitizeHtml,
  sanitizeText,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
};

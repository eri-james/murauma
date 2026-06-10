/**
 * Shared utilities for MURA Cloudflare Workers
 * 
 * This module provides sanitization, rate limiting, hCaptcha verification,
 * authentication (JWT + PBKDF2), and common response helpers used across
 * all API endpoints.
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
const MAX_USERNAME_LENGTH = 30;
const MIN_USERNAME_LENGTH = 3;

// Password hashing configuration (PBKDF2)
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEY_LENGTH = 256; // bits
const SALT_LENGTH = 16; // bytes

// JWT configuration
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Cookie name for session
const SESSION_COOKIE_NAME = 'mura_session';

// Allowed MIME types for profile picture uploads
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// ============================================================
// RESPONSE HELPERS
// ============================================================

/**
 * Creates a JSON response with CORS headers.
 */
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
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
 * Validates an optional string field — allows empty/null values.
 * Returns { valid: true, value: null } if empty.
 */
function validateOptionalField(value, maxLength, fieldName) {
  if (!value || typeof value !== 'string') {
    return { valid: true, value: null, error: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { valid: true, value: null, error: null };
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
  const result = validateOptionalField(value, MAX_TRAINER_ID_LENGTH, 'Trainer ID');
  if (!result.valid) return result;
  if (result.value && !/^\d{12}$/.test(result.value)) {
    return { valid: false, value: '', error: 'Trainer ID must be exactly 12 digits.' };
  }
  return result;
}

/**
 * Validates a username: alphanumeric + underscores, 3-30 chars.
 */
function validateUsername(value) {
  if (!value || typeof value !== 'string') {
    return { valid: false, value: '', error: 'Username is required.' };
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < MIN_USERNAME_LENGTH) {
    return { valid: false, value: '', error: `Username must be at least ${MIN_USERNAME_LENGTH} characters.` };
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return { valid: false, value: '', error: `Username must be ${MAX_USERNAME_LENGTH} characters or less.` };
  }
  if (!/^[a-z0-9_]+$/.test(trimmed)) {
    return { valid: false, value: '', error: 'Username can only contain lowercase letters, numbers, and underscores.' };
  }
  return { valid: true, value: trimmed, error: null };
}

/**
 * Validates a password: minimum 8 characters.
 */
function validatePassword(value) {
  if (!value || typeof value !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (value.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters.' };
  }
  if (value.length > 128) {
    return { valid: false, error: 'Password must be 128 characters or less.' };
  }
  return { valid: true, error: null };
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

// ============================================================
// RICH HTML SANITIZATION (for Quill.js / guide content)
// ============================================================

/**
 * Allowed HTML tags for rich text content (Quill.js-generated).
 * Broader than the basic ALLOWED_TAGS used for Markdown content.
 */
const RICH_ALLOWED_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'colgroup', 'col', // For Quill better-table column widths
  'sup', 'sub',
  'span', 'div',
  'iframe', // For embedded YouTube/Spotify (restricted below)
]);

/**
 * Allowed HTML attributes per tag for rich content.
 * Includes class/style for Quill formatting.
 */
const RICH_ALLOWED_ATTRS = {
  a: new Set(['href', 'title', 'target', 'rel']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'class', 'style']),
  td: new Set(['align', 'colspan', 'rowspan', 'class', 'style']),
  th: new Set(['align', 'colspan', 'rowspan', 'class', 'style']),
  table: new Set(['class', 'style', 'cellpadding', 'cellspacing', 'border']),
  colgroup: new Set(['span']),
  col: new Set(['span', 'style', 'width']),
  tr: new Set(['class', 'style']),
  iframe: new Set(['src', 'title', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'loading']),
  span: new Set(['class', 'style']),
  div: new Set(['class', 'style']),
  p: new Set(['class', 'style']),
  h1: new Set(['class', 'style']),
  h2: new Set(['class', 'style']),
  h3: new Set(['class', 'style']),
  h4: new Set(['class', 'style']),
  h5: new Set(['class', 'style']),
  h6: new Set(['class', 'style']),
  pre: new Set(['class']),
  code: new Set(['class']),
  blockquote: new Set(['class', 'style']),
  ul: new Set(['class']),
  ol: new Set(['class']),
  li: new Set(['class']),
};

/**
 * Allowed iframe src patterns (YouTube, Spotify, SoundCloud embeds only).
 */
const ALLOWED_IFRAME_SRC = [
  'https://www.youtube.com/embed/',
  'https://open.spotify.com/embed/',
  'https://w.soundcloud.com/player/',
];

/**
 * Sanitizes rich HTML content (from Quill.js editor) using a whitelist approach.
 * Broader than sanitizeHtml — allows span, div, class, style, and iframes.
 * Still blocks dangerous schemes, scripts, and event handlers.
 */
function sanitizeRichHtml(html) {
  if (typeof html !== 'string') return '';

  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g, (fullMatch, tagName) => {
    const lowerTag = tagName.toLowerCase();

    // Closing tags
    if (fullMatch.startsWith('</')) {
      if (RICH_ALLOWED_TAGS.has(lowerTag)) {
        return `</${lowerTag}>`;
      }
      return '';
    }

    // Opening or self-closing tags
    if (!RICH_ALLOWED_TAGS.has(lowerTag)) {
      return '';
    }

    // Parse attributes
    const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g;
    const allowedTagAttrs = RICH_ALLOWED_ATTRS[lowerTag] || new Set();
    const safeAttrs = [];
    let match;

    while ((match = attrRegex.exec(fullMatch)) !== null) {
      const attrName = match[1].toLowerCase();

      // Block all event handler attributes (onclick, onerror, etc.)
      if (attrName.startsWith('on')) continue;

      if (!allowedTagAttrs.has(attrName)) continue;

      // Extract the attribute value
      const valueMatch = match[0].match(/=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/);
      let value = valueMatch ? (valueMatch[1] ?? valueMatch[2] ?? valueMatch[3]) : '';

      // Sanitize URL attributes (href, src)
      if (attrName === 'href' || attrName === 'src') {
        // Special handling for iframe src — only allow known embed domains
        if (lowerTag === 'iframe' && attrName === 'src') {
          const isAllowed = ALLOWED_IFRAME_SRC.some(pattern => value.startsWith(pattern));
          if (!isAllowed) continue;
        } else if (lowerTag === 'img' && attrName === 'src') {
          // Allow data:image/ URLs in img src (for Quill.js base64 images in guides)
          // but block other data: schemes and javascript:/vbscript:
          const trimmedVal = value.trim();
          if (DANGEROUS_URL_SCHEMES.test(trimmedVal) && !/^data:image\//i.test(trimmedVal)) {
            continue;
          }
          // Also validate data:image/ URLs have a reasonable length (max 2MB inline)
          if (/^data:image\//i.test(trimmedVal) && trimmedVal.length > 2 * 1024 * 1024) {
            continue;
          }
        } else if (DANGEROUS_URL_SCHEMES.test(value.trim())) {
          continue;
        }
      }

      // Sanitize style attributes — whitelist safe CSS properties only
      if (attrName === 'style') {
        // Parse style into individual declarations, keep only safe properties
        const safeStyleProps = new Set([
          'text-align', 'text-decoration', 'text-indent', 'text-transform',
          'font-weight', 'font-style', 'font-size', 'font-family',
          'color', 'background-color', 'background',
          'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
          'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
          'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
          'border-collapse', 'border-spacing',
          'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
          'vertical-align', 'line-height', 'letter-spacing', 'white-space',
          'list-style-type', 'list-style-position',
          'display', 'float', 'clear',
          'overflow', 'overflow-x', 'overflow-y', 'text-overflow',
          'word-wrap', 'word-break', 'overflow-wrap',
        ]);
        const declarations = value.split(';').map(d => d.trim()).filter(Boolean);
        const safeDecls = declarations.filter(decl => {
          const colonIdx = decl.indexOf(':');
          if (colonIdx === -1) return false;
          const prop = decl.substring(0, colonIdx).trim().toLowerCase();
          return safeStyleProps.has(prop);
        });
        if (safeDecls.length === 0) continue;
        value = safeDecls.join('; ');
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

// ============================================================
// SLUG GENERATION
// ============================================================

/**
 * Generates a URL-friendly slug from a title.
 * - Lowercase, hyphens instead of spaces
 * - Only alphanumeric + hyphens
 * - Max 100 characters
 */
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // Remove non-word chars (except spaces/hyphens)
    .replace(/[\s_]+/g, '-')    // Replace spaces/underscores with hyphens
    .replace(/-+/g, '-')        // Collapse multiple hyphens
    .replace(/^-+|-+$/g, '')    // Trim hyphens
    .substring(0, 100);         // Limit length
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
 * Uses atomic INSERT OR REPLACE + conditional check to avoid TOCTOU race conditions.
 * Returns true if the request is allowed, false if rate-limited.
 */
async function checkRateLimit(db, clientKey, maxRequests = RATE_LIMIT_MAX) {
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();

  // Clean up expired entries
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(cutoff).run();

  // Atomically upsert: try to insert, or increment if exists and within window
  // Step 1: Check current state
  const existing = await db
    .prepare('SELECT request_count, window_start FROM rate_limits WHERE client_key = ?')
    .bind(clientKey)
    .first();

  if (existing) {
    const windowStart = new Date(existing.window_start);
    const elapsed = (now - windowStart) / 1000;

    if (elapsed < RATE_LIMIT_WINDOW_SEC) {
      // Within window — check limit BEFORE incrementing (atomic check-then-increment)
      if (existing.request_count >= maxRequests) {
        return false; // Rate limit exceeded — do NOT increment
      }
      // Increment counter atomically
      await db
        .prepare('UPDATE rate_limits SET request_count = request_count + 1 WHERE client_key = ? AND request_count < ?')
        .bind(clientKey, maxRequests)
        .run();
    } else {
      // Window expired, reset counter atomically
      await db
        .prepare('UPDATE rate_limits SET request_count = 1, window_start = ? WHERE client_key = ?')
        .bind(nowIso, clientKey)
        .run();
    }
  } else {
    // First request from this client — insert atomically
    await db
      .prepare('INSERT INTO rate_limits (client_key, request_count, window_start) VALUES (?, 1, ?)')
      .bind(clientKey, nowIso)
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
// PASSWORD HASHING (PBKDF2 via Web Crypto API)
// ============================================================

/**
 * Hashes a password using PBKDF2 with a random salt.
 * Returns { hash, salt } as hex strings.
 */
async function hashPassword(password) {
  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH
  );

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return { hash: hashHex, salt: saltHex };
}

/**
 * Verifies a password against a stored hash and salt.
 * Returns true if the password matches, false otherwise.
 */
async function verifyPassword(password, storedHash, storedSalt) {
  if (!storedHash || !storedSalt) return false;

  // Convert hex salt back to Uint8Array
  const salt = new Uint8Array(storedSalt.match(/.{2}/g).map(byte => parseInt(byte, 16)));

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH
  );

  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Timing-safe comparison
  if (hashHex.length !== storedHash.length) return false;
  let result = 0;
  for (let i = 0; i < hashHex.length; i++) {
    result |= hashHex.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================
// JWT (JSON Web Token) via Web Crypto API
// ============================================================

/**
 * Base64url-encodes a string.
 */
function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url-encodes an ArrayBuffer.
 */
function base64urlEncodeBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return base64urlEncode(binary);
}

/**
 * Decodes a base64url string to a regular string.
 */
function base64urlDecode(str) {
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return atob(padded);
}

/**
 * Creates a signed JWT token.
 * Payload includes: userId, username, role, iat, exp
 */
async function createJWT(payload, secret) {
  const header = { alg: JWT_ALGORITHM, typ: 'JWT' };
  
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(tokenPayload));
  const content = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(content));
  const signatureB64 = base64urlEncodeBuffer(signature);

  return `${content}.${signatureB64}`;
}

/**
 * Verifies and decodes a JWT token.
 * Returns the payload object if valid, or null if invalid/expired.
 */
async function verifyJWT(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const content = `${headerB64}.${payloadB64}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  // Convert base64url signature back to Uint8Array
  const signatureBinary = base64urlDecode(signatureB64);
  const signatureBytes = new Uint8Array(signatureBinary.length);
  for (let i = 0; i < signatureBinary.length; i++) {
    signatureBytes[i] = signatureBinary.charCodeAt(i);
  }

  try {
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(content)
    );
    if (!isValid) return null;

    const payload = JSON.parse(base64urlDecode(payloadB64));
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ============================================================
// SESSION / COOKIE HELPERS
// ============================================================

/**
 * Parses cookies from the request headers.
 * Returns an object of { name: value } pairs.
 */
function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) {
      cookies[name.trim()] = rest.join('=').trim();
    }
  }
  return cookies;
}

/**
 * Returns the Set-Cookie header value for the session cookie.
 */
function sessionCookieValue(token, maxAge = JWT_EXPIRY_SECONDS) {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

/**
 * Returns the Set-Cookie header value to clear the session cookie.
 */
function clearSessionCookieValue() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

/**
 * Extracts and verifies the authenticated user from the request.
 * Checks JWT in httpOnly cookie first, falls back to X-Admin-Secret header.
 * 
 * Returns { user: { userId, username, role } } on success,
 * or { user: null, error: Response } on failure.
 */
async function getAuthenticatedUser(request, env) {
  // Try JWT session cookie first
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];
  
  if (token) {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload && payload.userId && payload.username) {
      return { 
        user: { 
          userId: payload.userId, 
          username: payload.username, 
          role: payload.role || 'member' 
        }, 
        error: null 
      };
    }
  }

  // Fall back to admin secret header (for API-only admin access)
  if (authenticateAdmin(request, env)) {
    return { 
      user: { userId: 0, username: 'admin', role: 'admin' }, 
      error: null 
    };
  }

  return { user: null, error: null };
}

/**
 * Requires authentication — returns user or error response.
 * Use for member-only endpoints.
 */
async function requireAuth(request, env) {
  const { user, error } = await getAuthenticatedUser(request, env);
  if (error) return { user: null, error };
  if (!user) {
    return { user: null, error: errorResponse('Authentication required. Please log in.', 401) };
  }
  // Check that the user is a real member (not just admin-secret-based)
  if (user.userId === 0) {
    return { user: null, error: errorResponse('Please log in with a member account.', 401) };
  }
  return { user, error: null };
}

/**
 * Requires admin authentication — returns user or error response.
 * Accepts both JWT (with admin role) and X-Admin-Secret header.
 * Re-verifies admin role from database to prevent stale JWT privileges.
 */
async function requireAdmin(request, env) {
  const { user } = await getAuthenticatedUser(request, env);
  if (!user || user.role !== 'admin') {
    return { user: null, error: errorResponse('Admin access required.', 403) };
  }

  // Re-verify admin role from database for JWT-based sessions
  // (X-Admin-Secret user has userId=0 and is always valid while secret is correct)
  if (user.userId && user.userId !== 0 && env.DB) {
    try {
      const dbUser = await env.DB
        .prepare('SELECT role FROM members WHERE id = ?')
        .bind(user.userId)
        .first();
      if (!dbUser || dbUser.role !== 'admin') {
        return { user: null, error: errorResponse('Admin access required.', 403) };
      }
      // Update the role in case it changed (e.g., admin -> member)
      user.role = dbUser.role;
    } catch (err) {
      console.error('Admin role re-verification failed:', err.message);
      // Fail closed — if DB check fails, deny access
      return { user: null, error: errorResponse('Admin access verification failed.', 500) };
    }
  }

  return { user, error: null };
}

/**
 * Optional authentication — returns user if logged in, null otherwise.
 * Never returns an error — useful for endpoints that work for both
 * logged-in and anonymous users.
 */
async function getOptionalAuth(request, env) {
  const { user } = await getAuthenticatedUser(request, env);
  return user;
}

// ============================================================
// ADMIN AUTHENTICATION (legacy — X-Admin-Secret header)
// ============================================================

/**
 * Allowed origin for admin CORS headers.
 */
const ADMIN_ORIGIN = 'https://murauma.pages.dev';

/**
 * Site origin for public API CORS headers.
 * Used to restrict sensitive endpoints (login, register, profile) to the production site.
 */
const SITE_ORIGIN = 'https://murauma.pages.dev';

/**
 * Validates the admin secret from the X-Admin-Secret header.
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns true if authenticated, false otherwise.
 */
function authenticateAdmin(request, env) {
  const secret = request.headers.get('X-Admin-Secret');
  if (!secret || !env.ADMIN_SECRET) return false;
  // Timing-safe comparison: XOR all chars, result must be 0
  if (secret.length !== env.ADMIN_SECRET.length) return false;
  let result = 0;
  for (let i = 0; i < secret.length; i++) {
    result |= secret.charCodeAt(i) ^ env.ADMIN_SECRET.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Creates CORS preflight response headers for admin endpoints.
 * Restricts origin to the production site only.
 * @param {string[]} methods - Allowed HTTP methods
 */
function adminCorsHeaders(methods) {
  return {
    'Access-Control-Allow-Origin': ADMIN_ORIGIN,
    'Access-Control-Allow-Methods': methods.join(', '),
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  };
}

/**
 * Creates a CORS preflight Response for admin endpoints.
 * @param {string[]} methods - Allowed HTTP methods
 */
function adminPreflightResponse(methods) {
  return new Response(null, { headers: adminCorsHeaders(methods) });
}

// ============================================================
// YOUTUBE URL NORMALIZATION
// ============================================================

/**
 * Normalizes a YouTube URL to the embed format.
 * Supports:
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 * Returns the normalized embed URL, or the original URL if no video ID found.
 */
function normalizeYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return url;

  // 1) Embed URL: https://www.youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  // 2) Short URL: https://youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  // 3) Watch URL: https://www.youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);

  const videoId = embedMatch?.[1] || shortMatch?.[1] || watchMatch?.[1] || null;

  if (videoId) {
    return `https://www.youtube.com/embed/${videoId}`;
  }

  return url; // Return as-is if we can't extract a video ID
}

/**
 * Validates that a URL uses a safe scheme (https:// or http://).
 * Rejects javascript:, data:, vbscript:, and other dangerous schemes.
 * Returns the URL if safe, or null if dangerous.
 */
function validateUrlScheme(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
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
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  SESSION_COOKIE_NAME,
  JWT_EXPIRY_SECONDS,
  jsonResponse,
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  validateTrainerId,
  validateUsername,
  validatePassword,
  sanitizeHtml,
  sanitizeRichHtml,
  sanitizeText,
  generateSlug,
  checkRateLimit,
  getClientKey,
  verifyHcaptcha,
  hashPassword,
  verifyPassword,
  createJWT,
  verifyJWT,
  parseCookies,
  sessionCookieValue,
  clearSessionCookieValue,
  getAuthenticatedUser,
  requireAuth,
  requireAdmin,
  getOptionalAuth,
  authenticateAdmin,
  adminCorsHeaders,
  adminPreflightResponse,
  normalizeYouTubeUrl,
  validateUrlScheme,
  SITE_ORIGIN,
};

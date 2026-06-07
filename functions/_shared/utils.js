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
 * Sanitizes HTML content by removing dangerous elements and attributes.
 * This complements client-side DOMPurify for defense-in-depth.
 */
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  
  // Remove <script> tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove <iframe> tags
  html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove <object>, <embed>, <form> tags
  html = html.replace(/<(object|embed|form)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');
  
  // Remove on* event handler attributes
  html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  
  // Remove javascript: URLs
  html = html.replace(/(href|src)\s*=\s*["']javascript:[^"']*["']/gi, '$1=""');
  
  // Remove data: URLs in src (XSS vector)
  html = html.replace(/src\s*=\s*["']data:[^"']*["']/gi, 'src=""');
  
  // Remove dangerous style attributes
  html = html.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, (match) => {
    const lower = match.toLowerCase();
    if (lower.includes('expression(') || lower.includes('javascript:') || lower.includes('url(')) {
      return '';
    }
    return match;
  });
  
  // Remove <meta> and <link> tags
  html = html.replace(/<(meta|link)\b[^>]*\/?>/gi, '');
  
  return html.trim();
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

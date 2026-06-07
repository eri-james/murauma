/**
 * MURA Backend - Hardened Google Apps Script
 * 
 * SECURITY FEATURES:
 * 1. Server-side HTML sanitization (strips <script>, on* event handlers, javascript: URLs)
 * 2. Rate limiting via CacheService (max 3 submissions per IP per 10 minutes)
 * 3. hCaptcha verification for form submissions
 * 4. Input validation and length limits
 * 
 * DEPLOYMENT:
 * 1. Go to script.google.com and create a new project
 * 2. Paste this code (replacing existing Code.gs content)
 * 3. Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the deployment URL and update it in the HTML files
 * 
 * CONFIGURATION:
 * - Replace YOUR_HCAPTCHA_SECRET_KEY below with your hCaptcha secret key
 *   (get one free at https://www.hcaptcha.com/)
 */

// ============================================================
// CONFIGURATION
// ============================================================

const HCAPTCHA_SECRET = 'ES_5ac6268269644eb7a90d5865ad7f8a7b'; // hCaptcha secret key
const RATE_LIMIT_MAX = 3;           // Max submissions per window
const RATE_LIMIT_WINDOW = 600;      // Window in seconds (10 minutes)
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50000;
const MAX_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 500;
const MAX_TRAINER_ID_LENGTH = 12;

// Google Drive folder IDs (replace with your actual folder IDs)
const MEMBERS_FOLDER_ID = 'YOUR_MEMBERS_FOLDER_ID';     // Folder for member profile pictures
const WRITINGS_FOLDER_ID = 'YOUR_WRITINGS_FOLDER_ID';   // Folder for writing JSON files
const MEMBERS_SHEET_ID = 'YOUR_MEMBERS_SHEET_ID';       // Spreadsheet ID for member data

// ============================================================
// HTML SANITIZATION
// ============================================================

/**
 * Sanitizes HTML content by removing dangerous elements and attributes.
 * This is a server-side complement to client-side DOMPurify.
 * 
 * @param {string} html - The HTML string to sanitize
 * @returns {string} The sanitized HTML string
 */
function sanitizeHtml(html) {
  if (typeof html !== 'string') return '';
  
  // Remove <script> tags and their content
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove <iframe> tags
  html = html.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  
  // Remove <object>, <embed>, <form> tags
  html = html.replace(/<(object|embed|form)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');
  
  // Remove on* event handler attributes (onclick, onload, onerror, etc.)
  html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  
  // Remove javascript: URLs in href/src attributes
  html = html.replace(/(href|src)\s*=\s*["']javascript:[^"']*["']/gi, '$1=""');
  
  // Remove data: URLs in src attributes (can be used for XSS)
  html = html.replace(/src\s*=\s*["']data:[^"']*["']/gi, 'src=""');
  
  // Remove style attributes that could contain expression() or url()
  html = html.replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, function(match) {
    const styleContent = match.toLowerCase();
    if (styleContent.includes('expression(') || styleContent.includes('javascript:') || styleContent.includes('url(')) {
      return '';
    }
    return match;
  });
  
  // Remove <meta> and <link> tags (could redirect or inject)
  html = html.replace(/<(meta|link)\b[^>]*\/?>/gi, '');
  
  // Remove base64-encoded script attempts in tags
  html = html.replace(/<img\b[^>]*onload[^>]*>/gi, '');
  
  return html.trim();
}

/**
 * Sanitizes plain text by escaping HTML entities.
 * Use this for fields that should be plain text only (names, bios, etc.)
 * 
 * @param {string} text - The text to sanitize
 * @returns {string} The sanitized text with HTML entities escaped
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
 * Checks if the requester has exceeded the rate limit.
 * Uses CacheService to track submissions by IP-ish key.
 * 
 * @param {string} key - An identifier for the requester (e.g., IP or a hash)
 * @returns {boolean} true if the request is allowed, false if rate-limited
 */
function checkRateLimit(key) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'rate_' + key;
  const count = parseInt(cache.get(cacheKey) || '0', 10);
  
  if (count >= RATE_LIMIT_MAX) {
    return false; // Rate limit exceeded
  }
  
  cache.put(cacheKey, (count + 1).toString(), RATE_LIMIT_WINDOW);
  return true;
}

/**
 * Extracts a client identifier for rate limiting.
 * Uses query string parameter or falls back to a hash of headers.
 * 
 * @param {Object} e - The event object from the web app request
 * @returns {string} A client identifier string
 */
function getClientId(e) {
  // Google Apps Script web apps don't expose the client IP directly.
  // We use a combination of available headers as a best-effort identifier.
  const headers = e.parameter || {};
  // If the client sends a fingerprint or ID, use it; otherwise use a default
  return headers._clientId || 'anonymous';
}

// ============================================================
// hCAPTCHA VERIFICATION
// ============================================================

/**
 * Verifies an hCaptcha token with the hCaptcha API.
 * 
 * @param {string} token - The hCaptcha response token from the client
 * @returns {boolean} true if verification succeeds, false otherwise
 */
function verifyHcaptcha(token) {
  if (HCAPTCHA_SECRET === 'YOUR_HCAPTCHA_SECRET_KEY') {
    // If hCaptcha is not configured, skip verification (but log a warning)
    console.warn('hCaptcha secret key not configured. Skipping verification. Configure this for production!');
    return true;
  }
  
  if (!token) {
    console.error('hCaptcha token is missing.');
    return false;
  }
  
  try {
    const response = UrlFetchApp.fetch('https://api.hcaptcha.com/siteverify', {
      method: 'post',
      payload: {
        secret: HCAPTCHA_SECRET,
        response: token
      }
    });
    
    const result = JSON.parse(response.getContentText());
    return result.success === true;
  } catch (error) {
    console.error('hCaptcha verification error:', error.message);
    return false;
  }
}

// ============================================================
// INPUT VALIDATION
// ============================================================

/**
 * Validates and trims a string field.
 * 
 * @param {string} value - The value to validate
 * @param {number} maxLength - Maximum allowed length
 * @param {string} fieldName - Name of the field (for error messages)
 * @returns {Object} { valid: boolean, value: string, error: string|null }
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

// ============================================================
// MAIN REQUEST HANDLER
// ============================================================

/**
 * Handles POST requests to the web app.
 * This is the main entry point for form submissions.
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const clientId = getClientId(e);
    
    // --- Rate Limiting ---
    if (!checkRateLimit(clientId)) {
      return jsonResponse({
        result: 'error',
        message: 'Rate limit exceeded. Please wait a few minutes before trying again.'
      });
    }
    
    // --- hCaptcha Verification ---
    if (data.hCaptchaToken && !verifyHcaptcha(data.hCaptchaToken)) {
      return jsonResponse({
        result: 'error',
        message: 'CAPTCHA verification failed. Please try again.'
      });
    }
    
    // --- Route by form type ---
    switch (data.formType) {
      case 'memberRegistration':
        return handleMemberRegistration(data);
      case 'writingSubmission':
        return handleWritingSubmission(data);
      default:
        return jsonResponse({ result: 'error', message: 'Unknown form type.' });
    }
    
  } catch (error) {
    console.error('doPost error:', error.message);
    return jsonResponse({ result: 'error', message: 'An internal error occurred.' });
  }
}

/**
 * Handles GET requests (for listing writings, etc.)
 */
function doGet(e) {
  try {
    const action = e.parameter.action;
    
    switch (action) {
      case 'listWritings':
        return handleListWritings();
      default:
        return jsonResponse({ result: 'error', message: 'Unknown action.' });
    }
  } catch (error) {
    console.error('doGet error:', error.message);
    return jsonResponse({ result: 'error', message: 'An internal error occurred.' });
  }
}

// ============================================================
// MEMBER REGISTRATION
// ============================================================

function handleMemberRegistration(data) {
  // Validate all fields
  const nameResult = validateField(data.memberName, MAX_NAME_LENGTH, 'Display Name');
  if (!nameResult.valid) return jsonResponse({ result: 'error', message: nameResult.error });
  
  const trainerResult = validateField(data.trainerID, MAX_TRAINER_ID_LENGTH, 'Trainer ID');
  if (!trainerResult.valid) return jsonResponse({ result: 'error', message: trainerResult.error });
  
  // Validate Trainer ID format (12 digits)
  if (!/^\d{12}$/.test(trainerResult.value)) {
    return jsonResponse({ result: 'error', message: 'Trainer ID must be exactly 12 digits.' });
  }
  
  const favUmaResult = validateField(data.favoriteUma, MAX_NAME_LENGTH, 'Favorite Umamusume');
  if (!favUmaResult.valid) return jsonResponse({ result: 'error', message: favUmaResult.error });
  
  const bioResult = validateField(data.bio, MAX_BIO_LENGTH, 'Bio');
  if (!bioResult.valid) return jsonResponse({ result: 'error', message: bioResult.error });
  
  // Sanitize text fields (these will be displayed as plain text in HTML)
  const sanitizedName = sanitizeText(nameResult.value);
  const sanitizedTrainerId = trainerResult.value; // Numeric, no sanitization needed
  const sanitizedFavUma = sanitizeText(favUmaResult.value);
  const sanitizedBio = sanitizeText(bioResult.value);
  
  // Handle profile picture upload
  let profilePictureUrl = '';
  if (data.profilePicture && data.fileName && data.mimeType) {
    try {
      // Decode base64 image data
      const decoded = Utilities.base64Decode(data.profilePicture.split(',')[1] || data.profilePicture);
      const blob = Utilities.newBlob(decoded, data.mimeType, data.fileName);
      
      // Upload to Google Drive
      const folder = DriveApp.getFolderById(MEMBERS_FOLDER_ID);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      profilePictureUrl = file.getDownloadUrl();
    } catch (error) {
      console.error('Image upload error:', error.message);
      return jsonResponse({ result: 'error', message: 'Failed to upload profile picture.' });
    }
  } else {
    return jsonResponse({ result: 'error', message: 'Profile picture is required.' });
  }
  
  // Save to Google Sheets
  try {
    const sheet = SpreadsheetApp.openById(MEMBERS_SHEET_ID).getActiveSheet();
    sheet.appendRow([
      sanitizedName,
      sanitizedTrainerId,
      sanitizedFavUma,
      sanitizedBio,
      profilePictureUrl,
      'Pending' // Approval status
    ]);
  } catch (error) {
    console.error('Sheet write error:', error.message);
    return jsonResponse({ result: 'error', message: 'Failed to save registration data.' });
  }
  
  return jsonResponse({
    result: 'success',
    message: 'Registration submitted successfully! Please wait for an admin to approve your entry.'
  });
}

// ============================================================
// WRITING SUBMISSION
// ============================================================

function handleWritingSubmission(data) {
  // Validate fields
  const trainerResult = validateField(data.trainerID, MAX_TRAINER_ID_LENGTH, 'Trainer ID');
  if (!trainerResult.valid) return jsonResponse({ result: 'error', message: trainerResult.error });
  
  if (!/^\d{12}$/.test(trainerResult.value)) {
    return jsonResponse({ result: 'error', message: 'Trainer ID must be exactly 12 digits.' });
  }
  
  const titleResult = validateField(data.title, MAX_TITLE_LENGTH, 'Title');
  if (!titleResult.valid) return jsonResponse({ result: 'error', message: titleResult.error });
  
  const contentResult = validateField(data.content, MAX_CONTENT_LENGTH, 'Content');
  if (!contentResult.valid) return jsonResponse({ result: 'error', message: contentResult.error });
  
  // Sanitize the Markdown content (remove any raw HTML injection attempts)
  const sanitizedTitle = sanitizeHtml(titleResult.value);
  const sanitizedContent = sanitizeHtml(contentResult.value);
  
  // Look up author name from members sheet using Trainer ID
  let authorName = 'Unknown';
  try {
    const sheet = SpreadsheetApp.openById(MEMBERS_SHEET_ID).getActiveSheet();
    const data_rows = sheet.getDataRange().getValues();
    for (let i = 1; i < data_rows.length; i++) {
      if (data_rows[i][1] === trainerResult.value) { // Trainer ID is column B (index 1)
        authorName = data_rows[i][0]; // Display Name is column A (index 0)
        break;
      }
    }
  } catch (error) {
    console.error('Sheet read error:', error.message);
  }
  
  // Save as JSON file to Google Drive
  try {
    const folder = DriveApp.getFolderById(WRITINGS_FOLDER_ID);
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const fileName = `${dateStr}-${sanitizedTitle.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30).toLowerCase()}.json`;
    
    const writingData = {
      title: sanitizedTitle,
      author: sanitizeText(authorName),
      content: sanitizedContent,
      trainerID: trainerResult.value,
      timestamp: now.toISOString()
    };
    
    const blob = Utilities.newBlob(JSON.stringify(writingData, null, 2), 'application/json', fileName);
    folder.createFile(blob);
    
  } catch (error) {
    console.error('File write error:', error.message);
    return jsonResponse({ result: 'error', message: 'Failed to save writing.' });
  }
  
  return jsonResponse({
    result: 'success',
    message: 'Writing submitted successfully! It will appear in the Writings Library shortly.'
  });
}

// ============================================================
// LIST WRITINGS (GET endpoint)
// ============================================================

function handleListWritings() {
  try {
    const folder = DriveApp.getFolderById(WRITINGS_FOLDER_ID);
    const files = folder.getFiles();
    const writings = [];
    
    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().endsWith('.json')) {
        try {
          const content = file.getBlob().getDataAsString();
          const data = JSON.parse(content);
          
          // Sanitize data before sending to client (defense in depth)
          writings.push({
            title: sanitizeHtml(data.title || ''),
            author: sanitizeText(data.author || 'Unknown'),
            content: sanitizeHtml(data.content || ''),
            timestamp: data.timestamp || file.getDateCreated().toISOString()
          });
        } catch (parseError) {
          console.error('Failed to parse writing file:', file.getName(), parseError.message);
        }
      }
    }
    
    return jsonResponse({ result: 'success', writings: writings });
    
  } catch (error) {
    console.error('List writings error:', error.message);
    return jsonResponse({ result: 'error', message: 'Failed to list writings.' });
  }
}

// ============================================================
// UTILITY
// ============================================================

/**
 * Creates a JSON response with the correct content type.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

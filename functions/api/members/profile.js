/**
 * PUT /api/members/profile — Update Profile
 * 
 * Allows logged-in members to update their profile.
 * Fields that can be updated: name, favorite_uma, bio, trainer_id,
 * profile picture, and password (with current password verification).
 * 
 * Request body (JSON):
 *   { displayName, favoriteUma, bio, trainerID, profilePicture, mimeType, currentPassword, newPassword }
 * 
 * All fields are optional — only included fields will be updated.
 * Password change requires currentPassword.
 */
import {
  errorResponse,
  jsonResponse,
  validateField,
  validateOptionalField,
  validateTrainerId,
  validatePassword,
  sanitizeText,
  requireAuth,
  hashPassword,
  verifyPassword,
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  SITE_ORIGIN,
} from '../../_shared/utils.js';

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB for profile picture updates

export async function onRequestPut(context) {
  const { request, env } = context;
  const db = env.DB;

  try {
    // --- Authenticate ---
    const { user, error } = await requireAuth(request, env);
    if (error) return error;

    // --- Enforce body size limit ---
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      return errorResponse('Request body too large.', 413);
    }

    const data = await request.json();

    // --- Fetch current member data ---
    const member = await db
      .prepare('SELECT id, username, password_hash, password_salt, trainer_id FROM members WHERE id = ?')
      .bind(user.userId)
      .first();

    if (!member) {
      return errorResponse('Member not found.', 404);
    }

    // Build dynamic UPDATE query
    const updates = [];
    const values = [];

    // --- Display Name ---
    if (data.displayName !== undefined) {
      const nameResult = validateField(data.displayName, 50, 'Display Name');
      if (!nameResult.valid) return errorResponse(nameResult.error);
      updates.push('name = ?');
      values.push(sanitizeText(nameResult.value));
    }

    // --- Favorite Uma ---
    if (data.favoriteUma !== undefined) {
      const favUmaResult = validateOptionalField(data.favoriteUma, 50, 'Favorite Umamusume');
      if (!favUmaResult.valid) return errorResponse(favUmaResult.error);
      updates.push('favorite_uma = ?');
      values.push(favUmaResult.value ? sanitizeText(favUmaResult.value) : null);
    }

    // --- Bio ---
    if (data.bio !== undefined) {
      const bioResult = validateOptionalField(data.bio, 500, 'Bio');
      if (!bioResult.valid) return errorResponse(bioResult.error);
      updates.push('bio = ?');
      values.push(bioResult.value ? sanitizeText(bioResult.value) : null);
    }

    // --- Trainer ID ---
    if (data.trainerID !== undefined) {
      const trainerResult = validateTrainerId(data.trainerID);
      if (!trainerResult.valid) return errorResponse(trainerResult.error);
      
      // Check for duplicate trainer_id (if providing a new one)
      if (trainerResult.value && trainerResult.value !== member.trainer_id) {
        const existing = await db
          .prepare('SELECT id FROM members WHERE trainer_id = ? AND id != ?')
          .bind(trainerResult.value, user.userId)
          .first();
        if (existing) {
          return errorResponse('This Trainer ID is already registered by another member.');
        }
      }
      updates.push('trainer_id = ?');
      values.push(trainerResult.value);
    }

    // --- Profile Picture ---
    if (data.profilePicture && data.mimeType) {
      if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
        return errorResponse('Invalid image format. Allowed: PNG, JPEG, GIF, WebP.');
      }

      let base64Data;
      try {
        base64Data = data.profilePicture.includes(',')
          ? data.profilePicture.split(',')[1]
          : data.profilePicture;
        const decoded = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        if (decoded.length > MAX_IMAGE_SIZE_BYTES) {
          return errorResponse('Image file too large. Maximum size is 5MB.');
        }
      } catch {
        return errorResponse('Invalid image data.');
      }

      updates.push('profile_picture_data = ?');
      values.push(base64Data);
      updates.push('profile_picture_mime = ?');
      values.push(data.mimeType);
    }

    // --- Password Change ---
    if (data.newPassword) {
      if (!data.currentPassword) {
        return errorResponse('Current password is required to set a new password.');
      }

      // Verify current password
      const isCurrentValid = await verifyPassword(
        data.currentPassword,
        member.password_hash,
        member.password_salt
      );
      if (!isCurrentValid) {
        return errorResponse('Current password is incorrect.', 401);
      }

      // Validate new password
      const newPasswordResult = validatePassword(data.newPassword);
      if (!newPasswordResult.valid) return errorResponse(newPasswordResult.error);

      // Hash new password
      const { hash, salt } = await hashPassword(data.newPassword);
      updates.push('password_hash = ?');
      values.push(hash);
      updates.push('password_salt = ?');
      values.push(salt);
    }

    // --- If nothing to update ---
    if (updates.length === 0) {
      return errorResponse('No fields to update.');
    }

    // --- Execute Update ---
    values.push(user.userId); // for WHERE clause
    const query = `UPDATE members SET ${updates.join(', ')} WHERE id = ?`;

    try {
      await db.prepare(query).bind(...values).run();
    } catch (dbError) {
      console.error('Profile update error:', dbError.message);
      return errorResponse('Failed to update profile. Please try again.');
    }

    return jsonResponse({ result: 'success', message: 'Profile updated successfully.' });

  } catch (error) {
    console.error('Profile update error:', error.message);
    return errorResponse('An internal error occurred.', 500);
  }
}

/**
 * Handle CORS preflight requests.
 */
export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': SITE_ORIGIN,
      'Access-Control-Allow-Methods': 'PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

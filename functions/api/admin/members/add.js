/**
 * POST /api/admin/members/add — Manually add a member
 *
 * Request body (JSON):
 *   { name (required), username (required), password (required),
 *     trainerId?, favoriteUma?, bio?, role? (default 'member'),
 *     status? (default 'approved') }
 *
 * Admin-added members default to 'approved' status.
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  validateUsername,
  validatePassword,
  validateTrainerId,
  sanitizeText,
  hashPassword,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    // Name (required, 1-50 chars)
    const nameResult = validateField(data.name, 50, 'Name');
    if (!nameResult.valid) return errorResponse(nameResult.error);

    // Username (required, 3-30 chars, unique)
    const usernameResult = validateUsername(data.username);
    if (!usernameResult.valid) return errorResponse(usernameResult.error);

    // Check username uniqueness
    const usernameCheck = await db
      .prepare('SELECT id FROM members WHERE username = ?')
      .bind(usernameResult.value)
      .first();
    if (usernameCheck) return errorResponse('Username is already taken.');

    // Password (required, 8-100 chars)
    const passwordResult = validatePassword(data.password);
    if (!passwordResult.valid) return errorResponse(passwordResult.error);

    // Trainer ID (optional, 12-digit string, unique)
    let trainerId = null;
    if (data.trainerId !== undefined && data.trainerId !== '') {
      const trainerIdResult = validateTrainerId(data.trainerId);
      if (!trainerIdResult.valid) return errorResponse(trainerIdResult.error);
      trainerId = trainerIdResult.value;
      if (trainerId) {
        const trainerIdCheck = await db
          .prepare('SELECT id FROM members WHERE trainer_id = ?')
          .bind(trainerId)
          .first();
        if (trainerIdCheck) return errorResponse('Trainer ID is already in use.');
      }
    }

    // Favorite Uma (optional, 1-50 chars)
    const favoriteUmaResult = validateOptionalField(data.favoriteUma, 50, 'Favorite Uma');
    if (!favoriteUmaResult.valid) return errorResponse(favoriteUmaResult.error);

    // Bio (optional, 1-500 chars)
    const bioResult = validateOptionalField(data.bio, 500, 'Bio');
    if (!bioResult.valid) return errorResponse(bioResult.error);

    // Role (optional, default 'member')
    const role = data.role && ['member', 'admin'].includes(data.role) ? data.role : 'member';

    // Status (optional, default 'approved' for admin-added members)
    const status = data.status && ['pending', 'approved', 'rejected'].includes(data.status) ? data.status : 'approved';

    // Hash the password
    const { hash, salt } = await hashPassword(data.password);

    // Insert the new member
    const result = await db
      .prepare(
        `INSERT INTO members (username, password_hash, password_salt, name, trainer_id, favorite_uma, bio, profile_picture_data, profile_picture_mime, role, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', 'image/jpeg', ?, ?)`
      )
      .bind(
        usernameResult.value,
        hash,
        salt,
        sanitizeText(nameResult.value),
        trainerId,
        favoriteUmaResult.value ? sanitizeText(favoriteUmaResult.value) : null,
        bioResult.value ? sanitizeText(bioResult.value) : null,
        role,
        status,
      )
      .run();

    const newId = result.meta.last_row_id;

    return successResponse('Member added successfully.', { id: newId });

  } catch (error) {
    console.error('Admin add member error:', error.message);
    return errorResponse('Failed to add member.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}

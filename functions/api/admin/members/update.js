/**
 * POST /api/admin/members/update — Update member fields
 *
 * Request body (JSON):
 *   { memberId (required), name?, username?, trainerId?, favoriteUma?, bio?, role?, status? }
 *
 * Only updates fields that are provided.
 * Checks username and trainer_id uniqueness before updating.
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  validateUsername,
  validateTrainerId,
  sanitizeText,
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

    // Validate memberId
    if (!data.memberId || !Number.isInteger(data.memberId)) {
      return errorResponse('Valid member ID (integer) is required.');
    }

    // Check member exists
    const existing = await db
      .prepare('SELECT id, username, trainer_id FROM members WHERE id = ?')
      .bind(data.memberId)
      .first();

    if (!existing) {
      return errorResponse('Member not found.');
    }

    const updates = [];
    const values = [];

    // Name (optional, 1-50 chars)
    if (data.name !== undefined) {
      const result = validateField(data.name, 50, 'Name');
      if (!result.valid) return errorResponse(result.error);
      updates.push('name = ?');
      values.push(sanitizeText(result.value));
    }

    // Username (optional, 3-30 chars, unique)
    if (data.username !== undefined) {
      const result = validateUsername(data.username);
      if (!result.valid) return errorResponse(result.error);
      // Check uniqueness (exclude current member)
      const usernameCheck = await db
        .prepare('SELECT id FROM members WHERE username = ? AND id != ?')
        .bind(result.value, data.memberId)
        .first();
      if (usernameCheck) return errorResponse('Username is already taken.');
      updates.push('username = ?');
      values.push(result.value);
    }

    // Trainer ID (optional, 12-digit string, unique or null)
    // Send empty string to clear
    if (data.trainerId !== undefined) {
      // Empty string means clear the trainer_id
      if (data.trainerId === '') {
        updates.push('trainer_id = ?');
        values.push(null);
      } else {
        const result = validateTrainerId(data.trainerId);
        if (!result.valid) return errorResponse(result.error);
        // Check uniqueness (exclude current member, ignore null trainer_ids)
        if (result.value) {
          const trainerIdCheck = await db
            .prepare('SELECT id FROM members WHERE trainer_id = ? AND id != ?')
            .bind(result.value, data.memberId)
            .first();
          if (trainerIdCheck) return errorResponse('Trainer ID is already in use by another member.');
        }
        updates.push('trainer_id = ?');
        values.push(result.value);
      }
    }

    // Favorite Uma (optional, 1-50 chars)
    if (data.favoriteUma !== undefined) {
      const result = validateOptionalField(data.favoriteUma, 50, 'Favorite Uma');
      if (!result.valid) return errorResponse(result.error);
      updates.push('favorite_uma = ?');
      values.push(result.value ? sanitizeText(result.value) : null);
    }

    // Bio (optional, 1-500 chars)
    if (data.bio !== undefined) {
      const result = validateOptionalField(data.bio, 500, 'Bio');
      if (!result.valid) return errorResponse(result.error);
      updates.push('bio = ?');
      values.push(result.value ? sanitizeText(result.value) : null);
    }

    // Role (optional, must be 'member' or 'admin')
    if (data.role !== undefined) {
      if (!['member', 'admin'].includes(data.role)) {
        return errorResponse('Role must be member or admin.');
      }
      updates.push('role = ?');
      values.push(data.role);
    }

    // Status (optional, must be 'pending'/'approved'/'rejected')
    if (data.status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(data.status)) {
        return errorResponse('Status must be pending, approved, or rejected.');
      }
      updates.push('status = ?');
      values.push(data.status);
    }

    if (updates.length === 0) {
      return errorResponse('No fields to update.');
    }

    values.push(data.memberId);

    await db
      .prepare(`UPDATE members SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    // Fetch and return the updated member
    const updated = await db
      .prepare('SELECT id, username, name, trainer_id, favorite_uma, bio, role, status, created_at FROM members WHERE id = ?')
      .bind(data.memberId)
      .first();

    return successResponse(`Member #${data.memberId} updated successfully.`, {
      member: {
        id: updated.id,
        username: updated.username || '',
        name: updated.name || '',
        trainerId: updated.trainer_id,
        favoriteUma: updated.favorite_uma || '',
        bio: updated.bio || '',
        role: updated.role,
        status: updated.status,
        createdAt: updated.created_at,
      },
    });

  } catch (error) {
    console.error('Admin update member error:', error.message);
    return errorResponse('Failed to update member.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['POST', 'OPTIONS']);
}

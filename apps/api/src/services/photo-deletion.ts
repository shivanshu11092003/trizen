import { AppError } from '@photos/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { eventMembers, galleries, photos } from '../db/schema.js';
import { audit } from './audit.js';

const SELF_DELETE_WINDOW_MS = 15 * 60 * 1000;

/** Validate the entire request before deleting; a rejected batch changes nothing. */
export async function deletePhotos(
  c: Parameters<typeof audit>[0],
  photoIds: string[],
  eventId?: string,
): Promise<number> {
  const ids = [...new Set(photoIds)];
  const userId = c.get('session')!.userId;
  const result = await c.get('db').transaction(async (tx) => {
    const rows = await tx
      .select({ photo: photos, role: eventMembers.role })
      .from(photos)
      .innerJoin(eventMembers, and(eq(eventMembers.eventId, photos.eventId), eq(eventMembers.userId, userId)))
      .where(and(inArray(photos.id, ids), eventId ? eq(photos.eventId, eventId) : undefined))
      .for('update', { of: photos });
    if (rows.length !== ids.length)
      throw new AppError('NOT_FOUND', 'One or more photographs were not found in this event.');
    const now = Date.now();
    for (const { photo, role } of rows) {
      if (
        role !== 'admin' &&
        (photo.uploadedBy !== userId || now - photo.createdAt >= SELF_DELETE_WINDOW_MS)
      ) {
        throw new AppError(
          'FORBIDDEN',
          'Members can only delete their own uploads within 15 minutes. Ask the event lead.',
        );
      }
    }
    const activeIds = rows.filter(({ photo }) => photo.status !== 'deleted').map(({ photo }) => photo.id);
    if (activeIds.length) {
      await tx
        .update(photos)
        .set({ status: 'deleted', deletedAt: now, isSelected: false, updatedAt: now })
        .where(inArray(photos.id, activeIds));
      await tx
        .update(galleries)
        .set({ coverPhotoId: null, updatedAt: now })
        .where(inArray(galleries.coverPhotoId, activeIds));
    }
    return { deleted: activeIds.length, eventId: rows[0]!.photo.eventId };
  });
  await audit(c, {
    action: 'photo.deleted',
    eventId: result.eventId,
    targetType: 'photo',
    ...(ids.length === 1 ? { targetId: ids[0] } : {}),
    metadata: { photoIds: ids, count: result.deleted },
  });
  return result.deleted;
}

import { ConflictException } from '@nestjs/common';
import { type SendMessage } from '@relay/shared';
import { createHash } from 'node:crypto';
import { type ReservationDoc } from './send-reservation.schema.js';
export function sendFingerprint(data: SendMessage) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        data.conversationId,
        data.type,
        data.replyTo ?? null,
        data.type === 'text' ? data.body : data.mediaKey,
      ]),
    )
    .digest('hex');
}
export function assertMatchingSend(stored: ReservationDoc, fingerprint: string) {
  if (stored.fingerprint !== fingerprint)
    throw new ConflictException('This client message ID is already used for another message');
  return stored.event;
}

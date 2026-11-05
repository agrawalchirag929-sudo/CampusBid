import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';
import {
  queuedEmailPayloadSchema,
  type QueuedEmailPayload,
  type VerificationEmailPayload,
} from './types.js';

function encryptionKey(outboxKey: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(outboxKey, 'utf8'),
      Buffer.from('campusbid-mail-outbox-v1', 'utf8'),
      Buffer.from(purpose, 'utf8'),
      32,
    ),
  );
}

function encryptWithPurpose(
  payload: QueuedEmailPayload,
  outboxKey: string,
  purpose: string,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    encryptionKey(outboxKey, purpose),
    nonce,
  );
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptWithPurpose(
  encryptedPayload: string,
  outboxKey: string,
  purpose: string,
): unknown {
  const [nonceText, tagText, ciphertextText, extra] =
    encryptedPayload.split('.');
  if (!nonceText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('Mail outbox payload is malformed');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(outboxKey, purpose),
    Buffer.from(nonceText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as unknown;
}

export function encryptMailPayload(
  payload: QueuedEmailPayload,
  outboxKey: string,
): string {
  return encryptWithPurpose(payload, outboxKey, 'mail-payload-v2');
}

export function decryptMailPayload(
  encryptedPayload: string,
  outboxKey: string,
): QueuedEmailPayload {
  try {
    const parsed = queuedEmailPayloadSchema.safeParse(
      decryptWithPurpose(encryptedPayload, outboxKey, 'mail-payload-v2'),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Legacy verification messages used a different key purpose and no kind.
  }

  try {
    const legacy = z
      .object({
        to: z.string().email().max(320),
        name: z.string().min(1).max(100),
        token: z.string().min(32).max(256),
      })
      .strict()
      .safeParse(
        decryptWithPurpose(encryptedPayload, outboxKey, 'verification-email'),
      );
    if (legacy.success) return { kind: 'verification-email', ...legacy.data };
  } catch {
    // The final error below intentionally hides crypto and parsing details.
  }
  throw new Error('Mail outbox payload is invalid');
}

export function encryptVerificationEmail(
  payload: Omit<VerificationEmailPayload, 'kind'>,
  outboxKey: string,
): string {
  return encryptMailPayload(
    { kind: 'verification-email', ...payload },
    outboxKey,
  );
}

export function decryptVerificationEmail(
  encryptedPayload: string,
  outboxKey: string,
): VerificationEmailPayload {
  const payload = decryptMailPayload(encryptedPayload, outboxKey);
  if (payload.kind !== 'verification-email') {
    throw new Error('Mail outbox payload is not a verification email');
  }
  return payload;
}

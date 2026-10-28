import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';

const payloadSchema = z
  .object({
    to: z.string().email().max(320),
    name: z.string().min(1).max(100),
    token: z.string().min(32).max(256),
  })
  .strict();

export type VerificationEmailPayload = z.infer<typeof payloadSchema>;

function encryptionKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('campusbid-mail-outbox-v1', 'utf8'),
      Buffer.from('verification-email', 'utf8'),
      32,
    ),
  );
}

export function encryptVerificationEmail(
  payload: VerificationEmailPayload,
  secret: string,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), nonce);
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

export function decryptVerificationEmail(
  encryptedPayload: string,
  secret: string,
): VerificationEmailPayload {
  const [nonceText, tagText, ciphertextText, extra] =
    encryptedPayload.split('.');
  if (!nonceText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('Mail outbox payload is malformed');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(nonceText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  const parsed = payloadSchema.safeParse(JSON.parse(plaintext) as unknown);
  if (!parsed.success) throw new Error('Mail outbox payload is invalid');
  return parsed.data;
}

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
} from 'node:crypto';

const CODE_LENGTH = 6;
const ENCRYPTION_PURPOSE = 'campusbid-handover-code-v1';

export function generateHandoverCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(CODE_LENGTH, '0');
}

export function hashHandoverCode(
  auctionId: string,
  code: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${auctionId}:${code}`, 'utf8')
    .digest('hex');
}

function encryptionKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      Buffer.from('campusbid-handover-secret-v1', 'utf8'),
      Buffer.from(ENCRYPTION_PURPOSE, 'utf8'),
      32,
    ),
  );
}

export function encryptHandoverCode(code: string, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(code, 'utf8'),
    cipher.final(),
  ]);
  return [
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptHandoverCode(
  encryptedCode: string,
  secret: string,
): string {
  const [nonceText, tagText, ciphertextText, extra] = encryptedCode.split('.');
  if (!nonceText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error('Stored handover code is malformed');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(nonceText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const code = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  if (!/^\d{6}$/.test(code)) throw new Error('Stored handover code is invalid');
  return code;
}

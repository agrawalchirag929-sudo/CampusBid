import { createHash } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import { AuthorizationError } from '../../middleware/require-role.js';
import type { AuthContext, SignedUploadParams } from '@campusbid/shared';

export const CLOUDINARY_ALLOWED_FORMATS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
] as const;
export const CLOUDINARY_MAX_FILE_SIZE = 10 * 1024 * 1024;

export class UploadServiceUnavailableError extends Error {
  readonly status = 503;
  constructor() {
    super('Photo uploads are not configured. Contact the site administrator.');
    this.name = 'UploadServiceUnavailableError';
  }
}

export class UploadsService {
  constructor(
    private readonly config: AppConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  sign(auth: AuthContext): SignedUploadParams {
    if (!auth.roles.includes('SELLER')) throw new AuthorizationError();
    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
      this.config;
    if (
      !CLOUDINARY_CLOUD_NAME ||
      !CLOUDINARY_API_KEY ||
      !CLOUDINARY_API_SECRET
    ) {
      throw new UploadServiceUnavailableError();
    }

    const timestamp = Math.floor(this.clock().getTime() / 1_000);
    const folder = 'campusbid/' + auth.collegeId;
    const allowedFormats = CLOUDINARY_ALLOWED_FORMATS.join(',');
    const maxFileSize = CLOUDINARY_MAX_FILE_SIZE;
    const params = {
      allowed_formats: allowedFormats,
      folder,
      max_file_size: String(maxFileSize),
      timestamp: String(timestamp),
    };
    const signedText =
      Object.entries(params)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => key + '=' + value)
        .join('&') + CLOUDINARY_API_SECRET;
    const signature = createHash('sha1').update(signedText).digest('hex');

    return {
      cloudName: CLOUDINARY_CLOUD_NAME,
      apiKey: CLOUDINARY_API_KEY,
      timestamp,
      folder,
      allowedFormats,
      maxFileSize,
      signature,
    };
  }
}

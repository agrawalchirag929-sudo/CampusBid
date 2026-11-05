import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config.js';
import { createApp } from '../../../src/app.js';
import {
  ConsoleMailProvider,
  createMailProvider,
  SmtpMailProvider,
} from '../../../src/modules/auth/mail-provider.js';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: 'at-least-32-character-test-secret-value',
  MAIL_OUTBOX_KEY: 'at-least-32-character-mail-outbox-key',
  COOKIE_NAME: 'campusbid_refresh',
  CORS_ORIGINS: 'http://localhost:5173',
};

describe('API security configuration', () => {
  it('allows COOKIE_DOMAIN to remain unset for a host-only cookie', () => {
    expect(loadConfig(validEnvironment).COOKIE_DOMAIN).toBeUndefined();
  });

  it('requires strong JWT and mail outbox keys, cookie name, environment, and CORS allowlist', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, JWT_SECRET: 'short' }),
    ).toThrow(/JWT_SECRET/);
    expect(() =>
      loadConfig({ ...validEnvironment, MAIL_OUTBOX_KEY: 'short' }),
    ).toThrow(/MAIL_OUTBOX_KEY/);
    expect(() =>
      loadConfig({ ...validEnvironment, COOKIE_NAME: undefined }),
    ).toThrow(/COOKIE_NAME/);
    expect(() =>
      loadConfig({ ...validEnvironment, NODE_ENV: undefined }),
    ).toThrow(/NODE_ENV/);
    expect(() =>
      loadConfig({ ...validEnvironment, CORS_ORIGINS: undefined }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('requires complete SMTP settings in production and creates the SMTP provider', () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: 'production',
      }),
    ).toThrow(/SMTP_HOST/);
    const productionConfig = loadConfig({
      ...validEnvironment,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587',
      SMTP_USER: 'smtp-user',
      SMTP_PASS: 'smtp-pass',
      MAIL_FROM: 'CampusBid <no-reply@example.test>',
    });
    expect(createMailProvider(productionConfig)).toBeInstanceOf(
      SmtpMailProvider,
    );
    expect(() => createApp({ config: productionConfig })).not.toThrow();
  });
  it('only permits the console mail provider in development and tests', () => {
    expect(() => new ConsoleMailProvider('production')).toThrow();
    expect(() => new ConsoleMailProvider('staging')).toThrow();
    const originalEnvironment = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(() => new ConsoleMailProvider()).toThrow();
    } finally {
      process.env.NODE_ENV = originalEnvironment;
    }
    expect(() => new ConsoleMailProvider('development')).not.toThrow();
    expect(() => new ConsoleMailProvider('test')).not.toThrow();
    expect(createMailProvider(loadConfig(validEnvironment))).toBeInstanceOf(
      ConsoleMailProvider,
    );
  });
});

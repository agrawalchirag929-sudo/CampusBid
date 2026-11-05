import nodemailer, { type Transporter } from 'nodemailer';
import type { UserRole } from '@campusbid/shared';
import type { AppConfig } from '../../config.js';
import type { AuctionNotificationEmailPayload } from '../notifications/types.js';

export interface VerificationEmail {
  to: string;
  name: string;
  token: string;
}

export interface MailProvider {
  sendVerificationEmail(message: VerificationEmail): Promise<void>;
  sendAuctionNotificationEmail(
    message: AuctionNotificationEmailPayload,
  ): Promise<void>;
}

function formatRupees(amountPaise: number): string {
  const rupees = Math.floor(amountPaise / 100);
  const paise = String(amountPaise % 100).padStart(2, '0');
  return `₹${rupees}.${paise}`;
}

function notificationText(message: AuctionNotificationEmailPayload): string {
  switch (message.kind) {
    case 'auction-outbid':
      return `Hello ${message.name},\n\nYou have been outbid on “${message.auctionTitle}”. The new bid is ${formatRupees(message.amountPaise)}.`;
    case 'auction-won':
      return `Hello ${message.name},\n\nYou won “${message.auctionTitle}” with a bid of ${formatRupees(message.amountPaise)}.${message.handoverCode ? `\n\nYour seller handover code is ${message.handoverCode}. Share it with the seller when you collect the item.` : ''}`;
    case 'auction-sold':
      return `Hello ${message.name},\n\nYour listing “${message.auctionTitle}” sold for ${formatRupees(message.amountPaise)}.`;
    case 'auction-unsold':
      return `Hello ${message.name},\n\nYour listing “${message.auctionTitle}” ended without meeting its reserve price.`;
  }
}

export class ConsoleMailProvider implements MailProvider {
  constructor(nodeEnv: string | undefined = process.env.NODE_ENV) {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error(
        'ConsoleMailProvider is allowed only in development or test',
      );
    }
  }

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    console.info('[CampusBid verification]', JSON.stringify(message));
  }

  async sendAuctionNotificationEmail(
    message: AuctionNotificationEmailPayload,
  ): Promise<void> {
    console.info('[CampusBid auction notification]', JSON.stringify(message));
  }
}

export interface SmtpMailConfig {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  MAIL_FROM: string;
}

export class SmtpMailProvider implements MailProvider {
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpMailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
  }

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.MAIL_FROM,
      to: message.to,
      subject: 'Verify your CampusBid email',
      text: `Hello ${message.name},\n\nVerify your CampusBid email with this single-use token:\n${message.token}`,
    });
  }

  async sendAuctionNotificationEmail(
    message: AuctionNotificationEmailPayload,
  ): Promise<void> {
    const subjects = {
      'auction-outbid': 'You have been outbid on CampusBid',
      'auction-won': 'You won a CampusBid auction',
      'auction-sold': 'Your CampusBid listing sold',
      'auction-unsold': 'Your CampusBid auction ended',
    } satisfies Record<AuctionNotificationEmailPayload['kind'], string>;
    await this.transporter.sendMail({
      from: this.config.MAIL_FROM,
      to: message.to,
      subject: subjects[message.kind],
      text: notificationText(message),
    });
  }
}

export function createMailProvider(config: AppConfig): MailProvider {
  if (config.NODE_ENV !== 'production') {
    return new ConsoleMailProvider(config.NODE_ENV);
  }
  const smtp: SmtpMailConfig = {
    SMTP_HOST: config.SMTP_HOST ?? '',
    SMTP_PORT: config.SMTP_PORT ?? 0,
    SMTP_USER: config.SMTP_USER ?? '',
    SMTP_PASS: config.SMTP_PASS ?? '',
    MAIL_FROM: config.MAIL_FROM ?? '',
  };
  if (Object.values(smtp).some((value) => !value)) {
    throw new Error('Production mail delivery requires complete SMTP config');
  }
  return new SmtpMailProvider(smtp);
}

export interface AuthenticatedUser {
  userId: string;
  collegeId: string;
  roles: UserRole[];
}

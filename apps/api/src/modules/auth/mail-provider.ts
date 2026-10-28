import type { UserRole } from '@campusbid/shared';

export interface MailProvider {
  sendVerificationEmail(message: {
    to: string;
    name: string;
    token: string;
  }): Promise<void>;
}

export class ConsoleMailProvider implements MailProvider {
  constructor(nodeEnv: string | undefined = process.env.NODE_ENV) {
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error(
        'ConsoleMailProvider is allowed only in development or test',
      );
    }
  }

  async sendVerificationEmail(message: {
    to: string;
    name: string;
    token: string;
  }): Promise<void> {
    console.info('[CampusBid verification]', JSON.stringify(message));
  }
}

export interface AuthenticatedUser {
  userId: string;
  collegeId: string;
  roles: UserRole[];
}

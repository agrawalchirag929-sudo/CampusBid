import type { Connection, Types } from 'mongoose';
import { CollegeRepository } from './repository.js';

function emailDomain(email: string): string {
  const normalized = email.trim().toLowerCase();
  return normalized.slice(normalized.lastIndexOf('@') + 1);
}

export class CollegeService {
  private readonly repository: CollegeRepository;
  constructor(connection: Connection) {
    this.repository = new CollegeRepository(connection);
  }

  findActiveForEmail(email: string) {
    return this.repository.findActiveByExactDomain(emailDomain(email));
  }

  findActiveById(collegeId: Types.ObjectId) {
    return this.repository.findActiveById(collegeId);
  }

  seedBmsce() {
    return this.repository.seedBmsce();
  }
}

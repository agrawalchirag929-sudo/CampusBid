import type { Connection, Model, Types } from 'mongoose';
import { createCollegeModel, type CollegeFields } from './model.js';

export class CollegeRepository {
  private readonly College: Model<CollegeFields>;

  constructor(connection: Connection) {
    this.College = createCollegeModel(connection);
  }

  findActiveByExactDomain(domain: string) {
    return this.College.findOne({ active: true, emailDomains: domain }).exec();
  }

  findActiveById(collegeId: Types.ObjectId) {
    return this.College.findOne({ _id: collegeId, active: true }).exec();
  }

  async seedBmsce() {
    return this.College.findOneAndUpdate(
      { slug: 'bmsce' },
      {
        $setOnInsert: {
          name: 'BMS College of Engineering',
          slug: 'bmsce',
          emailDomains: ['bmsce.ac.in'],
          active: true,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).exec();
  }
}

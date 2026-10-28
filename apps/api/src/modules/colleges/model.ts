import { Schema, type Connection, type Model } from 'mongoose';

export interface CollegeFields {
  name: string;
  slug: string;
  emailDomains: string[];
  active: boolean;
}

export const collegeSchema = new Schema<CollegeFields>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    emailDomains: {
      type: [String],
      required: true,
      set: (domains: string[]) =>
        domains.map((domain) => domain.trim().toLowerCase()),
      validate: {
        validator: (domains: string[]) =>
          domains.length > 0 &&
          domains.every((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) &&
          new Set(domains).size === domains.length,
        message: 'Email domains must be unique valid domains',
      },
    },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'colleges', versionKey: false },
);

collegeSchema.index({ slug: 1 }, { unique: true, name: 'college_slug_unique' });
collegeSchema.index(
  { emailDomains: 1 },
  { unique: true, name: 'college_email_domain_unique' },
);

export function createCollegeModel(
  connection: Connection,
): Model<CollegeFields> {
  return (
    (connection.models.College as Model<CollegeFields> | undefined) ??
    connection.model<CollegeFields>('College', collegeSchema)
  );
}

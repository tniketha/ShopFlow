import { z } from 'zod';
import { createDb } from './db.js';
import { hashPassword } from './domain.js';
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    OWNER_EMAIL: z.email().transform((s) => s.toLowerCase()),
    OWNER_NAME: z.string().trim().min(1).max(100),
    OWNER_PASSWORD: z.string().min(12).max(128),
    BUSINESS_NAME: z.string().trim().min(1).max(160),
  })
  .parse(process.env);
const db = createDb(env.DATABASE_URL);
try {
  await db.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email: env.OWNER_EMAIL } }))
      throw new Error('This email already exists; no account was changed');
    const business = await tx.business.create({ data: { name: env.BUSINESS_NAME } });
    const user = await tx.user.create({
      data: {
        businessId: business.id,
        name: env.OWNER_NAME,
        email: env.OWNER_EMAIL,
        passwordHash: await hashPassword(env.OWNER_PASSWORD),
        role: 'OWNER',
      },
    });
    await tx.audit.create({
      data: {
        businessId: business.id,
        actorId: user.id,
        action: 'OWNER_PROVISIONED',
        entityId: user.id,
      },
    });
  });
  console.log('Business and owner created. Sign in with the email and password you supplied.');
} finally {
  await db.$disconnect();
}

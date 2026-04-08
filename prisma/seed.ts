import { PrismaClient, RoleCode, UserStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const pepper = process.env.PASSWORD_PEPPER ?? '';
  const rawPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!rawPassword || rawPassword.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be set and at least 12 characters');
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? '12');
  const passwordHash = await bcrypt.hash(rawPassword + pepper, rounds);

  const adminRole = await prisma.role.upsert({
    where: { code: RoleCode.ADMIN },
    update: { name: 'Administrator' },
    create: { code: RoleCode.ADMIN, name: 'Administrator' },
  });

  await prisma.role.upsert({
    where: { code: RoleCode.SUPERVISOR },
    update: { name: 'Supervisor' },
    create: { code: RoleCode.SUPERVISOR, name: 'Supervisor' },
  });

  await prisma.role.upsert({
    where: { code: RoleCode.AGENT },
    update: { name: 'Agent' },
    create: { code: RoleCode.AGENT, name: 'Agent' },
  });

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@solektra.local';
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
      roleId: adminRole.id,
    },
    create: {
      email,
      username,
      passwordHash,
      fullName: process.env.SEED_ADMIN_FULL_NAME ?? 'System Administrator',
      phone: process.env.SEED_ADMIN_PHONE ?? '250788000000',
      gender: 'Male',
      language: 'English',
      status: UserStatus.ACTIVE,
      roleId: adminRole.id,
    },
  });

  await prisma.account.upsert({
    where: {
      userId_type: { userId: user.id, type: 'OPERATING' },
    },
    update: {},
    create: {
      userId: user.id,
      type: 'OPERATING',
      currency: 'RWF',
      balanceMinor: BigInt(0),
    },
  });

  console.log('Seed complete. Admin email:', email, 'username:', username);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    pool.end();
    process.exit(1);
  });

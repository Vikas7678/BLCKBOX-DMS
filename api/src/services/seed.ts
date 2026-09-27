import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";

const SEED_EMAIL = "vikaskumar9891452674@gmail.com";
const SEED_PASSWORD = "Vikas@123";
const SEED_NAME = "Vikas Kumar";

/** Idempotent bootstrap admin — safe to run on every API startup. */
export async function seedBootstrapAdmin(): Promise<void> {
  const email = SEED_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed: user ${email} already exists — skipping`);
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  await prisma.user.create({
    data: {
      email,
      name: SEED_NAME,
      passwordHash,
      platformRole: "admin",
    },
  });
  console.log(`Seed: created bootstrap admin ${email}`);
}

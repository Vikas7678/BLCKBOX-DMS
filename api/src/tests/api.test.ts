import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";
import { PrismaClient, PlatformRole } from "@prisma/client";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://blckbox:blckbox@localhost:5433/blckbox";
process.env.JWT_SECRET = "test-secret";
process.env.STORAGE_PATH = path.join(__dirname, "../../data/test-uploads");
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.PUBLIC_WEB_URL = "http://localhost:5173";

import { createApp } from "../app";

const prisma = new PrismaClient();
let app: Awaited<ReturnType<typeof createApp>>;

/** Only clean up accounts created by these tests — never wipe the whole DB. */
const testUserIds = new Set<string>();

async function createTestUser(
  email: string,
  name = "User",
  platformRole: PlatformRole = "admin",
) {
  const passwordHash = await bcrypt.hash("password123", 10);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, platformRole },
  });
  testUserIds.add(user.id);
  const res = await request(app).post("/api/auth/login").send({ email, password: "password123" });
  expect(res.status).toBe(200);
  const cookie = res.headers["set-cookie"][0] as string;
  return { user: res.body.user, cookie };
}

async function createWorkspace(cookie: string, name: string) {
  const res = await request(app).post("/api/workspaces").set("Cookie", cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.workspace.id as string;
}

describe("API authz and sharing", () => {
  beforeAll(async () => {
    fs.mkdirSync(process.env.STORAGE_PATH!, { recursive: true });
    app = await createApp();
  });

  afterAll(async () => {
    const ids = Array.from(testUserIds);
    if (ids.length > 0) {
      await prisma.shareLink.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.document.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.workspaceInvitation.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.workspaceMember.deleteMany({ where: { userId: { in: ids } } });
      await prisma.folder.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { createdById: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it("prevents outsider from downloading another workspace file", async () => {
    const a = await createTestUser(`a-${Date.now()}@example.com`, "A");
    const b = await createTestUser(`b-${Date.now()}@example.com`, "B");
    const workspaceId = await createWorkspace(a.cookie, "A team");

    const upload = await request(app)
      .post("/api/documents")
      .set("Cookie", a.cookie)
      .attach("file", Buffer.from("secret-a"), "a.txt")
      .field("title", "A doc")
      .field("workspaceId", workspaceId);
    expect(upload.status).toBe(201);
    const docId = upload.body.document.id as string;

    const denied = await request(app)
      .get(`/api/documents/${docId}/download`)
      .set("Cookie", b.cookie);
    expect(denied.status).toBe(403);

    const allowed = await request(app)
      .get(`/api/documents/${docId}/download`)
      .set("Cookie", a.cookie);
    expect(allowed.status).toBe(200);
    expect(allowed.text).toBe("secret-a");
  });

  it("allows valid share link and rejects revoked/wrong password", async () => {
    const a = await createTestUser(`share-${Date.now()}@example.com`, "Sharer");
    const workspaceId = await createWorkspace(a.cookie, "Share ws");
    const upload = await request(app)
      .post("/api/documents")
      .set("Cookie", a.cookie)
      .attach("file", Buffer.from("shared"), "s.txt")
      .field("workspaceId", workspaceId);
    expect(upload.status).toBe(201);
    const docId = upload.body.document.id as string;

    const openLink = await request(app)
      .post(`/api/documents/${docId}/share-links`)
      .set("Cookie", a.cookie)
      .send({ expiresAt: new Date(Date.now() + 86400000).toISOString() });
    expect(openLink.status).toBe(201);
    const openToken = openLink.body.shareLink.token as string;

    const openMeta = await request(app).get(`/api/s/${openToken}`);
    expect(openMeta.status).toBe(200);
    expect(openMeta.body.share.needsPassword).toBe(false);

    const openDl = await request(app).get(`/api/s/${openToken}/download`);
    expect(openDl.status).toBe(200);
    expect(openDl.text).toBe("shared");

    const locked = await request(app)
      .post(`/api/documents/${docId}/share-links`)
      .set("Cookie", a.cookie)
      .send({
        password: "secret1",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(locked.status).toBe(201);
    const lockedToken = locked.body.shareLink.token as string;

    const needsPw = await request(app).get(`/api/s/${lockedToken}`);
    expect(needsPw.body.share.needsPassword).toBe(true);

    const wrong = await request(app).post(`/api/s/${lockedToken}/unlock`).send({ password: "nope" });
    expect(wrong.status).toBe(401);

    const unlock = await request(app).post(`/api/s/${lockedToken}/unlock`).send({ password: "secret1" });
    expect(unlock.status).toBe(200);
    const unlockCookie = unlock.headers["set-cookie"][0] as string;

    const lockedDl = await request(app).get(`/api/s/${lockedToken}/download`).set("Cookie", unlockCookie);
    expect(lockedDl.status).toBe(200);

    await request(app)
      .delete(`/api/documents/share-links/${openLink.body.shareLink.id}`)
      .set("Cookie", a.cookie);
    const revoked = await request(app).get(`/api/s/${openToken}`);
    expect(revoked.status).toBe(404);
  });

  it("invite accept grants membership with correct role", async () => {
    const owner = await createTestUser(`owner-${Date.now()}@example.com`, "Owner");
    const inviteeEmail = `invitee-${Date.now()}@example.com`;

    const workspaceId = await createWorkspace(owner.cookie, "Team");

    const invite = await request(app)
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set("Cookie", owner.cookie)
      .send({ email: inviteeEmail, role: "admin" });
    expect(invite.status).toBe(201);
    const token = invite.body.invitation.token as string;

    const invitee = await createTestUser(inviteeEmail, "Invitee", "member");
    const accept = await request(app)
      .post(`/api/invites/${token}/accept`)
      .set("Cookie", invitee.cookie);
    expect(accept.status).toBe(200);
    expect(accept.body.workspaceId).toBe(workspaceId);

    const members = await request(app)
      .get(`/api/workspaces/${workspaceId}/members`)
      .set("Cookie", owner.cookie);
    expect(members.status).toBe(200);
    const found = members.body.members.find(
      (m: { user: { email: string } }) => m.user.email === inviteeEmail,
    );
    expect(found?.role).toBe("admin");
  });

  it("admin can create a user and public register is always blocked", async () => {
    const admin = await createTestUser(`admin-create-${Date.now()}@example.com`, "Admin");
    const email = `created-${Date.now()}@example.com`;
    const created = await request(app)
      .post("/api/users")
      .set("Cookie", admin.cookie)
      .send({
        firstName: "New",
        lastName: "Person",
        email,
        password: "password123",
        platformRole: "member",
      });
    expect(created.status).toBe(201);
    expect(created.body.user.email).toBe(email);
    expect(created.body.user.name).toBe("New Person");
    expect(created.body.user.platformRole).toBe("member");
    testUserIds.add(created.body.user.id as string);

    const blocked = await request(app)
      .post("/api/auth/register")
      .send({ email: `blocked-${Date.now()}@example.com`, password: "password123", name: "Nope" });
    expect(blocked.status).toBe(403);
  });
});

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { requireDocumentAccess, requireMembership, canAccessTrashedDocument } from "../services/access";
import { listEntityAuditTrails } from "../services/audit";

export const auditRouter = Router();
auditRouter.use(requireAuth);

auditRouter.get("/documents/:id", async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) {
      // May have been permanently deleted — still allow reading trails if user can access workspace history via membership of any share? Keep simple: require previous access via soft-deleted check or live access.
      throw new HttpError(404, "Document not found");
    }
    if (doc.deletedAt) {
      const ok = await canAccessTrashedDocument(doc, req.user!.id);
      if (!ok) throw new HttpError(403, "You cannot view this audit trail");
    } else {
      await requireDocumentAccess(doc.id, req.user!.id);
    }
    const result = await listEntityAuditTrails("document", doc.id, req.query as Record<string, unknown>);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

auditRouter.get("/folders/:id", async (req, res, next) => {
  try {
    const folder = await prisma.folder.findUnique({ where: { id: req.params.id } });
    if (!folder) {
      throw new HttpError(404, "Folder not found");
    }
    await requireMembership(folder.workspaceId, req.user!.id);
    const result = await listEntityAuditTrails("folder", folder.id, req.query as Record<string, unknown>);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

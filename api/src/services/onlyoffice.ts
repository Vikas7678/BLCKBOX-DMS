import jwt from "jsonwebtoken";
import { config } from "../config";

const WORD = new Set([
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "odt",
  "ott",
  "rtf",
  "txt",
  "html",
  "htm",
  "md",
]);
const CELL = new Set(["xls", "xlsx", "xlsm", "xlsb", "xlt", "xltx", "ods", "csv"]);
const SLIDE = new Set(["ppt", "pptx", "pptm", "pps", "ppsx", "odp"]);
const PDF = new Set(["pdf"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

export function fileExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i < 0 || i === filename.length - 1) return "";
  return filename.slice(i + 1).toLowerCase();
}

export function getOnlyOfficeDocumentType(
  filename: string,
): "word" | "cell" | "slide" | "pdf" | null {
  const ext = fileExtension(filename);
  if (WORD.has(ext)) return "word";
  if (CELL.has(ext)) return "cell";
  if (SLIDE.has(ext)) return "slide";
  if (PDF.has(ext)) return "pdf";
  return null;
}

export function isImageFile(filename: string): boolean {
  return IMAGE.has(fileExtension(filename));
}

export function canPreviewFile(filename: string): boolean {
  return isImageFile(filename) || getOnlyOfficeDocumentType(filename) !== null;
}

export function signOnlyOfficeConfig(configPayload: Record<string, unknown>): string {
  return jwt.sign(
    {
      ...configPayload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 5,
    },
    config.onlyOfficeJwtSecret,
  );
}

export function createContentAccessToken(documentId: string, userId: string): string {
  return jwt.sign(
    { purpose: "onlyoffice-content", documentId, userId },
    config.jwtSecret,
    { expiresIn: "1h" },
  );
}

export function createShareContentAccessToken(documentId: string, shareToken: string): string {
  return jwt.sign(
    { purpose: "share-content", documentId, shareToken },
    config.jwtSecret,
    { expiresIn: "1h" },
  );
}

export function verifyContentAccessToken(token: string): {
  documentId: string;
  userId?: string;
  shareToken?: string;
} {
  const payload = jwt.verify(token, config.jwtSecret) as {
    purpose?: string;
    documentId?: string;
    userId?: string;
    shareToken?: string;
  };
  if (
    (payload.purpose !== "onlyoffice-content" && payload.purpose !== "share-content") ||
    !payload.documentId
  ) {
    throw new Error("Invalid content token");
  }
  if (payload.purpose === "onlyoffice-content" && !payload.userId) {
    throw new Error("Invalid content token");
  }
  if (payload.purpose === "share-content" && !payload.shareToken) {
    throw new Error("Invalid content token");
  }
  return {
    documentId: payload.documentId,
    userId: payload.userId,
    shareToken: payload.shareToken,
  };
}

export function buildContentUrl(documentId: string, contentToken: string): string {
  const base = config.publicApiUrl.replace(/\/$/, "");
  return `${base}/documents/${documentId}/content?token=${encodeURIComponent(contentToken)}`;
}

/** Same content endpoint, but reachable from the browser (not Docker-only host). */
export function buildBrowserContentUrl(documentId: string, contentToken: string): string {
  const base = config.browserApiUrl.replace(/\/$/, "");
  return `${base}/documents/${documentId}/content?token=${encodeURIComponent(contentToken)}`;
}

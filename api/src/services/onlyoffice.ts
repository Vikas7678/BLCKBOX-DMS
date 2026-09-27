/**
 * OnlyOffice / image preview helpers.
 * Routes should use buildOnlyOfficePreviewPayload + content-token helpers;
 * type/ext helpers stay file-private.
 */
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError } from "../middleware/error";

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

function fileExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i < 0 || i === filename.length - 1) return "";
  return filename.slice(i + 1).toLowerCase();
}

function getOnlyOfficeDocumentType(
  filename: string,
): "word" | "cell" | "slide" | "pdf" | null {
  const ext = fileExtension(filename);
  if (WORD.has(ext)) return "word";
  if (CELL.has(ext)) return "cell";
  if (SLIDE.has(ext)) return "slide";
  if (PDF.has(ext)) return "pdf";
  return null;
}

function isImageFile(filename: string): boolean {
  return IMAGE.has(fileExtension(filename));
}

function canPreviewFile(filename: string, mimeType?: string): boolean {
  if (isImageFile(filename) || (mimeType?.startsWith("image/") ?? false)) {
    return true;
  }
  return getOnlyOfficeDocumentType(filename) !== null;
}

function signOnlyOfficeConfig(configPayload: Record<string, unknown>): string {
  return jwt.sign(
    {
      ...configPayload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 5,
    },
    config.onlyOfficeJwtSecret,
  );
}

function buildContentUrl(documentId: string, contentToken: string): string {
  const base = config.publicApiUrl.replace(/\/$/, "");
  return `${base}/documents/${documentId}/content?token=${encodeURIComponent(contentToken)}`;
}

/** Same content endpoint, but reachable from the browser (not Docker-only host). */
function buildBrowserContentUrl(documentId: string, contentToken: string): string {
  const base = config.browserApiUrl.replace(/\/$/, "");
  return `${base}/documents/${documentId}/content?token=${encodeURIComponent(contentToken)}`;
}

export type PreviewDoc = {
  id: string;
  filename: string;
  title: string;
  mimeType: string;
  updatedAt: Date;
};

export type OnlyOfficePreviewPayload =
  | {
      mode: "image";
      documentServerUrl: string;
      title: string;
      url: string;
      mimeType: string;
    }
  | {
      mode: "onlyoffice";
      documentServerUrl: string;
      config: Record<string, unknown>;
    };

/** Build image or OnlyOffice viewer payload; throws HttpError(400) if type unsupported. */
export function buildOnlyOfficePreviewPayload(
  doc: PreviewDoc,
  opts: {
    contentToken: string;
    documentKey: string;
    viewer: { id: string; name: string };
  },
): OnlyOfficePreviewPayload {
  const image = isImageFile(doc.filename) || doc.mimeType.startsWith("image/");
  const documentType = getOnlyOfficeDocumentType(doc.filename);

  if (!canPreviewFile(doc.filename, doc.mimeType) || (!image && !documentType)) {
    throw new HttpError(400, "Preview is not available for this file type");
  }

  if (image) {
    return {
      mode: "image",
      documentServerUrl: config.onlyOfficeUrl,
      title: doc.title || doc.filename,
      url: buildBrowserContentUrl(doc.id, opts.contentToken),
      mimeType: doc.mimeType,
    };
  }

  const contentUrl = buildContentUrl(doc.id, opts.contentToken);
  const ext = fileExtension(doc.filename);
  const editorConfig = {
    document: {
      fileType: ext,
      key: opts.documentKey,
      title: doc.title || doc.filename,
      url: contentUrl,
      permissions: {
        print: false,
        download: false,
        edit: false,
        comment: false,
      },
    },
    editorConfig: {
      mode: "view" as const,
      user: opts.viewer,
      customization: {
        compactHeader: true,
        compactToolbar: true,
        chat: false,
        help: false,
        plugins: false,
        zoom: 100,
      },
    },
    documentType,
  };

  const token = signOnlyOfficeConfig(editorConfig);
  return {
    mode: "onlyoffice",
    documentServerUrl: config.onlyOfficeUrl,
    config: { ...editorConfig, token },
  };
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

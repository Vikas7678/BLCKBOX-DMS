import { escapeHtml } from "../lib/html";

function formatExpiry(iso: Date | string): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function layout(opts: {
  title: string;
  intro: string;
  documentName: string;
  message?: string;
  expiresAt: Date | string;
  ctaLabel: string;
  ctaUrl: string;
  password?: string;
}): { subject: string; html: string; text: string } {
  const expires = formatExpiry(opts.expiresAt);
  const messageBlock = opts.message?.trim()
    ? `<p style="margin:12px 0;padding:12px;background:#f3f4f6;border-radius:6px;color:#374151;">${escapeHtml(opts.message.trim())}</p>`
    : "";
  const messageText = opts.message?.trim() ? `\nMessage:\n${opts.message.trim()}\n` : "";
  const passwordHtml = opts.password
    ? `<p style="margin:12px 0;"><strong>Password:</strong> ${escapeHtml(opts.password)}</p>`
    : "";
  const passwordText = opts.password ? `Password: ${opts.password}\n` : "";

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(opts.title)}</h1>
    <p style="margin:0 0 12px;">${escapeHtml(opts.intro)}</p>
    <p style="margin:0 0 8px;"><strong>Document:</strong> ${escapeHtml(opts.documentName)}</p>
    ${messageBlock}
    <p style="margin:0 0 8px;"><strong>Expires on:</strong> ${escapeHtml(expires)}</p>
    ${passwordHtml}
    <p style="margin:24px 0;">
      <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#14b8a6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">${escapeHtml(opts.ctaLabel)}</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">Or open this link:<br/>${escapeHtml(opts.ctaUrl)}</p>
  </div>
</body></html>`;

  const text = `${opts.title}

${opts.intro}

Document: ${opts.documentName}
${messageText}Expires on: ${expires}
${passwordText}
${opts.ctaLabel}: ${opts.ctaUrl}
`;

  return { subject: opts.title, html, text };
}

export function buildInternalShareEmail(opts: {
  sharerName: string;
  documentName: string;
  expiresAt: Date;
  url: string;
  message?: string;
}) {
  return layout({
    title: `${opts.sharerName} shared a document with you`,
    intro: `${opts.sharerName} has shared a document with you on BLCKBOX. You can view it while signed in (delete is not allowed).`,
    documentName: opts.documentName,
    message: opts.message,
    expiresAt: opts.expiresAt,
    ctaLabel: "View document",
    ctaUrl: opts.url,
  });
}

export function buildExternalShareEmail(opts: {
  sharerName: string;
  documentName: string;
  expiresAt: Date;
  url: string;
  message?: string;
  password?: string;
}) {
  return layout({
    title: `${opts.sharerName} shared a document with you`,
    intro: `${opts.sharerName} has shared a document with you on BLCKBOX. No account is required.`,
    documentName: opts.documentName,
    message: opts.message,
    expiresAt: opts.expiresAt,
    ctaLabel: "View shared document",
    ctaUrl: opts.url,
    password: opts.password,
  });
}

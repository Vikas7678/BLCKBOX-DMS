function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roleLabel(role: string): string {
  if (role === "admin") return "Admin";
  if (role === "owner") return "Owner";
  return "Member";
}

/** Welcome email when an admin creates a platform user. */
export function buildUserCreatedEmail(opts: {
  firstName: string;
  lastName?: string;
  email: string;
  password: string;
  platformRole: string;
  loginUrl: string;
  createdByName: string;
}): { subject: string; html: string; text: string } {
  const fullName = [opts.firstName.trim(), opts.lastName?.trim()].filter(Boolean).join(" ");
  const role = roleLabel(opts.platformRole);
  const subject = "Your BLCKBOX account has been created";
  const intro = `${opts.createdByName} has created a BLCKBOX account for you. Use the credentials below to sign in.`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 12px;">Hello ${escapeHtml(opts.firstName.trim())},</p>
    <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
    <p style="margin:0 0 8px;"><strong>Name:</strong> ${escapeHtml(fullName)}</p>
    <p style="margin:0 0 8px;"><strong>Email:</strong> ${escapeHtml(opts.email)}</p>
    <p style="margin:0 0 8px;"><strong>Password:</strong> ${escapeHtml(opts.password)}</p>
    <p style="margin:0 0 8px;"><strong>Role:</strong> ${escapeHtml(role)}</p>
    <p style="margin:24px 0;">
      <a href="${escapeHtml(opts.loginUrl)}" style="display:inline-block;background:#14b8a6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Sign in to BLCKBOX</a>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">Or open this link:<br/>${escapeHtml(opts.loginUrl)}</p>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">For security, change your password after signing in if your organization requires it.</p>
  </div>
</body></html>`;

  const text = `${subject}

Hello ${opts.firstName.trim()},

${intro}

Name: ${fullName}
Email: ${opts.email}
Password: ${opts.password}
Role: ${role}

Sign in: ${opts.loginUrl}
`;

  return { subject, html, text };
}

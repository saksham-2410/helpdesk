import "server-only";
import { Resend } from "resend";
import { env, features } from "@/lib/env";

/**
 * Team invite email — deliberately minimal and self-contained rather than
 * routed through the conversation-threading send path Feature 3 builds
 * (lib/email/send.ts). An invite is a one-off transactional email, not a
 * reply in a thread; it has no Message-ID chain to participate in.
 *
 * Callers must not treat a thrown error here as fatal to the invite flow —
 * the invite row is the source of truth, and its link works whether or not
 * the email actually lands. See settings/actions.ts, which creates the
 * invite first and only best-effort attempts to email it.
 */
export async function sendInviteEmail(args: {
  to: string;
  workspaceName: string;
  inviterEmail: string;
  inviteUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!features.email) return { sent: false, error: "Email is not configured." };

  const resend = new Resend(env.resendApiKey);

  const { error } = await resend.emails.send({
    from: `${args.workspaceName} <${env.supportEmail}>`,
    to: args.to,
    subject: `You've been invited to ${args.workspaceName}`,
    text: [
      `${args.inviterEmail} invited you to join ${args.workspaceName} on Helpdesk.`,
      "",
      `Accept the invite: ${args.inviteUrl}`,
      "",
      "This link expires in 7 days.",
    ].join("\n"),
    html: `
      <p>${escapeHtml(args.inviterEmail)} invited you to join <strong>${escapeHtml(args.workspaceName)}</strong> on Helpdesk.</p>
      <p><a href="${args.inviteUrl}">Accept the invite</a></p>
      <p style="color:#736c60;font-size:13px;">This link expires in 7 days.</p>
    `,
  });

  if (error) return { sent: false, error: error.message };
  return { sent: true };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

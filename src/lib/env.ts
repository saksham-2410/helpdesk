import "server-only";

/**
 * Server-only environment access.
 *
 * Two rules this module enforces:
 *
 * 1. Validation is lazy. Reading a missing variable throws at call time with a
 *    message naming the variable — not at import time, which would break
 *    `next build` on a machine that legitimately has no secrets.
 *
 * 2. Optional integrations degrade instead of crashing. The Vercel domain API
 *    and Gemini are both optional: without them the app still runs, it just
 *    shows DNS instructions and a stale-summary notice respectively. That is
 *    the "graceful degradation" the brief asks for, expressed as a type.
 *
 * The `server-only` import above is the real guard: importing this from a
 * client component is a build error, so a service-role key cannot be leaked
 * into a browser bundle by accident.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const env = {
  get appUrl(): string {
    // Vercel injects VERCEL_PROJECT_PRODUCTION_URL; prefer the explicit value
    // so preview deploys can point at a stable origin when needed.
    const explicit = optional("NEXT_PUBLIC_APP_URL");
    if (explicit) return explicit.replace(/\/$/, "");
    const vercel = optional("VERCEL_PROJECT_PRODUCTION_URL");
    if (vercel) return `https://${vercel}`;
    return "http://localhost:3000";
  },

  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get supabaseJwtSecret() {
    return required("SUPABASE_JWT_SECRET");
  },

  get resendApiKey() {
    return required("RESEND_API_KEY");
  },
  get resendWebhookSecret() {
    return optional("RESEND_WEBHOOK_SECRET");
  },
  get emailDomain() {
    return required("EMAIL_DOMAIN");
  },
  get supportEmail() {
    return optional("SUPPORT_EMAIL") ?? `support@${required("EMAIL_DOMAIN")}`;
  },

  get geminiApiKey() {
    return optional("GEMINI_API_KEY");
  },
  get geminiModel() {
    return optional("GEMINI_MODEL") ?? "gemini-3.6-flash";
  },

  get vercelToken() {
    return optional("VERCEL_TOKEN");
  },
  get vercelProjectId() {
    return optional("VERCEL_PROJECT_ID");
  },
  get vercelTeamId() {
    return optional("VERCEL_TEAM_ID");
  },
} as const;

/** Feature availability, so callers branch on capability rather than on keys. */
export const features = {
  get ai() {
    return Boolean(optional("GEMINI_API_KEY"));
  },
  get email() {
    return Boolean(optional("RESEND_API_KEY") && optional("EMAIL_DOMAIN"));
  },
  /** Without a Vercel token, domains are recorded and instructions shown, but
   *  never provisioned. The UI says so rather than silently failing. */
  get customDomains() {
    return Boolean(optional("VERCEL_TOKEN") && optional("VERCEL_PROJECT_ID"));
  },
} as const;

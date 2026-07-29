"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import {
  addProjectDomain,
  verifyProjectDomain,
  removeProjectDomain,
  genericVerificationInstructions,
  isCustomDomainsEnabled,
  resolveDomainStatus,
  VercelApiError,
} from "@/lib/vercel/domains";

export interface ActionState {
  error?: string;
}

/**
 * RLS (`domains_admin_write`, via is_workspace_admin()) is the real
 * boundary — the role check here just gives a friendlier error than a
 * silent zero-row update.
 */
async function requireAdmin() {
  const workspace = await requireWorkspace();
  if (workspace.role !== "admin") throw new Error("FORBIDDEN");
  return workspace;
}

const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
    "Enter a valid domain, e.g. help.yourdomain.com",
  );

export async function addDomain(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = DomainSchema.safeParse(formData.get("domain"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const domain = parsed.data;

  let workspace;
  try {
    workspace = await requireAdmin();
  } catch {
    return { error: "Only an admin can connect a domain." };
  }

  const supabase = await createServerSupabase();

  let status: "pending" | "verifying" | "active" = "pending";
  let verification = genericVerificationInstructions(domain);
  let lastError: string | null = null;

  if (isCustomDomainsEnabled()) {
    try {
      const ownership = await addProjectDomain(domain);
      const resolved = await resolveDomainStatus(domain, ownership);
      status = resolved.status;
      verification = resolved.verification.length > 0 ? resolved.verification : verification;
    } catch (err) {
      // Still record the domain — pending with generic instructions beats
      // losing the attempt entirely because Vercel's API hiccupped.
      lastError = err instanceof VercelApiError ? err.message : "Could not reach Vercel.";
    }
  }

  const { error } = await supabase.from("workspace_domains").insert({
    workspace_id: workspace.id,
    domain,
    status,
    verification,
    last_error: lastError,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "That domain is already connected somewhere." : error.message,
    };
  }

  revalidatePath("/settings");
  return {};
}

export async function verifyDomain(domainId: string): Promise<ActionState> {
  await requireAdmin().catch(() => {
    throw new Error("FORBIDDEN");
  });
  const supabase = await createServerSupabase();

  const { data: row } = await supabase
    .from("workspace_domains")
    .select("id, domain")
    .eq("id", domainId)
    .maybeSingle();
  if (!row) return { error: "Domain not found." };

  if (!isCustomDomainsEnabled()) {
    return { error: "Automatic verification needs a Vercel API token — check the DNS records manually for now." };
  }

  try {
    const ownership = await verifyProjectDomain(row.domain);
    const resolved = await resolveDomainStatus(row.domain, ownership);
    await supabase
      .from("workspace_domains")
      .update({
        status: resolved.status,
        verification: resolved.verification,
        verified_at: resolved.status === "active" ? new Date().toISOString() : null,
        last_error: null,
      })
      .eq("id", domainId);
  } catch (err) {
    const message = err instanceof VercelApiError ? err.message : "Verification check failed.";
    await supabase
      .from("workspace_domains")
      .update({ status: "failed", last_error: message })
      .eq("id", domainId);
    return { error: message };
  }

  revalidatePath("/settings");
  return {};
}

export async function removeDomain(domainId: string): Promise<ActionState> {
  await requireAdmin().catch(() => {
    throw new Error("FORBIDDEN");
  });
  const supabase = await createServerSupabase();

  const { data: row } = await supabase
    .from("workspace_domains")
    .select("id, domain")
    .eq("id", domainId)
    .maybeSingle();

  if (row && isCustomDomainsEnabled()) {
    // Best-effort: Vercel already not having the domain (e.g. it was removed
    // there manually) must not block removing our own record of it.
    await removeProjectDomain(row.domain).catch(() => {});
  }

  const { error } = await supabase.from("workspace_domains").delete().eq("id", domainId);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}

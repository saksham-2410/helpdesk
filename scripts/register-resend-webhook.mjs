#!/usr/bin/env node
/**
 * One-off: register the inbound webhook with Resend and print the signing
 * secret to paste into RESEND_WEBHOOK_SECRET (locally and on Vercel).
 *
 * Not run automatically by anything — registering a webhook is a standing
 * change against your Resend account, so this is meant to be reviewed and
 * run by hand, once, after the app is deployed (the endpoint has to exist
 * before Resend can be pointed at it).
 *
 * Usage:
 *   node scripts/register-resend-webhook.mjs https://your-deployed-domain.vercel.app
 */
import { Resend } from "resend";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnvConfig(projectRoot);

const appUrl = process.argv[2];
if (!appUrl) {
  console.error("Usage: node scripts/register-resend-webhook.mjs <deployed-app-url>");
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.error("RESEND_API_KEY is not set in .env.local");
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);
const endpoint = `${appUrl.replace(/\/$/, "")}/api/webhooks/resend`;

const { data, error } = await resend.webhooks.create({
  endpoint,
  events: ["email.received"],
});

if (error) {
  console.error("Failed to create webhook:", error.message);
  process.exit(1);
}

console.log(`Webhook created: ${data.id}`);
console.log(`Endpoint:        ${endpoint}`);
console.log("");
console.log("Add this to .env.local AND to your Vercel project's environment variables,");
console.log("then redeploy (env changes only take effect on a fresh deploy):");
console.log("");
console.log(`RESEND_WEBHOOK_SECRET=${data.signing_secret}`);

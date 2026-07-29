#!/usr/bin/env node
/**
 * Builds the embeddable chat widget: src/widget/index.ts -> public/widget.js
 *
 * A single dependency-free IIFE, minified, no React/framework runtime — the
 * whole point of "install with one script tag on any website." Runs as a
 * `predev`/`prebuild` step so both local dev and the Vercel build produce a
 * fresh bundle automatically; the output is gitignored rather than committed,
 * same reasoning as any other build artifact.
 *
 * `@next/env` loads .env.local the same way `next dev`/`next build` do (this
 * runs as a bare Node script via a pre-lifecycle hook, before Next's own env
 * bootstrapping kicks in, so without this step process.env would be empty
 * locally even though `next dev` immediately afterward would see the file
 * just fine).
 */
import { build } from "esbuild";
// @next/env is CJS without a named-export shim under Node's ESM loader.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadEnvConfig(projectRoot);

function resolveAppUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return "http://localhost:3000";
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "\n[build-widget] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "The widget bundle embeds these at build time — without them widget.js\n" +
      "would ship broken. Copy .env.example to .env.local and fill them in.\n",
  );
  process.exit(1);
}

const appUrl = resolveAppUrl();

await build({
  entryPoints: [path.join(projectRoot, "src/widget/index.ts")],
  outfile: path.join(projectRoot, "public/widget.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  // Downlevels optional chaining / nullish coalescing for older browsers a
  // customer's own site visitors might still be on, while keeping native
  // async/await rather than generator-based transpilation.
  target: ["es2018"],
  minify: true,
  legalComments: "none",
  define: {
    __HD_API_BASE__: JSON.stringify(appUrl),
    __HD_SUPABASE_URL__: JSON.stringify(supabaseUrl),
    __HD_SUPABASE_ANON_KEY__: JSON.stringify(supabaseAnonKey),
  },
});

console.log(`[build-widget] public/widget.js built for ${appUrl}`);

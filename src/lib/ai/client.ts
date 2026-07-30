import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { env, features } from "@/lib/env";
import type { ConversationSummary } from "./types";
import {
  buildSummaryPrompt,
  buildDraftPrompt,
  SUMMARY_SYSTEM_INSTRUCTION,
  DRAFT_SYSTEM_INSTRUCTION,
  type SummarizeInput,
  type DraftReplyInput,
} from "./prompts";
import { summarizeConversationFallback, draftReplyFallback } from "./fallback";

/**
 * The only file that imports @google/genai. Swapping the *primary* provider
 * is a one-file change here; the *fallback* provider lives in fallback.ts —
 * see the circuit breaker below for how the two connect.
 *
 * @google/genai 2.13.0's actual surface is the plain `ai.models.generateContent
 * ({ model, contents, config })` shape below — earlier planning notes
 * speculated about an `interactions.create` streaming API that does not
 * match what this installed version exports; verified directly against
 * node_modules/@google/genai/dist/genai.d.ts before writing this.
 */

// Measured directly against the live API with this model + JSON schema +
// system instruction: 14-25s is normal, not an outlier — a 10s budget was
// aborting almost every real call. 25s leaves headroom under a 30s function
// timeout while still giving the fallback path a chance to fire for
// genuinely stuck requests.
const TIMEOUT_MS = 25_000;

/**
 * Soft, in-memory circuit breaker on Gemini specifically — same posture and
 * same limitation as lib/rate-limit.ts (doesn't coordinate across
 * instances/regions, resets on process restart; acceptable at this scale).
 *
 * Gemini's free tier is quota-limited per day (empirically: real requests
 * against this project's key started returning 429 RESOURCE_EXHAUSTED after
 * ~20 calls in a day), so once it starts failing, every subsequent call in
 * that window is guaranteed to fail identically. After a few consecutive
 * failures, stop spending a 25s timeout finding that out again on every
 * request and go straight to the fallback provider for a cooldown window,
 * then let one call through to test recovery.
 */
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function geminiCircuitOpen(): boolean {
  return consecutiveFailures >= CIRCUIT_THRESHOLD && Date.now() < circuitOpenUntil;
}
function recordGeminiFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
}
function recordGeminiSuccess() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

const SUMMARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    what_user_wants: { type: Type.STRING },
    whats_been_tried: { type: Type.STRING },
    current_status: { type: Type.STRING },
    sentiment: { type: Type.STRING, enum: ["positive", "neutral", "negative", "frustrated"] },
    suggested_next_step: { type: Type.STRING },
  },
  required: [
    "what_user_wants",
    "whats_been_tried",
    "current_status",
    "sentiment",
    "suggested_next_step",
  ],
  propertyOrdering: [
    "what_user_wants",
    "whats_been_tried",
    "current_status",
    "sentiment",
    "suggested_next_step",
  ],
};

const DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    draft_reply: { type: Type.STRING },
  },
  required: ["draft_reply"],
};

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

async function callGeminiSummary(input: SummarizeInput): Promise<ConversationSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await getClient().models.generateContent({
      model: env.geminiModel,
      contents: buildSummaryPrompt(input),
      config: {
        abortSignal: controller.signal,
        systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: SUMMARY_SCHEMA,
        temperature: 0.2,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini.");

    // Streaming would make this parse impossible mid-flight (partial JSON
    // isn't valid JSON) for no real benefit — summaries are a few hundred
    // tokens, so the whole response arrives fast enough that a spinner beats
    // the complexity of an incremental parser here. Parsed once, at the end.
    const parsed = JSON.parse(text) as ConversationSummary;
    if (!parsed.what_user_wants || !parsed.sentiment) {
      throw new Error("Malformed summary shape from Gemini.");
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiDraft(input: DraftReplyInput): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await getClient().models.generateContent({
      model: env.geminiModel,
      contents: buildDraftPrompt(input),
      config: {
        abortSignal: controller.signal,
        systemInstruction: DRAFT_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: DRAFT_SCHEMA,
        temperature: 0.4,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini.");

    const parsed = JSON.parse(text) as { draft_reply: string };
    if (!parsed.draft_reply) throw new Error("Malformed draft response from Gemini.");
    return parsed.draft_reply;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Throws only if BOTH Gemini and the fallback provider fail (or no fallback
 * is configured) — lib/ai/summarize.ts is the layer that catches that and
 * decides what an agent sees (stale cache, or nothing).
 *
 * Returns which model actually produced the result so callers that persist
 * it (the summary cache) can record the truth instead of always crediting
 * Gemini.
 */
export async function summarizeConversation(
  input: SummarizeInput,
): Promise<{ summary: ConversationSummary; model: string }> {
  if (!geminiCircuitOpen()) {
    try {
      const summary = await callGeminiSummary(input);
      recordGeminiSuccess();
      return { summary, model: env.geminiModel };
    } catch (err) {
      recordGeminiFailure();
      if (!features.aiFallback) throw err;
      console.error("[ai] Gemini summarize failed, trying fallback provider", err);
    }
  } else if (!features.aiFallback) {
    // Breaker open and nothing to fall back to — one real attempt is more
    // useful to the caller than a synthetic "circuit open" error, since a
    // stale cache is the caller's actual fallback either way.
    return { summary: await callGeminiSummary(input), model: env.geminiModel };
  }

  const summary = await summarizeConversationFallback(input);
  return { summary, model: `openrouter:${env.openrouterModel}` };
}

/** Never auto-sends — this only ever returns text for the caller to drop
 *  into the composer for the agent to review and edit. Same Gemini-first,
 *  fallback-on-failure behavior as summarizeConversation(). */
export async function draftReply(input: DraftReplyInput): Promise<string> {
  if (!geminiCircuitOpen()) {
    try {
      const draft = await callGeminiDraft(input);
      recordGeminiSuccess();
      return draft;
    } catch (err) {
      recordGeminiFailure();
      if (!features.aiFallback) throw err;
      console.error("[ai] Gemini draftReply failed, trying fallback provider", err);
    }
  } else if (!features.aiFallback) {
    return callGeminiDraft(input);
  }

  return draftReplyFallback(input);
}

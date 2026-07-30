import "server-only";
import { env } from "@/lib/env";
import type { ConversationSummary } from "./types";
import {
  SUMMARY_SYSTEM_INSTRUCTION,
  DRAFT_SYSTEM_INSTRUCTION,
  buildSummaryPrompt,
  buildDraftPrompt,
  type SummarizeInput,
  type DraftReplyInput,
} from "./prompts";
import { extractJson } from "./fallback-core";

/**
 * Cross-provider fallback for when Gemini itself is unavailable — not just
 * this one model, which lib/ai/client.ts's circuit breaker already handles
 * by backing off. OpenRouter is one API key in front of many vendors,
 * including several genuinely free-tier models, so an outage or quota
 * exhaustion specific to Google's models doesn't take AI summaries and
 * drafts down with it.
 *
 * This is the only file that talks to OpenRouter — a plain fetch against
 * its OpenAI-compatible REST endpoint rather than pulling in a second SDK
 * for one call shape.
 */

const TIMEOUT_MS = 15_000;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function callOpenRouter(systemInstruction: string, userPrompt: string): Promise<string> {
  if (!env.openrouterApiKey) {
    throw new Error("OPENROUTER_API_KEY not configured — no fallback available.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.openrouterApiKey}`,
        "Content-Type": "application/json",
        // OpenRouter uses these to attribute free-tier traffic; harmless to
        // omit, but present so this app's usage doesn't look anonymous.
        "HTTP-Referer": env.appUrl,
        "X-Title": "Helpdesk",
      },
      body: JSON.stringify({
        model: env.openrouterModel,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty response from OpenRouter.");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function summarizeConversationFallback(
  input: SummarizeInput,
): Promise<ConversationSummary> {
  const text = await callOpenRouter(SUMMARY_SYSTEM_INSTRUCTION, buildSummaryPrompt(input));
  const parsed = extractJson<ConversationSummary>(text);
  if (!parsed.what_user_wants || !parsed.sentiment) {
    throw new Error("Malformed summary shape from OpenRouter.");
  }
  return parsed;
}

export async function draftReplyFallback(input: DraftReplyInput): Promise<string> {
  const text = await callOpenRouter(DRAFT_SYSTEM_INSTRUCTION, buildDraftPrompt(input));
  const parsed = extractJson<{ draft_reply: string }>(text);
  if (!parsed.draft_reply) throw new Error("Malformed draft response from OpenRouter.");
  return parsed.draft_reply;
}

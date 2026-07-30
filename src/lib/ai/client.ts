import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { env } from "@/lib/env";
import type { ConversationSummary } from "./types";

/**
 * The only file in the app that imports @google/genai. Swapping providers
 * later is a one-file change — nothing else here even knows the vendor name.
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
// timeout while still giving the fallback path (stale cache / error) a
// chance to fire for genuinely stuck requests.
const TIMEOUT_MS = 25_000;

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

const SYSTEM_INSTRUCTION = `You summarize customer support conversations for a support agent who is
about to pick one up. Be concrete and specific — quote the customer's actual
words where it helps, never pad with generic filler. If a rolling summary of
everything before the new messages is provided, treat it as ground truth and
UPDATE it with what the new messages add or change; do not re-derive it from
scratch or drop details it already established. Respond with the sentiment of
the CUSTOMER (not the agent) as expressed in the most recent messages.`;

interface SummarizeInput {
  previousSummary: ConversationSummary | null;
  /** Only the messages the previous summary has not already seen — the
   *  incremental part of "incremental summarization". */
  newMessages: { authorType: string; bodyText: string }[];
  contactName: string | null;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return client;
}

function buildPrompt({ previousSummary, newMessages, contactName }: SummarizeInput): string {
  const parts: string[] = [];

  parts.push(`Customer: ${contactName ?? "unknown"}`);

  if (previousSummary) {
    parts.push(
      "Existing summary (covers everything before the new messages below):",
      JSON.stringify(previousSummary, null, 2),
    );
  }

  parts.push(
    previousSummary ? "New messages since that summary:" : "Conversation so far:",
    newMessages
      .map((m) => `[${m.authorType}] ${m.bodyText}`)
      .join("\n"),
  );

  return parts.join("\n\n");
}

/**
 * Throws on any failure — timeout, API error, or a response that doesn't
 * parse as the expected shape. lib/ai/summarize.ts is the layer that catches
 * this and decides what an agent sees (stale cache, or nothing).
 */
export async function summarizeConversation(
  input: SummarizeInput,
): Promise<ConversationSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await getClient().models.generateContent({
      model: env.geminiModel,
      contents: buildPrompt(input),
      config: {
        abortSignal: controller.signal,
        systemInstruction: SYSTEM_INSTRUCTION,
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

const DRAFT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    draft_reply: { type: Type.STRING },
  },
  required: ["draft_reply"],
};

const DRAFT_SYSTEM_INSTRUCTION = `You draft reply messages for a customer support agent — write as the
agent, first person, addressing the customer directly. Base the reply ONLY
on the conversation so far and the help-article excerpts provided; never
invent a policy, price, timeline, or fact that isn't in either. If nothing
provided actually answers the customer's question, write a brief reply
acknowledging what they asked and saying you're looking into it rather than
guessing. This text is inserted directly into the agent's reply box, so:
plain text only (no markdown, no subject line), and skip a greeting or
sign-off unless the conversation's own tone clearly calls for one — the
agent may still want to edit it before sending.`;

interface DraftReplyInput {
  messages: { authorType: string; bodyText: string }[];
  contactName: string | null;
  articles: { title: string; content: string }[];
}

function buildDraftPrompt({ messages, contactName, articles }: DraftReplyInput): string {
  const parts: string[] = [];
  parts.push(`Customer: ${contactName ?? "unknown"}`);
  parts.push(
    "Conversation so far:",
    messages.map((m) => `[${m.authorType}] ${m.bodyText}`).join("\n"),
  );
  if (articles.length > 0) {
    parts.push(
      "Relevant help articles (use only if actually relevant):",
      articles.map((a) => `- ${a.title}${a.content ? `: ${a.content}` : ""}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** Throws on any failure — the caller decides what the agent sees; this
 *  never auto-sends, it only ever fills the composer for the agent to
 *  review and edit. */
export async function draftReply(input: DraftReplyInput): Promise<string> {
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

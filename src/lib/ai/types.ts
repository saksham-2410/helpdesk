export type Sentiment = "positive" | "neutral" | "negative" | "frustrated";

export interface ConversationSummary {
  what_user_wants: string;
  whats_been_tried: string;
  current_status: string;
  sentiment: Sentiment;
  suggested_next_step: string;
}

export interface SummaryResult {
  summary: ConversationSummary;
  generatedAt: string;
  /** True when Gemini failed on this request and the value shown is the last
   *  good cache rather than a fresh generation — see lib/ai/summarize.ts. */
  stale: boolean;
}

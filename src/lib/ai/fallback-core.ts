/**
 * Pure parsing logic for the OpenRouter fallback path, with no `server-only`
 * or `env` dependency — kept separate from fallback.ts so it can be unit
 * tested directly under the plain Node test runner (server-only throws when
 * imported outside a Next.js build; see widget/token-core.ts for the same
 * split applied to the same problem).
 */

/**
 * Free-tier models are looser about "JSON only" than Gemini's schema-
 * constrained output — some still wrap the object in a ```json fence or
 * add a stray sentence despite the instruction. Tolerate both instead of
 * assuming a clean JSON.parse will always succeed.
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const braceMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonText = (braceMatch ? braceMatch[0] : candidate).trim();
  return JSON.parse(jsonText) as T;
}

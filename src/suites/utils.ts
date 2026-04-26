/**
 * Shared utilities for suite files.
 */

/**
 * Strips <think>…</think> blocks (case-insensitive, dotall) from a raw model
 * response and trims surrounding whitespace.
 */
export function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Extracts the first JSON object from a raw model response.
 * Handles markdown code fences and leading/trailing prose.
 * Returns the parsed value or null if parsing fails.
 */
export function extractJson(raw: string): unknown | null {
  const cleaned = stripThinking(raw);
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : cleaned;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(body.slice(first, last + 1));
  } catch {
    return null;
  }
}

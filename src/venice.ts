import { VENICE_API_KEY, VENICE_BASE_URL } from "./config.ts";
import type { CallResult } from "./types.ts";

export interface VeniceModel {
  id: string;
  type: string;
  model_spec?: {
    availableContextTokens?: number;
    capabilities?: {
      supportsFunctionCalling?: boolean;
      supportsReasoning?: boolean;
      supportsResponseSchema?: boolean;
      supportsVision?: boolean;
      supportsWebSearch?: boolean;
    };
    pricing?: {
      input?: { vcu?: number; usd?: number };
      output?: { vcu?: number; usd?: number };
    };
  };
}

async function authHeaders() {
  return {
    Authorization: `Bearer ${VENICE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function listModels(): Promise<VeniceModel[]> {
  const res = await fetch(`${VENICE_BASE_URL}/models?type=text`, {
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET /models ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { data: VeniceModel[] };
  return json.data ?? [];
}

export interface ChatCallInput {
  model: string;
  messages: { role: string; content: string }[];
  tools?: unknown[];
  toolChoice?: unknown;
  responseFormat?: unknown;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  stream?: boolean;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ res: Response; text: string; retries: number }> {
  const maxRetries = 8;
  let lastRes: Response | null = null;
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.status !== 429) {
        const text = res.ok ? "" : await res.text();
        return { res, text, retries: attempt };
      }
      lastRes = res;
      lastText = await res.text();
      if (attempt === maxRetries) break;
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const baseMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 15_000;
      const waitMs = Math.min(baseMs * 2 ** attempt, 120_000);
      process.stderr.write(
        `    ⏸  429 rate-limited, sleeping ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})\n`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } finally {
      clearTimeout(timer);
    }
  }
  return { res: lastRes!, text: lastText, retries: maxRetries };
}

export async function chatCall(input: ChatCallInput): Promise<CallResult> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
  };
  if (input.tools) body.tools = input.tools;
  if (input.toolChoice !== undefined) body.tool_choice = input.toolChoice;
  if (input.responseFormat) body.response_format = input.responseFormat;
  if (input.maxTokens) body.max_tokens = input.maxTokens;

  const started = performance.now();
  try {
    const { res, text: errText } = await fetchWithRetry(
      `${VENICE_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      },
      input.timeoutMs ?? 120_000,
    );
    const latencyMs = performance.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        promptTokens: 0,
        cachedTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        content: "",
        error: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
      };
    }
    const json = (await res.json()) as any;
    const choice = json.choices?.[0];
    const msg = choice?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((tc: any) => {
      let args: unknown = tc.function?.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          /* leave as string */
        }
      }
      return { name: tc.function?.name ?? "", args };
    });
    const usage = json.usage ?? {};
    const promptTokens =
      usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const cachedTokens =
      usage.prompt_tokens_details?.cached_tokens ??
      usage.cache_read_input_tokens ??
      0;
    const completionTokens =
      usage.completion_tokens ?? usage.output_tokens ?? 0;
    return {
      ok: true,
      latencyMs,
      promptTokens,
      cachedTokens,
      completionTokens,
      totalTokens: usage.total_tokens ?? promptTokens + completionTokens,
      content: msg.content ?? "",
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: choice?.finish_reason,
      raw: json,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: performance.now() - started,
      promptTokens: 0,
      cachedTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      content: "",
      error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
    };
  }
}

export async function streamTTFB(input: ChatCallInput): Promise<{
  ok: boolean;
  ttfbMs: number;
  totalMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  error?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? 120_000,
  );
  const body = {
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? 0.2,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: input.maxTokens ?? 128,
  };
  const started = performance.now();
  try {
    const res = await fetch(`${VENICE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      return {
        ok: false,
        ttfbMs: performance.now() - started,
        totalMs: performance.now() - started,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        error: `HTTP ${res.status}`,
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let ttfb = -1;
    let leftover = "";
    let usage: any = null;
    while (true) {
      const { done, value } = await reader.read();
      if (ttfb < 0 && value && value.length > 0) ttfb = performance.now() - started;
      if (done) break;
      const chunk = leftover + decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");
      leftover = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed?.usage) usage = parsed.usage;
        } catch {
          /* malformed chunk — skip */
        }
      }
    }
    const promptTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    const cachedTokens =
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.cache_read_input_tokens ??
      0;
    return {
      ok: true,
      ttfbMs: ttfb < 0 ? performance.now() - started : ttfb,
      totalMs: performance.now() - started,
      promptTokens,
      completionTokens,
      cachedTokens,
    };
  } catch (err: any) {
    return {
      ok: false,
      ttfbMs: performance.now() - started,
      totalMs: performance.now() - started,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

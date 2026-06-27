const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

function stripOpenRouterPrefix(model) {
  const value = String(model || "");
  return value.startsWith("openrouter/") ? value.slice("openrouter/".length) : value;
}

function selectedProviderKind(selected = {}) {
  if (selected.providerKind) return selected.providerKind;
  if (selected.kind === "cloud") return "cloud";
  if (String(selected.model || "").startsWith("openrouter/")) return "cloud";
  return "local";
}

async function postChatCompletion({ baseUrl, headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`chat_http_${response.status}: ${sanitizeProviderError(text).slice(0, 240)}`);
  }
  return response.json();
}

function sanitizeProviderError(text) {
  return String(text || "")
    .replace(/"user_id"\s*:\s*"[^"]*"/giu, '"user_id":"[redacted]"')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/gu, "sk-or-v1-[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]");
}

export async function callSelectedChat(selected, {
  messages,
  temperature = 0.2,
  maxTokens = 3072,
  timeoutMs = 120_000,
  keepAlive,
} = {}) {
  const providerKind = selectedProviderKind(selected);
  const model = String(selected?.modelApiName || selected?.model || "");
  if (!model) throw new Error("model_missing");

  if (providerKind === "cloud") {
    const candidates = [selected, ...(Array.isArray(selected?.cloudFallbacks) ? selected.cloudFallbacks : [])];
    const errors = [];
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("openrouter_api_key_missing");
    for (const candidate of candidates) {
      const candidateProvider = candidate?.provider || (String(candidate?.model || "").startsWith("openrouter/") ? "openrouter" : "");
      if (candidateProvider !== "openrouter") {
        errors.push(`${candidate?.model || "unknown"}:unsupported_cloud_provider_${candidateProvider || "unknown"}`);
        continue;
      }
      const candidateModel = String(candidate?.modelApiName || candidate?.model || "");
      try {
        const payload = await postChatCompletion({
          baseUrl: candidate?.baseUrl || DEFAULT_OPENROUTER_BASE_URL,
          timeoutMs,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://github.com/openclaw/openclaw",
            "X-Title": "OpenClaw cloud-free lane",
          },
          body: {
            model: stripOpenRouterPrefix(candidateModel),
            messages,
            temperature,
            max_tokens: maxTokens,
          },
        });
        return {
          ok: true,
          providerKind: "cloud",
          provider: candidateProvider,
          model: payload?.model ?? stripOpenRouterPrefix(candidateModel),
          requestedModel: candidate?.model || candidateModel,
          rotatedFrom: candidate === selected ? null : selected?.model,
          rotationErrors: errors,
          content: String(payload?.choices?.[0]?.message?.content ?? ""),
          promptTokens: payload?.usage?.prompt_tokens ?? 0,
          completionTokens: payload?.usage?.completion_tokens ?? 0,
        };
      } catch (error) {
        errors.push(`${candidate?.model || candidateModel}:${sanitizeProviderError(error?.message ?? error)}`);
      }
    }
    throw new Error(`cloud_free_rotation_exhausted: ${errors.join(" | ").slice(0, 1000)}`);
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    extra_body: { enable_thinking: true, ...(keepAlive ? { keep_alive: keepAlive } : {}) },
  };
  const payload = await postChatCompletion({
    baseUrl: selected?.baseUrl || DEFAULT_OLLAMA_BASE_URL,
    timeoutMs,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer ollama-local",
    },
    body,
  });
  return {
    ok: true,
    providerKind: "local",
    provider: "ollama",
    model: payload?.model ?? model,
    content: String(payload?.choices?.[0]?.message?.content ?? ""),
    promptTokens: payload?.usage?.prompt_tokens ?? 0,
    completionTokens: payload?.usage?.completion_tokens ?? 0,
  };
}

export { stripOpenRouterPrefix, selectedProviderKind, sanitizeProviderError };

import { execFileSync as _origExecFileSync } from "node:child_process";
/* zero-flash-exec-patched */ // 永久零閃窗（依 no-break-guardrails 零閃窗鐵則）
const execFileSync = (file, args, opts) => {
  if (args && !Array.isArray(args)) { opts = args; args = undefined; }
  return _origExecFileSync(file, args ?? [], { windowsHide: true, ...(opts ?? {}) });
};
import { randomUUID } from "node:crypto";
import { selectModel } from "../openclaw-model-orchestrator.mjs";

const DEFAULT_BASE_URLS = [
  "http://127.0.0.1:3100",
  "http://127.0.0.1:3030",
  "http://127.0.0.1:3000",
];
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_READY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_READY_POLL_MS = 5000;
const DEFAULT_DIRECT_AGENT_SERVER_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_DIRECT_AGENT_SERVER_POLL_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/g, "");
}

function candidateBaseUrls() {
  const configured = [process.env.OPENHANDS_BASE_URL, process.env.OPENHANDS_URL].filter(Boolean);
  return [...new Set([...configured, ...DEFAULT_BASE_URLS].map(normalizeBaseUrl))];
}

async function requestJson(
  baseUrl,
  path,
  { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, headers: extraHeaders = {} } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (process.env.OPENHANDS_API_KEY)
      headers.Authorization = `Bearer ${process.env.OPENHANDS_API_KEY}`;
    if (process.env.OPENHANDS_SESSION_API_KEY) {
      headers["X-Session-API-Key"] = process.env.OPENHANDS_SESSION_API_KEY;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function textContent(text) {
  return [{ type: "text", text }];
}

function extractV1StartTask(data) {
  const task = Array.isArray(data) ? data[0] : data;
  return {
    raw: task ?? null,
    taskId: task?.id ?? null,
    status: task?.status ?? null,
    conversationId: task?.app_conversation_id ?? null,
    // OpenHands 1.7：start task READY 時直接附 agent_server_url（最穩的 agent-server 來源）
    agentServerUrl: task?.agent_server_url ?? null,
    error: task?.error ?? task?.detail ?? null,
  };
}

function isTerminalStartStatus(status) {
  return ["READY", "ERROR"].includes(String(status ?? "").toUpperCase());
}

function isAgentActionEvent(event) {
  const kind = event?.kind ?? "";
  if (kind.includes("Action")) return true;
  if (event?.action || event?.tool_call_metadata || event?.command || event?.path) return true;
  return false;
}

function agentServerBaseUrl(conversationUrl, _conversationId) {
  // OpenHands 1.7 契約：conversation_url = {agent_server_url}/api/conversations/{id.hex}
  // id.hex 為「無連字號」UUID，舊版字串完全比對（帶連字號）永遠替換失敗 → 解析不到 base URL。
  // 改用 regex 剝尾段，同時相容帶連字號與 hex 兩種形式；剝不掉就回 null（誠實失敗，觸發後備）。
  if (!conversationUrl) return null;
  const stripped = conversationUrl.replace(/\/api\/conversations\/[0-9a-fA-F-]+\/?$/, "");
  if (stripped === conversationUrl || !stripped) return null;
  return stripped.replace("localhost", "127.0.0.1");
}

async function getV1ConversationAgentServer(runtime, conversationId, options = {}) {
  const metadata = await requestJson(
    runtime.baseUrl,
    `/api/v1/app-conversations?ids=${encodeURIComponent(conversationId)}`,
    { timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS },
  );
  const info = Array.isArray(metadata.data) ? metadata.data[0] : metadata.data;
  const baseUrl = agentServerBaseUrl(info?.conversation_url, conversationId);
  return {
    ok: metadata.ok && Boolean(baseUrl),
    metadata,
    baseUrl,
    sessionApiKey: info?.session_api_key ?? null,
    error:
      metadata.error ??
      metadata.data?.detail ??
      (!baseUrl ? "OpenHands conversation metadata missing agent server URL" : null),
  };
}

async function discoverReusableDirectAgentServer(runtime, options = {}) {
  if (process.env.OPENHANDS_AGENT_SERVER_URL) {
    return {
      ok: true,
      baseUrl: normalizeBaseUrl(process.env.OPENHANDS_AGENT_SERVER_URL),
      sessionApiKey: process.env.OPENHANDS_SESSION_API_KEY ?? null,
    };
  }
  if (runtime?.api !== "v1") {
    return { ok: false, error: "OpenHands direct agent server discovery requires V1 app API" };
  }
  const result = await requestJson(runtime.baseUrl, "/api/v1/app-conversations/search", {
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  const candidates = items
    .filter((item) => item?.conversation_url && item?.session_api_key)
    .filter((item) => String(item.sandbox_status ?? "").toUpperCase() === "RUNNING");
  const reusable =
    candidates.find((item) => String(item.execution_status ?? "").toLowerCase() === "finished") ??
    candidates[0];
  const conversationId = reusable?.id ?? null;
  const baseUrl = agentServerBaseUrl(reusable?.conversation_url, conversationId);
  if (!result.ok || !baseUrl) {
    const docker = await discoverDockerDirectAgentServer(options);
    if (docker.ok) return docker;
  }
  return {
    ok: result.ok && Boolean(baseUrl),
    baseUrl,
    sessionApiKey: reusable?.session_api_key ?? null,
    sourceConversationId: conversationId,
    error:
      result.error ??
      result.data?.detail ??
      (!baseUrl ? "No reusable OpenHands direct agent server is available" : null),
  };
}

async function discoverDockerDirectAgentServer(options = {}) {
  if (process.env.OPENHANDS_DISCOVER_DOCKER_AGENT_SERVER === "0") {
    return { ok: false, error: "Docker agent-server discovery is disabled" };
  }
  let lines = [];
  try {
    const output = execFileSync(
      "docker",
      ["ps", "--filter", "name=oh-agent-server", "--format", "{{.Names}} {{.Ports}}"],
      { encoding: "utf8", timeout: 5000 },
    );
    lines = output.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    return { ok: false, error: error?.message ?? "Docker agent-server discovery failed" };
  }
  for (const line of lines) {
    const [name] = line.split(/\s+/, 1);
    const port = line.match(/0\.0\.0\.0:(\d+)->8000\/tcp/)?.[1];
    if (!name || !port) continue;
    const baseUrl = `http://127.0.0.1:${port}`;
    const probe = await requestJson(baseUrl, "/server_info", {
      timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    if (!probe.ok) continue;
    let sessionApiKey = null;
    try {
      const envJson = execFileSync(
        "docker",
        ["inspect", name, "--format", "{{json .Config.Env}}"],
        {
          encoding: "utf8",
          timeout: 5000,
        },
      );
      const env = JSON.parse(envJson);
      // 1.7 仍用 OH_SESSION_API_KEYS_0=<key>；放寬為任何 OH_SESSION_API_KEYS* 前綴（含 JSON 陣列形式）
      const entry = env.find((e) => e.startsWith("OH_SESSION_API_KEYS"));
      if (entry) {
        const value = entry.slice(entry.indexOf("=") + 1);
        try {
          const parsed = JSON.parse(value);
          sessionApiKey = Array.isArray(parsed) ? (parsed[0] ?? null) : value || null;
        } catch {
          sessionApiKey = value || null;
        }
      }
    } catch {}
    return {
      ok: Boolean(sessionApiKey),
      baseUrl,
      sessionApiKey,
      sourceContainer: name,
      error: sessionApiKey ? null : "OpenHands agent-server container has no session key",
    };
  }
  return { ok: false, error: "No reachable OpenHands agent-server container was found" };
}

function isTerminalConversationStatus(data) {
  const status = String(
    data?.execution_status ?? data?.runtime_status ?? data?.status ?? "",
  ).toLowerCase();
  return ["finished", "error", "stuck", "waiting_for_confirmation", "stopped"].some((terminal) =>
    status.includes(terminal),
  );
}

function summarizeV1Events(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const stateEvents = items
    .filter(
      (event) => (event.kind ?? event.value?.kind ?? event.key) === "ConversationStateUpdateEvent",
    )
    .map((event) => event.value ?? event);
  const errorEvent = items.find(
    (event) => (event.kind ?? event.value?.kind ?? event.key) === "ConversationErrorEvent",
  );
  const error = errorEvent?.value ?? errorEvent;
  const statusEvent = stateEvents.findLast((event) => typeof event === "string");
  return {
    status: error ? "error" : (statusEvent ?? null),
    error: error?.detail ?? error?.error ?? null,
    events: items,
  };
}

async function probeBaseUrl(baseUrl) {
  const probes = [
    { api: "v1", path: "/api/v1/app-conversations/count" },
    { api: "v0", path: "/api/conversations" },
    { api: "root", path: "/" },
  ];
  const checkedApis = [];
  for (const probe of probes) {
    checkedApis.push(probe.api);
    const result = await requestJson(baseUrl, probe.path);
    const isOpenHandsRoot =
      probe.api === "root" &&
      result.ok &&
      typeof result.data?.raw === "string" &&
      result.data.raw.includes("<title>OpenHands</title>");
    const isJsonApiResponse =
      result.data !== null && typeof result.data === "object" && !result.data.raw;
    const apiProbeMatched =
      probe.api !== "root" &&
      (result.ok || [401, 403, 405, 422].includes(result.status)) &&
      (probe.api === "v1" || isJsonApiResponse);
    if (apiProbeMatched || isOpenHandsRoot) {
      return { ok: true, baseUrl, api: probe.api, checkedApis, probe, status: result.status };
    }
  }
  return { ok: false, baseUrl, checkedApis };
}

export async function discoverOpenHands() {
  const attempts = [];
  for (const baseUrl of candidateBaseUrls()) {
    const result = await probeBaseUrl(baseUrl);
    attempts.push(result);
    if (result.ok) return { ...result, attempts };
  }
  return { ok: false, attempts };
}

export async function listConversations() {
  const runtime = await discoverOpenHands();
  if (!runtime.ok) return { ok: false, runtime };
  if (runtime.api === "v1") {
    const result = await requestJson(runtime.baseUrl, "/api/v1/app-conversations/search", {
      timeoutMs: Number(process.env.OPENHANDS_LIST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    });
    if (result.ok) return { ...result, runtime };
    const fallback = await requestJson(runtime.baseUrl, "/api/v1/app-conversations/count");
    return {
      ...fallback,
      data: fallback.ok ? { count: fallback.data?.count ?? fallback.data } : fallback.data,
      runtime,
      fallbackFrom: "/api/v1/app-conversations/search",
      fallbackReason: result.error ?? result.status ?? "search failed",
    };
  }
  const result = await requestJson(runtime.baseUrl, "/api/conversations");
  return { ...result, runtime };
}

export async function getSettings() {
  const runtime = await discoverOpenHands();
  if (!runtime.ok) return { ok: false, runtime };
  if (runtime.api !== "v1")
    return { ok: false, runtime, error: "OpenHands settings API requires V1" };
  const result = await requestJson(runtime.baseUrl, "/api/v1/settings");
  return { ...result, runtime };
}

export async function listProfiles() {
  const runtime = await discoverOpenHands();
  if (!runtime.ok) return { ok: false, runtime };
  if (runtime.api !== "v1")
    return { ok: false, runtime, error: "OpenHands profiles API requires V1" };
  const result = await requestJson(runtime.baseUrl, "/api/v1/settings/profiles");
  return { ...result, runtime };
}

export async function getConversation(conversationId) {
  const runtime = await discoverOpenHands();
  if (!runtime.ok) return { ok: false, runtime };
  if (runtime.api === "v1") {
    const result = await requestJson(
      runtime.baseUrl,
      `/api/v1/conversation/${encodeURIComponent(conversationId)}/events/search?limit=100`,
    );
    const summary = result.ok ? summarizeV1Events(result.data) : {};
    return {
      ...result,
      data: result.ok ? { ...summary, raw: result.data } : result.data,
      runtime,
      conversationId,
    };
  }
  const path = `/api/conversations/${encodeURIComponent(conversationId)}`;
  const result = await requestJson(runtime.baseUrl, path);
  return { ...result, runtime, conversationId };
}

export async function waitForStartTask(taskId, options = {}) {
  const runtime = options.runtime ?? (await discoverOpenHands());
  if (!runtime.ok) return { ok: false, runtime };
  if (runtime.api !== "v1") return { ok: true, runtime, taskId, skipped: true };
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_READY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const attempts = [];
  while (Date.now() <= deadline) {
    const result = await requestJson(
      runtime.baseUrl,
      `/api/v1/app-conversations/start-tasks?ids=${encodeURIComponent(taskId)}`,
      { timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    const task = extractV1StartTask(result.data);
    attempts.push({ ok: result.ok, status: result.status, task });
    if (!result.ok) {
      if (Date.now() + pollMs > deadline) return { ...result, runtime, taskId, attempts };
      await delay(pollMs);
      continue;
    }
    if (task.conversationId || isTerminalStartStatus(task.status)) {
      return {
        ok: task.status !== "ERROR" && Boolean(task.conversationId),
        runtime,
        taskId,
        status: task.status,
        conversationId: task.conversationId,
        // 1.7：READY 時帶回 agent_server_url，下游可直連 agent-server 不必再解析 conversation_url
        agentServerUrl: task.agentServerUrl ?? null,
        error: task.error,
        attempts,
      };
    }
    await delay(pollMs);
  }
  return {
    ok: false,
    runtime,
    taskId,
    error: "Timed out waiting for OpenHands start task",
    attempts,
  };
}

export async function startConversation(message, options = {}) {
  const runtime = await discoverOpenHands();
  if (!runtime.ok) return { ok: false, runtime, error: "OpenHands is not reachable" };
  const requestedTaskId = options.taskId ?? `openclaw-${randomUUID()}`;
  const selectedRepository =
    options.selectedRepository ?? process.env.OPENHANDS_SELECTED_REPOSITORY ?? null;
  const body =
    runtime.api === "v1"
      ? {
          initial_message: {
            role: "user",
            content: textContent(message),
            run: options.run ?? true,
          },
          ...(options.sandboxId || process.env.OPENHANDS_SANDBOX_ID
            ? { sandbox_id: options.sandboxId ?? process.env.OPENHANDS_SANDBOX_ID }
            : {}),
          ...(selectedRepository ? { selected_repository: selectedRepository } : {}),
          trigger: "openhands_api",
        }
      : {
          initial_user_msg: message,
          ...(selectedRepository ? { repository: selectedRepository } : {}),
        };
  const path = runtime.api === "v1" ? "/api/v1/app-conversations" : "/api/conversations";
  const result = await requestJson(runtime.baseUrl, path, {
    method: "POST",
    body,
    timeoutMs: 30000,
  });
  const v1Task = runtime.api === "v1" ? extractV1StartTask(result.data) : null;
  const conversationId =
    v1Task?.conversationId ??
    (runtime.api === "v1"
      ? null
      : (result.data?.conversation_id ??
        result.data?.id ??
        result.data?.result?.conversation_id ??
        null));
  const startTaskId = v1Task?.taskId ?? result.data?.task_id ?? null;
  const started = {
    ...result,
    runtime,
    taskId: requestedTaskId,
    startTaskId,
    startStatus: v1Task?.status ?? null,
    conversationId,
    conversationUrl: conversationId ? `${runtime.baseUrl}/conversations/${conversationId}` : null,
  };
  if (!result.ok || !options.waitForReady || conversationId || !startTaskId) return started;
  const ready = await waitForStartTask(startTaskId, {
    runtime,
    timeoutMs: options.readyTimeoutMs,
    pollMs: options.readyPollMs,
  });
  return {
    ...started,
    ready,
    conversationId: ready.conversationId ?? conversationId,
    conversationUrl: ready.conversationId
      ? `${runtime.baseUrl}/conversations/${ready.conversationId}`
      : started.conversationUrl,
    ok: result.ok && ready.ok,
  };
}

export async function sendMessageToConversation(conversationId, message, options = {}) {
  const runtime = options.runtime ?? (await discoverOpenHands());
  if (!runtime.ok) return { ok: false, runtime };
  const path =
    runtime.api === "v1"
      ? `/api/v1/app-conversations/${encodeURIComponent(conversationId)}/send-message`
      : `/api/conversations/${encodeURIComponent(conversationId)}/events`;
  const body =
    runtime.api === "v1"
      ? { role: "user", content: textContent(message), run: options.run ?? true }
      : { role: "user", content: textContent(message), run: options.run ?? true };
  const result = await requestJson(runtime.baseUrl, path, {
    method: "POST",
    body,
    timeoutMs: options.timeoutMs ?? 30000,
  });
  return { ...result, runtime, conversationId };
}

export async function inspectConversationActivity(conversationId, options = {}) {
  const runtime = options.runtime ?? (await discoverOpenHands());
  if (!runtime.ok || !conversationId) {
    return { ok: false, actionCount: 0, eventCount: 0, error: "OpenHands activity unavailable" };
  }
  if (runtime.api !== "v1") return { ok: true, actionCount: null, eventCount: null, skipped: true };
  const agentServer = await getV1ConversationAgentServer(runtime, conversationId, options);
  if (!agentServer.ok) {
    return {
      ok: false,
      actionCount: 0,
      eventCount: 0,
      error: agentServer.error,
    };
  }
  const events = await requestJson(
    agentServer.baseUrl,
    `/api/conversations/${encodeURIComponent(conversationId)}/events/search?limit=100`,
    {
      timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: agentServer.sessionApiKey ? { "X-Session-API-Key": agentServer.sessionApiKey } : {},
    },
  );
  const items = Array.isArray(events.data?.items) ? events.data.items : [];
  const actionCount = items.filter(isAgentActionEvent).length;
  return {
    ok: events.ok && actionCount > 0,
    actionCount,
    eventCount: items.length,
    agentServerUrl: agentServer.baseUrl,
    error:
      events.ok && actionCount === 0
        ? "OpenHands finished without terminal or file-editor actions"
        : (events.error ?? events.data?.detail ?? null),
  };
}

async function directAgentLlmConfig() {
  const selected = process.env.OPENHANDS_LLM_MODEL
    ? { ok: true, model: process.env.OPENHANDS_LLM_MODEL }
    : await selectModel({ consumer: "openhands", task: "code" });
  const model = selected.ok && selected.model
    ? selected.model.includes("/") ? selected.model : `ollama/${selected.model}`
    : null;
  if (!model) throw new Error(`openhands_model_unavailable:${selected.reason ?? "unknown"}`);
  return {
    model,
    api_key: process.env.OPENHANDS_LLM_API_KEY ?? "ollama-local",
    base_url: process.env.OPENHANDS_LLM_BASE_URL ?? "http://host.docker.internal:11434",
    temperature: Number(process.env.OPENHANDS_LLM_TEMPERATURE ?? 0),
    max_output_tokens: Number(process.env.OPENHANDS_LLM_MAX_OUTPUT_TOKENS ?? 1024),
    native_tool_calling: false,
    disable_vision: true,
    caching_prompt: false,
    reasoning_effort: "none",
    enable_encrypted_reasoning: false,
    usage_id: process.env.OPENHANDS_LLM_USAGE_ID ?? "openclaw-direct-agent",
  };
}

async function directAgentRequest(message, options = {}) {
  const toolUseMessage = [
    "You are an autonomous engineering agent with terminal and file-editor tools.",
    "You must use a tool before your final answer. Do not only describe the change.",
    "Work in /workspace/project unless the task explicitly says otherwise.",
    "If the task asks to edit a file, inspect it, modify it, then verify the required text exists.",
    "",
    message,
  ].join("\n");
  return {
    workspace: {
      working_dir: options.workingDir ?? process.env.OPENHANDS_WORKING_DIR ?? "/workspace/project",
      kind: "LocalWorkspace",
    },
    max_iterations: Math.max(1, Number(options.maxIterations ?? 8)),
    stuck_detection: true,
    confirmation_policy: { kind: "NeverConfirm" },
    initial_message: { role: "user", content: textContent(toolUseMessage), run: true },
    agent: {
      kind: "Agent",
      llm: await directAgentLlmConfig(),
      tools: [{ name: "terminal" }, { name: "file_editor" }, { name: "task_tracker" }],
      include_default_tools: ["FinishTool", "ThinkTool"],
      system_prompt_kwargs: { cli_mode: true },
    },
    tags: { source: "openclaw" },
  };
}

async function inspectDirectConversationActivity(
  baseUrl,
  conversationId,
  sessionApiKey,
  options = {},
) {
  const events = await requestJson(
    baseUrl,
    `/api/conversations/${encodeURIComponent(conversationId)}/events/search?limit=100`,
    {
      timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: sessionApiKey ? { "X-Session-API-Key": sessionApiKey } : {},
    },
  );
  const items = Array.isArray(events.data?.items) ? events.data.items : [];
  const actionCount = items.filter(isAgentActionEvent).length;
  return {
    ok: events.ok && actionCount > 0,
    actionCount,
    eventCount: items.length,
    agentServerUrl: baseUrl,
    error:
      events.ok && actionCount === 0
        ? "OpenHands direct agent finished without terminal or file-editor actions"
        : (events.error ?? events.data?.detail ?? null),
  };
}

async function waitForDirectConversationTerminal(
  baseUrl,
  conversationId,
  sessionApiKey,
  options = {},
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DIRECT_AGENT_SERVER_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_DIRECT_AGENT_SERVER_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  const attempts = [];
  while (Date.now() <= deadline) {
    const result = await requestJson(
      baseUrl,
      `/api/conversations/${encodeURIComponent(conversationId)}`,
      {
        timeoutMs: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: sessionApiKey ? { "X-Session-API-Key": sessionApiKey } : {},
      },
    );
    attempts.push({
      ok: result.ok,
      status: result.status,
      executionStatus:
        result.data?.execution_status ?? result.data?.runtime_status ?? result.data?.status ?? null,
    });
    if (!result.ok || isTerminalConversationStatus(result.data)) {
      return { ...result, conversationId, attempts };
    }
    await delay(pollMs);
  }
  return {
    ok: false,
    conversationId,
    error: "Timed out waiting for OpenHands direct agent terminal state",
    attempts,
  };
}

export async function runDirectAgentServerTask(message, options = {}) {
  const baseUrl = normalizeBaseUrl(
    options.agentServerUrl ?? process.env.OPENHANDS_AGENT_SERVER_URL ?? "",
  );
  if (!baseUrl) return { ok: false, error: "OpenHands direct agent server URL is unavailable" };
  const sessionApiKey = options.sessionApiKey ?? process.env.OPENHANDS_SESSION_API_KEY ?? null;
  const headers = sessionApiKey ? { "X-Session-API-Key": sessionApiKey } : {};
  const attempts = [];
  const maxDirectAttempts = Math.max(1, Number(options.directAttempts ?? 3));
  for (let attemptIndex = 1; attemptIndex <= maxDirectAttempts; attemptIndex++) {
    let body;
    try {
      body = await directAgentRequest(message, { ...options, directAttempt: attemptIndex });
    } catch (error) {
      const failed = {
        ok: false,
        mode: "direct-agent-server",
        directAttempt: attemptIndex,
        conversationId: null,
        conversationUrl: null,
        error: String(error?.message ?? error),
      };
      attempts.push(failed);
      return { ...failed, directAttempts: attempts };
    }
    const started = await requestJson(baseUrl, "/api/conversations", {
      method: "POST",
      body,
      timeoutMs: options.timeoutMs ?? 30000,
      headers,
    });
    const conversationId = started.data?.id ?? started.data?.conversation_id ?? null;
    if (!started.ok || !conversationId) {
      const failed = {
        ...started,
        mode: "direct-agent-server",
        directAttempt: attemptIndex,
        conversationId,
        conversationUrl: conversationId ? `${baseUrl}/api/conversations/${conversationId}` : null,
        error: started.error ?? started.data?.exception ?? started.data?.detail ?? null,
      };
      attempts.push(failed);
      if (attemptIndex === maxDirectAttempts) return { ...failed, directAttempts: attempts };
      continue;
    }
    const terminal = await waitForDirectConversationTerminal(
      baseUrl,
      conversationId,
      sessionApiKey,
      {
        timeoutMs: options.terminalTimeoutMs,
        pollMs: options.terminalPollMs,
      },
    );
    const activity = await inspectDirectConversationActivity(
      baseUrl,
      conversationId,
      sessionApiKey,
    );
    const result = {
      ...started,
      mode: "direct-agent-server",
      directAttempt: attemptIndex,
      conversationId,
      conversationUrl: `${baseUrl}/api/conversations/${conversationId}`,
      terminal,
      activity,
      ok: started.ok && terminal.ok && activity.ok,
    };
    attempts.push(result);
    if (activity.ok || attemptIndex === maxDirectAttempts) {
      return { ...result, directAttempts: attempts };
    }
  }
}

export async function waitForConversationTerminal(conversationId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
  const pollMs = options.pollMs ?? 30000;
  const deadline = Date.now() + timeoutMs;
  const attempts = [];
  while (Date.now() <= deadline) {
    const result = await getConversation(conversationId);
    attempts.push({
      ok: result.ok,
      status: result.status,
      executionStatus:
        result.data?.execution_status ?? result.data?.runtime_status ?? result.data?.status ?? null,
    });
    if (!result.ok || isTerminalConversationStatus(result.data)) {
      return { ...result, conversationId, attempts };
    }
    await delay(pollMs);
  }
  return {
    ok: false,
    conversationId,
    error: "Timed out waiting for OpenHands conversation terminal state",
    attempts,
  };
}

export async function runTask(message, options = {}) {
  const started = await startConversation(message, { ...options, waitForReady: true });
  if ((!started.ok || !started.conversationId) && options.directAgentServerFallback !== false) {
    const agentServer = await discoverReusableDirectAgentServer(started.runtime);
    const direct = await runDirectAgentServerTask(message, {
      agentServerUrl: agentServer.baseUrl,
      sessionApiKey: agentServer.sessionApiKey,
      terminalTimeoutMs: options.terminalTimeoutMs,
      terminalPollMs: options.terminalPollMs,
    });
    return {
      ...direct,
      runtime: started.runtime,
      appStart: started,
      fallbackFrom: "openhands-app-start-failed",
      ok: direct.ok === true,
    };
  }
  if (!started.ok || !started.conversationId || !options.waitForTerminal) return started;
  const terminal = await waitForConversationTerminal(started.conversationId, {
    timeoutMs: options.terminalTimeoutMs,
    pollMs: options.terminalPollMs,
  });
  const finished = String(terminal.data?.status ?? "").toLowerCase() === "finished";
  const activity =
    terminal.ok && finished
      ? await inspectConversationActivity(started.conversationId, { runtime: started.runtime })
      : null;
  const terminalTimedOut = String(terminal.error ?? "").includes(
    "Timed out waiting for OpenHands conversation terminal state",
  );
  if (
    options.directAgentServerFallback !== false &&
    started.runtime?.api === "v1" &&
    ((terminal.ok && finished && activity?.ok === false && activity.actionCount === 0) ||
      terminalTimedOut)
  ) {
    const agentServer = await getV1ConversationAgentServer(started.runtime, started.conversationId);
    const direct = await runDirectAgentServerTask(message, {
      agentServerUrl: agentServer.baseUrl,
      sessionApiKey: agentServer.sessionApiKey,
      terminalTimeoutMs: options.terminalTimeoutMs,
      terminalPollMs: options.terminalPollMs,
    });
    return {
      ...direct,
      runtime: started.runtime,
      appConversationId: started.conversationId,
      appConversationUrl: started.conversationUrl,
      appActivity: activity,
      appTerminal: terminal,
      fallbackFrom: "openhands-app-no-tool-actions",
      ok: direct.ok === true,
    };
  }
  return {
    ...started,
    terminal,
    activity,
    ok: started.ok && terminal.ok && activity?.ok !== false,
  };
}

function buildRepairPrompt(originalMessage, attempt) {
  return `Continue this OpenHands engineering task and fix the failure from the previous sandbox run.\n\nOriginal task:\n${originalMessage}\n\nPrevious run evidence:\n- conversation: ${attempt.conversationUrl ?? attempt.conversationId ?? "none"}\n- terminal status: ${attempt.terminalStatus ?? "unknown"}\n- error: ${attempt.error ?? "none"}\n\nInstructions:\n- Work inside the sandbox.\n- Inspect the current repository state before changing files.\n- Make the smallest safe code/test/doc changes needed.\n- Run the most relevant verification.\n- Finish with a concise summary of changed files and verification evidence.`;
}

function summarizeAutonomousAttempt(result, index) {
  const lastStartTask = result.ready?.attempts?.at(-1)?.task ?? null;
  return {
    index,
    ok: result.ok === true,
    startTaskId: result.startTaskId ?? null,
    startStatus: result.ready?.status ?? result.startStatus ?? null,
    conversationId: result.conversationId ?? null,
    conversationUrl: result.conversationUrl ?? null,
    terminalStatus:
      result.terminal?.data?.status ??
      result.terminal?.data?.execution_status ??
      result.terminal?.data?.runtime_status ??
      null,
    actionCount: result.activity?.actionCount ?? null,
    eventCount: result.activity?.eventCount ?? null,
    error:
      result.ready?.error ??
      lastStartTask?.error ??
      lastStartTask?.raw?.detail ??
      result.activity?.error ??
      result.terminal?.data?.error ??
      result.terminal?.error ??
      result.error ??
      result.data?.detail ??
      null,
  };
}

export async function runAutonomousEngineeringLoop(message, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 2));
  const attempts = [];
  let prompt = message;
  for (let index = 1; index <= maxAttempts; index++) {
    const result = await runTask(prompt, {
      waitForReady: true,
      waitForTerminal: true,
      readyTimeoutMs: options.readyTimeoutMs,
      readyPollMs: options.readyPollMs,
      terminalTimeoutMs: options.terminalTimeoutMs,
      terminalPollMs: options.terminalPollMs,
    });
    const attempt = summarizeAutonomousAttempt(result, index);
    attempts.push(attempt);
    if (attempt.ok && attempt.terminalStatus === "finished") {
      return {
        ok: true,
        status: "completed",
        attempts,
        finalConversationId: attempt.conversationId,
        finalConversationUrl: attempt.conversationUrl,
      };
    }
    prompt = buildRepairPrompt(message, attempt);
  }
  return {
    ok: false,
    status: "needs_review",
    attempts,
    finalConversationId: attempts.at(-1)?.conversationId ?? null,
    finalConversationUrl: attempts.at(-1)?.conversationUrl ?? null,
    error: attempts.at(-1)?.error ?? "OpenHands autonomous loop did not reach finished state",
  };
}

export async function runLiveSmoke(options = {}) {
  const prompt =
    options.prompt ??
    "Reply with exactly OPENHANDS-LIGHT-OK. Do not modify files or run commands unless required.";
  const result = await runTask(prompt, {
    waitForTerminal: options.waitForTerminal ?? false,
    readyTimeoutMs: options.readyTimeoutMs ?? 5 * 60 * 1000,
    readyPollMs: options.readyPollMs ?? DEFAULT_READY_POLL_MS,
    terminalTimeoutMs: options.terminalTimeoutMs,
    terminalPollMs: options.terminalPollMs,
  });
  return {
    ok: result.ok === true && Boolean(result.conversationId),
    expectedReply: "OPENHANDS-LIGHT-OK",
    result,
  };
}

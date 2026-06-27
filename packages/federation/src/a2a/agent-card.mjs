// agent-card.mjs — 標準 A2A AgentCard 建構與融合
// 對齊官方 Agent2Agent 規格：AgentCard 服務於 /.well-known/agent-card.json，供其他 agent 發現。
// 融合點：把本地大腦產的 capability-manifest.v1（openclaw-agent-card-generator 輸出）映射成標準 AgentCard，
// 讓既有能力編目直接接上 A2A 生態，零重做。

/** AgentCard 在標準裡的 well-known 路徑（RFC 8615） */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

/**
 * 建構符合 A2A 標準的 AgentCard。
 * 欄位依官方 schema：name/description/url/version/capabilities/authentication/defaultInput|OutputModes/skills。
 */
export function buildAgentCard({
  name,
  url,
  description = "",
  version = "0.1.0",
  provider,
  documentationUrl,
  capabilities = {},
  authentication = { schemes: ["None"] },
  defaultInputModes = ["text/plain"],
  defaultOutputModes = ["text/plain"],
  skills = [],
} = {}) {
  if (!name || !url) throw new Error("AgentCard 需要 name 與 url");
  return {
    name,
    description,
    url,
    version,
    ...(provider ? { provider } : {}),
    ...(documentationUrl ? { documentationUrl } : {}),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      ...capabilities,
    },
    authentication,
    defaultInputModes,
    defaultOutputModes,
    skills: skills.map(normalizeSkill),
  };
}

/** 正規化單一 skill（補必填、移除空選填） */
function normalizeSkill(s) {
  if (!s?.id) throw new Error("skill 需要 id");
  return {
    id: s.id,
    name: s.name ?? s.id,
    description: s.description ?? "",
    tags: s.tags ?? [],
    ...(s.examples?.length ? { examples: s.examples } : {}),
    ...(s.inputModes ? { inputModes: s.inputModes } : {}),
    ...(s.outputModes ? { outputModes: s.outputModes } : {}),
  };
}

/**
 * 融合：OpenClaw capability-manifest.v1 → 標準 A2A skill。
 * manifest 欄位：{ id, officialName, purpose, triggers[], handles[], riskLevel }
 */
export function manifestToSkill(m) {
  return {
    id: m.id,
    name: m.officialName ?? m.id,
    description: m.purpose ?? "",
    tags: [...(m.handles ?? []), ...(m.riskLevel ? [m.riskLevel] : [])],
    ...(m.triggers?.length ? { examples: m.triggers } : {}),
  };
}

/** 把一組能力 manifest 融合成單一 AgentCard（既有編目 → 標準名片） */
export function cardFromManifests({ name, url, manifests = [], ...rest }) {
  return buildAgentCard({ name, url, skills: manifests.map(manifestToSkill), ...rest });
}

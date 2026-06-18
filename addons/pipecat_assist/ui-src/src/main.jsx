import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Cloud,
  Copy,
  Cpu,
  GitBranch,
  Home,
  KeyRound,
  Mic2,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Server,
  Settings,
  SlidersHorizontal,
  Trash2,
  Volume2,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import "./styles.css";

const API = {
  config: "api/assist/config",
  status: "api/assist/status",
  mcp: "api/assist/mcp/check",
};

const REDACTED = "__redacted__";
const GEMINI_TEXT_MODEL = "gemini-3.5-flash";
const GEMINI_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";
const GEMINI_LIVE_VOICE = "Charon";

const providerKinds = [
  ["openai", "OpenAI", Cloud],
  ["gemini", "Gemini", Cloud],
  ["anthropic", "Anthropic", Cloud],
  ["aws_bedrock", "Bedrock", Cloud],
  ["azure_openai", "Azure OpenAI", Cloud],
  ["openai_compatible", "OpenAI-compatible", Server],
  ["ollama", "Ollama", Cpu],
  ["local_runtime", "Local runtime", Cpu],
  ["home_assistant_mcp", "Home Assistant MCP", Home],
];

const stepTypes = [
  ["transport", "Transport", Radio],
  ["vad", "Turn", Mic2],
  ["stt", "STT", Mic2],
  ["llm", "Model", Bot],
  ["tools", "Tools", Wrench],
  ["tts", "TTS", Volume2],
  ["output", "Output", Volume2],
];

const templates = [
  {
    id: "gemini_live_home",
    label: "Gemini Live",
    icon: Cloud,
    mode: "realtime",
    provider: "gemini",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Gemini VAD", ""],
      ["llm", "llm", "Live model", "gemini"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["output", "output", "Native audio", "gemini"],
    ],
  },
  {
    id: "realtime_home",
    label: "Realtime Home",
    icon: Radio,
    mode: "realtime",
    provider: "openai",
    accent: "green",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Semantic VAD", ""],
      ["llm", "llm", "Realtime model", "openai"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["output", "output", "Audio output", "openai"],
    ],
  },
  {
    id: "cloud_cascade",
    label: "Cloud Cascade",
    icon: Cloud,
    mode: "classic",
    provider: "gemini",
    accent: "blue",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["stt", "stt", "Cloud STT", "gemini"],
      ["llm", "llm", "Cloud LLM", "gemini"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["tts", "tts", "Cloud TTS", "gemini"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "local_first",
    label: "Local First",
    icon: Cpu,
    mode: "classic",
    provider: "ollama",
    accent: "amber",
    steps: [
      ["transport", "transport", "SmallWebRTC", ""],
      ["vad", "vad", "Local VAD", "local-runtime"],
      ["stt", "stt", "Local STT", "local-runtime"],
      ["llm", "llm", "Local LLM", "ollama"],
      ["tools", "tools", "HA MCP tools", "ha-mcp"],
      ["tts", "tts", "Local TTS", "local-runtime"],
      ["output", "output", "Audio output", ""],
    ],
  },
  {
    id: "custom",
    label: "Custom",
    icon: GitBranch,
    mode: "classic",
    provider: "openai-compatible",
    accent: "red",
    steps: [],
  },
];

const defaultFlow = {
  id: "home-default",
  name: "Gemini Live Home Assistant",
  enabled: true,
  mode: "realtime",
  pipeline_template: "gemini_live_home",
  provider_id: "gemini",
  model: GEMINI_LIVE_MODEL,
  text_model: GEMINI_TEXT_MODEL,
  voice: GEMINI_LIVE_VOICE,
  speed: 1,
  language: "",
  instructions:
    "You are a realtime Home Assistant voice agent. Speak naturally and briefly. Use Home Assistant MCP tools only when the user clearly asks to control, inspect, or automate the home. Never invent device state. If a room, device, or action is ambiguous, ask one short clarification.",
  greeting: "Greet the user briefly and wait for their request.",
  transcription_model: "gpt-realtime-whisper",
  noise_reduction: "near_field",
  vad_mode: "semantic_vad",
  vad_eagerness: "low",
  interrupt_response: false,
  max_output_tokens: "",
  reasoning_effort: "",
  mcp_enabled: true,
  mcp_tool_allowlist: [],
  video_enabled: false,
  steps: [],
};

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStep(kind, label, integrationId = "", suffix = "") {
  return {
    id: `${kind}-${suffix || crypto.randomUUID().slice(0, 8)}`,
    kind,
    label,
    enabled: true,
    integration_id: integrationId,
    model: kind === "llm" ? "" : "",
    voice: kind === "tts" || kind === "output" ? "" : "",
    settings: {},
  };
}

function providerDefaults(provider) {
  if (provider === "gemini") {
    return {
      model: GEMINI_LIVE_MODEL,
      text_model: GEMINI_TEXT_MODEL,
      voice: GEMINI_LIVE_VOICE,
    };
  }
  return {};
}

function stepsFromTemplate(template) {
  return template.steps.map(([id, kind, label, integrationId]) => ({
    ...makeStep(kind, label, integrationId, id),
    id,
  }));
}

function applyTemplate(flow, templateId) {
  const template = templates.find((item) => item.id === templateId) || templates[0];
  const defaults = providerDefaults(template.provider);
  const steps = template.id === "custom" && flow.steps?.length ? flow.steps : stepsFromTemplate(template);
  const llm = steps.find((step) => step.kind === "llm");
  const output = steps.find((step) => step.kind === "output" || step.kind === "tts");
  return {
    ...flow,
    mode: template.mode,
    pipeline_template: template.id,
    provider_id: llm?.integration_id || template.provider,
    model: llm?.model || defaults.model || flow.model || "",
    text_model: defaults.text_model || flow.text_model || "",
    voice: output?.voice || defaults.voice || flow.voice || "",
    steps,
  };
}

function ensureShape(config) {
  const shaped = clone(config);
  shaped.integrations ||= [];
  shaped.flows = (shaped.flows?.length ? shaped.flows : [clone(defaultFlow)]).map((flow) => {
    const merged = { ...clone(defaultFlow), ...flow };
    if (!merged.steps?.length) return applyTemplate(merged, merged.pipeline_template || "gemini_live_home");
    return merged;
  });
  shaped.selected_flow_id ||= shaped.flows[0].id;
  return shaped;
}

function syncFlow(flow) {
  const llm = flow.steps?.find((step) => step.kind === "llm" && step.enabled);
  const output = flow.steps?.find(
    (step) => (step.kind === "output" || step.kind === "tts") && step.enabled,
  );
  return {
    ...flow,
    provider_id: llm?.integration_id || flow.provider_id || "gemini",
    model: llm?.model || flow.model || "",
    voice: output?.voice || flow.voice || "",
    language: flow.language || null,
    max_output_tokens: flow.max_output_tokens ? Number(flow.max_output_tokens) : null,
    reasoning_effort: flow.reasoning_effort || null,
    mcp_tool_allowlist: Array.isArray(flow.mcp_tool_allowlist)
      ? flow.mcp_tool_allowlist
      : String(flow.mcp_tool_allowlist || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
  };
}

function kindLabel(kind) {
  return providerKinds.find(([id]) => id === kind)?.[1] || kind;
}

function secretValue(value) {
  return value === REDACTED ? "" : value || "";
}

function stepIcon(kind) {
  return stepTypes.find(([id]) => id === kind)?.[2] || Workflow;
}

function Button({ children, icon: Icon, variant = "primary", title, ...props }) {
  return (
    <button className={`button ${variant}`} title={title} {...props}>
      {Icon && <Icon size={16} strokeWidth={2} />}
      {children && <span>{children}</span>}
    </button>
  );
}

function Field({ label, children, wide = false }) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function App() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState("pipelines");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("gemini");
  const [message, setMessage] = useState({ text: "", tone: "" });
  const [fatalError, setFatalError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load().catch((err) => setFatalError(String(err)));
  }, []);

  const selectedFlow = useMemo(() => {
    if (!config) return null;
    return config.flows.find((flow) => flow.id === config.selected_flow_id) || config.flows[0];
  }, [config]);

  const selectedStep = useMemo(() => {
    if (!selectedFlow) return null;
    return (
      selectedFlow.steps.find((step) => step.id === selectedStepId) ||
      selectedFlow.steps.find((step) => step.kind === "llm") ||
      selectedFlow.steps[0]
    );
  }, [selectedFlow, selectedStepId]);

  const selectedIntegration = useMemo(() => {
    if (!config) return null;
    return (
      config.integrations.find((integration) => integration.id === selectedIntegrationId) ||
      config.integrations[0]
    );
  }, [config, selectedIntegrationId]);

  async function load() {
    setFatalError("");
    const [configResponse, statusResponse] = await Promise.all([fetch(API.config), fetch(API.status)]);
    if (!configResponse.ok) {
      throw new Error(`Config API failed: ${configResponse.status}`);
    }
    if (!statusResponse.ok) {
      throw new Error(`Status API failed: ${statusResponse.status}`);
    }
    const nextConfig = ensureShape(await configResponse.json());
    setConfig(nextConfig);
    setStatus(await statusResponse.json());
    const flow = nextConfig.flows.find((item) => item.id === nextConfig.selected_flow_id) || nextConfig.flows[0];
    setSelectedStepId(flow.steps.find((step) => step.kind === "llm")?.id || flow.steps[0]?.id || "");
  }

  function updateConfig(updater) {
    setConfig((current) => ensureShape(updater(clone(current))));
  }

  function updateFlow(flowId, updater) {
    updateConfig((draft) => {
      draft.flows = draft.flows.map((flow) => (flow.id === flowId ? syncFlow(updater(clone(flow))) : flow));
      return draft;
    });
  }

  function updateSelectedFlow(updater) {
    updateFlow(selectedFlow.id, updater);
  }

  function updateStep(stepId, updater) {
    updateSelectedFlow((flow) => {
      flow.steps = flow.steps.map((step) => (step.id === stepId ? updater(clone(step)) : step));
      return flow;
    });
  }

  function updateIntegration(integrationId, updater) {
    updateConfig((draft) => {
      draft.integrations = draft.integrations.map((item) =>
        item.id === integrationId ? updater(clone(item)) : item,
      );
      return draft;
    });
  }

  function selectFlow(flowId) {
    updateConfig((draft) => {
      draft.selected_flow_id = flowId;
      return draft;
    });
    const flow = config.flows.find((item) => item.id === flowId);
    setSelectedStepId(flow?.steps.find((step) => step.kind === "llm")?.id || flow?.steps[0]?.id || "");
  }

  function addFlow() {
    const baseName = "New pipeline";
    const id = slugify(`${baseName}-${config.flows.length + 1}`);
    const flow = applyTemplate(
      {
        ...clone(defaultFlow),
        id,
        name: baseName,
      },
      "gemini_live_home",
    );
    updateConfig((draft) => {
      draft.flows.push(flow);
      draft.selected_flow_id = id;
      return draft;
    });
    setSelectedStepId("llm");
  }

  function duplicateFlow() {
    const copy = clone(selectedFlow);
    copy.id = slugify(`${selectedFlow.id}-copy-${config.flows.length + 1}`);
    copy.name = `${selectedFlow.name} copy`;
    updateConfig((draft) => {
      draft.flows.push(copy);
      draft.selected_flow_id = copy.id;
      return draft;
    });
  }

  function deleteFlow() {
    if (config.flows.length <= 1) return;
    updateConfig((draft) => {
      draft.flows = draft.flows.filter((flow) => flow.id !== selectedFlow.id);
      draft.selected_flow_id = draft.flows[0].id;
      return draft;
    });
  }

  function addStep(kind = "llm") {
    const [, label] = stepTypes.find(([id]) => id === kind) || stepTypes[3];
    const step = makeStep(kind, label, kind === "tools" ? "ha-mcp" : selectedFlow.provider_id);
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      flow.steps.push(step);
      return flow;
    });
    setSelectedStepId(step.id);
  }

  function deleteStep(stepId) {
    if (selectedFlow.steps.length <= 1) return;
    updateSelectedFlow((flow) => {
      flow.pipeline_template = "custom";
      flow.steps = flow.steps.filter((step) => step.id !== stepId);
      return flow;
    });
    setSelectedStepId(selectedFlow.steps.find((step) => step.id !== stepId)?.id || "");
  }

  function addIntegration(kind = "openai_compatible") {
    const label = kindLabel(kind);
    const id = slugify(`${kind}-${config.integrations.length + 1}`);
    const integration = {
      id,
      name: label,
      kind,
      enabled: true,
      api_key: "",
      token: "",
      base_url: kind === "ollama" ? "http://localhost:11434/v1" : "",
      endpoint: "",
      region: "",
      deployment: "",
      default_model: kind === "gemini" ? GEMINI_TEXT_MODEL : "",
      default_realtime_model: kind === "gemini" ? GEMINI_LIVE_MODEL : "",
      default_voice: kind === "gemini" ? GEMINI_LIVE_VOICE : "",
      organization: "",
      project: "",
      access_key_id: "",
      secret_key: "",
    };
    updateConfig((draft) => {
      draft.integrations.push(integration);
      return draft;
    });
    setSelectedIntegrationId(id);
  }

  function deleteIntegration(integrationId) {
    if (["gemini", "openai", "ha-mcp"].includes(integrationId)) return;
    updateConfig((draft) => {
      draft.integrations = draft.integrations.filter((item) => item.id !== integrationId);
      draft.flows = draft.flows.map((flow) => ({
        ...flow,
        steps: flow.steps.map((step) =>
          step.integration_id === integrationId ? { ...step, integration_id: "" } : step,
        ),
      }));
      return draft;
    });
    setSelectedIntegrationId("gemini");
  }

  async function save() {
    setSaving(true);
    setMessage({ text: "Saving", tone: "" });
    const payload = {
      ...config,
      flows: config.flows.map(syncFlow),
    };
    const response = await fetch(API.config, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!response.ok) {
      setMessage({ text: await response.text(), tone: "error" });
      return;
    }
    const nextConfig = ensureShape(await response.json());
    setConfig(nextConfig);
    setMessage({ text: "Saved", tone: "ok" });
  }

  async function checkMcp() {
    setMessage({ text: "Checking MCP", tone: "" });
    const response = await fetch(API.mcp, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flow_id: selectedFlow.id }),
    });
    const result = await response.json();
    setMessage(
      result.ok
        ? { text: `MCP connected: ${result.tool_count} tools`, tone: "ok" }
        : { text: result.error || "MCP check failed", tone: "error" },
    );
  }

  async function copyOfferUrl() {
    await navigator.clipboard.writeText(config.runner_offer_url || "");
    setMessage({ text: "Copied", tone: "ok" });
  }

  if (!config || !selectedFlow) {
    return (
      <main className="loading">
        <img src="assets/logo.svg" alt="" />
        {fatalError ? (
          <>
            <strong>Interface did not load</strong>
            <span>{fatalError}</span>
            <Button icon={RefreshCw} variant="secondary" onClick={() => load().catch((err) => setFatalError(String(err)))}>
              Retry
            </Button>
          </>
        ) : (
          <span>Loading</span>
        )}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="nav">
        <div className="brand">
          <img src="assets/logo.svg" alt="" />
          <div>
            <h1>Pipecat Assist</h1>
            <span className={status?.ok ? "state ok" : "state"}>{status?.ok ? "ready" : "offline"}</span>
          </div>
        </div>

        <nav className="tabs" aria-label="Pipecat Assist">
          {[
            ["pipelines", "Pipelines", Workflow],
            ["integrations", "Integrations", SlidersHorizontal],
            ["runtime", "Runtime", Settings],
          ].map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="rail-head">
          <span>Pipelines</span>
          <Button icon={Plus} variant="ghost" title="Add pipeline" onClick={addFlow} />
        </div>
        <div className="flow-list">
          {config.flows.map((flow) => {
            const TemplateIcon =
              templates.find((item) => item.id === flow.pipeline_template)?.icon || Workflow;
            return (
              <button
                key={flow.id}
                className={flow.id === selectedFlow.id ? "flow-card active" : "flow-card"}
                onClick={() => {
                  setTab("pipelines");
                  selectFlow(flow.id);
                }}
              >
                <TemplateIcon size={18} />
                <span>
                  <strong>{flow.name}</strong>
                  <small>{flow.mode} / {flow.provider_id}</small>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h2>{tab === "pipelines" ? selectedFlow.name : tab === "integrations" ? "Integrations" : "Runtime"}</h2>
            <span>{selectedFlow.mode} pipeline</span>
          </div>
          <div className="actions">
            <Button icon={RefreshCw} variant="secondary" onClick={load} title="Reload" />
            <Button icon={Save} onClick={save} disabled={saving}>
              Save
            </Button>
          </div>
        </header>

        {tab === "pipelines" && (
          <PipelineView
            config={config}
            flow={selectedFlow}
            selectedStep={selectedStep}
            setSelectedStepId={setSelectedStepId}
            updateFlow={updateSelectedFlow}
            updateStep={updateStep}
            addStep={addStep}
            deleteStep={deleteStep}
            duplicateFlow={duplicateFlow}
            deleteFlow={deleteFlow}
          />
        )}

        {tab === "integrations" && (
          <IntegrationsView
            config={config}
            selectedIntegration={selectedIntegration}
            setSelectedIntegrationId={setSelectedIntegrationId}
            updateIntegration={updateIntegration}
            addIntegration={addIntegration}
            deleteIntegration={deleteIntegration}
          />
        )}

        {tab === "runtime" && (
          <RuntimeView
            config={config}
            flow={selectedFlow}
            status={status}
            checkMcp={checkMcp}
            copyOfferUrl={copyOfferUrl}
            updateConfig={updateConfig}
            updateIntegration={updateIntegration}
          />
        )}

        <div className={message.tone ? `message ${message.tone}` : "message"} role="status">
          {message.tone === "ok" && <CheckCircle2 size={16} />}
          {message.tone === "error" && <AlertCircle size={16} />}
          <span>{message.text}</span>
        </div>
      </main>
    </div>
  );
}

function PipelineView({
  config,
  flow,
  selectedStep,
  setSelectedStepId,
  updateFlow,
  updateStep,
  addStep,
  deleteStep,
  duplicateFlow,
  deleteFlow,
}) {
  return (
    <div className="workspace-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>Pipeline</h3>
            <span>{flow.steps.length} steps</span>
          </div>
          <div className="button-row">
            <Button icon={Copy} variant="secondary" onClick={duplicateFlow}>
              Duplicate
            </Button>
            <Button icon={Trash2} variant="danger" onClick={deleteFlow} disabled={config.flows.length <= 1}>
              Delete
            </Button>
          </div>
        </div>

        <div className="template-grid">
          {templates.map((template) => {
            const Icon = template.icon;
            return (
              <button
                key={template.id}
                className={
                  flow.pipeline_template === template.id
                    ? `template-card active ${template.accent}`
                    : `template-card ${template.accent}`
                }
                onClick={() => updateFlow((draft) => applyTemplate(draft, template.id))}
              >
                <Icon size={20} />
                <strong>{template.label}</strong>
              </button>
            );
          })}
        </div>

        <div className="pipeline-canvas">
          {flow.steps.map((step, index) => {
            const Icon = stepIcon(step.kind);
            return (
              <React.Fragment key={step.id}>
                <button
                  className={selectedStep?.id === step.id ? "node selected" : "node"}
                  onClick={() => setSelectedStepId(step.id)}
                >
                  <Icon size={19} />
                  <strong>{step.label}</strong>
                  <span>{step.integration_id || step.kind}</span>
                </button>
                {index < flow.steps.length - 1 && <div className="connector" />}
              </React.Fragment>
            );
          })}
          <button className="node add-node" onClick={() => addStep("llm")}>
            <Plus size={18} />
            <strong>Add</strong>
            <span>step</span>
          </button>
        </div>
      </section>

      <section className="panel inspector">
        <div className="panel-head">
          <div>
            <h3>Inspector</h3>
            <span>{selectedStep?.label || flow.name}</span>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Name">
            <input value={flow.name} onChange={(event) => updateFlow((draft) => ({ ...draft, name: event.target.value }))} />
          </Field>
          <Field label="ID">
            <input value={flow.id} readOnly />
          </Field>
          <Toggle checked={flow.enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, enabled: value }))} label="Enabled" />
          <Toggle checked={flow.video_enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, video_enabled: value }))} label="Video input" />
        </div>

        {selectedStep && (
          <>
            <div className="divider" />
            <div className="form-grid">
              <Field label="Step label">
                <input
                  value={selectedStep.label}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, label: event.target.value }))}
                />
              </Field>
              <Field label="Step type">
                <select
                  value={selectedStep.kind}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, kind: event.target.value }))}
                >
                  {stepTypes.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Integration">
                <select
                  value={selectedStep.integration_id || ""}
                  onChange={(event) =>
                    updateStep(selectedStep.id, (step) => ({ ...step, integration_id: event.target.value }))
                  }
                >
                  <option value="">None</option>
                  {config.integrations.map((integration) => (
                    <option key={integration.id} value={integration.id}>
                      {integration.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Model">
                <input
                  value={selectedStep.model || ""}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, model: event.target.value }))}
                />
              </Field>
              <Field label="Voice">
                <input
                  value={selectedStep.voice || ""}
                  onChange={(event) => updateStep(selectedStep.id, (step) => ({ ...step, voice: event.target.value }))}
                />
              </Field>
              <Toggle
                checked={selectedStep.enabled}
                onChange={(value) => updateStep(selectedStep.id, (step) => ({ ...step, enabled: value }))}
                label="Step enabled"
              />
              <Button
                icon={Trash2}
                variant="danger"
                onClick={() => deleteStep(selectedStep.id)}
                disabled={flow.steps.length <= 1}
              >
                Remove step
              </Button>
            </div>
          </>
        )}

        <div className="divider" />
        <div className="form-grid">
          <Field label="Text model">
            <input value={flow.text_model || ""} onChange={(event) => updateFlow((draft) => ({ ...draft, text_model: event.target.value }))} />
          </Field>
          <Field label="Language">
            <input value={flow.language || ""} onChange={(event) => updateFlow((draft) => ({ ...draft, language: event.target.value }))} />
          </Field>
          <Field label="Noise reduction">
            <select value={flow.noise_reduction} onChange={(event) => updateFlow((draft) => ({ ...draft, noise_reduction: event.target.value }))}>
              <option value="off">off</option>
              <option value="near_field">near field</option>
              <option value="far_field">far field</option>
            </select>
          </Field>
          <Field label="VAD">
            <select value={flow.vad_mode} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_mode: event.target.value }))}>
              <option value="semantic_vad">semantic</option>
              <option value="server_vad">server</option>
            </select>
          </Field>
          <Field label="VAD eagerness">
            <select value={flow.vad_eagerness} onChange={(event) => updateFlow((draft) => ({ ...draft, vad_eagerness: event.target.value }))}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="auto">auto</option>
            </select>
          </Field>
          <Field label="Speed">
            <input
              type="number"
              min="0.25"
              max="1.5"
              step="0.05"
              value={flow.speed}
              onChange={(event) => updateFlow((draft) => ({ ...draft, speed: Number(event.target.value || 1) }))}
            />
          </Field>
          <Toggle checked={flow.mcp_enabled} onChange={(value) => updateFlow((draft) => ({ ...draft, mcp_enabled: value }))} label="MCP tools" />
          <Toggle
            checked={flow.interrupt_response}
            onChange={(value) => updateFlow((draft) => ({ ...draft, interrupt_response: value }))}
            label="Interrupt response"
          />
          <Field label="MCP allowlist" wide>
            <input
              value={(flow.mcp_tool_allowlist || []).join(", ")}
              onChange={(event) =>
                updateFlow((draft) => ({
                  ...draft,
                  mcp_tool_allowlist: event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                }))
              }
            />
          </Field>
          <Field label="Instructions" wide>
            <textarea rows={8} value={flow.instructions} onChange={(event) => updateFlow((draft) => ({ ...draft, instructions: event.target.value }))} />
          </Field>
          <Field label="Greeting" wide>
            <input value={flow.greeting} onChange={(event) => updateFlow((draft) => ({ ...draft, greeting: event.target.value }))} />
          </Field>
        </div>
      </section>
    </div>
  );
}

function IntegrationsView({
  config,
  selectedIntegration,
  setSelectedIntegrationId,
  updateIntegration,
  addIntegration,
  deleteIntegration,
}) {
  return (
    <div className="workspace-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>Providers</h3>
            <span>{config.integrations.length} integrations</span>
          </div>
          <div className="button-row">
            <Button icon={Plus} variant="secondary" onClick={() => addIntegration("openai_compatible")}>
              Compatible
            </Button>
            <Button icon={Cpu} variant="secondary" onClick={() => addIntegration("ollama")}>
              Local
            </Button>
          </div>
        </div>

        <div className="integration-list">
          {config.integrations.map((integration) => {
            const Icon = providerKinds.find(([id]) => id === integration.kind)?.[2] || Cloud;
            return (
              <button
                key={integration.id}
                className={selectedIntegration?.id === integration.id ? "integration-card active" : "integration-card"}
                onClick={() => setSelectedIntegrationId(integration.id)}
              >
                <Icon size={20} />
                <span>
                  <strong>{integration.name}</strong>
                  <small>{kindLabel(integration.kind)}</small>
                </span>
                <span className={integration.enabled ? "dot on" : "dot"} />
              </button>
            );
          })}
        </div>
      </section>

      {selectedIntegration && (
        <section className="panel inspector">
          <div className="panel-head">
            <div>
              <h3>{selectedIntegration.name}</h3>
              <span>{kindLabel(selectedIntegration.kind)}</span>
            </div>
            <Button
              icon={Trash2}
              variant="danger"
              onClick={() => deleteIntegration(selectedIntegration.id)}
              disabled={["gemini", "openai", "ha-mcp"].includes(selectedIntegration.id)}
            />
          </div>

          <div className="form-grid">
            <Field label="Name">
              <input
                value={selectedIntegration.name}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, name: event.target.value }))}
              />
            </Field>
            <Field label="ID">
              <input
                value={selectedIntegration.id}
                readOnly
              />
            </Field>
            <Field label="Kind">
              <select
                value={selectedIntegration.kind}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, kind: event.target.value }))}
                disabled={selectedIntegration.id === "ha-mcp"}
              >
                {providerKinds.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Toggle
              checked={selectedIntegration.enabled}
              onChange={(value) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, enabled: value }))}
              label="Enabled"
            />
            <Field label="API key">
              <input
                type="password"
                value={secretValue(selectedIntegration.api_key)}
                placeholder={selectedIntegration.api_key_configured ? "configured" : ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, api_key: event.target.value }))}
              />
            </Field>
            <Field label="Token">
              <input
                type="password"
                value={secretValue(selectedIntegration.token)}
                placeholder={selectedIntegration.token_configured ? "configured" : ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, token: event.target.value }))}
              />
            </Field>
            <Field label="Base URL">
              <input
                value={selectedIntegration.base_url || ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, base_url: event.target.value }))}
              />
            </Field>
            <Field label="Endpoint">
              <input
                value={selectedIntegration.endpoint || ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, endpoint: event.target.value }))}
              />
            </Field>
            <Field label="Default model">
              <input
                value={selectedIntegration.default_model || ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, default_model: event.target.value }))}
              />
            </Field>
            <Field label="Realtime model">
              <input
                value={selectedIntegration.default_realtime_model || ""}
                onChange={(event) =>
                  updateIntegration(selectedIntegration.id, (item) => ({ ...item, default_realtime_model: event.target.value }))
                }
              />
            </Field>
            <Field label="Voice">
              <input
                value={selectedIntegration.default_voice || ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, default_voice: event.target.value }))}
              />
            </Field>
            <Field label="Region">
              <input
                value={selectedIntegration.region || ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, region: event.target.value }))}
              />
            </Field>
            <Field label="Deployment">
              <input
                value={selectedIntegration.deployment || ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, deployment: event.target.value }))}
              />
            </Field>
            <Field label="Access key">
              <input
                type="password"
                value={secretValue(selectedIntegration.access_key_id)}
                placeholder={selectedIntegration.access_key_id_configured ? "configured" : ""}
                onChange={(event) =>
                  updateIntegration(selectedIntegration.id, (item) => ({ ...item, access_key_id: event.target.value }))
                }
              />
            </Field>
            <Field label="Secret key">
              <input
                type="password"
                value={secretValue(selectedIntegration.secret_key)}
                placeholder={selectedIntegration.secret_key_configured ? "configured" : ""}
                onChange={(event) => updateIntegration(selectedIntegration.id, (item) => ({ ...item, secret_key: event.target.value }))}
              />
            </Field>
          </div>
        </section>
      )}
    </div>
  );
}

function offerPath(config) {
  if (config.runner_offer_path) return config.runner_offer_path;
  try {
    const url = new URL(config.runner_offer_url || "api/offer", window.location.href);
    const token = url.searchParams.get("token");
    return `api/offer${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  } catch {
    return "api/offer";
  }
}

function waitForIceGatheringComplete(peerConnection, timeoutMs = 2500) {
  if (peerConnection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peerConnection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (peerConnection.iceGatheringState === "complete") finish();
    };
    timer = setTimeout(finish, timeoutMs);
    peerConnection.addEventListener("icegatheringstatechange", onChange);
  });
}

function VoiceTest({ config, flow }) {
  const audioRef = useRef(null);
  const channelRef = useRef(null);
  const closingRef = useRef(false);
  const pingRef = useRef(null);
  const peerRef = useRef(null);
  const readySentRef = useRef(false);
  const streamRef = useRef(null);
  const trackReadyRef = useRef(false);
  const [state, setState] = useState("idle");
  const [detail, setDetail] = useState("Ready");

  useEffect(() => () => disposeSession(), []);

  function disposeSession() {
    closingRef.current = true;
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(
        JSON.stringify({
          label: "rtvi-ai",
          id: crypto.randomUUID().slice(0, 8),
          type: "disconnect-bot",
          data: {},
        }),
      );
    }
    channelRef.current?.close();
    channelRef.current = null;
    readySentRef.current = false;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackReadyRef.current = false;
    if (audioRef.current) audioRef.current.srcObject = null;
  }

  function clearSession(nextState = "idle", nextDetail = "Ready") {
    disposeSession();
    setState(nextState);
    setDetail(nextDetail);
    window.setTimeout(() => {
      closingRef.current = false;
    }, 0);
  }

  function stopVoiceTest(updateState = true) {
    clearSession(updateState ? "idle" : state, updateState ? "Stopped" : detail);
  }

  async function startVoiceTest() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setDetail("This browser cannot access a microphone from the current context.");
      return;
    }

    clearSession("requesting", "Waiting for microphone permission");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      streamRef.current = stream;

      const peerConnection = new RTCPeerConnection();
      peerRef.current = peerConnection;
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        peerConnection.addTransceiver(audioTrack, { direction: "sendrecv" });
      } else {
        peerConnection.addTransceiver("audio", { direction: "sendrecv" });
      }

      const channel = peerConnection.createDataChannel("signalling");
      channelRef.current = channel;
      const sendClientReady = () => {
        if (!trackReadyRef.current || readySentRef.current || channel.readyState !== "open") return;
        channel.send(
          JSON.stringify({
            label: "rtvi-ai",
            id: crypto.randomUUID().slice(0, 8),
            type: "client-ready",
            data: {
              version: "1.4.0",
              about: {
                library: "pipecat-assist-ui",
                library_version: "0.1.4",
                platform: "browser",
              },
            },
          }),
        );
        readySentRef.current = true;
      };
      channel.onopen = () => {
        pingRef.current = window.setInterval(() => {
          if (channel.readyState === "open") channel.send(`ping ${Date.now()}`);
        }, 1000);
        sendClientReady();
      };

      peerConnection.ontrack = (event) => {
        if (event.track.kind !== "audio") return;
        if (!audioRef.current) return;
        audioRef.current.srcObject = event.streams[0] || new MediaStream([event.track]);
        audioRef.current.play().catch(() => {});
        trackReadyRef.current = true;
        sendClientReady();
      };

      peerConnection.onconnectionstatechange = () => {
        const next = peerConnection.connectionState;
        if (next === "connected") {
          setState("connected");
          setDetail("Connected. Speak to the selected assistant.");
        }
        if (["failed", "disconnected", "closed"].includes(next) && !closingRef.current) {
          clearSession(next === "failed" ? "error" : "idle", `WebRTC ${next}`);
        }
      };

      setState("connecting");
      setDetail("Creating WebRTC offer");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const response = await fetch(offerPath(config), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: peerConnection.localDescription.sdp,
          type: peerConnection.localDescription.type,
          request_data: {
            flow_id: flow.id,
            source: "ui_voice_test",
          },
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const answer = await response.json();
      await peerConnection.setRemoteDescription({
        sdp: answer.sdp,
        type: answer.type,
      });
      setDetail("Connecting audio");
    } catch (err) {
      clearSession("error", err?.message || String(err));
    }
  }

  const running = ["requesting", "connecting", "connected"].includes(state);
  const stateLabel = {
    connected: "Connected",
    connecting: "Connecting",
    error: "Needs attention",
    idle: "Idle",
    requesting: "Microphone",
  }[state];

  return (
    <div className="voice-test">
      <div className={running ? "voice-pulse active" : "voice-pulse"}>
        <Mic2 size={22} />
      </div>
      <div className="voice-copy">
        <strong>{stateLabel}</strong>
        <span>{detail}</span>
        <audio ref={audioRef} autoPlay controls />
      </div>
      <Button icon={running ? X : Mic2} variant={running ? "danger" : "primary"} onClick={running ? () => stopVoiceTest() : startVoiceTest}>
        {running ? "Stop voice test" : "Start voice test"}
      </Button>
    </div>
  );
}

function RuntimeView({ config, flow, status, checkMcp, copyOfferUrl, updateConfig, updateIntegration }) {
  const mcp = config.integrations.find((integration) => integration.kind === "home_assistant_mcp");
  return (
    <div className="workspace-grid">
      <section className="panel main-panel">
        <div className="panel-head">
          <div>
            <h3>Home Assistant</h3>
            <span>{status?.mcp_token_configured ? "token ready" : "token pending"}</span>
          </div>
          <Button icon={RefreshCw} variant="secondary" onClick={checkMcp}>
            Check MCP
          </Button>
        </div>
        <div className="form-grid">
          <Field label="MCP URL">
            <input
              value={mcp?.base_url || ""}
              placeholder={config.effective_mcp_url}
              onChange={(event) => updateIntegration(mcp.id, (item) => ({ ...item, base_url: event.target.value }))}
            />
          </Field>
          <Field label="Access token">
            <input
              type="password"
              value={secretValue(mcp?.token)}
              placeholder={mcp?.token_configured ? "configured" : "Supervisor token"}
              onChange={(event) => updateIntegration(mcp.id, (item) => ({ ...item, token: event.target.value }))}
            />
          </Field>
        </div>
        <div className="divider" />
        <div className="panel-head">
          <div>
            <h3>Voice test</h3>
            <span>{flow.name}</span>
          </div>
        </div>
        <VoiceTest config={config} flow={flow} />
      </section>

      <section className="panel inspector">
        <div className="panel-head">
          <div>
            <h3>Satellite</h3>
            <span>SmallWebRTC</span>
          </div>
          <Button icon={Copy} variant="secondary" onClick={copyOfferUrl}>
            Copy URL
          </Button>
        </div>
        <div className="form-grid">
          <Field label="Public host">
            <input
              value={config.runner_host || ""}
              placeholder="homeassistant.local"
              onChange={(event) => updateConfig((draft) => ({ ...draft, runner_host: event.target.value }))}
            />
          </Field>
          <Field label="Offer URL" wide>
            <input value={config.runner_offer_url || ""} readOnly />
          </Field>
          <Field label="Satellite secret">
            <input
              type="password"
              value={secretValue(config.satellite_shared_secret)}
              placeholder={config.satellite_shared_secret_configured ? "configured" : ""}
              onChange={(event) => updateConfig((draft) => ({ ...draft, satellite_shared_secret: event.target.value }))}
            />
          </Field>
          <Field label="Port">
            <input value={status?.runner?.port || 7860} readOnly />
          </Field>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);

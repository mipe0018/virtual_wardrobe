import { supabase } from "../supabase";

// Only non-secret status is stored: kind, label, status and timestamps.
const STORAGE_KEY = "dressed-generation-flow";
const POLL_MS = 4000;
const MAX_RUNNING_MS = 10 * 60 * 1000;

export type FlowKind = "character" | "clothing" | "other";
type FlowState = {
  status: "running" | "completed" | "failed";
  kind: FlowKind;
  label: string;
  startedAt: number;
  keepOnReload?: boolean;
};

let panel: HTMLDivElement | null = null;
let labelElement: HTMLParagraphElement | null = null;
let hideTimer: number | undefined;
let pollTimer: number | undefined;
let initialized = false;

function readState(): FlowState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FlowState) : null;
  } catch {
    return null;
  }
}

function writeState(state: FlowState | null) {
  try {
    if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable; the panel still works for this page.
  }
}

function mountPanel() {
  if (panel) return;
  panel = document.createElement("div");
  panel.className = "flow-progress";
  panel.hidden = true;
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  labelElement = document.createElement("p");
  labelElement.className = "flow-progress-label";
  const track = document.createElement("div");
  track.className = "flow-progress-track";
  const bar = document.createElement("div");
  bar.className = "flow-progress-bar";
  track.appendChild(bar);
  panel.append(labelElement, track);
  document.body.appendChild(panel);
}

function render(state: FlowState | null) {
  mountPanel();
  if (!panel || !labelElement) return;
  if (!state) {
    panel.hidden = true;
    return;
  }
  panel.classList.toggle("is-done", state.status === "completed");
  panel.classList.toggle("is-error", state.status === "failed");
  labelElement.textContent = state.label;
  panel.hidden = false;
}

export function showFlow(label: string, kind: FlowKind = "other") {
  window.clearTimeout(hideTimer);
  const previous = readState();
  const state: FlowState = {
    status: "running",
    kind,
    label,
    startedAt: previous?.status === "running" && previous.kind === kind ? previous.startedAt : Date.now(),
  };
  writeState(state);
  render(state);
}

export function finishFlow(label: string) {
  window.clearTimeout(hideTimer);
  window.clearTimeout(pollTimer);
  const previous = readState();
  // The page may reload once right after success; keep the completed state through that reload only.
  const state: FlowState = {
    status: "completed",
    kind: previous?.kind ?? "other",
    label,
    startedAt: previous?.startedAt ?? Date.now(),
    keepOnReload: true,
  };
  writeState(state);
  render(state);
}

export function failFlow(message: string) {
  window.clearTimeout(hideTimer);
  window.clearTimeout(pollTimer);
  const previous = readState();
  const state: FlowState = {
    status: "failed",
    kind: previous?.kind ?? "other",
    label: message,
    startedAt: previous?.startedAt ?? Date.now(),
  };
  writeState(state);
  render(state);
  hideTimer = window.setTimeout(() => {
    writeState(null);
    render(null);
  }, 10000);
}

function isReload(): boolean {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type === "reload";
}

// A generation started on another page keeps running on the server; poll its status here.
async function pollRunning(state: FlowState) {
  if (state.kind === "other" || Date.now() - state.startedAt > MAX_RUNNING_MS) {
    if (state.kind !== "other") finishFlow(completedLabel(state.kind));
    else {
      writeState(null);
      render(null);
    }
    return;
  }
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (token) {
      const response = await fetch("/api/ai/usage", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await response.json()) as {
        usage?: Array<{ generation_type: string; in_progress: boolean }>;
      };
      const entry = body.usage?.find((item) => item.generation_type === state.kind);
      if (response.ok && entry && !entry.in_progress && Date.now() - state.startedAt > 8000) {
        finishFlow(completedLabel(state.kind));
        return;
      }
    }
  } catch {
    // Try again on the next tick.
  }
  pollTimer = window.setTimeout(() => {
    const current = readState();
    if (current?.status === "running") void pollRunning(current);
  }, POLL_MS);
}

function completedLabel(kind: FlowKind): string {
  return kind === "character" ? "MODEL READY ✓" : "AI READY ✓";
}

export function initGenerationFlow() {
  if (initialized) return;
  initialized = true;
  let state = readState();

  if (state && state.status !== "running" && isReload()) {
    if (state.keepOnReload) {
      state = { ...state, keepOnReload: false };
      writeState(state);
    } else {
      state = null;
      writeState(null);
    }
  } else if (state?.status === "failed") {
    state = null;
    writeState(null);
  }

  if (!state) return;
  render(state);
  if (state.status === "running") void pollRunning(state);
}

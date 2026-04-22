const readyStateEl = document.querySelector("#ready-state");
const accountStateEl = document.querySelector("#account-state");
const sessionStateEl = document.querySelector("#session-state");
const threadStateEl = document.querySelector("#thread-state");
const turnStateEl = document.querySelector("#turn-state");
const modelSelectEl = document.querySelector("#model-select");
const connectionStateEl = document.querySelector("#connection-state");
const transcriptEl = document.querySelector("#transcript");
const eventsEl = document.querySelector("#events");
const eventCountEl = document.querySelector("#event-count");
const formEl = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const sendEl = document.querySelector("#send");
const stopEl = document.querySelector("#stop-turn");
const newThreadEl = document.querySelector("#new-thread");
const errorEl = document.querySelector("#error");
const authTokenEl = document.querySelector("#auth-token");
const refreshThreadsEl = document.querySelector("#refresh-threads");
const threadHistoryEl = document.querySelector("#thread-history");
const threadPreviewEl = document.querySelector("#thread-preview");

const SESSION_STORAGE_KEY = "codexGatewaySessionId";
const THREAD_STORAGE_KEY = "codexGatewayThreadId";

let state = null;
let eventSource = null;
let sessionId = null;
let authToken = "";
let threads = [];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function setConnectionState(label) {
  connectionStateEl.textContent = label;
}

function renderState(nextState) {
  state = nextState;

  readyStateEl.textContent = state.ready ? "ready" : "starting";
  accountStateEl.textContent = state.account?.summary ?? "unknown";
  sessionStateEl.textContent = sessionId ?? "not started";
  threadStateEl.textContent = state.threadId ?? "not started";
  turnStateEl.textContent = state.activeTurn
    ? `running${state.currentTurnId ? ` (${state.currentTurnId.slice(0, 8)})` : ""}`
    : state.lastTurnStatus || "idle";

  renderModelOptions();
  renderTranscript();
  renderEvents();
  renderThreadHistory();
  renderControls();
  persistCurrentState();
}

function renderModelOptions() {
  const models = state?.models ?? [];
  const currentValue = state?.selectedModel ?? "";

  modelSelectEl.innerHTML = models
    .map(
      (model) =>
        `<option value="${escapeHtml(model.model)}" ${
          model.model === currentValue ? "selected" : ""
        }>${escapeHtml(model.displayName || model.model)}</option>`,
    )
    .join("");
}

function renderTranscript() {
  const transcript = state?.transcript ?? [];

  if (transcript.length === 0) {
    transcriptEl.innerHTML = `
      <div class="empty-state">
        <p>No messages yet.</p>
        <p>Start with a small prompt to confirm the bridge is healthy.</p>
      </div>
    `;
    return;
  }

  transcriptEl.innerHTML = transcript
    .map((entry) => {
      const text = escapeHtml(entry.text || "").replaceAll("\n", "<br />");
      return `
        <article class="message message-${escapeHtml(entry.role)}">
          <header>
            <span class="role">${escapeHtml(entry.role)}</span>
            <span class="status">${escapeHtml(entry.status)}</span>
          </header>
          <div class="body">${text || "<span class=\"muted\">(empty)</span>"}</div>
        </article>
      `;
    })
    .join("");

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function renderEvents() {
  const events = (state?.recentEvents ?? []).slice(-30).reverse();
  eventCountEl.textContent = String(state?.recentEvents?.length ?? 0);

  if (events.length === 0) {
    eventsEl.innerHTML = `<p class="muted">No events yet.</p>`;
    return;
  }

  eventsEl.innerHTML = events
    .map(
      (event) => `
        <div class="event-row">
          <div class="event-top">
            <span class="event-method">${escapeHtml(event.method || event.type || "event")}</span>
            <span class="event-status">${escapeHtml(event.status || "-")}</span>
          </div>
          <div class="event-preview">${escapeHtml(event.textPreview || event.itemType || "")}</div>
        </div>
      `,
    )
    .join("");
}

function renderThreadHistory() {
  if (threads.length === 0) {
    threadHistoryEl.innerHTML = `<p class="muted">No threads loaded.</p>`;
    return;
  }

  threadHistoryEl.innerHTML = threads
    .map((thread) => {
      const title = thread.name || thread.preview || thread.id;
      const updatedAt = thread.updatedAt
        ? new Date(thread.updatedAt * 1000).toLocaleString()
        : "unknown time";
      const active = thread.id === state?.threadId ? " active" : "";
      return `
        <div class="thread-row${active}" data-thread-id="${escapeHtml(thread.id)}">
          <div class="thread-title">${escapeHtml(title)}</div>
          <div class="thread-meta">${escapeHtml(thread.id)} · ${escapeHtml(updatedAt)}</div>
          <div class="thread-actions">
            <button class="ghost" type="button" data-action="preview" data-thread-id="${escapeHtml(thread.id)}">Preview</button>
            <button type="button" data-action="resume" data-thread-id="${escapeHtml(thread.id)}">Resume</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderThreadPreview(thread) {
  const turns = thread?.turns ?? [];
  const messages = [];

  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") {
        const text = userMessageText(item);
        if (text) {
          messages.push({ role: "user", text });
        }
      }
      if (item.type === "agentMessage" && item.text) {
        messages.push({ role: "assistant", text: item.text });
      }
    }
  }

  if (messages.length === 0) {
    threadPreviewEl.innerHTML = `<p class="muted">No text messages in this thread.</p>`;
    return;
  }

  threadPreviewEl.innerHTML = messages
    .slice(-6)
    .map(
      (message) => `
        <div class="preview-message">
          <div class="thread-meta">${escapeHtml(message.role)}</div>
          <div class="thread-title">${escapeHtml(message.text)}</div>
        </div>
      `,
    )
    .join("");
}

function userMessageText(item) {
  return (item.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function renderControls() {
  const busy = Boolean(state?.activeTurn);
  const unavailable = !sessionId;
  sendEl.disabled = busy || unavailable;
  stopEl.disabled = !busy || unavailable || !state?.currentTurnId;
  newThreadEl.disabled = busy || unavailable;
  modelSelectEl.disabled = busy || unavailable;
  promptEl.disabled = !state?.ready || unavailable;
  refreshThreadsEl.disabled = busy;
}

function sessionPath(suffix = "") {
  if (!sessionId) {
    throw new Error("Session is not ready.");
  }

  return `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

function authHeaders() {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

function persistCurrentState() {
  if (sessionId) {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }
  if (state?.threadId) {
    localStorage.setItem(THREAD_STORAGE_KEY, state.threadId);
  }
}

function forgetStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function forgetStoredThread() {
  localStorage.removeItem(THREAD_STORAGE_KEY);
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: authHeaders(),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function createSession(body = {}) {
  const payload = await postJson("/api/sessions", body);
  sessionId = payload.sessionId;
  renderState(payload.state);
  return payload;
}

async function restoreOrCreateSession() {
  const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
  if (storedSessionId) {
    sessionId = storedSessionId;
    try {
      const payload = await getJson(sessionPath("/state"));
      renderState(payload.state);
      return payload;
    } catch (error) {
      sessionId = null;
      forgetStoredSession();
    }
  }

  const storedThreadId = localStorage.getItem(THREAD_STORAGE_KEY);
  if (storedThreadId) {
    try {
      return await createSession({ resumeThreadId: storedThreadId });
    } catch (error) {
      forgetStoredThread();
    }
  }

  return createSession();
}

function connectEvents() {
  if (!sessionId) {
    throw new Error("Session is not ready.");
  }

  eventSource?.close();
  const url = new URL(sessionPath("/events"), window.location.origin);
  if (authToken) {
    url.searchParams.set("access_token", authToken);
  }
  eventSource = new EventSource(url);

  eventSource.addEventListener("open", () => {
    setConnectionState("streaming");
  });

  eventSource.addEventListener("session", (event) => {
    const session = JSON.parse(event.data);
    sessionId = session.id;
    sessionStateEl.textContent = session.id;
  });

  eventSource.addEventListener("state", (event) => {
    renderState(JSON.parse(event.data));
  });

  eventSource.addEventListener("warning", (event) => {
    const warning = JSON.parse(event.data);
    showError(warning.message || "Warning from server");
  });

  eventSource.addEventListener("server-request", (event) => {
    const request = JSON.parse(event.data);
    if (request.handled && request.result === "decline") {
      showError(`Declined ${request.method}`);
    }
  });

  eventSource.addEventListener("session-closed", (event) => {
    const payload = JSON.parse(event.data);
    showError(`Session closed: ${payload.reason}`);
    setConnectionState("closed");
  });

  eventSource.onerror = () => {
    setConnectionState("reconnecting");
  };
}

async function loadThreads() {
  const payload = await getJson("/api/threads?limit=20&sortKey=updated_at");
  threads = payload.threads ?? [];
  renderThreadHistory();
}

async function previewThread(threadId) {
  const payload = await getJson(`/api/threads/${encodeURIComponent(threadId)}`);
  renderThreadPreview(payload.thread);
}

async function resumeThread(threadId) {
  let payload;
  if (sessionId) {
    payload = await postJson(sessionPath("/thread/resume"), { threadId });
  } else {
    payload = await createSession({ resumeThreadId: threadId });
    connectEvents();
  }

  sessionId = payload.sessionId;
  renderState(payload.state);
  await previewThread(threadId);
  await loadThreads();
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const prompt = promptEl.value.trim();
  if (!prompt) {
    showError("Prompt must not be empty.");
    return;
  }

  try {
    await postJson(sessionPath("/turn"), { prompt });
    promptEl.value = "";
  } catch (error) {
    showError(error.message);
  }
});

newThreadEl.addEventListener("click", async () => {
  clearError();

  try {
    await postJson(sessionPath("/thread/new"), {
      model: modelSelectEl.value || undefined,
    });
  } catch (error) {
    showError(error.message);
  }
});

refreshThreadsEl.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearError();

  try {
    await loadThreads();
  } catch (error) {
    showError(error.message);
  }
});

threadHistoryEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const threadId = button.dataset.threadId;
  if (!threadId) {
    return;
  }

  clearError();
  try {
    if (button.dataset.action === "preview") {
      await previewThread(threadId);
    }
    if (button.dataset.action === "resume") {
      await resumeThread(threadId);
    }
  } catch (error) {
    showError(error.message);
  }
});

stopEl.addEventListener("click", async () => {
  clearError();

  try {
    await postJson(sessionPath("/turn/interrupt"), {});
  } catch (error) {
    showError(error.message);
  }
});

authTokenEl.addEventListener("change", () => {
  authToken = authTokenEl.value.trim();
  if (sessionId) {
    connectEvents();
  }
});

try {
  await restoreOrCreateSession();
  connectEvents();
  void loadThreads();
} catch (error) {
  showError(error.message);
  setConnectionState("offline");
}

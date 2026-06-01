const AUTOMATION_PAGE_SOURCE = "CHATGPT_BACKUP_AUTOMATION";
const AUTOMATION_EXTENSION_SOURCE = "CHATGPT_BACKUP_EXTENSION";
const AUTOMATION_EXPORT_MARKDOWN_ZIP_MESSAGE = "CHATGPT_BACKUP_AUTOMATION_EXPORT_MARKDOWN_ZIP";
const AUTOMATION_EXPORT_MARKDOWN_ZIP_TYPE = "EXPORT_MARKDOWN_ZIP";
const AUTOMATION_EXPORT_MARKDOWN_ZIP_RESULT_TYPE = "EXPORT_MARKDOWN_ZIP_RESULT";
const AUTOMATION_ALLOWED_HOSTNAMES = new Set(["chatgpt.com", "www.chatgpt.com"]);

const htmlElement = document.documentElement;
const colorScheme = htmlElement.classList.contains("dark") ? "dark" : "light";
chrome.runtime.sendMessage({
  message: "getColorScheme",
  colorScheme,
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getProjectConversationIdsFromDom(projectSlug) {
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const ids = new Set();
  const projectPattern = new RegExp(`/g/${escapeRegExp(projectSlug)}/c/([a-z0-9-]+)`);

  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(projectPattern);
    if (match?.[1]) {
      ids.add(match[1]);
    }
  });

  return Array.from(ids);
}

function isAutomationPageAllowed() {
  return AUTOMATION_ALLOWED_HOSTNAMES.has(window.location.hostname);
}

function validateAutomationExportMessage(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid automation message");
  }

  if (data.source !== AUTOMATION_PAGE_SOURCE || data.type !== AUTOMATION_EXPORT_MARKDOWN_ZIP_TYPE) {
    return null;
  }

  if (!data.requestId || typeof data.requestId !== "string") {
    throw new Error("Missing requestId");
  }

  const payload = data.payload;
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing payload");
  }

  if (payload.bucket !== "project" && payload.bucket !== "recent") {
    throw new Error("Invalid bucket");
  }

  return {
    requestId: data.requestId,
    payload: {
      bucket: payload.bucket,
      name: typeof payload.name === "string" ? payload.name : "",
      backupRunId: typeof payload.backupRunId === "string" ? payload.backupRunId : "",
    },
  };
}

function postAutomationResult(requestId, response) {
  const ok = Boolean(response?.ok);
  window.postMessage({
    source: AUTOMATION_EXTENSION_SOURCE,
    type: AUTOMATION_EXPORT_MARKDOWN_ZIP_RESULT_TYPE,
    requestId,
    ok,
    result: ok
      ? {
          filename: response.filename,
          bucket: response.bucket,
          name: response.name,
          backupRunId: response.backupRunId,
          downloadId: response.downloadId,
        }
      : undefined,
    error: ok ? undefined : response?.error || "Automation export failed",
  }, window.location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  if (event.origin !== window.location.origin || !isAutomationPageAllowed()) {
    return;
  }

  let automationRequest = null;
  try {
    automationRequest = validateAutomationExportMessage(event.data);
  } catch (error) {
    const requestId = typeof event.data?.requestId === "string" ? event.data.requestId : "";
    if (requestId) {
      postAutomationResult(requestId, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (!automationRequest) {
    return;
  }

  chrome.runtime.sendMessage({
    message: AUTOMATION_EXPORT_MARKDOWN_ZIP_MESSAGE,
    requestId: automationRequest.requestId,
    payload: automationRequest.payload,
  }, (response) => {
    if (chrome.runtime.lastError) {
      postAutomationResult(automationRequest.requestId, { ok: false, error: chrome.runtime.lastError.message });
      return;
    }

    postAutomationResult(automationRequest.requestId, response);
  });
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.message !== "getCurrentProjectConversationIds") {
    return;
  }

  try {
    const conversationIds = getProjectConversationIdsFromDom(request.projectSlug);
    console.log(`GPT-BACKUP::CONTENT::project-conversation-ids::${JSON.stringify({ projectSlug: request.projectSlug, conversationIds })}`);
    sendResponse({ conversationIds });
  } catch (error) {
    sendResponse({ error: error.message || String(error) });
  }

  return true;
});

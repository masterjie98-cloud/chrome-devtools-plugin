import type {
  EventOf,
  ExtensionEvent,
  ExtensionMessage,
  ExtensionRequest,
  ExtensionResponse,
  MessageSource,
  ResponsePayloadMap,
  RequestOf
} from "./messages";

export function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function makeRequest<T extends ExtensionRequest["type"]>(
  source: RequestOf<T>["source"],
  type: T,
  payload: RequestOf<T>["payload"]
): RequestOf<T> {
  return {
    id: createMessageId(),
    source,
    type,
    payload
  } as RequestOf<T>;
}

export function makeEvent<T extends ExtensionEvent["type"]>(
  source: EventOf<T>["source"],
  type: T,
  payload: EventOf<T>["payload"]
): EventOf<T> {
  return {
    id: createMessageId(),
    source,
    type,
    payload
  } as EventOf<T>;
}

export function okResponse<T extends ExtensionRequest["type"]>(
  request: Pick<RequestOf<T>, "id" | "type">,
  payload: ResponsePayloadMap[T]
): ExtensionResponse<T> {
  return {
    id: request.id,
    type: request.type,
    ok: true,
    payload
  } as ExtensionResponse<T>;
}

export function errorResponse<T extends ExtensionRequest["type"]>(
  request: { id: string; type: T },
  code: string,
  message: string,
  details?: unknown
): ExtensionResponse<T> {
  return {
    id: request.id,
    type: request.type,
    ok: false,
    error: {
      code,
      message,
      details
    }
  } as ExtensionResponse<T>;
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ExtensionMessage>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    isMessageSource(candidate.source) &&
    "payload" in candidate
  );
}

export function isExtensionEvent(value: unknown): value is ExtensionEvent {
  return (
    isExtensionMessage(value) &&
    (value.source === "content" || value.source === "background")
  );
}

export function isBackgroundContentRequest(
  value: unknown,
): value is ExtensionRequest {
  return (
    isExtensionMessage(value) &&
    value.source === "background" &&
    value.type.startsWith("content:")
  );
}

export function sendRuntimeRequest<T extends ExtensionRequest["type"]>(
  request: RequestOf<T>
): Promise<ExtensionResponse<T>> {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return Promise.resolve(
        errorResponse<T>(
          request,
          "CHROME_RUNTIME_UNAVAILABLE",
          "Chrome extension runtime is not available in this context."
        )
      );
    }
  } catch {
    return Promise.resolve(
      errorResponse<T>(
        request,
        "EXTENSION_CONTEXT_INVALIDATED",
        "Chrome extension context was invalidated. Reload the page and try again."
      )
    );
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(request, (response: ExtensionResponse<T> | undefined) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve(errorResponse<T>(request, "RUNTIME_MESSAGE_ERROR", lastError.message ?? "Runtime error"));
          return;
        }

        if (!response) {
          resolve(errorResponse<T>(request, "EMPTY_RESPONSE", "No response was returned."));
          return;
        }

        resolve(response);
      });
    } catch (error) {
      resolve(
        errorResponse<T>(
          request,
          "EXTENSION_CONTEXT_INVALIDATED",
          error instanceof Error
            ? error.message
            : "Chrome extension context was invalidated.",
        ),
      );
    }
  });
}

export function sendRuntimeEvent(event: ExtensionEvent): void {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return;
    }

    chrome.runtime.sendMessage(event, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Existing content scripts can outlive an extension reload. Ignore the stale
    // context; the next page reload will inject the new script.
  }
}

function isMessageSource(value: unknown): value is MessageSource {
  return value === "sidepanel" || value === "background" || value === "content";
}

import type {
  DomElementInfo,
  DomSummaryNode,
  PageSnapshot,
} from "../shared/dom";
import { buildCompressedPageContext } from "../shared/contextDigest";
import {
  collaborationWorkspaceForMcp,
  createEmptyCollaborationWorkspace,
  sanitizeCollaborationWorkspace,
  upsertCollaborationItem,
  type CollaborationItemInput,
  type CollaborationItemSource,
  type CollaborationWorkspaceMutationResult,
  type CollaborationWorkspaceSnapshot,
} from "../shared/collaborationWorkspace";
import {
  sanitizeAgentToolCallForPersistence,
  sanitizeAgentToolResultForPersistence,
  type AgentSessionSnapshot,
  type AgentSessionStatus,
  type AgentSessionToolCallSnapshot,
  type AgentSessionToolResultSnapshot,
} from "../shared/agentSession";
import { sanitizeAgentTaskState } from "../shared/agentTaskState";
import type {
  ActiveTabSnapshot,
  ElementSelectedPayload,
  PluginChatMessageSnapshot,
  ScreenshotSnapshot,
} from "../shared/wsProtocol";
import {
  sanitizeActiveTabForMcp,
  sanitizeElementForMcp,
  sanitizePageSnapshotForMcp,
  sanitizeScreenshotForMcp,
} from "../shared/wsProtocol";
import { sanitizeText } from "../shared/sanitize";
import { createMessageId } from "../shared/messaging";
import { createResourceTargetKey } from "./resourceRouting";

export interface BrowserSession {
  sessionId: string;
  browserConnected: boolean;
  uiConnected: boolean;
  browserConnectedAt?: string;
  uiConnectedAt?: string;
  currentTab?: ActiveTabSnapshot;
  selectedElement?: DomElementInfo;
  domSnapshot?: string;
  pageContext?: PageSnapshot;
  consoleLogs: unknown[];
  networkRequests: unknown[];
  screenshots: ScreenshotSnapshot[];
  lastScreenshot?: ScreenshotSnapshot;
  pluginConversation: PluginChatMessageSnapshot[];
  currentConversationId: string;
  lastPluginMessage?: PluginChatMessageSnapshot;
  agentSessions: AgentSessionSnapshot[];
  activeAgentSession?: AgentSessionSnapshot;
  collaborationWorkspace: CollaborationWorkspaceSnapshot;
  lastAgentConclusion?: {
    sessionId: string;
    status: AgentSessionStatus;
    content: string;
    completedAt: string;
  };
  createdAt: number;
  lastSeenAt: number;
  stateUpdatedAt: number;
  currentTabUpdatedAt?: number;
  revision: number;
}

export interface BrowserStateSnapshot {
  sessionId: string;
  browserConnected: boolean;
  pluginConnected: boolean;
  uiConnected: boolean;
  browserConnectedAt?: string;
  uiConnectedAt?: string;
  activeTab?: ActiveTabSnapshot;
  currentTab?: ActiveTabSnapshot;
  selectedElement?: DomElementInfo;
  domSnapshot?: string;
  pageContext?: PageSnapshot;
  consoleLogs: unknown[];
  networkRequests: unknown[];
  screenshots: ScreenshotSnapshot[];
  lastScreenshot?: ScreenshotSnapshot;
  pluginConversation: PluginChatMessageSnapshot[];
  currentConversationId: string;
  lastPluginMessage?: PluginChatMessageSnapshot;
  agentSessions: AgentSessionSnapshot[];
  activeAgentSession?: AgentSessionSnapshot;
  collaborationWorkspace: CollaborationWorkspaceSnapshot;
  lastAgentConclusion?: BrowserSession["lastAgentConclusion"];
  lastSeenAt?: string;
  stateUpdatedAt?: string;
  artifactCapturedAt?: string;
  /** @deprecated Use stateUpdatedAt. */
  updatedAt?: string;
  revision: number;
}

export interface PersistedBrowserSessionState {
  sessionId: string;
  currentTab?: ActiveTabSnapshot;
  selectedElement?: DomElementInfo;
  pageContext?: PageSnapshot;
  screenshots: ScreenshotSnapshot[];
  pluginConversation: PluginChatMessageSnapshot[];
  currentConversationId: string;
  collaborationWorkspace: CollaborationWorkspaceSnapshot;
  lastAgentConclusion?: BrowserSession["lastAgentConclusion"];
  createdAt: number;
  lastSeenAt: number;
  stateUpdatedAt: number;
  revision: number;
}

export interface PersistedBrowserState {
  activeSessionId: string;
  sessions: PersistedBrowserSessionState[];
}

export interface BrowserSessionSummary {
  sessionId: string;
  browserConnected: boolean;
  uiConnected: boolean;
  selected: boolean;
  activeTarget: ActiveTabSnapshot | null;
  resourceTargetKey: string | null;
  lastSeenAt: string;
  stateUpdatedAt: string;
  revision: number;
}

const DEFAULT_SESSION_ID = "default";
const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SCREENSHOTS = 20;

export class BrowserStateHub {
  readonly sessions = new Map<string, BrowserSession>();
  private activeSessionId = DEFAULT_SESSION_ID;
  private readonly persistenceListeners = new Set<
    (state: PersistedBrowserState) => void
  >();

  constructor(private readonly clock: () => number = Date.now) {
    this.ensureSession(DEFAULT_SESSION_ID);
  }

  connect(
    role: "browser" | "ui" | "plugin" | "observer",
    sessionId = DEFAULT_SESSION_ID,
  ): BrowserSession {
    const session = this.ensureSession(sessionId);
    const now = this.clock();
    session.lastSeenAt = now;
    session.stateUpdatedAt = now;
    this.activeSessionId = session.sessionId;

    if (role === "browser" || role === "plugin") {
      session.browserConnected = true;
      session.browserConnectedAt = new Date(now).toISOString();
    }
    if (role === "ui" || role === "observer" || role === "plugin") {
      session.uiConnected = true;
      session.uiConnectedAt = new Date(now).toISOString();
    }

    return session;
  }

  disconnect(
    role: "browser" | "ui" | "plugin" | "observer",
    sessionId = this.activeSessionId,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (role === "browser" || role === "plugin") {
      session.browserConnected = false;
    }
    if (role === "ui" || role === "observer" || role === "plugin") {
      session.uiConnected = false;
    }
    this.markStateUpdated(sessionId);
  }

  touch(sessionId = this.activeSessionId): BrowserSession {
    const session = this.ensureSession(sessionId);
    session.lastSeenAt = this.clock();
    this.activeSessionId = session.sessionId;
    return session;
  }

  cleanupExpiredSessions(now = this.clock()): void {
    let changed = false;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (sessionId === DEFAULT_SESSION_ID) {
        continue;
      }
      if (now - session.lastSeenAt > SESSION_TTL_MS) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }
    if (!this.sessions.has(this.activeSessionId)) {
      this.activeSessionId = DEFAULT_SESSION_ID;
    }
    if (changed) {
      this.notifyPersistence();
    }
  }

  getActiveSession(): BrowserSession {
    return this.ensureSession(this.activeSessionId);
  }

  getSession(sessionId = this.activeSessionId): BrowserSession {
    return this.ensureSession(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  listSessionSummaries(selectedSessionId?: string): BrowserSessionSummary[] {
    return Array.from(this.sessions.values())
      .filter(
        (session) =>
          session.sessionId !== DEFAULT_SESSION_ID ||
          session.browserConnected ||
          Boolean(session.currentTab),
      )
      .map((session) => ({
        sessionId: session.sessionId,
        browserConnected: session.browserConnected,
        uiConnected: session.uiConnected,
        selected: session.sessionId === selectedSessionId,
        activeTarget: session.currentTab ?? null,
        resourceTargetKey: createResourceTargetKey(session.currentTab),
        lastSeenAt: new Date(session.lastSeenAt).toISOString(),
        stateUpdatedAt: new Date(session.stateUpdatedAt).toISOString(),
        revision: session.revision,
      }))
      .sort(
        (left, right) =>
          Number(right.browserConnected) - Number(left.browserConnected) ||
          left.sessionId.localeCompare(right.sessionId),
      );
  }

  setCurrentTab(activeTab: ActiveTabSnapshot, sessionId?: string): void {
    const session = this.markStateUpdated(sessionId);
    this.applyCurrentTab(session, activeTab, true);
    session.currentTabUpdatedAt = session.lastSeenAt;
    this.notifyPersistence();
  }

  async waitForCurrentTabAfterBrowserConnect(
    sessionId: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const timeoutMs = Math.max(0, Math.min(1_000, options.timeoutMs ?? 350));
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("REQUEST_CANCELLED: target refresh was cancelled.");
      }
      const session = this.ensureSession(sessionId);
      if (!targetRefreshPending(session)) {
        return Boolean(session.currentTab);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      await waitForTargetRefreshTick(Math.min(20, remaining), options.signal);
    }
  }

  setElementSelected(
    payload: ElementSelectedPayload,
    sessionId?: string,
  ): void {
    const session = this.markStateUpdated(sessionId);
    this.applyCurrentTab(session, payload.activeTab);
    session.selectedElement = sanitizeElementForMcp(payload.selectedElement);
    this.notifyPersistence();
  }

  addPluginMessage(
    message: PluginChatMessageSnapshot,
    sessionId?: string,
  ): void {
    const session = this.markStateUpdated(sessionId);
    const conversationId = message.conversationId
      ? sanitizeText(message.conversationId, 200).trim() ||
        session.currentConversationId
      : session.currentConversationId;
    const sanitized: PluginChatMessageSnapshot = {
      ...message,
      conversationId,
      content: sanitizeText(message.content, 6000),
    };
    if (conversationId !== session.currentConversationId) {
      session.currentConversationId = conversationId;
      session.pluginConversation = [];
      session.lastPluginMessage = undefined;
    }
    session.pluginConversation.push(sanitized);
    session.pluginConversation = session.pluginConversation.slice(-100);
    session.lastPluginMessage = sanitized;
    this.notifyPersistence();
  }

  startPluginConversation(
    conversationId: string,
    sessionId?: string,
  ): void {
    const session = this.touch(sessionId);
    const normalized = sanitizeText(conversationId, 200).trim();
    if (!normalized) {
      return;
    }
    session.stateUpdatedAt = session.lastSeenAt;
    session.currentConversationId = normalized;
    session.pluginConversation = [];
    session.lastPluginMessage = undefined;
    this.notifyPersistence();
  }

  setLastScreenshot(screenshot: ScreenshotSnapshot, sessionId?: string): void {
    const session = this.markStateUpdated(sessionId);
    const sanitized = sanitizeScreenshotForMcp(screenshot);
    session.lastScreenshot = sanitized;
    session.screenshots.push(sanitized);
    session.screenshots = session.screenshots.slice(-MAX_SCREENSHOTS);
    this.notifyPersistence();
  }

  setPageContext(
    activeTab: ActiveTabSnapshot,
    pageContext: PageSnapshot,
    sessionId?: string,
  ): boolean {
    return this.setPageContextWithResult(
      activeTab,
      pageContext,
      sessionId,
    ).accepted;
  }

  setPageContextWithResult(
    activeTab: ActiveTabSnapshot,
    pageContext: PageSnapshot,
    sessionId?: string,
  ): { accepted: boolean; mismatchFields: string[] } {
    const session = this.touch(sessionId);
    const sanitizedPageContext = sanitizePageSnapshotForMcp(pageContext);
    const effectiveTarget = sanitizedPageContext.provenance?.target ?? activeTab;
    const mismatchFields =
      sanitizedPageContext.provenance && session.currentTab
        ? pageContextTargetMismatchFields(session.currentTab, effectiveTarget)
        : [];
    if (mismatchFields.length > 0) {
      return { accepted: false, mismatchFields };
    }
    session.stateUpdatedAt = session.lastSeenAt;
    this.applyCurrentTab(session, effectiveTarget);
    session.pageContext = sanitizedPageContext;
    session.domSnapshot = session.pageContext.visibleText;
    this.notifyPersistence();
    return { accepted: true, mismatchFields: [] };
  }

  setAgentSession(sessionSnapshot: AgentSessionSnapshot, sessionId?: string): void {
    const session = this.markStateUpdated(sessionId);
    const sanitized = sanitizeAgentSession(sessionSnapshot);
    const existingIndex = session.agentSessions.findIndex(
      (candidate) => candidate.id === sanitized.id,
    );

    if (existingIndex === -1) {
      session.agentSessions.push(sanitized);
    } else {
      session.agentSessions.splice(existingIndex, 1, sanitized);
    }

    session.agentSessions = session.agentSessions.slice(-20);

    if (sanitized.status === "running") {
      session.activeAgentSession = sanitized;
    } else if (session.activeAgentSession?.id === sanitized.id) {
      session.activeAgentSession = undefined;
    }

    if (sanitized.finalContent) {
      session.lastAgentConclusion = {
        sessionId: sanitized.id,
        status: sanitized.status,
        content: sanitizeText(sanitized.finalContent, 12000),
        completedAt: sanitized.completedAt ?? sanitized.updatedAt,
      };
    }
    this.notifyPersistence();
  }

  upsertCollaborationItem(
    input: CollaborationItemInput,
    source: CollaborationItemSource,
    sessionId?: string,
    options: { allowOwnerLastWriteWithoutRevision?: boolean } = {},
  ): CollaborationWorkspaceMutationResult {
    const session = this.markStateUpdated(sessionId);
    const result = upsertCollaborationItem(
      session.collaborationWorkspace,
      input,
      source,
      new Date(session.stateUpdatedAt).toISOString(),
      options,
    );
    session.collaborationWorkspace = result.workspace;
    this.notifyPersistence();
    return structuredClone(result);
  }

  subscribePersistence(
    listener: (state: PersistedBrowserState) => void,
  ): () => void {
    this.persistenceListeners.add(listener);
    return () => this.persistenceListeners.delete(listener);
  }

  toPersistentState(): PersistedBrowserState {
    return {
      activeSessionId: this.activeSessionId,
      sessions: Array.from(this.sessions.values()).map((session) => ({
        sessionId: session.sessionId,
        currentTab: session.currentTab,
        selectedElement: session.selectedElement,
        pageContext: session.pageContext,
        screenshots: session.screenshots.map((screenshot) => ({
          ...sanitizeScreenshotForMcp(screenshot),
          dataUrl: `data:${screenshot.mimeType};base64,`,
        })),
        pluginConversation: session.pluginConversation,
        currentConversationId: session.currentConversationId,
        collaborationWorkspace: session.collaborationWorkspace,
        lastAgentConclusion: session.lastAgentConclusion,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        stateUpdatedAt: session.stateUpdatedAt,
        revision: session.revision,
      })),
    };
  }

  restorePersistentState(value: unknown): void {
    const restored = parsePersistentBrowserState(value);
    this.sessions.clear();
    for (const persisted of restored.sessions) {
      const screenshots = persisted.screenshots
        .slice(-MAX_SCREENSHOTS)
        .map(sanitizeScreenshotForMcp);
      const pluginConversation = persisted.pluginConversation
        .slice(-100)
        .map(sanitizePluginMessage)
        .filter(
          (message) =>
            !message.conversationId ||
            message.conversationId === persisted.currentConversationId,
        );
      const pageContext = persisted.pageContext
        ? sanitizePageSnapshotForMcp(persisted.pageContext)
        : undefined;
      const session: BrowserSession = {
        sessionId: persisted.sessionId,
        browserConnected: false,
        uiConnected: false,
        currentTab: persisted.currentTab
          ? sanitizeActiveTabForMcp(persisted.currentTab)
          : undefined,
        selectedElement: persisted.selectedElement
          ? sanitizeElementForMcp(persisted.selectedElement)
          : undefined,
        domSnapshot: pageContext?.visibleText,
        pageContext,
        consoleLogs: [],
        networkRequests: [],
        screenshots,
        lastScreenshot: screenshots.at(-1),
        pluginConversation,
        currentConversationId: persisted.currentConversationId,
        collaborationWorkspace: sanitizeCollaborationWorkspace(
          persisted.collaborationWorkspace,
        ),
        lastPluginMessage: pluginConversation.at(-1),
        agentSessions: [],
        lastAgentConclusion: persisted.lastAgentConclusion
          ? {
              ...persisted.lastAgentConclusion,
              content: sanitizeText(
                persisted.lastAgentConclusion.content,
                12000,
              ),
            }
          : undefined,
        createdAt: persisted.createdAt,
        lastSeenAt: persisted.lastSeenAt,
        stateUpdatedAt: persisted.stateUpdatedAt,
        currentTabUpdatedAt: persisted.currentTab
          ? persisted.stateUpdatedAt
          : undefined,
        revision: persisted.revision,
      };
      this.sessions.set(session.sessionId, session);
    }
    this.ensureSession(DEFAULT_SESSION_ID);
    this.activeSessionId = this.sessions.has(restored.activeSessionId)
      ? restored.activeSessionId
      : DEFAULT_SESSION_ID;
  }

  snapshot(sessionId = this.activeSessionId): BrowserStateSnapshot {
    const session = this.ensureSession(sessionId);
    const lastSeenAt = new Date(session.lastSeenAt).toISOString();
    const stateUpdatedAt = new Date(session.stateUpdatedAt).toISOString();
    const artifactCapturedAt = session.lastScreenshot?.capturedAt;
    return {
      sessionId: session.sessionId,
      browserConnected: session.browserConnected,
      pluginConnected: session.browserConnected,
      uiConnected: session.uiConnected,
      browserConnectedAt: session.browserConnectedAt,
      uiConnectedAt: session.uiConnectedAt,
      activeTab: session.currentTab,
      currentTab: session.currentTab,
      selectedElement: session.selectedElement,
      domSnapshot: session.domSnapshot,
      pageContext: session.pageContext,
      consoleLogs: session.consoleLogs,
      networkRequests: session.networkRequests,
      screenshots: session.screenshots,
      lastScreenshot: session.lastScreenshot,
      pluginConversation: session.pluginConversation,
      currentConversationId: session.currentConversationId,
      lastPluginMessage: session.lastPluginMessage,
      agentSessions: session.agentSessions,
      activeAgentSession: session.activeAgentSession,
      collaborationWorkspace: session.collaborationWorkspace,
      lastAgentConclusion: session.lastAgentConclusion,
      revision: session.revision,
      lastSeenAt,
      stateUpdatedAt,
      artifactCapturedAt,
      updatedAt: stateUpdatedAt,
    };
  }

  resourcePayload(
    key: keyof BrowserStateSnapshot,
    sessionId?: string,
  ): unknown {
    const snapshot = this.snapshot(sessionId);
    return {
      browserConnected: snapshot.browserConnected,
      pluginConnected: snapshot.browserConnected,
      sessionId: snapshot.sessionId,
      lastSeenAt: snapshot.lastSeenAt,
      stateUpdatedAt: snapshot.stateUpdatedAt,
      artifactCapturedAt: snapshot.artifactCapturedAt,
      updatedAt: snapshot.stateUpdatedAt,
      value: snapshot[key] ?? null,
    };
  }

  collaborationWorkspacePayload(sessionId?: string): unknown {
    const snapshot = this.snapshot(sessionId);
    return {
      browserConnected: snapshot.browserConnected,
      pluginConnected: snapshot.browserConnected,
      sessionId: snapshot.sessionId,
      workspace: collaborationWorkspaceForMcp(snapshot.collaborationWorkspace),
      ...stateTimeMetadata(snapshot),
    };
  }

  selectedElementPayload(sessionId?: string): unknown {
    const snapshot = this.snapshot(sessionId);
    if (!snapshot.selectedElement) {
      return {
        browserConnected: snapshot.browserConnected,
        pluginConnected: snapshot.browserConnected,
        sessionId: snapshot.sessionId,
        error: snapshot.browserConnected
          ? "Browser is connected, but no element has been selected yet."
          : "Browser is not connected to ws://127.0.0.1:17321, and no cached selectedElement is available.",
        selectedElement: null,
        ...stateTimeMetadata(snapshot),
      };
    }

    return {
      browserConnected: snapshot.browserConnected,
      pluginConnected: snapshot.browserConnected,
      sessionId: snapshot.sessionId,
      warning: snapshot.browserConnected
        ? undefined
        : "Browser is not currently connected; returning the last cached selectedElement.",
      activeTab: snapshot.currentTab ?? null,
      selectedElement: snapshot.selectedElement,
      ...stateTimeMetadata(snapshot),
    };
  }

  contextDigestPayload(sessionId?: string): unknown {
    const snapshot = this.snapshot(sessionId);
    if (!snapshot.pageContext) {
      return {
        browserConnected: snapshot.browserConnected,
        pluginConnected: snapshot.browserConnected,
        sessionId: snapshot.sessionId,
        error: snapshot.browserConnected
          ? "Browser is connected, but page context has not been synced yet."
          : "Browser is not connected to ws://127.0.0.1:17321, and no cached page context is available.",
        activeTab: snapshot.currentTab ?? null,
        contextDigest: null,
        ...stateTimeMetadata(snapshot),
      };
    }

    return {
      browserConnected: snapshot.browserConnected,
      pluginConnected: snapshot.browserConnected,
      sessionId: snapshot.sessionId,
      warning: snapshot.browserConnected
        ? undefined
        : "Browser is not currently connected; returning the last cached page context digest.",
      activeTab: snapshot.currentTab ?? null,
      contextDigest: buildCompressedPageContext(
        snapshot.pageContext,
        snapshot.selectedElement,
      ),
      ...stateTimeMetadata(snapshot),
    };
  }

  private ensureSession(sessionId = DEFAULT_SESSION_ID): BrowserSession {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const now = this.clock();
    const session: BrowserSession = {
      sessionId,
      browserConnected: false,
      uiConnected: false,
      consoleLogs: [],
      networkRequests: [],
      screenshots: [],
      pluginConversation: [],
      currentConversationId: createConversationId(),
      agentSessions: [],
      collaborationWorkspace: createEmptyCollaborationWorkspace(),
      revision: 0,
      createdAt: now,
      lastSeenAt: now,
      stateUpdatedAt: now,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private markStateUpdated(sessionId?: string): BrowserSession {
    const session = this.touch(sessionId);
    session.stateUpdatedAt = session.lastSeenAt;
    return session;
  }

  private notifyPersistence(): void {
    if (this.persistenceListeners.size === 0) {
      return;
    }
    const state = this.toPersistentState();
    for (const listener of this.persistenceListeners) {
      listener(state);
    }
  }

  private applyCurrentTab(
    session: BrowserSession,
    activeTab: ActiveTabSnapshot,
    authoritative = false,
  ): void {
    const nextTab = sanitizeActiveTabForMcp(activeTab);
    const documentChanged = Boolean(
      session.currentTab &&
        ((session.currentTab.navigationId &&
          nextTab.navigationId &&
          session.currentTab.navigationId !== nextTab.navigationId) ||
          (nextTab.documentId !== undefined &&
            session.currentTab.documentId !== nextTab.documentId) ||
          (nextTab.frameId !== undefined &&
            session.currentTab.frameId !== nextTab.frameId) ||
          (nextTab.targetId !== undefined &&
            session.currentTab.targetId !== nextTab.targetId) ||
          session.currentTab.url !== nextTab.url),
    );
    if (documentChanged) {
      session.selectedElement = undefined;
      session.domSnapshot = undefined;
      session.pageContext = undefined;
      session.screenshots = [];
      session.lastScreenshot = undefined;
      session.revision += 1;
    }
    session.currentTab = authoritative
      ? { ...nextTab, revision: session.revision }
      : {
          ...session.currentTab,
          ...withoutUndefined(nextTab),
          url: nextTab.url,
          title: nextTab.title,
          revision: session.revision,
        };
  }
}

function targetRefreshPending(session: BrowserSession): boolean {
  if (
    !session.browserConnected ||
    !session.currentTab ||
    !session.browserConnectedAt
  ) {
    return false;
  }
  const connectedAt = Date.parse(session.browserConnectedAt);
  return (
    Number.isFinite(connectedAt) &&
    (session.currentTabUpdatedAt ?? 0) < connectedAt
  );
}

function waitForTargetRefreshTick(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("REQUEST_CANCELLED: target refresh was cancelled."),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function pageContextTargetMismatchFields(
  current: ActiveTabSnapshot,
  captured: ActiveTabSnapshot,
): string[] {
  const mismatchFields: string[] = [];
  const keys: Array<keyof ActiveTabSnapshot> = [
    "tabId",
    "targetId",
    "frameId",
    "documentId",
    "navigationId",
  ];
  for (const key of keys) {
    if (
      current[key] !== undefined &&
      captured[key] !== undefined &&
      current[key] !== captured[key]
    ) {
      mismatchFields.push(key);
    }
  }
  if (current.url !== captured.url) {
    mismatchFields.push("url");
  }
  return mismatchFields;
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function createConversationId(): string {
  return `conversation-${createMessageId()}`;
}

function parsePersistentBrowserState(value: unknown): PersistedBrowserState {
  if (!isRecord(value)) {
    throw new Error("Persisted browser state must be an object.");
  }
  if (
    typeof value.activeSessionId !== "string" ||
    !Array.isArray(value.sessions) ||
    value.sessions.length > 100
  ) {
    throw new Error("Persisted browser state has invalid session metadata.");
  }
  const sessions = value.sessions.map(parsePersistedSession);
  if (new Set(sessions.map((session) => session.sessionId)).size !== sessions.length) {
    throw new Error("Persisted browser state contains duplicate session IDs.");
  }
  return { activeSessionId: value.activeSessionId, sessions };
}

function parsePersistedSession(value: unknown): PersistedBrowserSessionState {
  if (!isRecord(value)) {
    throw new Error("Persisted browser session must be an object.");
  }
  const legacyUpdatedAt = value.updatedAt;
  const lastSeenAt = isSafeTimestamp(value.lastSeenAt)
    ? value.lastSeenAt
    : legacyUpdatedAt;
  const stateUpdatedAt = isSafeTimestamp(value.stateUpdatedAt)
    ? value.stateUpdatedAt
    : legacyUpdatedAt;
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId.trim() ||
    value.sessionId.length > 200 ||
    typeof value.currentConversationId !== "string" ||
    !value.currentConversationId.trim() ||
    value.currentConversationId.length > 200 ||
    !Array.isArray(value.screenshots) ||
    !value.screenshots.every(isScreenshotSnapshot) ||
    !Array.isArray(value.pluginConversation) ||
    !value.pluginConversation.every(isPluginMessageSnapshot) ||
    !isSafeTimestamp(value.createdAt) ||
    !isSafeTimestamp(lastSeenAt) ||
    !isSafeTimestamp(stateUpdatedAt) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    (value.currentTab !== undefined && !isActiveTabSnapshot(value.currentTab)) ||
    (value.selectedElement !== undefined &&
      !isDomElementSnapshot(value.selectedElement)) ||
    (value.pageContext !== undefined && !isPageSnapshot(value.pageContext)) ||
    (value.lastAgentConclusion !== undefined &&
      !isLastAgentConclusion(value.lastAgentConclusion))
  ) {
    throw new Error(`Persisted browser session is invalid: ${String(value.sessionId)}`);
  }
  return {
    ...(value as unknown as PersistedBrowserSessionState),
    collaborationWorkspace:
      value.collaborationWorkspace === undefined
        ? createEmptyCollaborationWorkspace()
        : sanitizeCollaborationWorkspace(value.collaborationWorkspace),
    lastSeenAt,
    stateUpdatedAt,
  };
}

function stateTimeMetadata(snapshot: BrowserStateSnapshot) {
  return {
    lastSeenAt: snapshot.lastSeenAt,
    stateUpdatedAt: snapshot.stateUpdatedAt,
    artifactCapturedAt: snapshot.artifactCapturedAt,
    updatedAt: snapshot.stateUpdatedAt,
  };
}

function sanitizePluginMessage(
  message: PluginChatMessageSnapshot,
): PluginChatMessageSnapshot {
  return {
    id: sanitizeText(message.id, 200),
    conversationId: message.conversationId
      ? sanitizeText(message.conversationId, 200)
      : undefined,
    role: message.role,
    content: sanitizeText(message.content, 6000),
    createdAt: message.createdAt,
  };
}

function isActiveTabSnapshot(value: unknown): value is ActiveTabSnapshot {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.title === "string"
  );
}

function isPageSnapshot(value: unknown): value is PageSnapshot {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.origin === "string" &&
    typeof value.capturedAt === "string" &&
    typeof value.visibleText === "string" &&
    Array.isArray(value.domSummary) &&
    value.domSummary.every(isDomSummaryNode) &&
    typeof value.nodeCount === "number" &&
    typeof value.truncated === "boolean"
  );
}

function isDomElementSnapshot(value: unknown): value is DomElementInfo {
  return (
    isRecord(value) &&
    typeof value.selector === "string" &&
    typeof value.tagName === "string" &&
    typeof value.outerHTML === "string" &&
    isRecord(value.attributes) &&
    Object.values(value.attributes).every((entry) => typeof entry === "string") &&
    isRecord(value.computedStyle) &&
    Object.values(value.computedStyle).every(
      (entry) => typeof entry === "string",
    ) &&
    isRecord(value.rect)
  );
}

function isDomSummaryNode(value: unknown): value is DomSummaryNode {
  return (
    isRecord(value) &&
    typeof value.tagName === "string" &&
    typeof value.selector === "string" &&
    typeof value.childElementCount === "number" &&
    (value.children === undefined ||
      (Array.isArray(value.children) && value.children.every(isDomSummaryNode)))
  );
}

function isScreenshotSnapshot(value: unknown): value is ScreenshotSnapshot {
  return (
    isRecord(value) &&
    typeof value.capturedAt === "string" &&
    (value.mimeType === "image/png" || value.mimeType === "image/jpeg") &&
    typeof value.dataUrl === "string"
  );
}

function isPluginMessageSnapshot(
  value: unknown,
): value is PluginChatMessageSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.conversationId === undefined ||
      typeof value.conversationId === "string") &&
    (value.role === "user" ||
      value.role === "assistant" ||
      value.role === "tool") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string"
  );
}

function isLastAgentConclusion(
  value: unknown,
): value is NonNullable<BrowserSession["lastAgentConclusion"]> {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    (value.status === "running" ||
      value.status === "completed" ||
      value.status === "blocked" ||
      value.status === "failed" ||
      value.status === "cancelled") &&
    typeof value.content === "string" &&
    typeof value.completedAt === "string"
  );
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeAgentSession(
  session: AgentSessionSnapshot,
): AgentSessionSnapshot {
  return {
    ...session,
    input: sanitizeText(session.input, 4000),
    finalContent: session.finalContent
      ? sanitizeText(session.finalContent, 12000)
      : undefined,
    taskState: sanitizeAgentTaskState(session.taskState),
    events: session.events.slice(-80).map((event) => ({
      ...event,
      summary: sanitizeText(event.summary, 1200),
      data: event.data
        ? {
            contextReadError: event.data.contextReadError
              ? sanitizeText(event.data.contextReadError, 800)
              : undefined,
            toolCalls: sanitizeAgentToolCalls(event.data.toolCalls),
            toolResults: sanitizeAgentToolResults(event.data.toolResults),
          }
        : undefined,
    })),
  };
}

function sanitizeAgentToolCalls(
  toolCalls: AgentSessionToolCallSnapshot[] | undefined,
): AgentSessionToolCallSnapshot[] | undefined {
  return toolCalls?.slice(0, 8).map((toolCall) => ({
    ...sanitizeAgentToolCallForPersistence(toolCall),
    name: sanitizeText(toolCall.name, 160),
  }));
}

function sanitizeAgentToolResults(
  toolResults: AgentSessionToolResultSnapshot[] | undefined,
): AgentSessionToolResultSnapshot[] | undefined {
  return toolResults?.slice(0, 8).map((toolResult) => ({
    ...sanitizeAgentToolResultForPersistence(toolResult),
    name: sanitizeText(toolResult.name, 160),
  }));
}

export const browserStateHub = new BrowserStateHub();

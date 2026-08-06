import { AsyncLocalStorage } from "node:async_hooks";
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
  AGENT_RUN_PHASES,
  AGENT_RUN_SCHEMA_VERSION,
  sanitizeAgentToolCallForPersistence,
  sanitizeAgentToolResultForPersistence,
  type AgentRunDiagnosticsSnapshot,
  type AgentRuntimeEnvironmentSnapshot,
  type AgentTurnSnapshot,
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
import {
  sanitizeMultilineText,
  sanitizeText,
  sanitizeUrl,
} from "../shared/sanitize";
import { createMessageId } from "../shared/messaging";
import { createResourceTargetKey } from "./resourceRouting";
import {
  BROWSER_ACTIVITY_EVENT_LIMITS,
  BROWSER_ACTIVITY_EVENT_LIMIT,
  BROWSER_ACTIVITY_STREAM_VERSION,
  sanitizeBrowserActivityEventInput,
  sanitizeBrowserActivityTarget,
  type BrowserActivityEvent,
  type BrowserActivityEventInput,
  type BrowserActivityKind,
  BROWSER_ACTIVITY_KINDS,
  type BrowserActivityStreamSnapshot,
} from "../shared/browserActivity";

export interface BrowserSession {
  sessionId: string;
  browserConnected: boolean;
  uiConnected: boolean;
  browserConnectedAt?: string;
  uiConnectedAt?: string;
  currentTab?: ActiveTabSnapshot;
  /**
   * Latest browser-authoritative target snapshot for each observed Tab.
   * `currentTab` is only the UI selection; tool tasks may stay pinned to a
   * different Tab while the user switches windows or conversations.
   */
  targetsByTabId: Map<number, ActiveTabSnapshot>;
  selectedElement?: DomElementInfo;
  domSnapshot?: string;
  pageContext?: PageSnapshot;
  consoleLogs: unknown[];
  networkRequests: unknown[];
  activityStreams: Map<number, BrowserActivityStreamState>;
  activityFallbackStream: BrowserActivityStreamState;
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
  activityStream: BrowserActivityStreamSnapshot;
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
  agentSessions?: AgentSessionSnapshot[];
  activityStreams?: PersistedBrowserActivityStreamState[];
  lastAgentConclusion?: BrowserSession["lastAgentConclusion"];
  createdAt: number;
  lastSeenAt: number;
  stateUpdatedAt: number;
  revision: number;
}

interface BrowserActivityStreamState {
  streamId: string;
  startedAt: string;
  active: boolean;
  target?: ActiveTabSnapshot;
  sequence: number;
  droppedEvents: number;
  eventCounts: Record<BrowserActivityKind, number>;
  events: BrowserActivityEvent[];
  updatedAt: number;
}

interface PersistedBrowserActivityStreamState {
  tabId: number;
  streamId: string;
  startedAt: string;
  target?: ActiveTabSnapshot;
  sequence: number;
  droppedEvents: number;
  events: BrowserActivityEvent[];
  updatedAt: number;
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
const MAX_PERSISTED_ACTIVITY_STREAMS = 8;
const MAX_TRACKED_TARGETS = 64;

export class BrowserStateHub {
  readonly sessions = new Map<string, BrowserSession>();
  private activeSessionId = DEFAULT_SESSION_ID;
  private readonly taskTargetContext = new AsyncLocalStorage<{
    sessionId: string;
    target: ActiveTabSnapshot;
  }>();
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

  targetSnapshot(
    sessionId: string,
    tabId: number | undefined,
  ): ActiveTabSnapshot | undefined {
    if (tabId === undefined) {
      return undefined;
    }
    const target = this.ensureSession(sessionId).targetsByTabId.get(tabId);
    return target ? structuredClone(target) : undefined;
  }

  runWithTaskTarget<T>(
    sessionId: string,
    target: ActiveTabSnapshot | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!target) {
      return operation();
    }
    return this.taskTargetContext.run(
      { sessionId, target: structuredClone(target) },
      operation,
    );
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
      content: sanitizeMultilineText(message.content, 6000),
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

  setActivityActive(
    active: boolean,
    sessionId?: string,
    target?: ActiveTabSnapshot,
  ): void {
    const session = this.markStateUpdated(sessionId);
    const normalizedTarget = target
      ? sanitizeBrowserActivityTarget(target)
      : session.currentTab
        ? sanitizeBrowserActivityTarget(session.currentTab)
        : undefined;
    const tabId = normalizedTarget?.tabId;
    if (tabId === undefined) {
      if (active) {
        session.activityFallbackStream = createActivityStreamState(
          session.stateUpdatedAt,
          normalizedTarget,
          true,
        );
      } else {
        session.activityFallbackStream.active = false;
        session.activityFallbackStream.updatedAt = session.stateUpdatedAt;
      }
      this.notifyPersistence();
      return;
    }
    if (active) {
      session.activityStreams.set(
        tabId,
        createActivityStreamState(session.stateUpdatedAt, normalizedTarget, true),
      );
      trimActivityStreams(session);
      this.notifyPersistence();
      return;
    }
    const stream = session.activityStreams.get(tabId);
    if (stream) {
      stream.active = false;
      stream.updatedAt = session.stateUpdatedAt;
      this.notifyPersistence();
    }
  }

  addBrowserActivityEvent(
    input: BrowserActivityEventInput,
    sessionId?: string,
  ): BrowserActivityEvent | undefined {
    const session = this.markStateUpdated(sessionId);
    const sanitized = sanitizeBrowserActivityEventInput(input);
    const tabId = sanitized.target?.tabId ?? session.currentTab?.tabId;
    const stream =
      tabId === undefined
        ? session.activityFallbackStream
        : session.activityStreams.get(tabId);
    if (!stream) {
      return undefined;
    }
    if (!stream.active && sanitized.summary.reason !== "monitoring-stopped") {
      return undefined;
    }
    stream.sequence += 1;
    const event: BrowserActivityEvent = {
      ...sanitized,
      observedAt: sanitized.observedAt ?? new Date(this.clock()).toISOString(),
      sequence: stream.sequence,
    };
    stream.events.push(event);
    stream.eventCounts[event.kind] += 1;
    stream.updatedAt = session.stateUpdatedAt;
    const kindLimit = BROWSER_ACTIVITY_EVENT_LIMITS[event.kind];
    if (stream.eventCounts[event.kind] > kindLimit) {
      const oldestKindIndex = stream.events.findIndex(
        (candidate) => candidate.kind === event.kind,
      );
      if (oldestKindIndex >= 0) {
        stream.events.splice(oldestKindIndex, 1);
        stream.eventCounts[event.kind] -= 1;
      }
      stream.droppedEvents += 1;
    }
    this.notifyPersistence();
    return structuredClone(event);
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
        content: sanitizeMultilineText(sanitized.finalContent, 12000),
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
        agentSessions: session.agentSessions
          .slice(-20)
          .map(sanitizeAgentSession),
        activityStreams: [...session.activityStreams.entries()]
          .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
          .slice(0, MAX_PERSISTED_ACTIVITY_STREAMS)
          .map(([tabId, stream]) => ({
            tabId,
            streamId: stream.streamId,
            startedAt: stream.startedAt,
            target: stream.target,
            sequence: stream.sequence,
            droppedEvents: stream.droppedEvents,
            events: structuredClone(stream.events),
            updatedAt: stream.updatedAt,
          })),
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
      const recoveredAgentSessions = (persisted.agentSessions ?? []).map(
        (agentSession) =>
          recoverPersistedAgentSession(
            agentSession,
            new Date(this.clock()).toISOString(),
          ),
      );
      const session: BrowserSession = {
        sessionId: persisted.sessionId,
        browserConnected: false,
        uiConnected: false,
        currentTab: persisted.currentTab
          ? sanitizeActiveTabForMcp(persisted.currentTab)
          : undefined,
        targetsByTabId: new Map(),
        selectedElement: persisted.selectedElement
          ? sanitizeElementForMcp(persisted.selectedElement)
          : undefined,
        domSnapshot: pageContext?.visibleText,
        pageContext,
        consoleLogs: [],
        networkRequests: [],
        activityStreams: restoreActivityStreams(persisted.activityStreams),
        activityFallbackStream: createActivityStreamState(this.clock()),
        screenshots,
        lastScreenshot: screenshots.at(-1),
        pluginConversation,
        currentConversationId: persisted.currentConversationId,
        collaborationWorkspace: sanitizeCollaborationWorkspace(
          persisted.collaborationWorkspace,
        ),
        lastPluginMessage: pluginConversation.at(-1),
        agentSessions: recoveredAgentSessions,
        activeAgentSession: undefined,
        lastAgentConclusion: persisted.lastAgentConclusion
          ? {
              ...persisted.lastAgentConclusion,
              content: sanitizeMultilineText(
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
      if (session.currentTab?.tabId !== undefined) {
        session.targetsByTabId.set(
          session.currentTab.tabId,
          structuredClone(session.currentTab),
        );
      }
      this.sessions.set(session.sessionId, session);
    }
    this.ensureSession(DEFAULT_SESSION_ID);
    this.activeSessionId = this.sessions.has(restored.activeSessionId)
      ? restored.activeSessionId
      : DEFAULT_SESSION_ID;
  }

  snapshot(sessionId = this.activeSessionId): BrowserStateSnapshot {
    const session = this.ensureSession(sessionId);
    const taskTargetContext = this.taskTargetContext.getStore();
    const taskTarget =
      taskTargetContext?.sessionId === session.sessionId
        ? taskTargetContext.target.tabId !== undefined
          ? session.targetsByTabId.get(taskTargetContext.target.tabId) ??
            taskTargetContext.target
          : taskTargetContext.target
        : undefined;
    const effectiveCurrentTab = taskTarget ?? session.currentTab;
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
      activeTab: effectiveCurrentTab,
      currentTab: effectiveCurrentTab,
      selectedElement: session.selectedElement,
      domSnapshot: session.domSnapshot,
      pageContext: session.pageContext,
      consoleLogs: session.consoleLogs,
      networkRequests: session.networkRequests,
      activityStream: this.activityStreamSnapshot(
        session,
        effectiveCurrentTab?.tabId,
      ),
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

  activityStreamPayload(
    sessionId?: string,
    tabId?: number,
  ): BrowserActivityStreamSnapshot {
    return this.activityStreamSnapshot(this.ensureSession(sessionId), tabId);
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
      targetsByTabId: new Map(),
      consoleLogs: [],
      networkRequests: [],
      activityStreams: new Map(),
      activityFallbackStream: createActivityStreamState(now),
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

  private activityStreamSnapshot(
    session: BrowserSession,
    preferredTabId?: number,
  ): BrowserActivityStreamSnapshot {
    const selectedTabId = preferredTabId ?? session.currentTab?.tabId;
    const selectedTabStream =
      selectedTabId === undefined
        ? undefined
        : session.activityStreams.get(selectedTabId);
    const stream =
      selectedTabStream ??
      [...session.activityStreams.values()].sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          right.updatedAt - left.updatedAt,
      )[0] ??
      session.activityFallbackStream;
    const first = stream.events[0];
    const last = stream.events.at(-1);
    return {
      version: BROWSER_ACTIVITY_STREAM_VERSION,
      sessionId: session.sessionId,
      streamId: stream.streamId,
      startedAt: stream.startedAt,
      active: stream.active,
      target: stream.target ?? null,
      latestSequence: stream.sequence,
      retainedFromSequence: first?.sequence ?? null,
      retainedToSequence: last?.sequence ?? null,
      droppedEvents: stream.droppedEvents,
      retentionLimits: { ...BROWSER_ACTIVITY_EVENT_LIMITS },
      events: structuredClone(stream.events),
      updatedAt: new Date(stream.updatedAt).toISOString(),
    };
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
    if (session.currentTab.tabId !== undefined) {
      session.targetsByTabId.delete(session.currentTab.tabId);
      session.targetsByTabId.set(
        session.currentTab.tabId,
        structuredClone(session.currentTab),
      );
      while (session.targetsByTabId.size > MAX_TRACKED_TARGETS) {
        const oldestTabId = session.targetsByTabId.keys().next().value;
        if (oldestTabId === undefined) {
          break;
        }
        session.targetsByTabId.delete(oldestTabId);
      }
    }
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

function createActivityStreamId(): string {
  return `activity-${createMessageId()}`;
}

function createActivityStreamState(
  now: number,
  target?: ActiveTabSnapshot,
  active = false,
): BrowserActivityStreamState {
  return {
    streamId: createActivityStreamId(),
    startedAt: new Date(now).toISOString(),
    active,
    target,
    sequence: 0,
    droppedEvents: 0,
    eventCounts: emptyActivityEventCounts(),
    events: [],
    updatedAt: now,
  };
}

function trimActivityStreams(session: BrowserSession): void {
  if (session.activityStreams.size <= MAX_PERSISTED_ACTIVITY_STREAMS) {
    return;
  }
  const removable = [...session.activityStreams.entries()]
    .filter(([, stream]) => !stream.active)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  while (
    session.activityStreams.size > MAX_PERSISTED_ACTIVITY_STREAMS &&
    removable.length > 0
  ) {
    const [tabId] = removable.shift()!;
    session.activityStreams.delete(tabId);
  }
}

function restoreActivityStreams(
  persisted: PersistedBrowserActivityStreamState[] | undefined,
): Map<number, BrowserActivityStreamState> {
  const streams = new Map<number, BrowserActivityStreamState>();
  for (const candidate of persisted ?? []) {
    const events = candidate.events.map((event) => {
      const sanitized = sanitizeBrowserActivityEventInput(event);
      return {
        ...sanitized,
        observedAt: sanitized.observedAt ?? event.observedAt,
        sequence: event.sequence,
      } satisfies BrowserActivityEvent;
    });
    const eventCounts = emptyActivityEventCounts();
    for (const event of events) {
      eventCounts[event.kind] += 1;
    }
    streams.set(candidate.tabId, {
      streamId: candidate.streamId,
      startedAt: candidate.startedAt,
      active: false,
      target: candidate.target
        ? sanitizeBrowserActivityTarget(candidate.target)
        : undefined,
      sequence: candidate.sequence,
      droppedEvents: candidate.droppedEvents,
      eventCounts,
      events,
      updatedAt: candidate.updatedAt,
    });
  }
  return streams;
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
    agentSessions: parsePersistedAgentSessions(value.agentSessions),
    activityStreams: parsePersistedActivityStreams(value.activityStreams),
    collaborationWorkspace:
      value.collaborationWorkspace === undefined
        ? createEmptyCollaborationWorkspace()
        : sanitizeCollaborationWorkspace(value.collaborationWorkspace),
    lastSeenAt,
    stateUpdatedAt,
  };
}

function parsePersistedAgentSessions(
  value: unknown,
): AgentSessionSnapshot[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.slice(-20).flatMap((candidate): AgentSessionSnapshot[] => {
    if (!isPersistedAgentSession(candidate)) {
      return [];
    }
    try {
      return [sanitizeAgentSession(candidate)];
    } catch {
      return [];
    }
  });
}

function isPersistedAgentSession(
  value: unknown,
): value is AgentSessionSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= 200 &&
    ["running", "completed", "blocked", "failed", "cancelled"].includes(
      String(value.status),
    ) &&
    typeof value.input === "string" &&
    typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    (value.completedAt === undefined ||
      (typeof value.completedAt === "string" &&
        Number.isFinite(Date.parse(value.completedAt)))) &&
    (value.finalContent === undefined ||
      typeof value.finalContent === "string") &&
    (value.assistantMessageId === undefined ||
      (typeof value.assistantMessageId === "string" &&
        value.assistantMessageId.length <= 200)) &&
    (value.visibleContent === undefined ||
      typeof value.visibleContent === "string") &&
    (value.executionOwner === undefined ||
      ["sidepanel", "extension_background", "daemon"].includes(
        String(value.executionOwner),
      )) &&
    (value.schemaVersion === undefined ||
      value.schemaVersion === AGENT_RUN_SCHEMA_VERSION) &&
    (value.phase === undefined ||
      AGENT_RUN_PHASES.includes(value.phase as (typeof AGENT_RUN_PHASES)[number])) &&
    (value.heartbeatAt === undefined ||
      (typeof value.heartbeatAt === "string" &&
        Number.isFinite(Date.parse(value.heartbeatAt)))) &&
    (value.diagnostics === undefined ||
      isPersistedAgentDiagnostics(value.diagnostics)) &&
    (value.runtimeEnvironment === undefined ||
      isPersistedRuntimeEnvironment(value.runtimeEnvironment)) &&
    (value.turns === undefined ||
      (Array.isArray(value.turns) &&
        value.turns.length <= 40 &&
        value.turns.every(isPersistedAgentTurn))) &&
    isRecord(value.taskState) &&
    Array.isArray(value.events) &&
    value.events.length <= 80 &&
    value.events.every(isPersistedAgentSessionEvent) &&
    (value.executionBinding === undefined ||
      isPersistedAgentExecutionBinding(value.executionBinding))
  );
}

function isPersistedAgentExecutionBinding(value: unknown): boolean {
  const target =
    isRecord(value) && isRecord(value.target) ? value.target : undefined;
  return (
    isRecord(value) &&
    typeof value.taskId === "string" &&
    typeof value.conversationId === "string" &&
    target !== undefined &&
    Number.isSafeInteger(target.tabId) &&
    (target.tabId as number) >= 0 &&
    (target.windowId === undefined ||
      Number.isSafeInteger(target.windowId)) &&
    ["targetId", "title", "url"].every(
      (key) => target[key] === undefined || typeof target[key] === "string",
    )
  );
}

function isPersistedAgentSessionEvent(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    ![
      "started",
      "context",
      "phase",
      "heartbeat",
      "diagnostic",
      "compaction",
      "tool_calls",
      "tool_results",
      "completed",
      "blocked",
      "failed",
      "cancelled",
    ].includes(String(value.type)) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    typeof value.summary !== "string"
  ) {
    return false;
  }
  if (value.data === undefined) {
    return true;
  }
  if (!isRecord(value.data)) {
    return false;
  }
  return (
    (value.data.turnId === undefined || typeof value.data.turnId === "string") &&
    (value.data.phase === undefined ||
      AGENT_RUN_PHASES.includes(value.data.phase as (typeof AGENT_RUN_PHASES)[number])) &&
    (value.data.status === undefined || typeof value.data.status === "string") &&
    (value.data.providerStreamBytes === undefined ||
      (Number.isSafeInteger(value.data.providerStreamBytes) &&
        (value.data.providerStreamBytes as number) >= 0)) &&
    (value.data.errorCode === undefined || typeof value.data.errorCode === "string") &&
    (value.data.beforeTokens === undefined ||
      (Number.isSafeInteger(value.data.beforeTokens) &&
        (value.data.beforeTokens as number) >= 0)) &&
    (value.data.afterTokens === undefined ||
      (Number.isSafeInteger(value.data.afterTokens) &&
        (value.data.afterTokens as number) >= 0)) &&
    (value.data.reason === undefined || typeof value.data.reason === "string") &&
    (value.data.contextReadError === undefined ||
      typeof value.data.contextReadError === "string") &&
    (value.data.toolCalls === undefined ||
      (Array.isArray(value.data.toolCalls) &&
        value.data.toolCalls.every(
          (toolCall) =>
            isRecord(toolCall) &&
            typeof toolCall.id === "string" &&
            typeof toolCall.name === "string" &&
            isRecord(toolCall.arguments),
        ))) &&
    (value.data.toolResults === undefined ||
      (Array.isArray(value.data.toolResults) &&
        value.data.toolResults.every(
          (toolResult) =>
            isRecord(toolResult) &&
            typeof toolResult.toolCallId === "string" &&
            typeof toolResult.name === "string" &&
            typeof toolResult.content === "string",
        )))
  );
}

function isPersistedAgentDiagnostics(value: unknown): boolean {
  return (
    isRecord(value) &&
    AGENT_RUN_PHASES.includes(value.phase as (typeof AGENT_RUN_PHASES)[number]) &&
    ["phaseStartedAt", "lastHeartbeatAt", "lastProgressAt"].every(
      (key) => typeof value[key] === "string" && Number.isFinite(Date.parse(value[key] as string)),
    ) &&
    ["modelRequestCount", "toolCallCount", "completedToolCallCount"].every(
      (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
    )
  );
}

function isPersistedAgentTurn(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Number.isSafeInteger(value.index) &&
    (value.index as number) >= 1 &&
    AGENT_RUN_PHASES.includes(value.phase as (typeof AGENT_RUN_PHASES)[number]) &&
    ["running", "completed", "failed", "cancelled"].includes(String(value.status)) &&
    typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    Array.isArray(value.toolCalls) &&
    value.toolCalls.length <= 16 &&
    value.toolCalls.every(
      (toolCall) =>
        isRecord(toolCall) &&
        typeof toolCall.id === "string" &&
        typeof toolCall.name === "string" &&
        isRecord(toolCall.arguments) &&
        ["requested", "running", "returned", "failed", "cancelled"].includes(
          String(toolCall.status),
        ),
    )
  );
}

function isPersistedRuntimeEnvironment(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.capturedAt === "string" &&
    Number.isFinite(Date.parse(value.capturedAt)) &&
    typeof value.runtimeBuildId === "string" &&
    typeof value.model === "string" &&
    typeof value.providerOrigin === "string" &&
    Number.isSafeInteger(value.contextWindowTokens) &&
    Number.isSafeInteger(value.maxOutputTokens) &&
    ["browser", "mixed", "external_only"].includes(String(value.toolScope)) &&
    Array.isArray(value.enabledToolNames) &&
    value.enabledToolNames.every((item) => typeof item === "string") &&
    Array.isArray(value.externalMcpServerIds) &&
    value.externalMcpServerIds.every((item) => typeof item === "string") &&
    ["approval_required", "tools_disabled"].includes(String(value.permissionMode))
  );
}

function parsePersistedActivityStreams(
  value: unknown,
): PersistedBrowserActivityStreamState[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .slice(0, MAX_PERSISTED_ACTIVITY_STREAMS)
    .flatMap((candidate): PersistedBrowserActivityStreamState[] => {
      if (
        !isRecord(candidate) ||
        !Number.isSafeInteger(candidate.tabId) ||
        (candidate.tabId as number) < 0 ||
        typeof candidate.streamId !== "string" ||
        !candidate.streamId.startsWith("activity-") ||
        typeof candidate.startedAt !== "string" ||
        !Number.isFinite(Date.parse(candidate.startedAt)) ||
        !Number.isSafeInteger(candidate.sequence) ||
        (candidate.sequence as number) < 0 ||
        !Number.isSafeInteger(candidate.droppedEvents) ||
        (candidate.droppedEvents as number) < 0 ||
        !isSafeTimestamp(candidate.updatedAt) ||
        !Array.isArray(candidate.events) ||
        candidate.events.length > BROWSER_ACTIVITY_EVENT_LIMIT ||
        !candidate.events.every(isPersistedBrowserActivityEvent) ||
        (candidate.target !== undefined &&
          !isActiveTabSnapshot(candidate.target))
      ) {
        return [];
      }
      return [candidate as unknown as PersistedBrowserActivityStreamState];
    });
}

function isPersistedBrowserActivityEvent(
  value: unknown,
): value is BrowserActivityEvent {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    BROWSER_ACTIVITY_KINDS.includes(
      String(value.kind) as BrowserActivityKind,
    ) &&
    typeof value.observedAt === "string" &&
    isRecord(value.summary)
  );
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
    content: sanitizeMultilineText(message.content, 6000),
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

function emptyActivityEventCounts(): Record<BrowserActivityKind, number> {
  return {
    dom: 0,
    network: 0,
    console: 0,
    navigation: 0,
    style: 0,
    visual: 0,
    storage: 0,
    realtime: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeAgentSession(
  session: AgentSessionSnapshot,
): AgentSessionSnapshot {
  return {
    ...session,
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    id: sanitizeText(session.id, 200),
    assistantMessageId: session.assistantMessageId
      ? sanitizeText(session.assistantMessageId, 200)
      : undefined,
    input: sanitizeMultilineText(session.input, 4000),
    finalContent: session.finalContent
      ? sanitizeMultilineText(session.finalContent, 12000)
      : undefined,
    visibleContent: session.visibleContent
      ? sanitizeMultilineText(session.visibleContent, 12000)
      : undefined,
    executionBinding: session.executionBinding
      ? {
          taskId: sanitizeText(session.executionBinding.taskId, 200),
          conversationId: sanitizeText(
            session.executionBinding.conversationId,
            200,
          ),
          target: {
            tabId: session.executionBinding.target.tabId,
            windowId: session.executionBinding.target.windowId,
            targetId: session.executionBinding.target.targetId
              ? sanitizeText(session.executionBinding.target.targetId, 200)
              : undefined,
            title: session.executionBinding.target.title
              ? sanitizeText(session.executionBinding.target.title, 500)
              : undefined,
            url: session.executionBinding.target.url
              ? sanitizeUrl(session.executionBinding.target.url)
              : undefined,
          },
        }
      : undefined,
    phase:
      session.phase && AGENT_RUN_PHASES.includes(session.phase)
        ? session.phase
        : session.status === "running"
          ? "starting"
          : session.status,
    heartbeatAt: sanitizeAgentTimestamp(
      session.heartbeatAt,
      session.updatedAt,
    ),
    diagnostics: session.diagnostics
      ? sanitizeAgentDiagnostics(session.diagnostics, session.updatedAt)
      : undefined,
    runtimeEnvironment: session.runtimeEnvironment
      ? sanitizeRuntimeEnvironment(session.runtimeEnvironment)
      : undefined,
    turns: session.turns?.slice(-40).map(sanitizeAgentTurn),
    taskState: sanitizeAgentTaskState(session.taskState),
    events: session.events.slice(-80).map((event) => ({
      ...event,
      id: sanitizeText(event.id, 200),
      sequence:
        Number.isSafeInteger(event.sequence) && (event.sequence ?? 0) >= 0
          ? event.sequence
          : undefined,
      summary: sanitizeText(event.summary, 1200),
      data: event.data
        ? {
            turnId: event.data.turnId
              ? sanitizeText(event.data.turnId, 200)
              : undefined,
            phase:
              event.data.phase && AGENT_RUN_PHASES.includes(event.data.phase)
                ? event.data.phase
                : undefined,
            status: event.data.status
              ? sanitizeText(event.data.status, 800)
              : undefined,
            providerStreamBytes: sanitizeNonNegativeInteger(
              event.data.providerStreamBytes,
            ),
            errorCode: event.data.errorCode
              ? sanitizeText(event.data.errorCode, 120)
              : undefined,
            beforeTokens: sanitizeNonNegativeInteger(event.data.beforeTokens),
            afterTokens: sanitizeNonNegativeInteger(event.data.afterTokens),
            reason: event.data.reason
              ? sanitizeText(event.data.reason, 800)
              : undefined,
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

function sanitizeAgentDiagnostics(
  diagnostics: AgentRunDiagnosticsSnapshot,
  fallbackTimestamp: string,
): AgentRunDiagnosticsSnapshot {
  return {
    phase: AGENT_RUN_PHASES.includes(diagnostics.phase)
      ? diagnostics.phase
      : "starting",
    phaseStartedAt: sanitizeAgentTimestamp(
      diagnostics.phaseStartedAt,
      fallbackTimestamp,
    ),
    lastHeartbeatAt: sanitizeAgentTimestamp(
      diagnostics.lastHeartbeatAt,
      fallbackTimestamp,
    ),
    lastProgressAt: sanitizeAgentTimestamp(
      diagnostics.lastProgressAt,
      fallbackTimestamp,
    ),
    lastStatus: diagnostics.lastStatus
      ? sanitizeText(diagnostics.lastStatus, 800)
      : undefined,
    modelRequestCount: sanitizeNonNegativeInteger(diagnostics.modelRequestCount) ?? 0,
    toolCallCount: sanitizeNonNegativeInteger(diagnostics.toolCallCount) ?? 0,
    completedToolCallCount:
      sanitizeNonNegativeInteger(diagnostics.completedToolCallCount) ?? 0,
    providerStreamBytes: sanitizeNonNegativeInteger(
      diagnostics.providerStreamBytes,
    ),
    stalledSince: diagnostics.stalledSince
      ? sanitizeAgentTimestamp(diagnostics.stalledSince, fallbackTimestamp)
      : undefined,
    lastErrorCode: diagnostics.lastErrorCode
      ? sanitizeText(diagnostics.lastErrorCode, 120)
      : undefined,
    lastErrorSummary: diagnostics.lastErrorSummary
      ? sanitizeText(diagnostics.lastErrorSummary, 1200)
      : undefined,
  };
}

function sanitizeRuntimeEnvironment(
  environment: AgentRuntimeEnvironmentSnapshot,
): AgentRuntimeEnvironmentSnapshot {
  return {
    capturedAt: sanitizeAgentTimestamp(
      environment.capturedAt,
      new Date(0).toISOString(),
    ),
    runtimeBuildId: sanitizeText(environment.runtimeBuildId, 160),
    model: sanitizeText(environment.model, 300),
    providerOrigin: sanitizeUrl(environment.providerOrigin),
    contextWindowTokens:
      sanitizeNonNegativeInteger(environment.contextWindowTokens) ?? 0,
    maxOutputTokens:
      sanitizeNonNegativeInteger(environment.maxOutputTokens) ?? 0,
    toolScope: ["browser", "mixed", "external_only"].includes(
      environment.toolScope,
    )
      ? environment.toolScope
      : "mixed",
    enabledToolNames: environment.enabledToolNames
      .slice(0, 200)
      .map((name) => sanitizeText(name, 200)),
    externalMcpServerIds: environment.externalMcpServerIds
      .slice(0, 40)
      .map((id) => sanitizeText(id, 80)),
    targetTabId: sanitizeNonNegativeInteger(environment.targetTabId),
    targetId: environment.targetId
      ? sanitizeText(environment.targetId, 200)
      : undefined,
    permissionMode:
      environment.permissionMode === "tools_disabled"
        ? "tools_disabled"
        : "approval_required",
  };
}

function sanitizeAgentTurn(turn: AgentTurnSnapshot): AgentTurnSnapshot {
  return {
    id: sanitizeText(turn.id, 200),
    index: Math.max(1, Math.floor(turn.index)),
    phase: AGENT_RUN_PHASES.includes(turn.phase) ? turn.phase : "starting",
    status: ["running", "completed", "failed", "cancelled"].includes(turn.status)
      ? turn.status
      : "failed",
    startedAt: sanitizeAgentTimestamp(turn.startedAt, new Date(0).toISOString()),
    updatedAt: sanitizeAgentTimestamp(turn.updatedAt, turn.startedAt),
    completedAt: turn.completedAt
      ? sanitizeAgentTimestamp(turn.completedAt, turn.updatedAt)
      : undefined,
    toolCalls: turn.toolCalls.slice(0, 16).map((toolCall) => ({
      ...sanitizeAgentToolCallForPersistence(toolCall),
      status: ["requested", "running", "returned", "failed", "cancelled"].includes(
        toolCall.status,
      )
        ? toolCall.status
        : "failed",
      requestedAt: sanitizeAgentTimestamp(toolCall.requestedAt, turn.startedAt),
      updatedAt: sanitizeAgentTimestamp(toolCall.updatedAt, turn.updatedAt),
      completedAt: toolCall.completedAt
        ? sanitizeAgentTimestamp(toolCall.completedAt, turn.updatedAt)
        : undefined,
      resultCharCount: sanitizeNonNegativeInteger(toolCall.resultCharCount),
      errorCode: toolCall.errorCode
        ? sanitizeText(toolCall.errorCode, 120)
        : undefined,
    })),
  };
}

function sanitizeAgentTimestamp(
  value: string | undefined,
  fallback: string,
): string {
  return value && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function sanitizeNonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : undefined;
}

function sanitizeAgentToolCalls(
  toolCalls: AgentSessionToolCallSnapshot[] | undefined,
): AgentSessionToolCallSnapshot[] | undefined {
  return toolCalls?.slice(0, 8).map((toolCall) => ({
    ...sanitizeAgentToolCallForPersistence(toolCall),
    name: sanitizeText(toolCall.name, 160),
  }));
}

function recoverPersistedAgentSession(
  session: AgentSessionSnapshot,
  recoveredAt: string,
): AgentSessionSnapshot {
  const sanitized = sanitizeAgentSession(session);
  if (sanitized.status !== "running") {
    return sanitized;
  }

  const recoveryMessage =
    "Daemon 重启前该 Agent 仍在运行，原执行环境已经结束。任务快照已保留；请回到对应对话，重新读取页面状态后决定继续或终止。";
  return sanitizeAgentSession({
    ...sanitized,
    status: "blocked",
    phase: "blocked",
    heartbeatAt: recoveredAt,
    updatedAt: recoveredAt,
    completedAt: recoveredAt,
    finalContent: recoveryMessage,
    taskState: {
      ...sanitized.taskState,
      revision: sanitized.taskState.revision + 1,
      phase: "blocked",
      activeAction: undefined,
      blockers: [...sanitized.taskState.blockers, recoveryMessage].slice(-20),
      updatedAt: recoveredAt,
    },
    diagnostics: sanitized.diagnostics
      ? {
          ...sanitized.diagnostics,
          phase: "blocked",
          phaseStartedAt: recoveredAt,
          lastHeartbeatAt: recoveredAt,
          stalledSince: undefined,
          lastErrorCode: "DAEMON_RESTART_RECOVERY",
          lastErrorSummary: recoveryMessage,
        }
      : undefined,
    events: [
      ...sanitized.events,
      {
        id: `daemon-recovery-${sanitizeText(sanitized.id, 160)}`,
        type: "blocked" as const,
        createdAt: recoveredAt,
        summary: recoveryMessage,
      },
    ].slice(-80),
  });
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

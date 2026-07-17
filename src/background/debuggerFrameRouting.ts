export interface CdpFrameTreeNode {
  frame: {
    id: string;
    url: string;
  };
  childFrames?: CdpFrameTreeNode[];
}

export interface NavigationFrameNode {
  frameId: number;
  parentFrameId: number;
  documentId: string;
  url: string;
  documentLifecycle?: string;
}

export interface DebuggerFrameRoute {
  cdpFrameId: string;
  frameId: number;
  documentId: string;
  url: string;
}

const MAX_ROUTABLE_FRAME_COUNT = 512;
const MAX_ROUTABLE_FRAME_DEPTH = 64;

export function createOopifAutoAttachParams(): {
  autoAttach: true;
  waitForDebuggerOnStart: false;
  flatten: true;
  filter: Array<{ type: "iframe"; exclude: false }>;
} {
  return {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [{ type: "iframe", exclude: false }],
  };
}

/**
 * Correlate Chrome's integer webNavigation frame IDs with CDP frame IDs.
 *
 * Chrome exposes no direct conversion between these two namespaces. We only
 * accept a route when the parent relationship and normalized URL identify one
 * child on both sides. Duplicate siblings or incomplete trees remain unmapped
 * so trusted input cannot be dispatched to a guessed renderer session.
 */
export function mapDebuggerFrameTree(
  cdpRoot: CdpFrameTreeNode,
  navigationFrames: readonly NavigationFrameNode[],
): Map<string, DebuggerFrameRoute> {
  const routes = new Map<string, DebuggerFrameRoute>();
  const activeFrames = navigationFrames.filter(
    (frame) =>
      frame.documentLifecycle === undefined ||
      frame.documentLifecycle === "active",
  );
  if (activeFrames.length > MAX_ROUTABLE_FRAME_COUNT) {
    return routes;
  }
  const navigationRoot = activeFrames.find((frame) => frame.frameId === 0);
  if (
    !navigationRoot ||
    normalizeFrameUrl(navigationRoot.url) !== normalizeFrameUrl(cdpRoot.frame.url)
  ) {
    return routes;
  }

  routes.set(cdpRoot.frame.id, toRoute(cdpRoot, navigationRoot));
  mapChildren(cdpRoot, navigationRoot, activeFrames, routes, 0);
  return routes;
}

export function requireDebuggerFrameRoute<T extends DebuggerFrameRoute>(
  routes: ReadonlyMap<number, T>,
  frameId: number,
  documentId?: string,
): T {
  const route = routes.get(frameId);
  if (!route) {
    throw new Error(
      "TRUSTED_INPUT_FRAME_UNSUPPORTED: the selected child frame has no unique Chrome 125+ OOPIF debugger session. Same-process frames, duplicate sibling URLs, and unavailable flat sessions fail closed; select frame 0 or choose a uniquely routable OOPIF.",
    );
  }
  if (documentId && route.documentId !== documentId) {
    throw new Error(
      "STALE_CONTEXT: the selected child-frame document changed before trusted input dispatch; refresh and select the frame again.",
    );
  }
  return route;
}

function mapChildren(
  cdpParent: CdpFrameTreeNode,
  navigationParent: NavigationFrameNode,
  navigationFrames: readonly NavigationFrameNode[],
  routes: Map<string, DebuggerFrameRoute>,
  depth: number,
): void {
  if (depth >= MAX_ROUTABLE_FRAME_DEPTH) {
    return;
  }
  const cdpChildren = cdpParent.childFrames ?? [];
  const navigationChildren = navigationFrames.filter(
    (frame) => frame.parentFrameId === navigationParent.frameId,
  );
  const cdpUrlCounts = countUrls(
    cdpChildren.map((child) => child.frame.url),
  );
  const navigationUrlCounts = countUrls(
    navigationChildren.map((child) => child.url),
  );

  for (const cdpChild of cdpChildren) {
    const url = normalizeFrameUrl(cdpChild.frame.url);
    if (cdpUrlCounts.get(url) !== 1 || navigationUrlCounts.get(url) !== 1) {
      continue;
    }
    const navigationChild = navigationChildren.find(
      (candidate) => normalizeFrameUrl(candidate.url) === url,
    );
    if (!navigationChild) {
      continue;
    }
    routes.set(cdpChild.frame.id, toRoute(cdpChild, navigationChild));
    mapChildren(cdpChild, navigationChild, navigationFrames, routes, depth + 1);
  }
}

function toRoute(
  cdpFrame: CdpFrameTreeNode,
  navigationFrame: NavigationFrameNode,
): DebuggerFrameRoute {
  return {
    cdpFrameId: cdpFrame.frame.id,
    frameId: navigationFrame.frameId,
    documentId: navigationFrame.documentId,
    url: navigationFrame.url,
  };
}

function countUrls(urls: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of urls) {
    const url = normalizeFrameUrl(value);
    counts.set(url, (counts.get(url) ?? 0) + 1);
  }
  return counts;
}

function normalizeFrameUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("#", 1)[0] ?? value;
  }
}

import assert from "node:assert/strict";
import test from "node:test";

test("activity monitoring owns independent Tab sessions and preserves a shared ordinary debugger", async () => {
  const tabs = new Map(
    Array.from({ length: 12 }, (_, index) => {
      const id = index + 1;
      return [
        id,
        {
          id,
          windowId: 1,
          active: id === 2,
          highlighted: id === 2,
          title: `Tab ${id}`,
          url: `https://tab-${id}.example.test/`,
        },
      ] as const;
    }),
  );
  const attached: number[] = [];
  const detached: number[] = [];
  const commands: Array<{ tabId: number; method: string }> = [];
  const debuggerEvents: Array<(...args: unknown[]) => void> = [];
  const debuggerDetaches: Array<(...args: unknown[]) => void> = [];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (_message: unknown, callback?: () => void) => callback?.(),
    },
    storage: {
      session: {
        get: (_key: string, callback: (items: object) => void) => callback({}),
        set: (_items: object, callback: () => void) => callback(),
      },
    },
    tabs: {
      get: (tabId: number, callback: (tab: object | undefined) => void) =>
        callback(tabs.get(tabId)),
      query: (
        query: { active?: boolean },
        callback: (result: object[]) => void,
      ) =>
        callback(
          [...tabs.values()].filter((tab) => !query.active || tab.active),
        ),
    },
    debugger: {
      attach: (
        target: { tabId?: number },
        _version: string,
        callback: () => void,
      ) => {
        attached.push(target.tabId ?? -1);
        callback();
      },
      detach: (target: { tabId?: number }, callback: () => void) => {
        detached.push(target.tabId ?? -1);
        callback();
      },
      getTargets: (callback: (targets: object[]) => void) =>
        callback(
          [...tabs.values()].map((tab) => ({
            id: `target-${tab.id}`,
            tabId: tab.id,
            type: "page",
            title: tab.title,
            url: tab.url,
            attached: attached.includes(tab.id),
          })),
        ),
      sendCommand: (
        target: { tabId?: number },
        method: string,
        _params: object,
        callback: (result: object) => void,
      ) => {
        commands.push({ tabId: target.tabId ?? -1, method });
        callback({});
      },
      onEvent: {
        addListener: (listener: (...args: unknown[]) => void) =>
          debuggerEvents.push(listener),
      },
      onDetach: {
        addListener: (listener: (...args: unknown[]) => void) =>
          debuggerDetaches.push(listener),
      },
    },
  };

  const {
    startActivityDebuggerForTab,
    startNetworkDebugger,
    stopActivityDebuggerForTab,
  } = await import("../src/background/debuggerAdapter");

  await startActivityDebuggerForTab(1, activityStartInput());
  await startActivityDebuggerForTab(2, activityStartInput());

  assert.deepEqual(attached, [1, 2]);
  assert.deepEqual(
    commands.filter((command) => command.method === "Network.enable"),
    [
      { tabId: 1, method: "Network.enable" },
      { tabId: 2, method: "Network.enable" },
    ],
  );
  assert.equal(debuggerEvents.length, 1);
  assert.equal(debuggerDetaches.length, 1);

  await stopActivityDebuggerForTab(1);
  assert.deepEqual(detached, [1]);
  assert.equal(
    commands.some(
      (command) => command.tabId === 1 && command.method === "Network.disable",
    ),
    true,
  );

  await startNetworkDebugger({ preserveLog: true, maxEntries: 40 });
  const detachCountBeforeSharedStop = detached.length;
  const sharedDisableCountBeforeStop = commands.filter(
    (command) => command.tabId === 2 && command.method === "Network.disable",
  ).length;

  await stopActivityDebuggerForTab(2);

  assert.equal(detached.length, detachCountBeforeSharedStop);
  assert.equal(
    commands.filter(
      (command) => command.tabId === 2 && command.method === "Network.disable",
    ).length,
    sharedDisableCountBeforeStop,
  );
});

test("activity monitoring fails closed after eight simultaneous Tabs", async () => {
  const { startActivityDebuggerForTab, stopActivityDebuggerForTab } =
    await import("../src/background/debuggerAdapter");

  for (let tabId = 3; tabId <= 10; tabId += 1) {
    await startActivityDebuggerForTab(tabId, activityStartInput());
  }
  await assert.rejects(
    startActivityDebuggerForTab(11, activityStartInput()),
    /ACTIVITY_MONITOR_LIMIT/,
  );
  for (let tabId = 3; tabId <= 10; tabId += 1) {
    await stopActivityDebuggerForTab(tabId);
  }
});

function activityStartInput() {
  return {
    includeNetwork: true,
    includeConsole: false,
    preserveLog: false,
    maxNetworkEntries: 40,
  };
}

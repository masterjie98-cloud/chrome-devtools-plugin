import assert from "node:assert/strict";
import test from "node:test";

test("target preflight enables Page before current native dialog handling without OOPIF auto-attach", async () => {
  const commands: Array<{
    tabId: number;
    method: string;
    params: Record<string, unknown>;
  }> = [];
  let detachListener:
    | ((source: { tabId?: number }, reason: string) => void)
    | undefined;
  const tab = {
    id: 41,
    windowId: 7,
    active: true,
    highlighted: true,
    title: "Dialog fixture",
    url: "https://dialog.example.test/",
  };

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
      get: (tabId: number, callback: (value: object | undefined) => void) =>
        callback(tabId === tab.id ? tab : undefined),
      query: (_query: object, callback: (value: object[]) => void) =>
        callback([tab]),
    },
    debugger: {
      attach: (
        _target: { tabId?: number },
        _version: string,
        callback: () => void,
      ) => callback(),
      detach: (_target: { tabId?: number }, callback: () => void) => callback(),
      getTargets: (callback: (targets: object[]) => void) =>
        callback([
          {
            id: "dialog-target",
            tabId: tab.id,
            type: "page",
            title: tab.title,
            url: tab.url,
            attached: false,
          },
        ]),
      sendCommand: (
        target: { tabId?: number },
        method: string,
        params: Record<string, unknown>,
        callback: (result: object) => void,
      ) => {
        commands.push({ tabId: target.tabId ?? -1, method, params });
        callback({});
      },
      onEvent: {
        addListener: (_listener: (...args: unknown[]) => void) => undefined,
      },
      onDetach: {
        addListener: (
          listener: (source: { tabId?: number }, reason: string) => void,
        ) => {
          detachListener = listener;
        },
      },
    },
  };

  const {
    handleCurrentJavaScriptDialog,
    prepareJavaScriptDialogHandling,
  } = await import(
    "../src/background/debuggerAdapter"
  );

  await prepareJavaScriptDialogHandling(tab.id);
  assert.deepEqual(
    await handleCurrentJavaScriptDialog({ action: "dismiss" }, tab.id),
    {
      handled: true,
      action: "dismiss",
    },
  );
  assert.deepEqual(commands, [
    {
      tabId: tab.id,
      method: "Page.enable",
      params: {},
    },
    {
      tabId: tab.id,
      method: "Page.handleJavaScriptDialog",
      params: { accept: false },
    },
  ]);

  detachListener?.({ tabId: tab.id }, "target_closed");
  const commandCountAfterDetach = commands.length;
  await assert.rejects(
    handleCurrentJavaScriptDialog({ action: "dismiss" }, tab.id),
    /DIALOG_SESSION_NOT_ARMED/,
  );
  assert.equal(commands.length, commandCountAfterDetach);
});

import Alert from "antd/es/alert";
import Button from "antd/es/button";
import Space from "antd/es/space";
import Typography from "antd/es/typography";
import { useCallback, useEffect, useState } from "react";
import {
  acknowledgeUpdateNotice,
  fetchUpdateNotice,
  getRunningExtensionVersion,
  shouldPromptExtensionReload,
  type UpdateNotice,
} from "../../shared/updateNotice";
import type { LocalUpdateCheckResultPayload } from "../../shared/wsProtocol";
import { mcpBridge } from "../services/mcpBridge";

/** Check the configured git/Release update channel on open and every 6 hours. */
const REMOTE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Poll disk notice for post-update reload prompt (local file only, not GitHub). */
const NOTICE_POLL_MS = 5 * 60_000;

export function useLocalUpdateStatus() {
  const runningVersion = getRunningExtensionVersion();
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [notice, setNotice] = useState<UpdateNotice | null>(null);
  const [promptReload, setPromptReload] = useState(false);
  const [updateCheck, setUpdateCheck] =
    useState<LocalUpdateCheckResultPayload | null>(null);
  const [updating, setUpdating] = useState(false);

  const refreshNotice = useCallback(async () => {
    const next = await fetchUpdateNotice();
    setNotice(next);
    setPromptReload(await shouldPromptExtensionReload(next));
  }, []);

  const checkRemote = useCallback(async () => {
    const connected = mcpBridge.isConnected();
    setDaemonConnected(connected);
    if (!connected) {
      return;
    }
    try {
      setUpdateCheck(await mcpBridge.checkLocalUpdate());
    } catch {
      // ignore transient disconnects
    }
  }, []);

  useEffect(() => {
    void refreshNotice();
    void checkRemote();
    const noticeTimer = window.setInterval(() => {
      void refreshNotice();
      setDaemonConnected(mcpBridge.isConnected());
    }, NOTICE_POLL_MS);
    const remoteTimer = window.setInterval(() => {
      void checkRemote();
    }, REMOTE_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(noticeTimer);
      window.clearInterval(remoteTimer);
    };
  }, [refreshNotice, checkRemote]);

  const runDaemonUpdate = async () => {
    setUpdating(true);
    try {
      const result = await mcpBridge.runLocalUpdate();
      if (result.ok) {
        await refreshNotice();
        setPromptReload(true);
      }
      return result;
    } finally {
      setUpdating(false);
    }
  };

  const reloadExtension = async () => {
    if (!notice) {
      chrome.runtime.reload();
      return;
    }
    await acknowledgeUpdateNotice(notice);
    chrome.runtime.reload();
  };

  const dismissReloadPrompt = async () => {
    if (notice) {
      await acknowledgeUpdateNotice(notice);
    }
    setPromptReload(false);
  };

  return {
    runningVersion,
    daemonConnected,
    updateAvailable: Boolean(updateCheck?.ok && updateCheck.updateAvailable),
    autoUpdateSupported: updateCheck?.autoUpdateSupported !== false,
    updateMessage: updateCheck?.message,
    latestVersion:
      updateCheck?.latestReleaseVersion ||
      notice?.version ||
      runningVersion,
    promptReload,
    notice,
    updating,
    runDaemonUpdate,
    reloadExtension,
    dismissReloadPrompt,
  };
}

type LocalUpdateStatus = ReturnType<typeof useLocalUpdateStatus>;

/** Only renders when there is something actionable (update or reload). */
export function LocalUpdateAlert({ status }: { status: LocalUpdateStatus }) {
  const {
    runningVersion,
    daemonConnected,
    updateAvailable,
    autoUpdateSupported,
    updateMessage,
    promptReload,
    notice,
    updating,
    runDaemonUpdate,
    reloadExtension,
    dismissReloadPrompt,
  } = status;

  if (!updateAvailable && !promptReload) {
    return null;
  }

  return (
    <div className="local-update-alert-wrap">
      {daemonConnected && updateAvailable ? (
        <Alert
          type="warning"
          showIcon
          message={`发现更新（当前 v${runningVersion}）`}
          description={updateMessage}
          action={
            <Button
              type="primary"
              size="small"
              loading={updating}
              disabled={!autoUpdateSupported}
              onClick={() => void runDaemonUpdate()}
            >
              {autoUpdateSupported ? "由 Daemon 更新" : "Release 缺少更新包"}
            </Button>
          }
        />
      ) : null}
      {promptReload && notice ? (
        <Alert
          type="warning"
          showIcon
          message="代码已更新，请重载扩展"
          description={`磁盘 v${notice.version} 已就绪，当前运行仍是 v${runningVersion}。`}
          action={
            <Space size={6}>
              <Button
                type="primary"
                size="small"
                onClick={() => void reloadExtension()}
              >
                重载扩展
              </Button>
              <Button size="small" onClick={() => void dismissReloadPrompt()}>
                关闭
              </Button>
            </Space>
          }
        />
      ) : null}
      {!daemonConnected && updateAvailable ? (
        <Alert
          type="info"
          showIcon
          message="有更新可用，但 Daemon 未连接"
          description={
            <Typography.Text>
              请先启动已安装的 Daemon，再由侧栏自动下载并安装 Release ZIP；如果本机
              还没有安装 Daemon，请先手动下载最新 Release ZIP。
            </Typography.Text>
          }
        />
      ) : null}
    </div>
  );
}

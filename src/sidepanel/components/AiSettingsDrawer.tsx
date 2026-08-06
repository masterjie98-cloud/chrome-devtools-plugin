import Alert from "antd/es/alert";
import AntApp from "antd/es/app";
import AutoComplete from "antd/es/auto-complete";
import Button from "antd/es/button";
import Divider from "antd/es/divider";
import Drawer from "antd/es/drawer";
import Form from "antd/es/form";
import Input from "antd/es/input";
import InputNumber from "antd/es/input-number";
import Popconfirm from "antd/es/popconfirm";
import Select from "antd/es/select";
import Space from "antd/es/space";
import Switch from "antd/es/switch";
import Tag from "antd/es/tag";
import Tabs from "antd/es/tabs";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import { useEffect, useState } from "react";
import type { AiConfig, AiProfile, AiProfilesState } from "../services/aiConfig";
import {
  addAiModelsToState,
  applyAiModelCapabilities,
  DEFAULT_AI_CONFIG,
  MAX_TOOL_ROUNDS,
  getActiveConfig,
} from "../services/aiConfig";
import { detectAiCapabilities } from "../services/aiClient";
import {
  getBridgeToken,
  saveBridgeToken,
} from "../../shared/bridgeCredentials";
import { getInstallationId } from "../../shared/extensionIdentity";
import {
  acknowledgeUpdateNotice,
  fetchUpdateNotice,
  getRunningExtensionVersion,
  shouldPromptExtensionReload,
  type UpdateNotice,
} from "../../shared/updateNotice";
import type {
  LocalServiceStatusResultPayload,
  LocalUpdateCheckResultPayload,
} from "../../shared/wsProtocol";
import {
  getAiProviderOrigin,
  hasAiProviderOriginChanged,
  validateAiProviderUrl,
} from "../services/aiEndpointPolicy";
import {
  fetchAiModelCatalog,
  type AiModelCatalogResult,
} from "../services/aiModelCatalog";
import { mcpBridge } from "../services/mcpBridge";
import type { ExternalMcpServerSummary } from "../../shared/externalMcp";
import { McpSettingsSection } from "./McpSettingsSection";

interface AiSettingsDrawerProps {
  open: boolean;
  initialTab: AiSettingsTab;
  profilesState: AiProfilesState;
  bridgeConnected: boolean;
  activeTargetLabel?: string;
  pageContextSynced: boolean;
  onClose: () => void;
  onSave: (state: AiProfilesState) => Promise<void>;
  onMcpServersChange?: (servers: ExternalMcpServerSummary[]) => void;
}

export type AiSettingsTab = "model" | "mcp" | "page" | "local";

function generateId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

type ConfigFormValues = AiConfig;

export function AiSettingsDrawer({
  open,
  initialTab,
  profilesState,
  bridgeConnected,
  activeTargetLabel,
  pageContextSynced,
  onClose,
  onSave,
  onMcpServersChange,
}: AiSettingsDrawerProps) {
  const [form] = Form.useForm<ConfigFormValues>();
  const { modal, message } = AntApp.useApp();
  const supportsVision = Boolean(
    Form.useWatch("supportsVision", { form, preserve: true }),
  );
  const apiUrl = String(
    Form.useWatch("apiUrl", { form, preserve: true }) ?? "",
  );
  const providerOrigin = getAiProviderOrigin(apiUrl) ?? "当前 AI Provider";
  const supportsWebSearch = Boolean(
    Form.useWatch("supportsWebSearch", { form, preserve: true }),
  );
  const capabilityDetection = Form.useWatch("capabilityDetection", {
    form,
    preserve: true,
  });

  // Local copy of profiles so edits don't commit until Save
  const [localState, setLocalState] = useState<AiProfilesState>(profilesState);
  const [detecting, setDetecting] = useState(false);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalog, setModelCatalog] =
    useState<AiModelCatalogResult | null>(null);
  const [selectedCatalogModels, setSelectedCatalogModels] = useState<string[]>(
    [],
  );
  const [bridgeToken, setBridgeToken] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [savingBridge, setSavingBridge] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);
  const [promptReload, setPromptReload] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [runningUpdate, setRunningUpdate] = useState(false);
  const [updateCheck, setUpdateCheck] =
    useState<LocalUpdateCheckResultPayload | null>(null);
  const [localService, setLocalService] =
    useState<LocalServiceStatusResultPayload | null>(null);
  const [localServiceLoading, setLocalServiceLoading] = useState(false);
  const [localServiceSaving, setLocalServiceSaving] = useState(false);
  const [settingsTab, setSettingsTab] = useState<AiSettingsTab>(initialTab);
  const runningVersion = getRunningExtensionVersion();
  const latestVersion =
    updateCheck?.latestReleaseVersion || updateNotice?.version || runningVersion;
  const daemonConnected = bridgeConnected || mcpBridge.isConnected();

  const refreshLocalServiceStatus = async () => {
    if (!mcpBridge.isConnected()) {
      setLocalService(null);
      return null;
    }
    setLocalServiceLoading(true);
    try {
      const status = await mcpBridge.getLocalServiceStatus();
      setLocalService(status);
      return status;
    } catch {
      setLocalService(null);
      return null;
    } finally {
      setLocalServiceLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSubmitError(undefined);
      setLocalState(profilesState);
      void getBridgeToken().then(setBridgeToken);
      void getInstallationId().then(setInstallationId);
      void (async () => {
        const notice = await fetchUpdateNotice();
        setUpdateNotice(notice);
        setPromptReload(await shouldPromptExtensionReload(notice));
      })();
      void refreshLocalServiceStatus();
    }
  }, [open, profilesState, daemonConnected]);

  const refreshDiskNotice = async () => {
    const notice = await fetchUpdateNotice();
    setUpdateNotice(notice);
    setPromptReload(await shouldPromptExtensionReload(notice));
    return notice;
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await refreshDiskNotice();
      if (!daemonConnected) {
        message.info(
          "Daemon 未连接：请先启动已安装的 Daemon；尚未安装的用户需先手动下载 Release ZIP。",
        );
        return;
      }
      const result = await mcpBridge.checkLocalUpdate();
      setUpdateCheck(result);
      if (!result.ok) {
        message.error(result.error || "检查更新失败。");
        return;
      }
      if (result.updateAvailable) {
        if (result.autoUpdateSupported === false) {
          message.error(result.message || "发现新版本，但 Release 缺少安全更新资产。");
        } else {
          message.warning(result.message || "发现可用更新。");
        }
      } else {
        message.success(result.message || "已是最新。");
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "检查更新失败。");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const runDaemonUpdate = async () => {
    if (!daemonConnected) {
      message.warning("请先启动并连接 daemon；尚未安装时请先下载 Release ZIP。");
      return;
    }
    setRunningUpdate(true);
    try {
      const result = await mcpBridge.runLocalUpdate();
      if (!result.ok) {
        message.error(result.error || "Daemon 更新失败。");
        return;
      }
      await refreshDiskNotice();
      setPromptReload(true);
      message.success(
        `更新完成 ${result.currentVersion ?? ""} → ${result.newVersion ?? ""}。请重载扩展；daemon 即将重启。`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Daemon 更新失败。");
    } finally {
      setRunningUpdate(false);
    }
  };

  const activeProfile = localState.profiles.find(
    (p) => p.id === localState.activeProfileId,
  );

  // When active profile changes, sync form
  useEffect(() => {
    if (activeProfile) {
      form.setFieldsValue(activeProfile.config);
    }
  }, [activeProfile, form]);

  useEffect(() => {
    setModelCatalog(null);
    setSelectedCatalogModels([]);
  }, [apiUrl, localState.activeProfileId]);

  const loadModelCatalog = async () => {
    setSubmitError(undefined);
    setModelCatalogLoading(true);
    try {
      await form.validateFields(["apiUrl"]);
      const values = form.getFieldsValue(["apiUrl", "apiKey"]);
      const nextApiUrl = String(values.apiUrl ?? "").trim();
      const apiKey = String(values.apiKey ?? "").trim();
      if (
        apiKey &&
        activeProfile &&
        hasAiProviderOriginChanged(activeProfile.config.apiUrl, nextApiUrl) &&
        !(await confirmModelCatalogRequest(
          modal,
          activeProfile.config.apiUrl,
          nextApiUrl,
        ))
      ) {
        return;
      }
      const result = await fetchAiModelCatalog({ apiUrl: nextApiUrl, apiKey });
      setModelCatalog(result);
      message.success(`已获取 ${result.models.length} 个模型。`);
    } catch (error) {
      setModelCatalog(null);
      setSubmitError(
        error instanceof Error ? error.message : "获取模型列表失败。",
      );
    } finally {
      setModelCatalogLoading(false);
    }
  };

  const switchProfile = (id: string) => {
    // Persist current form edits before switching
    const values = form.getFieldsValue(true);
    const updated = syncFormToState(localState, values);
    setLocalState({ ...updated, activeProfileId: id });
  };

  const addModel = () => {
    const values = form.getFieldsValue(true);
    const updated = syncFormToState(localState, values);
    const sourceConfig = getActiveConfig(updated);
    const newProfile: AiProfile = {
      id: generateId(),
      name: "新模型",
      config: {
        ...sourceConfig,
        model: "",
        supportsVision: false,
        supportsWebSearch: false,
        includeImageHistory: false,
        enableWebSearch: false,
        capabilityDetection: {},
      },
    };
    setLocalState({
      profiles: [...updated.profiles, newProfile],
      activeProfileId: newProfile.id,
    });
  };

  const addSelectedCatalogModels = () => {
    const values = form.getFieldsValue(true);
    const updated = syncFormToState(localState, values);
    const result = addAiModelsToState(
      updated,
      selectedCatalogModels,
      getActiveConfig(updated),
    );
    if (result.addedProfileIds.length === 0) {
      message.info("所选模型已全部添加。");
      return;
    }
    setLocalState(result.state);
    setSelectedCatalogModels([]);
    message.success(`已添加 ${result.addedProfileIds.length} 个模型。`);
  };

  const deleteModel = () => {
    if (localState.profiles.length <= 1) return;
    const remaining = localState.profiles.filter(
      (p) => p.id !== localState.activeProfileId,
    );
    setLocalState({
      profiles: remaining,
      activeProfileId: remaining[remaining.length - 1]!.id,
    });
  };

  const submit = async () => {
    setDetecting(true);
    setSubmitError(undefined);
    try {
      await form.validateFields();
      await saveBridgeToken(bridgeToken);
      const values = form.getFieldsValue(true);
      const syncedState = syncFormToState(localState, values);
      const activeConfig = getActiveConfig(syncedState);
      const previousProfile = profilesState.profiles.find(
        (profile) => profile.id === syncedState.activeProfileId,
      );
      const providerOriginChanged = Boolean(
        previousProfile &&
          hasAiProviderOriginChanged(
            previousProfile.config.apiUrl,
            activeConfig.apiUrl,
          ),
      );
      const sendsApiKeyToNewOrigin = Boolean(
        activeConfig.apiKey && previousProfile?.config.apiKey,
      );
      let fastAgentEgressConfirmed = false;
      if (
        providerOriginChanged &&
        (sendsApiKeyToNewOrigin || activeConfig.fastAgentMode) &&
        !(await confirmProviderOriginChange(
          modal,
          previousProfile!.config.apiUrl,
          activeConfig.apiUrl,
          {
            sendsApiKey: sendsApiKeyToNewOrigin,
            sendsFastAgentScreenshot: activeConfig.fastAgentMode,
          },
        ))
      ) {
        return;
      }
      fastAgentEgressConfirmed =
        providerOriginChanged && activeConfig.fastAgentMode;
      const result = await detectAiCapabilities(activeConfig);
      const finalState = applyAiModelCapabilities(
        syncedState,
        syncedState.activeProfileId,
        result,
      );
      const nextConfig = getActiveConfig(finalState);
      if (
        nextConfig.fastAgentMode &&
        !previousProfile?.config.fastAgentMode &&
        !fastAgentEgressConfirmed &&
        !(await confirmFastAgentModeEnable(modal, nextConfig.apiUrl))
      ) {
        return;
      }
      form.setFieldsValue(nextConfig);
      await onSave(finalState);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "模型保存失败，请重试。",
      );
    } finally {
      setDetecting(false);
    }
  };

  const saveLocalConnection = async () => {
    setSavingBridge(true);
    try {
      await saveBridgeToken(bridgeToken);
      message.success("本机连接凭据已保存，Bridge 会自动重连。");
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "本机连接凭据保存失败。",
      );
    } finally {
      setSavingBridge(false);
    }
  };

  return (
    <Drawer
      className="ai-settings-drawer"
      title="设置"
      width={600}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={activeProfile?.config}>
        <Tabs
          className="settings-tabs"
          activeKey={settingsTab}
          onChange={(tab) => {
            if (
              tab === "model" ||
              tab === "mcp" ||
              tab === "page" ||
              tab === "local"
            ) {
              setSettingsTab(tab);
            }
          }}
          items={[
            { key: "model", label: "模型管理" },
            { key: "mcp", label: "MCP" },
            { key: "page", label: "页面与工具" },
            { key: "local", label: "本机与更新" },
          ]}
        />

        {/* ── 连接 ─────────────────────────────────────── */}
        <section hidden={settingsTab !== "local"} className="settings-tab-panel">
        <div className="settings-diagnostic-overview" aria-label="本机连接诊断摘要">
          <div>
            <Typography.Text strong>运行诊断</Typography.Text>
            <Typography.Paragraph type="secondary">
              先确认 daemon，再确认页面目标；版本、更新和本机凭据分别处理。
            </Typography.Paragraph>
          </div>
          <div className="settings-diagnostic-grid">
            <span>扩展</span>
            <Typography.Text type="success">v{runningVersion} 已运行</Typography.Text>
            <span>Daemon</span>
            <Typography.Text type={daemonConnected ? "success" : "warning"}>
              {daemonConnected ? "WebSocket 已连接" : "未连接，请先启动本机服务"}
            </Typography.Text>
            <span>页面目标</span>
            <Typography.Text type={activeTargetLabel ? "success" : "secondary"}>
              {activeTargetLabel || "尚未绑定可调试页面"}
            </Typography.Text>
            <span>页面上下文</span>
            <Typography.Text type={pageContextSynced ? "success" : "secondary"}>
              {pageContextSynced ? "已同步" : "等待首次观察"}
            </Typography.Text>
          </div>
        </div>

        <div className="settings-connection-status" style={{ marginBottom: 12 }}>
          <div className="settings-connection-status__header">
            <div>
              <Typography.Text strong>本地版本与更新</Typography.Text>
              <Typography.Paragraph type="secondary">
                自动更新只接受正式 Release ZIP 与对应 SHA-256；源码开发目录不会执行 git、安装依赖或构建。
              </Typography.Paragraph>
            </div>
            <Tag color={daemonConnected ? "green" : "default"}>
              {daemonConnected ? "Daemon 已连接" : "Daemon 未连接"}
            </Tag>
          </div>
          <div className="settings-connection-status__grid">
            {latestVersion === runningVersion ? (
              <>
                <span>当前版本</span>
                <Typography.Text code>v{runningVersion}</Typography.Text>
              </>
            ) : (
              <>
                <span>当前版本</span>
                <Typography.Text code>v{runningVersion}</Typography.Text>
                <span>最新版本</span>
                <Typography.Text code>v{latestVersion}</Typography.Text>
              </>
            )}
          </div>
          {!daemonConnected ? (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="仅扩展模式不能自动更新"
              description={
                "已安装用户请先启动 daemon；尚未安装的用户请手动下载最新 Release ZIP。源码目录由维护者自行更新，不提供应用内 git 更新。"
              }
            />
          ) : null}
          {daemonConnected && updateCheck?.updateAvailable ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message="发现可用更新"
              description={updateCheck.message}
            />
          ) : null}
          {promptReload && updateNotice ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message="代码已更新，请重载扩展"
              description={`磁盘 ${updateNotice.version} 已就绪。点「重载扩展」或到 chrome://extensions 重新加载。`}
            />
          ) : null}
          <div className="settings-update-actions">
            <Button loading={checkingUpdate} onClick={() => void checkForUpdates()}>
              {daemonConnected ? "检查更新" : "查看更新说明 / 检查重载"}
            </Button>
            <Button
              type="primary"
              disabled={
                !daemonConnected ||
                updateCheck?.autoUpdateSupported === false
              }
              loading={runningUpdate}
              onClick={() => void runDaemonUpdate()}
            >
              下载并安装 Release ZIP
            </Button>
            <Button
              disabled={!promptReload || !updateNotice}
              onClick={() => {
                if (!updateNotice) {
                  return;
                }
                void (async () => {
                  await acknowledgeUpdateNotice(updateNotice);
                  chrome.runtime.reload();
                })();
              }}
            >
              重载扩展
            </Button>
          </div>
          {daemonConnected && localService?.ok && localService.supported ? (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <Typography.Text strong>macOS 开机自启（LaunchAgent）</Typography.Text>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {localService.message ||
                      "由 daemon 注册/取消 LaunchAgent；仅 macOS 显示。"}
                  </Typography.Paragraph>
                </div>
                <Switch
                  checked={Boolean(localService.registered)}
                  loading={localServiceLoading || localServiceSaving}
                  onChange={(enabled) => {
                    void (async () => {
                      setLocalServiceSaving(true);
                      try {
                        const result =
                          await mcpBridge.setLocalServiceAutostart(enabled);
                        if (!result.ok) {
                          message.error(result.error || "修改开机自启失败。");
                          await refreshLocalServiceStatus();
                          return;
                        }
                        message.success(
                          result.message ||
                            (enabled ? "已开启开机自启" : "已关闭开机自启"),
                        );
                        await refreshLocalServiceStatus();
                      } catch (error) {
                        message.error(
                          error instanceof Error
                            ? error.message
                            : "修改开机自启失败。",
                        );
                      } finally {
                        setLocalServiceSaving(false);
                      }
                    })();
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="settings-connection-status">
          <div className="settings-connection-status__header">
            <div>
              <Typography.Text strong>本机连接中心</Typography.Text>
              <Typography.Paragraph type="secondary">
                这里只确认扩展与本地 daemon；Codex/Claude/Cursor 是否已注册需在对应客户端检查。
              </Typography.Paragraph>
            </div>
            <Tag color={bridgeConnected ? "green" : "default"}>
              {bridgeConnected ? "Bridge 已连接" : "Bridge 未连接"}
            </Tag>
          </div>
          <div className="settings-connection-status__grid">
            <span>当前页面</span>
            <Typography.Text ellipsis={{ tooltip: activeTargetLabel }}>
              {activeTargetLabel || "尚未同步目标"}
            </Typography.Text>
            <span>页面上下文</span>
            <Typography.Text type={pageContextSynced ? "success" : "secondary"}>
              {pageContextSynced ? "已同步" : "等待首次观察"}
            </Typography.Text>
            <span>MCP 客户端</span>
            <div className="settings-connection-status__command">
              <Typography.Text type="secondary">
                在项目目录运行（或先双击 setup-local 脚手架生成配置）：
              </Typography.Text>
              <Typography.Text
                code
                copyable={{ text: "npm run client:config" }}
                className="settings-command-code"
              >
                npm run client:config
              </Typography.Text>
            </div>
          </div>
        </div>

        <Form.Item
          label="本地 Bridge Token"
          extra="先在项目目录运行 npm run daemon:token，再把输出粘贴到这里。Token 仅保存在当前 Chrome Profile。"
        >
          <Input.Password
            value={bridgeToken}
            onChange={(event) => setBridgeToken(event.target.value)}
            placeholder="本机 daemon 配对令牌"
            autoComplete="off"
          />
        </Form.Item>

        <Button
          block
          loading={savingBridge}
          onClick={() => void saveLocalConnection()}
          style={{ marginBottom: 16 }}
        >
          保存本机连接并重连
        </Button>

        <Form.Item label="Chrome Profile Installation ID">
          <Typography.Text code copyable={{ text: installationId }}>
            {installationId || "加载中…"}
          </Typography.Text>
        </Form.Item>
        </section>

        <section hidden={settingsTab !== "model"} className="settings-tab-panel">
        <div className="settings-model-manager">
          <div className="settings-section-heading">
            <div>
              <Typography.Text strong>模型管理</Typography.Text>
              <Typography.Paragraph type="secondary">
                每个模型独立保存连接信息和能力；聊天输入框可直接切换。
              </Typography.Paragraph>
            </div>
            <Button onClick={addModel}>手动添加</Button>
          </div>
          <div className="settings-model-toolbar">
            <Select
              className="settings-model-select"
              value={localState.activeProfileId}
              onChange={switchProfile}
              options={localState.profiles.map((profile) => ({
                value: profile.id,
                label: profile.config.model || "未填写模型 ID",
              }))}
              aria-label="选择要编辑的模型"
            />
            <Popconfirm
              title="删除这个模型？"
              description="仅删除本地保存的模型信息，不会影响 Provider。"
              okText="删除"
              cancelText="取消"
              disabled={localState.profiles.length <= 1}
              onConfirm={deleteModel}
            >
              <Button danger disabled={localState.profiles.length <= 1}>
                删除
              </Button>
            </Popconfirm>
          </div>
        </div>

        <Divider />

        <Form.Item
          label="API URL"
          name="apiUrl"
          extra="本地 OpenAI-compatible 服务可填 base URL，例如 http://localhost:11434 或 http://localhost:1234/v1。"
          rules={[
            { required: true, message: "请输入 API URL" },
            {
              validator: async (_, value: string | undefined) => {
                const error = validateAiProviderUrl(value ?? "");
                if (error) {
                  throw new Error(error);
                }
              },
            },
          ]}
        >
          <Input placeholder="https://api.openai.com/v1/chat/completions" />
        </Form.Item>

        <Form.Item
          label="API Key（可选）"
          name="apiKey"
        >
          <Input.Password placeholder="本地模型可留空" autoComplete="off" />
        </Form.Item>

        <Form.Item
          label="模型 ID"
          extra={
            modelCatalog
              ? `已从 ${modelCatalog.requestUrl} 获取 ${modelCatalog.models.length} 个模型。`
              : "可手动输入，也可从当前 Provider 获取模型列表后批量添加。"
          }
        >
          <Space.Compact block>
            <Form.Item
              name="model"
              noStyle
              rules={[{ required: true, message: "请输入模型名" }]}
            >
              <AutoComplete
                style={{ flex: 1 }}
                options={(modelCatalog?.models ?? []).map((model) => ({
                  value: model,
                  label: model,
                }))}
                filterOption={(input, option) =>
                  String(option?.value ?? "")
                    .toLocaleLowerCase()
                    .includes(input.toLocaleLowerCase())
                }
                placeholder="gpt-4.1-mini / deepseek-chat / Kimi-K2.7-Code"
              />
            </Form.Item>
            <Button
              loading={modelCatalogLoading}
              onClick={() => void loadModelCatalog()}
            >
              获取列表
            </Button>
          </Space.Compact>
        </Form.Item>

        {modelCatalog ? (
          <div className="settings-model-catalog">
            <div>
              <Typography.Text strong>从列表添加模型</Typography.Text>
              <Typography.Paragraph type="secondary">
                选择一个或多个模型；已添加到当前 API URL 的模型会自动忽略。
              </Typography.Paragraph>
            </div>
            <div className="settings-model-catalog-actions">
              <Select
                mode="multiple"
                allowClear
                showSearch
                maxTagCount="responsive"
                value={selectedCatalogModels}
                onChange={setSelectedCatalogModels}
                options={modelCatalog.models.map((model) => ({
                  value: model,
                  label: model,
                  disabled: localState.profiles.some(
                    (profile) =>
                      profile.config.apiUrl.trim() === apiUrl.trim() &&
                      profile.config.model.trim() === model,
                  ),
                }))}
                placeholder="选择要添加的模型"
                aria-label="选择要添加的模型"
              />
              <Button
                type="primary"
                disabled={selectedCatalogModels.length === 0}
                onClick={addSelectedCatalogModels}
              >
                添加选中模型
              </Button>
            </div>
          </div>
        ) : null}

        <Divider />

        {/* ── 生成参数 ──────────────────────────────────── */}
        <Typography.Text className="settings-section-title">
          生成参数
        </Typography.Text>
        <Space size={12} align="start" wrap>
          <Form.Item
            label="Temperature"
            name="temperature"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={2} step={0.1} precision={1} />
          </Form.Item>

          <Form.Item
            label="History"
            name="maxHistory"
            rules={[{ required: true }]}
          >
            <InputNumber min={2} max={40} step={1} />
          </Form.Item>

          <Form.Item label="Max output" name="maxOutputTokens">
            <InputNumber min={128} max={65536} step={256} placeholder="auto" />
          </Form.Item>

          <Form.Item
            label="Context window"
            name="contextWindowTokens"
            tooltip="当前 Provider/模型支持的总上下文 Token 数。插件会预留输出空间，并在请求前压缩旧历史和旧工具结果，避免上下文溢出。"
          >
            <InputNumber min={8192} max={2000000} step={8192} />
          </Form.Item>

          <Form.Item
            label="单段工具轮数"
            name="maxToolRounds"
            tooltip={`单个执行段允许的工具轮数。默认 ${DEFAULT_AI_CONFIG.maxToolRounds}，最高 ${MAX_TOOL_ROUNDS}；设为 0 会关闭工具执行。`}
            extra="开启自动续跑时，到达该轮数会使用压缩后的工具上下文进入下一执行段；关闭时会停止工具并生成阶段总结。总安全预算仍可能更早停止。"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={MAX_TOOL_ROUNDS} step={1} />
          </Form.Item>
          <Form.Item
            label="自动压缩并续跑"
            name="autoContinueAfterToolRoundLimit"
            valuePropName="checked"
            tooltip="任务尚未完成时，跨过单段轮数边界并继续调用工具。仅压缩当前运行上下文，不写入长期记忆。"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        </Space>

        <Divider />

        {/* ── 模型能力 ──────────────────────────────────── */}
        <Typography.Text className="settings-section-title">
          模型能力
        </Typography.Text>
        <div className="settings-capability-list">
          {renderCapabilityStatus({
            label: "图片输入",
            supported: supportsVision,
            error: capabilityDetection?.visionError,
          })}

          {renderCapabilityStatus({
            label: "联网搜索",
            supported: supportsWebSearch,
            error: capabilityDetection?.webSearchError,
          })}

          <Typography.Paragraph type="secondary">
            保存配置时会向当前 API URL 发送轻量探测请求，并自动更新模型能力。
            Kimi 官方 API 使用 <code>$web_search</code>，OpenAI 官方 API 使用 hosted search，本地/vLLM 模型使用扩展自带的 <code>web_search</code> function 工具。
            {capabilityDetection?.checkedAt
              ? ` 上次检测：${formatCheckedAt(capabilityDetection.checkedAt)}`
              : " 尚未检测。"}
          </Typography.Paragraph>
        </div>

        <div className="settings-switch-grid">
          <Form.Item name="includeImageHistory" valuePropName="checked">
            <Switch disabled={!supportsVision} />
          </Form.Item>
          <div>
            <Typography.Text>历史图片进入上下文</Typography.Text>
            <Typography.Paragraph type="secondary">
              默认关闭。图片只随当前问题发送，避免模型因旧图片报错。
            </Typography.Paragraph>
          </div>

          <Form.Item name="enableTools" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div>
            <Typography.Text>允许 AI 调用页面工具</Typography.Text>
            <Typography.Paragraph type="secondary">
              关闭后 AI 只聊天分析，不会高亮、查询 DOM 或应用 CSS patch。
            </Typography.Paragraph>
          </div>

          <Form.Item name="fastAgentMode" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div>
            <Typography.Text>极速执行（DOM + 按需视觉）</Typography.Text>
            <Typography.Paragraph type="secondary">
              默认开启。首轮提供有界 DOM 执行图，不自动截图；模型支持图片且 Agent 判断视觉信息有帮助时，才主动请求截图并在页面变化后刷新检查点。视觉内容会发送到 {providerOrigin}。
            </Typography.Paragraph>
          </div>
        </div>

        <Divider />
        </section>

        {/* ── 页面上下文 ────────────────────────────────── */}
        <section hidden={settingsTab !== "page"} className="settings-tab-panel">
        <Typography.Text className="settings-section-title">
          页面上下文
        </Typography.Text>
        <div className="settings-switch-grid">
          <Form.Item name="autoReadPage" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div>
            <Typography.Text>发送前自动读取页面</Typography.Text>
            <Typography.Paragraph type="secondary">
              打开后每次提问都会刷新 URL、标题、可见文本和 DOM 摘要。
            </Typography.Paragraph>
          </div>

          <Form.Item name="includePageContext" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div>
            <Typography.Text>携带页面文本</Typography.Text>
            <Typography.Paragraph type="secondary">
              关闭后只保留对话本身，适合纯代码或普通问题。
            </Typography.Paragraph>
          </div>

          <Form.Item name="includeDomSummary" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div>
            <Typography.Text>携带 DOM 摘要</Typography.Text>
            <Typography.Paragraph type="secondary">
              用于让 AI 自己选择 selector 和判断页面结构。
            </Typography.Paragraph>
          </div>

          <Form.Item name="includeSelectedElement" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div>
            <Typography.Text>携带选中元素</Typography.Text>
            <Typography.Paragraph type="secondary">
              发送最近一次选择元素的 selector、outerHTML 和布局样式。
            </Typography.Paragraph>
          </div>
        </div>

        <Space size={12} align="start" wrap>
          <Form.Item
            label="Visible text limit"
            name="visibleTextLimit"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={8000} step={200} />
          </Form.Item>

          <Form.Item
            label="DOM summary limit"
            name="domSummaryLimit"
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={16000} step={500} />
          </Form.Item>
        </Space>
        </section>

        <section hidden={settingsTab !== "mcp"} className="settings-tab-panel">
          <McpSettingsSection
            daemonConnected={daemonConnected}
            onServersChange={onMcpServersChange}
          />
        </section>

        {settingsTab === "model" ? (
          <Alert
            type="info"
            showIcon
            message="API Key 可选；留空时不会发送 Authorization 请求头。有值时仅保存在当前 Chrome Profile 的扩展存储中，不写入 localStorage。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {settingsTab === "model" || settingsTab === "page" ? (
          <>
            {submitError ? (
              <Alert
                type="error"
                showIcon
                message="保存失败"
                description={submitError}
                style={{ marginBottom: 16 }}
              />
            ) : null}

            <Button type="primary" block onClick={submit} loading={detecting}>
              {detecting
                ? "检测模型能力..."
                : settingsTab === "model"
                  ? "保存模型"
                  : "保存页面与工具设置"}
            </Button>
          </>
        ) : null}
      </Form>
    </Drawer>
  );
}

function confirmProviderOriginChange(
  modal: ReturnType<typeof AntApp.useApp>["modal"],
  previousUrl: string,
  nextUrl: string,
  egress: {
    sendsApiKey: boolean;
    sendsFastAgentScreenshot: boolean;
  },
): Promise<boolean> {
  const previousOrigin = getAiProviderOrigin(previousUrl) ?? previousUrl;
  const nextOrigin = getAiProviderOrigin(nextUrl) ?? nextUrl;
  return new Promise((resolve) => {
    modal.confirm({
      title: "确认更改 AI Provider 发送目标",
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            保存后，以下数据会从原 Provider 发送到新的目标：
          </Typography.Text>
          <Typography.Text code>{previousOrigin}</Typography.Text>
          <Typography.Text code>{nextOrigin}</Typography.Text>
          {egress.sendsApiKey ? (
            <Typography.Text>• 当前配置的 API Key</Typography.Text>
          ) : null}
          {egress.sendsFastAgentScreenshot ? (
            <Typography.Text>• Agent 按需请求的截图与后续视觉检查点</Typography.Text>
          ) : null}
          <Typography.Text type="secondary">
            只有在你信任新目标时才继续。
          </Typography.Text>
        </Space>
      ),
      okText: "确认并发送",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function confirmModelCatalogRequest(
  modal: ReturnType<typeof AntApp.useApp>["modal"],
  previousUrl: string,
  nextUrl: string,
): Promise<boolean> {
  const previousOrigin = getAiProviderOrigin(previousUrl) ?? previousUrl;
  const nextOrigin = getAiProviderOrigin(nextUrl) ?? nextUrl;
  return new Promise((resolve) => {
    modal.confirm({
      title: "确认向新 Provider 查询模型？",
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            点击继续后，会立即向新的目标发送 GET /v1/models，并携带当前模型的 API Key：
          </Typography.Text>
          <Typography.Text code>{previousOrigin}</Typography.Text>
          <Typography.Text code>{nextOrigin}</Typography.Text>
          <Typography.Text type="secondary">
            仅在你信任该 Provider 时继续；响应只用于填充模型选择列表。
          </Typography.Text>
        </Space>
      ),
      okText: "确认并查询",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

function confirmFastAgentModeEnable(
  modal: ReturnType<typeof AntApp.useApp>["modal"],
  providerUrl: string,
): Promise<boolean> {
  const providerOrigin = getAiProviderOrigin(providerUrl) ?? providerUrl;
  return new Promise((resolve) => {
    modal.confirm({
      title: "允许极速执行按需发送页面截图？",
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            启用后，发送消息本身不会截图。Agent 仅在任务需要视觉证据时主动请求截图；进入视觉观察后，页面变化可发送最新检查点到：
          </Typography.Text>
          <Typography.Text code>{providerOrigin}</Typography.Text>
          <Typography.Text type="secondary">
            截图可能包含页面中的账号、业务数据或其他敏感内容。Agent 首次截图仍走工具审批；后续检查点有每任务上限，你可以随时关闭极速执行。
          </Typography.Text>
        </Space>
      ),
      okText: "允许并启用",
      cancelText: "取消",
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

// ── Helper ─────────────────────────────────────────────────────────────────

function syncFormToState(
  state: AiProfilesState,
  values: Partial<ConfigFormValues>,
): AiProfilesState {
  const activeConfig = getActiveConfig(state);

  const config: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...activeConfig,
    apiUrl: (values.apiUrl ?? "").trim(),
    apiKey: (values.apiKey ?? "").trim(),
    model: (values.model ?? "").trim(),
    temperature: values.temperature ?? DEFAULT_AI_CONFIG.temperature,
    maxHistory: values.maxHistory ?? DEFAULT_AI_CONFIG.maxHistory,
    contextWindowTokens:
      values.contextWindowTokens ?? DEFAULT_AI_CONFIG.contextWindowTokens,
    maxOutputTokens: values.maxOutputTokens || undefined,
    supportsVision: values.supportsVision ?? activeConfig.supportsVision,
    supportsWebSearch:
      values.supportsWebSearch ?? activeConfig.supportsWebSearch,
    includeImageHistory: Boolean(values.includeImageHistory),
    fastAgentMode: Boolean(values.fastAgentMode),
    autoReadPage: Boolean(values.autoReadPage),
    enableTools: Boolean(values.enableTools),
    maxToolRounds: values.maxToolRounds ?? DEFAULT_AI_CONFIG.maxToolRounds,
    autoContinueAfterToolRoundLimit: Boolean(
      values.autoContinueAfterToolRoundLimit,
    ),
    includePageContext: Boolean(values.includePageContext),
    includeDomSummary: Boolean(values.includeDomSummary),
    includeSelectedElement: Boolean(values.includeSelectedElement),
    visibleTextLimit:
      values.visibleTextLimit ?? DEFAULT_AI_CONFIG.visibleTextLimit,
    domSummaryLimit: values.domSummaryLimit ?? DEFAULT_AI_CONFIG.domSummaryLimit,
    enableWebSearch: values.enableWebSearch ?? activeConfig.enableWebSearch,
    capabilityDetection:
      values.capabilityDetection ?? activeConfig.capabilityDetection,
  };

  const profiles = state.profiles.map((p) =>
    p.id === state.activeProfileId
      ? { ...p, name: config.model || "未命名模型", config }
      : p,
  );

  return { ...state, profiles };
}

function renderCapabilityStatus(params: {
  label: string;
  supported: boolean;
  error?: string;
}) {
  const status = params.supported ? (
    <Tag color="green">支持</Tag>
  ) : (
    <Tooltip title={params.error}>
      <Tag color={params.error ? "red" : "default"}>未支持</Tag>
    </Tooltip>
  );

  return (
    <div className="settings-capability-row">
      <Typography.Text>{params.label}</Typography.Text>
      {status}
      {params.error ? (
        <Typography.Text type="secondary" className="settings-capability-error">
          {params.error}
        </Typography.Text>
      ) : null}
    </div>
  );
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

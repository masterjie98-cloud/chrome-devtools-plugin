import Alert from "antd/es/alert";
import AntApp from "antd/es/app";
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
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import { useEffect, useState } from "react";
import type { AiConfig, AiProfile, AiProfilesState } from "../services/aiConfig";
import {
  DEFAULT_AI_CONFIG,
  MAX_TOOL_ROUNDS,
  getActiveConfig,
} from "../services/aiConfig";
import {
  detectAiCapabilities,
  type AiCapabilityProbeResult,
} from "../services/aiClient";
import {
  getBridgeToken,
  saveBridgeToken,
} from "../../shared/bridgeCredentials";
import { getInstallationId } from "../../shared/extensionIdentity";
import {
  getAiProviderOrigin,
  hasAiProviderOriginChanged,
  validateAiProviderUrl,
} from "../services/aiEndpointPolicy";

interface AiSettingsDrawerProps {
  open: boolean;
  profilesState: AiProfilesState;
  bridgeConnected: boolean;
  activeTargetLabel?: string;
  pageContextSynced: boolean;
  onClose: () => void;
  onSave: (state: AiProfilesState) => Promise<void>;
}

function generateId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

type ConfigFormValues = AiConfig & { profileName: string };

export function AiSettingsDrawer({
  open,
  profilesState,
  bridgeConnected,
  activeTargetLabel,
  pageContextSynced,
  onClose,
  onSave,
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
  const [bridgeToken, setBridgeToken] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [savingBridge, setSavingBridge] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  useEffect(() => {
    if (open) {
      setSubmitError(undefined);
      setLocalState(profilesState);
      void getBridgeToken().then(setBridgeToken);
      void getInstallationId().then(setInstallationId);
    }
  }, [open, profilesState]);

  const activeProfile = localState.profiles.find(
    (p) => p.id === localState.activeProfileId,
  );

  // When active profile changes, sync form
  useEffect(() => {
    if (activeProfile) {
      form.setFieldsValue({
        ...activeProfile.config,
        profileName: activeProfile.name,
      });
    }
  }, [activeProfile, form]);

  const switchProfile = (id: string) => {
    // Persist current form edits before switching
    const values = form.getFieldsValue(true);
    const updated = syncFormToState(localState, values);
    setLocalState({ ...updated, activeProfileId: id });
  };

  const addProfile = () => {
    const newProfile: AiProfile = {
      id: generateId(),
      name: `方案 ${localState.profiles.length + 1}`,
      config: { ...getActiveConfig(localState), apiKey: "" },
    };
    const values = form.getFieldsValue(true);
    const updated = syncFormToState(localState, values);
    setLocalState({
      profiles: [...updated.profiles, newProfile],
      activeProfileId: newProfile.id,
    });
  };

  const deleteProfile = () => {
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
      const finalState = applyCapabilityProbeResult(syncedState, result);
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
        error instanceof Error ? error.message : "AI 配置保存失败，请重试。",
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
      title="AI 配置"
      width={440}
      open={open}
      onClose={onClose}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={activeProfile?.config}>
        {/* ── 配置方案 ─────────────────────────────────── */}
        <Typography.Text className="settings-section-title">
          配置方案
        </Typography.Text>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Select
            style={{ flex: 1 }}
            value={localState.activeProfileId}
            onChange={switchProfile}
            options={localState.profiles.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
          />
          <Tooltip title="新建方案（复制当前配置）">
            <Button onClick={addProfile}>+ 新建</Button>
          </Tooltip>
          <Popconfirm
            title="删除此配置方案？"
            okText="删除"
            cancelText="取消"
            disabled={localState.profiles.length <= 1}
            onConfirm={deleteProfile}
          >
            <Button danger disabled={localState.profiles.length <= 1}>
              删除
            </Button>
          </Popconfirm>
        </div>

        <Form.Item
          label="方案名称"
          name="profileName"
          rules={[{ required: true, message: "请输入方案名称" }]}
        >
          <Input placeholder="例如：GPT-4o / DeepSeek R1 / Claude" />
        </Form.Item>

        <Divider />

        {/* ── 连接 ─────────────────────────────────────── */}
        <Typography.Text className="settings-section-title">
          连接
        </Typography.Text>

        <div className="settings-connection-status">
          <div className="settings-connection-status__header">
            <div>
              <Typography.Text strong>本机连接中心</Typography.Text>
              <Typography.Paragraph type="secondary">
                这里只确认扩展与本地 daemon；Codex/Claude/Cursor 是否已注册需在对应客户端检查。
              </Typography.Paragraph>
            </div>
            <Tag color={bridgeConnected ? "success" : "default"}>
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
            <Typography.Text>
              在项目目录运行 <Typography.Text code copyable={{ text: "npm run client:config" }}>npm run client:config</Typography.Text>
            </Typography.Text>
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
          label="Model"
          name="model"
          rules={[{ required: true, message: "请输入模型名" }]}
        >
          <Input placeholder="gpt-4.1-mini / deepseek-chat / claude-3-5-sonnet" />
        </Form.Item>

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

        {/* ── 页面上下文 ────────────────────────────────── */}
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

        <Alert
          type="info"
          showIcon
          message="API Key 可选；留空时不会发送 Authorization 请求头。有值时仅保存在当前 Chrome Profile 的扩展存储中，不写入 localStorage。"
          style={{ marginBottom: 16 }}
        />

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
          {detecting ? "检测模型能力..." : "检测并保存配置"}
        </Button>
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
  const profileName =
    typeof values.profileName === "string" && values.profileName.trim()
      ? values.profileName.trim()
      : "未命名方案";

  const config: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...activeConfig,
    apiUrl: (values.apiUrl ?? "").trim(),
    apiKey: (values.apiKey ?? "").trim(),
    model: (values.model ?? "").trim(),
    temperature: values.temperature ?? DEFAULT_AI_CONFIG.temperature,
    maxHistory: values.maxHistory ?? DEFAULT_AI_CONFIG.maxHistory,
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
    p.id === state.activeProfileId ? { ...p, name: profileName, config } : p,
  );

  return { ...state, profiles };
}

function applyCapabilityProbeResult(
  state: AiProfilesState,
  result: AiCapabilityProbeResult,
): AiProfilesState {
  const profiles = state.profiles.map((profile) => {
    if (profile.id !== state.activeProfileId) {
      return profile;
    }

    return {
      ...profile,
      config: {
        ...profile.config,
        supportsVision: result.supportsVision,
        supportsWebSearch: result.supportsWebSearch,
        includeImageHistory: result.supportsVision
          ? profile.config.includeImageHistory
          : false,
        fastAgentMode: profile.config.fastAgentMode,
        enableWebSearch: result.supportsWebSearch,
        capabilityDetection: {
          checkedAt: result.checkedAt,
          visionError: result.visionError,
          webSearchError: result.webSearchError,
        },
      },
    };
  });

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

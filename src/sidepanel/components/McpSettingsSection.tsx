import { SafetyCertificateOutlined } from "@ant-design/icons";
import AntApp from "antd/es/app";
import Button from "antd/es/button";
import Empty from "antd/es/empty";
import Input from "antd/es/input";
import Popconfirm from "antd/es/popconfirm";
import Space from "antd/es/space";
import Select from "antd/es/select";
import Switch from "antd/es/switch";
import Tag from "antd/es/tag";
import Typography from "antd/es/typography";
import { useEffect, useState } from "react";
import {
  MAX_EXTERNAL_MCP_SERVERS,
  parseExternalMcpImport,
  type ExternalMcpServerSummary,
} from "../../shared/externalMcp";
import { mcpBridge } from "../services/mcpBridge";

interface McpSettingsSectionProps {
  daemonConnected: boolean;
  onServersChange?: (servers: ExternalMcpServerSummary[]) => void;
}

const IMPORT_EXAMPLE = JSON.stringify(
  {
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
      },
      remote: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer replace-me" },
      },
    },
  },
  null,
  2,
);

export function McpSettingsSection({
  daemonConnected,
  onServersChange,
}: McpSettingsSectionProps) {
  const { message } = AntApp.useApp();
  const [servers, setServers] = useState<ExternalMcpServerSummary[]>([]);
  const [configText, setConfigText] = useState(IMPORT_EXAMPLE);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string>();

  const commitServers = (next: ExternalMcpServerSummary[]) => {
    setServers(next);
    onServersChange?.(next);
    return next;
  };

  const refresh = async () => {
    if (!daemonConnected || !mcpBridge.isConnected()) {
      return commitServers([]);
    }
    setLoading(true);
    try {
      return commitServers(await mcpBridge.listExternalMcpServers());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取 MCP 配置失败。");
      return commitServers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [daemonConnected]);

  const importServers = async () => {
    if (!daemonConnected) {
      message.warning("请先连接本机 daemon，再导入 MCP 配置。");
      return;
    }
    setLoading(true);
    try {
      const imported = parseExternalMcpImport(configText, (name) =>
        createServerId(name),
      );
      if (servers.length + imported.length > MAX_EXTERNAL_MCP_SERVERS) {
        throw new Error(`MCP server 总数不能超过 ${MAX_EXTERNAL_MCP_SERVERS}。`);
      }
      const existingNames = new Set(servers.map((server) => server.name.toLowerCase()));
      const duplicate = imported.find((server) =>
        existingNames.has(server.name.toLowerCase()),
      );
      if (duplicate) {
        throw new Error(`MCP server 名称已存在：${duplicate.name}`);
      }
      let next = servers;
      for (const server of imported) {
        next = await mcpBridge.upsertExternalMcpServer(server);
      }
      commitServers(next);
      setConfigText(IMPORT_EXAMPLE);
      message.success(
        `已导入 ${imported.length} 个 MCP server；当前均为停用，启用或测试时才会启动。`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入 MCP 配置失败。");
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const runServerAction = async (
    serverId: string,
    action: () => Promise<ExternalMcpServerSummary[]>,
    success: string,
  ) => {
    setActionId(serverId);
    try {
      commitServers(await action());
      message.success(success);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "MCP 操作失败。");
      await refresh();
    } finally {
      setActionId(undefined);
    }
  };

  return (
    <div className="settings-mcp-section">
      <div className="settings-mcp-notice" role="note">
        <SafetyCertificateOutlined aria-hidden="true" />
        <div>
          <Typography.Text strong>第三方 MCP 默认逐次审批</Typography.Text>
          <Typography.Paragraph type="secondary">
            导入只保存配置；启用或测试时才会连接。可信 Server
            可单独开启只读免审或全部工具自动运行，并可随时撤销。
          </Typography.Paragraph>
        </div>
      </div>

      <div className="settings-section-heading">
        <div>
          <Typography.Text strong>已注册 MCP</Typography.Text>
          <Typography.Paragraph type="secondary">
            设置页控制 server 是否运行；聊天顶部再选择“关闭 / 自动 / 指定 MCP”。
          </Typography.Paragraph>
        </div>
        <Button size="small" loading={loading} onClick={() => void refresh()}>
          刷新
        </Button>
      </div>

      {!daemonConnected ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Daemon 未连接，无法管理 MCP"
        />
      ) : servers.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="尚未导入 MCP server"
        />
      ) : (
        <div className="settings-mcp-list">
          {servers.map((server) => (
            <div className="settings-mcp-card" key={server.id}>
              <div className="settings-mcp-card__header">
                <div className="settings-mcp-card__identity">
                  <Typography.Text strong>{server.name}</Typography.Text>
                  <Typography.Text type="secondary" ellipsis={{ tooltip: server.endpointLabel }}>
                    {server.endpointLabel}
                  </Typography.Text>
                  {server.description ? (
                    <Typography.Text type="secondary">
                      {server.description}
                    </Typography.Text>
                  ) : null}
                </div>
                <Switch
                  size="small"
                  checked={server.enabled}
                  loading={actionId === server.id}
                  onChange={(enabled) =>
                    void runServerAction(
                      server.id,
                      () => mcpBridge.setExternalMcpServerEnabled(server.id, enabled),
                      enabled ? "MCP 已启用。" : "MCP 已停用并关闭连接。",
                    )
                  }
                />
              </div>
              <div className="settings-mcp-card__meta">
                <Tag>{server.transportType === "stdio" ? "stdio" : "HTTP"}</Tag>
                <StatusTag server={server} />
                {server.importRequestedEnabled && !server.enabled ? (
                  <Tag color="gold">配置请求启用 · 请手动确认</Tag>
                ) : null}
                {server.toolCount > 0 ? <Tag>{server.toolCount} 个工具</Tag> : null}
                {server.resourceCount > 0 ? (
                  <Tag>{server.resourceCount} 个资源</Tag>
                ) : null}
                {server.promptCount > 0 ? (
                  <Tag>{server.promptCount} 个提示词</Tag>
                ) : null}
                {server.trustReadOnlyTools ? (
                  <Tag color="blue">已信任只读声明</Tag>
                ) : null}
                {server.autoApproveTools ? (
                  <Tag color="red">全部工具自动运行</Tag>
                ) : null}
              </div>
              {server.error ? (
                <Typography.Paragraph type="danger" className="settings-mcp-card__error">
                  {server.error}
                </Typography.Paragraph>
              ) : null}
              <Space size={8} wrap>
                <Button
                  size="small"
                  disabled={!server.enabled}
                  loading={actionId === server.id}
                  onClick={() =>
                    void runServerAction(
                      server.id,
                      () => mcpBridge.testExternalMcpServer(server.id),
                      "MCP 连接与工具列表验证通过。",
                    )
                  }
                >
                  测试连接
                </Button>
                {server.trustReadOnlyTools ? (
                  <Button
                    size="small"
                    disabled={actionId === server.id}
                    onClick={() =>
                      void runServerAction(
                        server.id,
                        () =>
                          mcpBridge.setExternalMcpServerReadOnlyTrust(
                            server.id,
                            false,
                          ),
                        "已恢复逐次审批。",
                      )
                    }
                  >
                    取消只读免审
                  </Button>
                ) : (
                  <Popconfirm
                    title={`信任 ${server.name} 的只读声明？`}
                    description="只有 readOnlyHint=true 且没有冲突破坏性声明的工具会免逐次审批；MCP Server 可以谎报行为，请只对可信来源开启。"
                    okText="信任并启用"
                    cancelText="取消"
                    onConfirm={() =>
                      runServerAction(
                        server.id,
                        () =>
                          mcpBridge.setExternalMcpServerReadOnlyTrust(
                            server.id,
                            true,
                          ),
                        "已信任该 MCP 的只读声明。",
                      )
                    }
                  >
                    <Button size="small" disabled={actionId === server.id}>
                      信任只读声明
                    </Button>
                  </Popconfirm>
                )}
                {server.autoApproveTools ? (
                  <Button
                    size="small"
                    disabled={actionId === server.id}
                    onClick={() =>
                      void runServerAction(
                        server.id,
                        () =>
                          mcpBridge.setExternalMcpServerAutoApprove(
                            server.id,
                            false,
                          ),
                        "已关闭该 MCP 的自动运行，后续恢复审批。",
                      )
                    }
                  >
                    关闭自动运行
                  </Button>
                ) : (
                  <Popconfirm
                    title={`让 ${server.name} 的全部工具自动运行？`}
                    description="开启后，该 MCP 的读取、写入、删除和未知工具均不再逐次询问。MCP Server 的声明可能不准确，请只对完全信任的来源开启。"
                    okText="仍要自动运行"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      runServerAction(
                        server.id,
                        () =>
                          mcpBridge.setExternalMcpServerAutoApprove(
                            server.id,
                            true,
                          ),
                        "已开启该 MCP 的全部工具自动运行。",
                      )
                    }
                  >
                    <Button size="small" danger disabled={actionId === server.id}>
                      自动运行全部
                    </Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title={`删除 ${server.name}？`}
                  description="会先关闭连接，再从本机 daemon 配置中删除。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() =>
                    runServerAction(
                      server.id,
                      () => mcpBridge.removeExternalMcpServer(server.id),
                      "MCP 配置已删除。",
                    )
                  }
                >
                  <Button size="small" danger disabled={actionId === server.id}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
              {server.tools.length ? (
                <div className="settings-mcp-tools" aria-label={`${server.name} 工具策略`}>
                  {server.tools.map((tool) => (
                    <div className="settings-mcp-tool-row" key={tool.name}>
                      <div className="settings-mcp-tool-copy">
                        <Typography.Text ellipsis={{ tooltip: tool.description }}>
                          {tool.title}
                        </Typography.Text>
                        <Typography.Text type="secondary" code>
                          {tool.name}
                        </Typography.Text>
                      </div>
                      <Switch
                        size="small"
                        checked={tool.enabled}
                        disabled={actionId === server.id}
                        onChange={(enabled) =>
                          void runServerAction(
                            server.id,
                            () =>
                              mcpBridge.setExternalMcpToolPolicy(
                                server.id,
                                tool.name,
                                { enabled },
                              ),
                            enabled ? "工具已启用。" : "工具已停用。",
                          )
                        }
                      />
                      <Select
                        size="small"
                        value={tool.approval}
                        disabled={!tool.enabled || actionId === server.id}
                        aria-label={`${tool.title} 审批策略`}
                        options={[
                          { value: "inherit", label: "继承 Server" },
                          { value: "ask", label: "每次询问" },
                          { value: "auto", label: "自动运行" },
                        ]}
                        onChange={(approval) =>
                          void runServerAction(
                            server.id,
                            () =>
                              mcpBridge.setExternalMcpToolPolicy(
                                server.id,
                                tool.name,
                                { approval },
                              ),
                            "工具审批策略已更新。",
                          )
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {server.discoveryErrors?.length ? (
                <Typography.Paragraph type="warning" className="settings-mcp-card__error">
                  能力发现部分失败：{server.discoveryErrors.join("；")}
                </Typography.Paragraph>
              ) : null}
              {server.lastConnectedAt ? (
                <Typography.Text type="secondary" className="settings-mcp-runtime-meta">
                  最近连接 {formatRuntimeTime(server.lastConnectedAt)}
                  {server.reconnectCount ? ` · 自动重连 ${server.reconnectCount} 次` : ""}
                </Typography.Text>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <div className="settings-mcp-import">
        <Typography.Text strong>导入 JSON 配置</Typography.Text>
        <Typography.Paragraph type="secondary">
          兼容 <code>streamable-http + url</code> 与 <code>streamableHttp + baseUrl</code>。
          <code>isActive</code> 不会绕过本页确认；远程地址只接受 HTTPS（localhost 可用 HTTP），不支持旧 SSE。
        </Typography.Paragraph>
        <Input.TextArea
          value={configText}
          onChange={(event) => setConfigText(event.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
          spellCheck={false}
          aria-label="MCP JSON 配置"
        />
        <Button
          type="primary"
          block
          disabled={!daemonConnected}
          loading={loading}
          onClick={() => void importServers()}
        >
          导入并注册（暂不启动）
        </Button>
        <Typography.Paragraph type="secondary" className="settings-mcp-secret-note">
          env 与 headers 仅写入 daemon 私有配置文件（0600），不会回显到扩展存储或服务器列表。
        </Typography.Paragraph>
      </div>
    </div>
  );
}

function StatusTag({ server }: { server: ExternalMcpServerSummary }) {
  const config = {
    disabled: { color: "default", label: "已停用" },
    idle: { color: "default", label: "待连接" },
    connecting: { color: "processing", label: "连接中" },
    connected: { color: "success", label: "已连接" },
    error: { color: "error", label: "连接失败" },
  }[server.status];
  return <Tag color={config.color}>{config.label}</Tag>;
}

function createServerId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "server";
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `mcp_${slug}_${suffix}`;
}

function formatRuntimeTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

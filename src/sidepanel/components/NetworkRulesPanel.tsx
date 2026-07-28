import {
  ApiOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import Button from "antd/es/button";
import Input from "antd/es/input";
import InputNumber from "antd/es/input-number";
import Select from "antd/es/select";
import Space from "antd/es/space";
import Switch from "antd/es/switch";
import Table from "antd/es/table";
import Tag from "antd/es/tag";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import { useMemo, useState } from "react";
import type {
  DebuggerProxyHit,
  DebuggerProxyRule,
  DebuggerProxyRuleInput,
  DebuggerProxyScenarioStep,
  DebuggerProxyStage,
  DebuggerProxyStatus,
} from "../../shared/debugger";
import type { BrowserTargetTab } from "../../shared/dom";
import type {
  DnrRuleSummary,
  HeaderModification,
  HeaderOperation,
  HeaderRuleInput,
  HeaderRuleTarget,
} from "../../shared/network";
import { TOOL_NAMES, type ToolName } from "../../shared/tools";

interface NetworkRulesPanelProps {
  rules: DnrRuleSummary[];
  proxyRules: DebuggerProxyRule[];
  proxyStatus?: DebuggerProxyStatus;
  proxyHits: DebuggerProxyHit[];
  targetTabs: BrowserTargetTab[];
  selectedTargetTabId?: number;
  runningTool: ToolName | null;
  onRefresh: () => void;
  onRefreshTargetTabs: () => void;
  onSelectTargetTab: (tabId: number) => void;
  onUpsertHeaderRule: (input: HeaderRuleInput) => void;
  onUpsertMock: (urlFilter: string, extensionPath: string) => void;
  onRemoveRule: (ruleId: number) => void;
  onEnableProxy: () => void;
  onDisableProxy: () => void;
  onRefreshProxyRules: () => void;
  onUpsertProxyRule: (input: DebuggerProxyRuleInput) => Promise<boolean>;
  onRemoveProxyRule: (id: string) => void;
  onRefreshProxyHits: () => void;
}

interface HeaderDraft {
  key: string;
  header: string;
  operation: HeaderOperation;
  value: string;
}

const HEADER_OPERATION_OPTIONS = [
  { value: "set", label: "set" },
  { value: "append", label: "append" },
  { value: "remove", label: "remove" },
] satisfies Array<{ value: HeaderOperation; label: string }>;

const PROXY_STAGE_OPTIONS = [
  { value: "response", label: "请求后替换响应" },
  { value: "request", label: "不请求后端，直接返回" },
] satisfies Array<{ value: DebuggerProxyStage; label: string }>;

const EMPTY_HEADER_DRAFT = {
  header: "",
  operation: "set" as HeaderOperation,
  value: "",
};

export function NetworkRulesPanel({
  rules,
  proxyRules,
  proxyStatus,
  proxyHits,
  targetTabs,
  selectedTargetTabId,
  runningTool,
  onRefresh,
  onRefreshTargetTabs,
  onSelectTargetTab,
  onUpsertHeaderRule,
  onUpsertMock,
  onRemoveRule,
  onEnableProxy,
  onDisableProxy,
  onRefreshProxyRules,
  onUpsertProxyRule,
  onRemoveProxyRule,
  onRefreshProxyHits,
}: NetworkRulesPanelProps) {
  const [urlFilter, setUrlFilter] = useState("");
  const [target, setTarget] = useState<HeaderRuleTarget>("request");
  const [headerDrafts, setHeaderDrafts] = useState<HeaderDraft[]>([
    createHeaderDraft("x-ai-devtools", "set", "enabled"),
  ]);
  const [mockFilter, setMockFilter] = useState("");
  const [extensionPath, setExtensionPath] = useState("/mocks/default.json");
  const [proxyPattern, setProxyPattern] = useState("*://api.example.com/*");
  const [proxyRequestHeaders, setProxyRequestHeaders] = useState<HeaderDraft[]>([
    createHeaderDraft("x-ai-devtools", "set", "enabled"),
  ]);
  const [proxyResponseHeaders, setProxyResponseHeaders] = useState<HeaderDraft[]>([
    createHeaderDraft(),
  ]);
  const [proxyMockEnabled, setProxyMockEnabled] = useState(true);
  const [proxyMockStage, setProxyMockStage] = useState<DebuggerProxyStage>("response");
  const [proxyPriority, setProxyPriority] = useState(1);
  const [proxyStatusCode, setProxyStatusCode] = useState(200);
  const [proxyContentType, setProxyContentType] = useState("application/json; charset=utf-8");
  const [proxyBody, setProxyBody] = useState("{\"ok\":true}");
  const [proxyScenarioEnabled, setProxyScenarioEnabled] = useState(false);
  const [proxyScenarioText, setProxyScenarioText] = useState(
    JSON.stringify(
      [
        { name: "首次", statusCode: 202, responseBody: "{\"state\":\"pending\"}" },
        { name: "完成", statusCode: 200, responseBody: "{\"state\":\"done\"}" },
      ],
      null,
      2,
    ),
  );
  const [proxyScenarioRepeat, setProxyScenarioRepeat] = useState<
    "hold-last" | "loop"
  >("hold-last");
  const [proxyScenarioError, setProxyScenarioError] = useState<string>();
  const [editingProxyRuleId, setEditingProxyRuleId] = useState<string>();
  const [proxyDraftDirty, setProxyDraftDirty] = useState(false);
  const [savingProxyRule, setSavingProxyRule] = useState(false);
  const [expandedProxyRuleIds, setExpandedProxyRuleIds] = useState<string[]>([]);

  const dnrHeaderActions = useMemo(
    () => normalizeHeaderDrafts(headerDrafts),
    [headerDrafts],
  );
  const proxyRequestHeaderActions = useMemo(
    () => normalizeHeaderDrafts(proxyRequestHeaders),
    [proxyRequestHeaders],
  );
  const proxyResponseHeaderActions = useMemo(
    () => normalizeHeaderDrafts(proxyResponseHeaders),
    [proxyResponseHeaders],
  );
  const proxyHasAction =
    proxyRequestHeaderActions.length > 0 ||
    proxyResponseHeaderActions.length > 0 ||
    proxyMockEnabled;
  const canSaveProxyRule = Boolean(proxyPattern.trim()) && proxyHasAction;
  const proxyHitsByRuleId = useMemo(() => {
    const hitsByRuleId = new Map<string, DebuggerProxyHit[]>();
    for (const hit of proxyHits) {
      const hits = hitsByRuleId.get(hit.ruleId) ?? [];
      hits.push(hit);
      hitsByRuleId.set(hit.ruleId, hits);
    }
    return hitsByRuleId;
  }, [proxyHits]);

  const markProxyDraftDirty = () => {
    if (editingProxyRuleId) {
      setProxyDraftDirty(true);
    }
  };

  const loadProxyRule = (rule: DebuggerProxyRule) => {
    setEditingProxyRuleId(rule.id);
    setProxyDraftDirty(false);
    setProxyPattern(
      rule.urlPattern || rule.urlContains || rule.regexFilter || "",
    );
    setProxyPriority(rule.priority ?? 1);
    setProxyMockStage(rule.mockStage ?? "response");
    setProxyStatusCode(rule.statusCode ?? 200);
    setProxyContentType(rule.contentType ?? "application/json; charset=utf-8");
    setProxyBody(rule.responseBody ?? "");
    setProxyScenarioEnabled(Boolean(rule.scenarioSteps?.length));
    setProxyScenarioText(
      JSON.stringify(rule.scenarioSteps ?? [], null, 2),
    );
    setProxyScenarioRepeat(rule.scenarioRepeat ?? "hold-last");
    setProxyScenarioError(undefined);
    setProxyMockEnabled(
      rule.responseBody !== undefined ||
        rule.responseBodyBase64 !== undefined ||
        rule.statusCode !== undefined ||
        rule.contentType !== undefined,
    );
    setProxyRequestHeaders(toHeaderDrafts(rule.requestHeaders));
    setProxyResponseHeaders(toHeaderDrafts(rule.responseHeaders));
  };

  const clearProxyEdit = () => {
    setEditingProxyRuleId(undefined);
    setProxyDraftDirty(false);
    setProxyPattern("*://api.example.com/*");
    setProxyPriority(1);
    setProxyRequestHeaders([createHeaderDraft("x-ai-devtools", "set", "enabled")]);
    setProxyResponseHeaders([createHeaderDraft()]);
    setProxyMockEnabled(true);
    setProxyMockStage("response");
    setProxyStatusCode(200);
    setProxyContentType("application/json; charset=utf-8");
    setProxyBody("{\"ok\":true}");
    setProxyScenarioEnabled(false);
    setProxyScenarioText("[]");
    setProxyScenarioRepeat("hold-last");
    setProxyScenarioError(undefined);
  };

  const toggleRuleHits = (ruleId: string) => {
    setExpandedProxyRuleIds((current) =>
      current.includes(ruleId)
        ? current.filter((id) => id !== ruleId)
        : [...current, ruleId],
    );
  };

  const saveProxyRule = async () => {
    if (!canSaveProxyRule || savingProxyRule || runningTool) {
      return;
    }

    setSavingProxyRule(true);
    try {
      let scenarioSteps: DebuggerProxyScenarioStep[] | undefined;
      if (proxyScenarioEnabled) {
        try {
          const parsed = JSON.parse(proxyScenarioText) as unknown;
          if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error("场景至少需要一个步骤");
          }
          scenarioSteps = parsed as DebuggerProxyScenarioStep[];
          setProxyScenarioError(undefined);
        } catch (error) {
          setProxyScenarioError(
            error instanceof Error ? error.message : "场景 JSON 无效",
          );
          return;
        }
      }
      const saved = await onUpsertProxyRule({
        id: editingProxyRuleId,
        enabled: true,
        ...buildProxyMatcherInput(proxyPattern),
        priority: proxyPriority,
        requestHeaders: proxyRequestHeaderActions,
        responseHeaders: proxyResponseHeaderActions,
        statusCode: proxyMockEnabled ? proxyStatusCode : undefined,
        contentType: proxyMockEnabled ? proxyContentType : undefined,
        responseBody: proxyMockEnabled ? proxyBody : undefined,
        responseBodyBase64: undefined,
        responsePhrase: undefined,
        mockStage: proxyMockEnabled ? proxyMockStage : undefined,
        scenarioSteps,
        scenarioRepeat: proxyScenarioEnabled
          ? proxyScenarioRepeat
          : undefined,
        resetScenario: proxyScenarioEnabled,
      });
      if (saved) {
        clearProxyEdit();
      }
    } finally {
      setSavingProxyRule(false);
    }
  };

  const toolRunning = runningTool !== null;
  const proxyToggleLoading =
    runningTool === TOOL_NAMES.DEBUGGER_PROXY_ENABLE ||
    runningTool === TOOL_NAMES.DEBUGGER_PROXY_DISABLE;

  return (
    <div className="stack rules-workbench">
      <section className="panel-section rules-section rules-section-primary">
        <div className="section-title-row rules-title-row">
          <div>
            <Typography.Title level={5}>CDP 请求代理</Typography.Title>
            <Typography.Text type="secondary" className="rules-section-subtitle">
              修改页面真实请求，支持多请求头、多响应头和内联 Mock。
            </Typography.Text>
          </div>
          <Space size={6}>
            <Switch
              checked={Boolean(proxyStatus?.fetchEnabled)}
              checkedChildren="已启用"
              unCheckedChildren="已停用"
              loading={proxyToggleLoading}
              disabled={toolRunning}
              onChange={(checked) =>
                checked ? onEnableProxy() : onDisableProxy()
              }
              aria-label="启用或停用 CDP 请求代理"
            />
            <Tooltip title="刷新代理规则">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={onRefreshProxyRules}
                loading={runningTool === TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES}
                disabled={toolRunning}
                aria-label="刷新代理规则"
              />
            </Tooltip>
          </Space>
        </div>

        <div className="rules-toolbar">
          <Space.Compact className="rules-target-select">
            <Select<number>
              showSearch
              value={selectedTargetTabId}
              onChange={onSelectTargetTab}
              disabled={toolRunning}
              placeholder="选择代理目标页面"
              optionFilterProp="label"
              options={targetTabs.map((tab) => ({
                value: tab.id,
                label: `${tab.title || "Untitled"} · ${tab.url || ""}`,
              }))}
            />
            <Tooltip title="刷新可调试页面">
              <Button
                icon={<ReloadOutlined />}
                onClick={onRefreshTargetTabs}
                loading={runningTool === TOOL_NAMES.BROWSER_LIST_TABS}
                disabled={toolRunning}
                aria-label="刷新可调试页面"
              />
            </Tooltip>
          </Space.Compact>
        </div>

        {editingProxyRuleId ? (
          <div className="rules-edit-banner">
            <EditOutlined />
            <span>{proxyDraftDirty ? "正在编辑，修改尚未保存" : "正在编辑，使用下方保存按钮提交"}</span>
            <Typography.Text code>{editingProxyRuleId}</Typography.Text>
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={clearProxyEdit}
              disabled={savingProxyRule}
            >
              取消编辑
            </Button>
          </div>
        ) : null}

        <div className="rules-editor">
          <label className="rules-field">
            <span>URL 匹配</span>
            <Input
              value={proxyPattern}
              onChange={(event) => {
                setProxyPattern(event.target.value);
                markProxyDraftDirty();
              }}
              placeholder="*://api.example.com/* 或 regex:^https://"
            />
          </label>

          <HeaderDraftEditor
            title="请求头"
            description="在请求发出前 set、append 或 remove。"
            drafts={proxyRequestHeaders}
            onChange={(next) => {
              setProxyRequestHeaders(next);
              markProxyDraftDirty();
            }}
          />

          <HeaderDraftEditor
            title="响应头"
            description="在响应返回页面前修改，可和 Mock 响应一起使用。"
            drafts={proxyResponseHeaders}
            onChange={(next) => {
              setProxyResponseHeaders(next);
              markProxyDraftDirty();
            }}
          />

          <div className="rules-mock-block">
            <div className="rules-subtitle-row">
              <div>
                <Typography.Text strong>Mock 响应</Typography.Text>
                <Typography.Text type="secondary">可关闭；开启后选择是否真的请求后端。</Typography.Text>
              </div>
              <Switch
                checked={proxyMockEnabled}
                checkedChildren="已开启"
                unCheckedChildren="已关闭"
                onChange={(checked) => {
                  setProxyMockEnabled(checked);
                  markProxyDraftDirty();
                }}
                aria-label="开启或关闭 Mock 响应"
              />
            </div>
            {proxyMockEnabled ? (
              <Space direction="vertical" className="full-width" size={8}>
                <div className="rules-mock-grid">
                  <label className="rules-field">
                    <span>优先级</span>
                    <InputNumber
                      min={1}
                      max={999}
                      value={proxyPriority}
                      onChange={(value) => {
                        setProxyPriority(value ?? 1);
                        markProxyDraftDirty();
                      }}
                    />
                  </label>
                  <label className="rules-field">
                    <span>Mock 方式</span>
                    <Select<DebuggerProxyStage>
                      value={proxyMockStage}
                      onChange={(next) => {
                        setProxyMockStage(next);
                        markProxyDraftDirty();
                      }}
                      options={PROXY_STAGE_OPTIONS}
                    />
                  </label>
                  <label className="rules-field">
                    <span>状态码</span>
                    <InputNumber
                      min={100}
                      max={599}
                      value={proxyStatusCode}
                      onChange={(value) => {
                        setProxyStatusCode(value ?? 200);
                        markProxyDraftDirty();
                      }}
                    />
                  </label>
                </div>
                <label className="rules-field">
                  <span>行为说明</span>
                  <Typography.Text type="secondary" className="rules-stage-help">
                    {proxyMockStage === "response"
                      ? "请求会发到后端；收到响应后，插件把最终响应替换成下面的 Mock。"
                      : "请求不会发到后端；插件在请求发出前直接把下面的 Mock 返回给页面。"}
                  </Typography.Text>
                </label>
                <label className="rules-field">
                  <span>Content-Type</span>
                  <Input
                    value={proxyContentType}
                    onChange={(event) => {
                      setProxyContentType(event.target.value);
                      markProxyDraftDirty();
                    }}
                    placeholder="application/json; charset=utf-8"
                  />
                </label>
                <Input.TextArea
                  value={proxyBody}
                  onChange={(event) => {
                    setProxyBody(event.target.value);
                    markProxyDraftDirty();
                  }}
                  autoSize={{ minRows: 5, maxRows: 10 }}
                  placeholder='{"ok":true}'
                  className="rules-body-editor"
                />
                <div className="rules-subtitle-row">
                  <div>
                    <Typography.Text strong>状态场景</Typography.Text>
                    <Typography.Text type="secondary">
                      按命中顺序返回多步响应；保存后从第一步开始。
                    </Typography.Text>
                  </div>
                  <Switch
                    checked={proxyScenarioEnabled}
                    checkedChildren="已开启"
                    unCheckedChildren="已关闭"
                    onChange={(checked) => {
                      setProxyScenarioEnabled(checked);
                      setProxyScenarioError(undefined);
                      markProxyDraftDirty();
                    }}
                    aria-label="开启或关闭状态场景"
                  />
                </div>
                {proxyScenarioEnabled ? (
                  <>
                    <label className="rules-field">
                      <span>最后一步行为</span>
                      <Select<"hold-last" | "loop">
                        value={proxyScenarioRepeat}
                        onChange={(value) => {
                          setProxyScenarioRepeat(value);
                          markProxyDraftDirty();
                        }}
                        options={[
                          { value: "hold-last", label: "保持最后一步" },
                          { value: "loop", label: "循环到第一步" },
                        ]}
                      />
                    </label>
                    <Input.TextArea
                      value={proxyScenarioText}
                      status={proxyScenarioError ? "error" : undefined}
                      onChange={(event) => {
                        setProxyScenarioText(event.target.value);
                        setProxyScenarioError(undefined);
                        markProxyDraftDirty();
                      }}
                      autoSize={{ minRows: 6, maxRows: 14 }}
                      placeholder='[{"name":"首次","statusCode":202,"responseBody":"{\"state\":\"pending\"}"}]'
                      className="rules-body-editor"
                      aria-label="状态场景 JSON"
                    />
                    {proxyScenarioError ? (
                      <Typography.Text type="danger">
                        {proxyScenarioError}
                      </Typography.Text>
                    ) : null}
                  </>
                ) : null}
              </Space>
            ) : (
              <div className="rules-muted-surface">当前规则只处理请求头/响应头，不替换响应体。</div>
            )}
          </div>

          <div className="rules-save-row">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void saveProxyRule()}
              disabled={!canSaveProxyRule || toolRunning}
              loading={savingProxyRule}
            >
              {editingProxyRuleId ? "保存修改并启用" : "保存并启用规则"}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={onRefreshProxyHits}
              loading={runningTool === TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS}
              disabled={toolRunning}
            >
              刷新命中记录
            </Button>
          </div>
        </div>

        <Table<DebuggerProxyRule>
          size="small"
          rowKey="id"
          dataSource={proxyRules}
          pagination={false}
          className="rules-table"
          locale={{ emptyText: "暂无代理规则" }}
          expandable={{
            expandedRowKeys: expandedProxyRuleIds,
            expandIcon: () => null,
            showExpandColumn: false,
            expandedRowRender: (record) => (
              <RuleHitsPanel hits={proxyHitsByRuleId.get(record.id) ?? []} />
            ),
            rowExpandable: () => true,
          }}
          columns={[
            {
              title: "代理规则",
              dataIndex: "id",
              render: (_, record) => {
                const recentHits = proxyHitsByRuleId.get(record.id) ?? [];
                const isExpanded = expandedProxyRuleIds.includes(record.id);
                const hitTotal = Math.max(recentHits.length, record.hitCount ?? 0);
                return (
                  <div className="rules-rule-item">
                    <div className="rule-cell rules-rule-cell">
                      <div className="rules-rule-line">
                        <Typography.Text strong>{record.id}</Typography.Text>
                        {record.id === editingProxyRuleId ? <Tag color="blue">编辑中</Tag> : null}
                        {record.id === editingProxyRuleId && proxyDraftDirty ? <Tag color="orange">未保存</Tag> : null}
                      </div>
                      <Typography.Text type="secondary" className="break-anywhere">
                        {record.urlPattern || record.urlContains || record.regexFilter}
                      </Typography.Text>
                      <div className="rules-rule-meta">
                        <span>priority {record.priority ?? 1}</span>
                        {hitTotal > 0 ? (
                          <button
                            type="button"
                            className={`rules-hit-chip${isExpanded ? " is-active" : ""}`}
                            onClick={() => toggleRuleHits(record.id)}
                            aria-expanded={isExpanded}
                          >
                            命中 {hitTotal}
                          </button>
                        ) : (
                          <span className="rules-hit-chip is-muted">暂无命中</span>
                        )}
                        <span>{formatProxyStage(record.mockStage)}</span>
                      </div>
                      {record.requestHeaders?.length ? (
                        <Typography.Text type="secondary" className="break-anywhere">
                          请求头: {formatHeaders(record.requestHeaders)}
                        </Typography.Text>
                      ) : null}
                      {record.responseHeaders?.length ? (
                        <Typography.Text type="secondary" className="break-anywhere">
                          响应头: {formatHeaders(record.responseHeaders)}
                        </Typography.Text>
                      ) : null}
                    </div>
                    <div className="rules-row-actions">
                      <Tooltip title="编辑规则">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => loadProxyRule(record)}
                          disabled={savingProxyRule}
                          aria-label="编辑规则"
                        />
                      </Tooltip>
                      <Tooltip title="删除代理规则">
                        <Button
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          disabled={toolRunning || savingProxyRule}
                          aria-label="删除代理规则"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (record.id === editingProxyRuleId) {
                              clearProxyEdit();
                            }
                            setExpandedProxyRuleIds((current) =>
                              current.filter((id) => id !== record.id),
                            );
                            onRemoveProxyRule(record.id);
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                );
              }
            }
          ]}
        />
      </section>

      <details className="rules-compat">
        <summary>
          <span>
            <strong>DNR 兼容规则</strong>
            <small>固定 Header 与扩展内 GET Mock</small>
          </span>
        </summary>
        <div className="rules-compat-content">
      <section className="panel-section rules-section rules-legacy-section">
        <div className="section-title-row rules-title-row">
          <div>
            <Typography.Title level={5}>动态 Header 规则</Typography.Title>
            <Typography.Text type="secondary" className="rules-section-subtitle">
              declarativeNetRequest 规则，适合固定 header 修改。
            </Typography.Text>
          </div>
          <Tooltip title="刷新动态规则">
            <Button
              icon={<ReloadOutlined />}
              onClick={onRefresh}
              loading={runningTool === TOOL_NAMES.DNR_LIST_RULES}
              disabled={toolRunning}
            />
          </Tooltip>
        </div>

        <Space direction="vertical" className="full-width" size={10}>
          <Input value={urlFilter} onChange={(event) => setUrlFilter(event.target.value)} placeholder="*://example.com/*" />
          <Space.Compact className="full-width">
            <Select<HeaderRuleTarget>
              value={target}
              onChange={setTarget}
              options={[
                { value: "request", label: "请求头" },
                { value: "response", label: "响应头" }
              ]}
            />
          </Space.Compact>
          <HeaderDraftEditor
            title={target === "response" ? "响应头修改" : "请求头修改"}
            drafts={headerDrafts}
            onChange={setHeaderDrafts}
          />
          <Button
            type="primary"
            icon={<ApiOutlined />}
            onClick={() =>
              onUpsertHeaderRule({
                target,
                urlFilter,
                headers: dnrHeaderActions,
              })
            }
            loading={runningTool === TOOL_NAMES.DNR_UPSERT_HEADER_RULE}
            disabled={
              !urlFilter.trim() || !dnrHeaderActions.length || toolRunning
            }
          >
            保存 Header 规则
          </Button>
        </Space>
      </section>

      <section className="panel-section rules-section rules-legacy-section">
        <Typography.Title level={5}>GET Mock</Typography.Title>
        <Space direction="vertical" className="full-width" size={8}>
          <Typography.Text type="secondary">
            只支持扩展内文件路径。要直接填写 JSON Mock，用上面的 CDP 请求代理。
          </Typography.Text>
          <Input value={mockFilter} onChange={(event) => setMockFilter(event.target.value)} placeholder="*://api.example.com/users*" />
          <Input value={extensionPath} onChange={(event) => setExtensionPath(event.target.value)} placeholder="/mocks/default.json" />
          <Button
            icon={<ThunderboltOutlined />}
            onClick={() => onUpsertMock(mockFilter, extensionPath)}
            loading={runningTool === TOOL_NAMES.MOCK_UPSERT_GET}
            disabled={!mockFilter.trim() || !extensionPath.trim() || toolRunning}
          >
            保存 GET Mock
          </Button>
        </Space>
      </section>

      <section className="panel-section rules-section rules-legacy-section">
        <Typography.Title level={5}>动态规则</Typography.Title>
        <Table<DnrRuleSummary>
          size="small"
          rowKey="id"
          dataSource={rules}
          pagination={false}
          className="rules-table"
          locale={{ emptyText: "暂无 DNR 规则" }}
          columns={[
            {
              title: "ID",
              dataIndex: "id",
              width: 72
            },
            {
              title: "Action",
              dataIndex: "actionType",
              render: (_, record) => (
                <div className="rule-cell">
                  <Typography.Text strong>{record.actionType}</Typography.Text>
                  <Typography.Text type="secondary" className="break-anywhere">
                    {record.urlFilter || record.regexFilter || record.redirect?.extensionPath || "-"}
                  </Typography.Text>
                  {record.requestHeaders?.length ? (
                    <Typography.Text type="secondary" className="break-anywhere">
                      request: {formatHeaders(record.requestHeaders)}
                    </Typography.Text>
                  ) : null}
                  {record.responseHeaders?.length ? (
                    <Typography.Text type="secondary" className="break-anywhere">
                      response: {formatHeaders(record.responseHeaders)}
                    </Typography.Text>
                  ) : null}
                </div>
              )
            },
            {
              title: "",
              width: 48,
              render: (_, record) => (
                <Tooltip title="删除规则">
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    disabled={toolRunning}
                    onClick={() => onRemoveRule(record.id)}
                    aria-label="删除动态规则"
                  />
                </Tooltip>
              )
            }
          ]}
        />
      </section>
        </div>
      </details>
    </div>
  );
}

interface RuleHitsPanelProps {
  hits: DebuggerProxyHit[];
}

function RuleHitsPanel({ hits }: RuleHitsPanelProps) {
  const visibleHits = hits.slice(0, 8);
  if (!visibleHits.length) {
    return (
      <div className="rules-inline-hit-panel">
        <Typography.Text type="secondary">
          暂无最近命中详情。点击上方“刷新命中记录”同步最新记录。
        </Typography.Text>
      </div>
    );
  }

  return (
    <div className="rules-inline-hit-panel">
      <div className="rules-inline-hit-title">
        <Typography.Text strong>最近命中</Typography.Text>
        <Typography.Text type="secondary">最多显示 8 条</Typography.Text>
      </div>
      <div className="rules-inline-hit-list">
        {visibleHits.map((hit) => (
          <Typography.Text key={hit.id} type="secondary" className="break-anywhere">
            {formatProxyHit(hit)}
          </Typography.Text>
        ))}
      </div>
    </div>
  );
}

interface HeaderDraftEditorProps {
  title: string;
  description?: string;
  drafts: HeaderDraft[];
  onChange: (drafts: HeaderDraft[]) => void;
}

function HeaderDraftEditor({
  title,
  description,
  drafts,
  onChange,
}: HeaderDraftEditorProps) {
  const updateDraft = (key: string, patch: Partial<HeaderDraft>) => {
    onChange(
      drafts.map((draft) =>
        draft.key === key ? { ...draft, ...patch } : draft,
      ),
    );
  };
  const removeDraft = (key: string) => {
    const next = drafts.filter((draft) => draft.key !== key);
    onChange(next.length ? next : [createHeaderDraft()]);
  };

  return (
    <div className="rules-header-editor">
      <div className="rules-subtitle-row">
        <div>
          <Typography.Text strong>{title}</Typography.Text>
          {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
        </div>
        <Button size="small" icon={<PlusOutlined />} onClick={() => onChange([...drafts, createHeaderDraft()])}>
          添加
        </Button>
      </div>
      <div className="rules-header-list">
        {drafts.map((draft) => (
          <div className="rules-header-row" key={draft.key}>
            <Select<HeaderOperation>
              value={draft.operation}
              onChange={(operation) => updateDraft(draft.key, { operation })}
              options={HEADER_OPERATION_OPTIONS}
            />
            <Input
              value={draft.header}
              onChange={(event) => updateDraft(draft.key, { header: event.target.value })}
              placeholder="Header"
            />
            <Input
              value={draft.value}
              onChange={(event) => updateDraft(draft.key, { value: event.target.value })}
              disabled={draft.operation === "remove"}
              placeholder={draft.operation === "remove" ? "remove 不需要值" : "Value"}
            />
            <Tooltip title="删除这一行">
              <Button
                icon={<CloseOutlined />}
                onClick={() => removeDraft(draft.key)}
                aria-label="删除 header 行"
              />
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}

function createHeaderDraft(
  header = EMPTY_HEADER_DRAFT.header,
  operation = EMPTY_HEADER_DRAFT.operation,
  value = EMPTY_HEADER_DRAFT.value,
): HeaderDraft {
  return {
    key: `header-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    header,
    operation,
    value,
  };
}

function toHeaderDrafts(headers: HeaderModification[] | undefined): HeaderDraft[] {
  if (!headers?.length) {
    return [createHeaderDraft()];
  }

  return headers.map((header) =>
    createHeaderDraft(
      header.header,
      header.operation,
      header.operation === "remove" ? "" : header.value ?? "",
    ),
  );
}

function normalizeHeaderDrafts(drafts: HeaderDraft[]): HeaderModification[] {
  return drafts
    .map((draft) => ({
      header: draft.header.trim(),
      operation: draft.operation,
      value: draft.operation === "remove" ? undefined : draft.value,
    }))
    .filter((draft) => Boolean(draft.header));
}

function formatHeaders(headers: DnrRuleSummary["requestHeaders"]): string {
  return (headers ?? [])
    .map((header) =>
      header.operation === "remove"
        ? `${header.operation} ${header.header}`
        : `${header.operation} ${header.header}=${header.value ?? ""}`,
    )
    .join(", ");
}

function formatProxyStage(stage: DebuggerProxyStage | undefined): string {
  return stage === "request" ? "不请求后端" : "请求后替换";
}

function formatProxyHit(hit: DebuggerProxyHit): string {
  const outcome = hit.action === "miss" ? "未匹配" : "命中";
  const note = hit.note ? ` · ${hit.note}` : "";
  return `${outcome} · ${hit.stage} · ${hit.action} · ${hit.method} ${hit.url}${note}`;
}

function buildProxyMatcherInput(
  rawPattern: string,
): Pick<DebuggerProxyRuleInput, "urlPattern" | "urlContains" | "regexFilter"> {
  const pattern = rawPattern.trim();
  if (!pattern) {
    return {};
  }

  if (pattern.startsWith("regex:")) {
    return { regexFilter: pattern.slice("regex:".length).trim() };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pattern) || pattern.startsWith("*://")) {
    return { urlPattern: pattern };
  }

  return { urlContains: pattern.replace(/^\*+|\*+$/g, "") };
}

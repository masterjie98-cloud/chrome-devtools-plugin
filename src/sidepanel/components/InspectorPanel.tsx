import {
  AimOutlined,
  BgColorsOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import Button from "antd/es/button";
import Descriptions from "antd/es/descriptions";
import Empty from "antd/es/empty";
import Input from "antd/es/input";
import Segmented from "antd/es/segmented";
import Space from "antd/es/space";
import Tag from "antd/es/tag";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import { useState } from "react";
import type {
  CssPatchInput,
  DomQueryInput,
  DomQueryResult,
  DomQueryType,
  PageSnapshot,
} from "../../shared/dom";
import { ElementDetails } from "./ElementDetails";

interface InspectorPanelProps {
  pageSnapshot?: PageSnapshot;
  queryResult?: DomQueryResult;
  selectedElement?: DomQueryResult["elements"][number];
  busy: boolean;
  elementPickerActive: boolean;
  onReadPage: () => void;
  onPickElement: () => void;
  onCancelElementPick: () => void;
  onQuery: (input: DomQueryInput) => void;
  onHighlight: (selector: string) => void;
  onClearHighlights: () => void;
  onApplyCssPatch: (input: CssPatchInput) => void;
  onRemoveCssPatch: (patchId: string) => void;
}

export function InspectorPanel({
  pageSnapshot,
  queryResult,
  selectedElement,
  busy,
  elementPickerActive,
  onReadPage,
  onPickElement,
  onCancelElementPick,
  onQuery,
  onHighlight,
  onClearHighlights,
  onApplyCssPatch,
  onRemoveCssPatch,
}: InspectorPanelProps) {
  const [queryType, setQueryType] = useState<DomQueryType>("selector");
  const [query, setQuery] = useState("");
  const [patchId, setPatchId] = useState("assistant-patch");
  const [css, setCss] = useState("");

  const submitQuery = () => {
    if (!query.trim()) {
      return;
    }
    onQuery({ query: query.trim(), queryType, limit: 8 });
  };

  return (
    <div className="stack inspector-workbench">
      <section className="panel-section inspector-page-section">
        <div className="section-title-row">
          <Typography.Title level={5}>页面</Typography.Title>
          <Space>
            <Tooltip title="读取页面">
              <Button
                icon={<CodeOutlined />}
                onClick={onReadPage}
                loading={busy}
                aria-label="读取页面信息"
              />
            </Tooltip>
            <Tooltip title={elementPickerActive ? "取消选择元素" : "选择元素"}>
              <Button
                icon={
                  elementPickerActive ? <CloseCircleOutlined /> : <AimOutlined />
                }
                onClick={
                  elementPickerActive ? onCancelElementPick : onPickElement
                }
                loading={busy && !elementPickerActive}
                danger={elementPickerActive}
                aria-label={elementPickerActive ? "取消选择元素" : "选择元素"}
              />
            </Tooltip>
          </Space>
        </div>

        {pageSnapshot ? (
          <Descriptions
            size="small"
            column={1}
            className="inspector-page-summary"
          >
            <Descriptions.Item label="URL">
              <Typography.Text copyable className="break-anywhere">
                {pageSnapshot.url}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="标题">
              {pageSnapshot.title || "-"}
            </Descriptions.Item>
            <Descriptions.Item label="节点">
              {pageSnapshot.nodeCount}
              {pageSnapshot.truncated ? (
                <Tag color="orange">已截断</Tag>
              ) : null}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="未读取页面"
          />
        )}
      </section>

      <section className="panel-section inspector-selection-section">
        <div className="section-title-row">
          <div>
            <Typography.Title level={5}>选中元素</Typography.Title>
            <Typography.Text type="secondary" className="section-subtitle">
              从页面选择后，在这里查看结构、样式和定位信息。
            </Typography.Text>
          </div>
        </div>
        <ElementDetails element={selectedElement} />
      </section>

      <section className="panel-section">
        <div className="section-title-row">
          <div>
            <Typography.Title level={5}>DOM 查询</Typography.Title>
            <Typography.Text type="secondary" className="section-subtitle">
              按 CSS、类名或 XPath 查找页面元素。
            </Typography.Text>
          </div>
          <Tooltip title="清除高亮">
            <Button
              icon={<ClearOutlined />}
              onClick={onClearHighlights}
              aria-label="清除页面高亮"
            />
          </Tooltip>
        </div>

        <div className="inspector-query-controls">
          <Segmented
            value={queryType}
            onChange={(value) => setQueryType(value as DomQueryType)}
            options={[
              { label: "CSS", value: "selector" },
              { label: "类名", value: "className" },
              { label: "XPath", value: "xpath" },
            ]}
          />
          <Space.Compact className="full-width">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onPressEnter={submitQuery}
              placeholder={
                queryType === "selector"
                  ? ".container > button"
                  : queryType === "className"
                    ? "ant-btn-primary"
                    : "//button[contains(., '关注')]"
              }
            />
            <Button
              icon={<SearchOutlined />}
              onClick={submitQuery}
              loading={busy}
              aria-label="查询 DOM"
            />
          </Space.Compact>
        </div>

        {queryResult ? (
          <div className="query-result">
            <Typography.Text type={queryResult.error ? "danger" : "secondary"}>
              {queryResult.error ?? `匹配到 ${queryResult.count} 个元素`}
            </Typography.Text>
            {queryResult.elements.map((element) => (
              <div
                className="result-row"
                key={`${element.selector}-${element.rect.top}`}
              >
                <Typography.Text code className="result-selector">
                  {element.selector}
                </Typography.Text>
                <Button
                  size="small"
                  onClick={() => onHighlight(element.selector)}
                >
                  高亮
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <details className="inspector-advanced">
        <summary>
          <span>
            <strong>临时样式</strong>
            <small>对当前页面应用可移除的 CSS Patch</small>
          </span>
        </summary>
        <div className="inspector-advanced-content">
          <label className="inspector-field">
            <span>Patch ID</span>
            <Input
              value={patchId}
              onChange={(event) => setPatchId(event.target.value)}
              placeholder="例如 assistant-patch"
            />
          </label>
          <label className="inspector-field">
            <span>CSS</span>
            <Input.TextArea
              value={css}
              onChange={(event) => setCss(event.target.value)}
              autoSize={{ minRows: 5, maxRows: 10 }}
              placeholder=".target { outline: 2px solid #00b894; }"
            />
          </label>
          <div className="inspector-advanced-actions">
            <Button
              onClick={() => onRemoveCssPatch(patchId)}
              disabled={!patchId.trim()}
            >
              移除样式
            </Button>
            <Button
              type="primary"
              icon={<BgColorsOutlined />}
              onClick={() => onApplyCssPatch({ patchId, css })}
              disabled={!css.trim()}
              loading={busy}
            >
              应用样式
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

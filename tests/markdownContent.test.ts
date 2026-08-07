import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/sidepanel/components/MarkdownContent";

test("chat Markdown renders GFM dividers and tables instead of raw syntax", () => {
  const html = renderMarkdown(`
## 计算后 CSS 样式（Computed Style）

---

| 属性 | 值 |
| --- | --- |
| \`display\` | \`flex\` |
| \`width\` | \`1163.28px\` |
  `);

  assert.match(html, /<h3[^>]*>计算后 CSS 样式（Computed Style）<\/h3>/);
  assert.match(html, /<hr class="chat-markdown-divider"\/?>/);
  assert.match(html, /<table class="chat-markdown-table">/);
  assert.match(html, /<th>属性<\/th>/);
  assert.match(html, /<code class="chat-inline-code">display<\/code>/);
  assert.doesNotMatch(html, /\| 属性 \| 值 \|/);
});

test("chat Markdown keeps fenced code blocks and their language header", () => {
  const html = renderMarkdown(`
\`\`\`html
<div class="task-meta">content</div>
\`\`\`
  `);

  assert.match(html, /class="message-code-block"/);
  assert.match(html, /<span>html<\/span>/);
  assert.match(html, /&lt;div class=&quot;task-meta&quot;&gt;content&lt;\/div&gt;/);
  assert.match(html, /aria-label="复制代码"/);
});

test("chat Markdown does not execute raw HTML or unsafe links", () => {
  const html = renderMarkdown(`
<script>alert("unsafe")</script>

<img src=x onerror="alert('unsafe')">

[unsafe](javascript:alert('unsafe'))
  `);

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, />unsafe<\/span>/);
});

test("chat Markdown preserves supported data images", () => {
  const html = renderMarkdown(
    "![fixture](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB)",
  );

  assert.match(html, /class="markdown-image-card"/);
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"/);
  assert.match(html, /alt="fixture"/);
});

test("assistant history repairs flattened headings, lists, and GFM table rows", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content:
        "查询完成。 ## Kubernetes 服务状态 ### 健康 - **采集目标：** 全部 up - **节点：** 正常 ### 命名空间分布 | 命名空间 | 目标数 | | --- | --- | | spaces | 22 | | monitor | 11 |",
      repairFlattenedBlocks: true,
    }),
  );

  assert.match(html, /<h3[^>]*>Kubernetes 服务状态<\/h3>/);
  assert.match(html, /<h4[^>]*>健康<\/h4>/);
  assert.match(html, /<ul class="chat-markdown-list">/);
  assert.match(html, /<table class="chat-markdown-table">/);
  assert.match(html, /<th>命名空间<\/th>/);
  assert.match(html, /<td>monitor<\/td>/);
});

test("delegated task compatibility repair restores a flattened H1 report", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content:
        "检测到重复读取并停止。 # Pod 复测报告 ## 结论 | 项目 | 状态 | | --- | --- | | user-container | CrashLoopBackOff |",
      repairFlattenedBlocks: true,
    }),
  );

  assert.match(html, /<h2[^>]*>Pod 复测报告<\/h2>/);
  assert.match(html, /<h3[^>]*>结论<\/h3>/);
  assert.match(html, /<table class="chat-markdown-table">/);
  assert.match(html, /<td>user-container<\/td>/);
  assert.doesNotMatch(html, /# Pod 复测报告/);
});

test("assistant compatibility repair separates a heading glued to punctuation", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content:
        "Let me give the final answer.## 当前页面 Pod 状态查询结果\n结论：全部 Running。",
      repairFlattenedBlocks: true,
    }),
  );

  assert.match(html, /Let me give the final answer\.<\/p>/);
  assert.match(html, /<h3[^>]*>当前页面 Pod 状态查询结果<\/h3>/);
  assert.doesNotMatch(html, /answer\.##/);
});

test("every Markdown surface repairs a GFM header split across physical lines", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: `数据源列表（3/3 成功）
每次返回同一结果:
| 数据源 ID
| 环境 | 是否默认 |
|---|---|---|
| \`prometheus-infra-0\` | test | ✅ 是 |`,
    }),
  );

  assert.match(html, /<table class="chat-markdown-table">/);
  assert.match(html, /<th>数据源 ID<\/th>/);
  assert.match(html, /<th>环境<\/th>/);
  assert.match(html, /<th>是否默认<\/th>/);
  assert.match(html, /<td><code class="chat-inline-code">prometheus-infra-0<\/code><\/td>/);
  assert.doesNotMatch(html, /\| 数据源 ID/);
});

test("assistant compatibility repair never splits valid three-column GFM tables", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: `### 基础设施服务（infra 命名空间）
| 服务 | Pod | 状态 |
|------|-----|------|
| maxkey | maxkey-0 | ✅ up |

### 卫星任务规划（satellite-planning 命名空间）
| 服务 | Pod | 状态 |
|------|-----|------|
| satellite-task-planning | satellite-task-planning-0 | ✅ up |

### 系统组件（kube-system 命名空间）
| 组件 | 状态 |
|------|------|
| kubelet | ✅ up |`,
      repairFlattenedBlocks: true,
    }),
  );

  assert.equal((html.match(/<table class="chat-markdown-table">/g) ?? []).length, 3);
  assert.match(html, /<th>服务<\/th><th>Pod<\/th><th>状态<\/th>/);
  assert.doesNotMatch(html, /\| 服务 \| Pod \| 状态 \|/);
});

test("flattened assistant history separates prose from a table without changing its columns", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content:
        "### 服务状态明细 | 服务 | Pod | 状态 | |------|-----|------| | maxkey | maxkey-0 | ✅ up |",
      repairFlattenedBlocks: true,
    }),
  );

  assert.match(html, /<h4[^>]*>服务状态明细<\/h4>/);
  assert.match(html, /<th>服务<\/th><th>Pod<\/th><th>状态<\/th>/);
  assert.match(html, /<td>maxkey<\/td><td>maxkey-0<\/td><td>✅ up<\/td>/);
});

test("global malformed-table repair leaves fenced Markdown unchanged", () => {
  const html = renderMarkdown(`
\`\`\`md
| 服务
| Pod | 状态 |
|---|---|---|
\`\`\`
  `);

  assert.doesNotMatch(html, /<table class="chat-markdown-table">/);
  assert.match(html, /\| 服务\n\| Pod \| 状态 \|\n\|---\|---\|---\|/);
});

test("assistant history repair leaves fenced code byte-for-byte intact", () => {
  const source = "说明。 ## 标题\n```md\ninline ## not-a-heading | | - **x:**\n```";
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      content: source,
      repairFlattenedBlocks: true,
    }),
  );

  assert.match(html, /<h3[^>]*>标题<\/h3>/);
  assert.match(html, /inline ## not-a-heading \| \| - \*\*x:\*\*/);
});

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownContent, { content: content.trim() }),
  );
}

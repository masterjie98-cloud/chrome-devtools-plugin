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

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    createElement(MarkdownContent, { content: content.trim() }),
  );
}

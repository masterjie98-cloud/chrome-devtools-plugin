import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("ChatPanel renders exactly one Agent runtime bar at the message-stream level", () => {
  const fileName = new URL(
    "../src/sidepanel/components/ChatPanel.tsx",
    import.meta.url,
  );
  const source = readFileSync(fileName, "utf8");
  const sourceFile = ts.createSourceFile(
    fileName.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const runtimeBars: ts.JsxSelfClosingElement[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === "AgentRuntimeBar"
    ) {
      runtimeBars.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.equal(runtimeBars.length, 1);
  const [runtimeBar] = runtimeBars;
  assert.ok(runtimeBar);
  assert.equal(findAncestorClassName(runtimeBar, sourceFile), "chat-messages");
});

test("context usage separates cumulative conversation storage from request context", () => {
  const source = readFileSync(
    new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /本次模型请求上下文/);
  assert.match(source, /原始工具结果.*最终回答.*替代/);
  assert.match(source, /对话记忆/);
  assert.match(source, /当前任务/);
  assert.match(source, /待决策/);
  assert.match(source, /对话累计/);
  assert.match(source, /本次请求/);
  assert.match(source, /useState<"conversation" \| "request">\(\s*"conversation"/);
  assert.match(source, /对话累计存量/);
  assert.match(source, /当前结构化记忆约/);
  assert.match(source, /会随对话持续增长/);
  assert.match(source, /实际发送量以“本次请求”为准/);
  assert.match(source, /cumulativeBreakdown\.tool_results/);
  assert.match(source, /cumulativeContextWindowTokens/);
});

test("MCP collaboration UI identifies both AIs on a left-aligned read-only timeline", () => {
  const source = readFileSync(
    new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../src/sidepanel/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(source, /MCP 协作上下文/);
  assert.match(source, /真实任务消息、工具调用和结果按时间记录/);
  assert.match(source, /实时记录/);
  assert.match(source, /MCP 后端 AI · Codex/);
  assert.match(source, /插件 AI/);
  assert.match(source, /当前为只读协作记录/);
  assert.match(source, /用户加入对话将在后续阶段开放/);
  assert.match(source, /conversation\.kind === "mcp_collaboration"/);
  const messageStream = source.slice(
    source.indexOf('<div className="chat-messages"'),
    source.indexOf("<AgentRuntimeBar"),
  );
  assert.doesNotMatch(messageStream, /<DelegatedTaskCard/);
  assert.match(
    styles,
    /\.chat-message-row-source-mcp_ai\s*\{[^}]*flex-direction:\s*row;/s,
  );
  assert.match(
    styles,
    /\.chat-message-source-mcp_ai\.chat-message-user\s*\{[^}]*align-self:\s*flex-start;/s,
  );
  const mcpBubbleStyles = styles.match(
    /\.chat-message-source-mcp_ai\s*\{([^}]*)\}/s,
  )?.[1];
  assert.ok(mcpBubbleStyles);
  assert.doesNotMatch(mcpBubbleStyles, /padding:\s*0/);
  assert.doesNotMatch(mcpBubbleStyles, /width:\s*100%/);
  assert.doesNotMatch(mcpBubbleStyles, /max-width:\s*720px/);
  assert.match(
    styles,
    /\.chat-message-source-mcp_ai \.chat-meta-labels \.ant-typography\s*\{[^}]*font-weight:\s*600;/s,
  );
});

function findAncestorClassName(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const className = current.openingElement.attributes.properties.find(
        (property): property is ts.JsxAttribute =>
          ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "className",
      );
      const initializer = className?.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        return initializer.text;
      }
    }
    current = current.parent;
  }
  return undefined;
}

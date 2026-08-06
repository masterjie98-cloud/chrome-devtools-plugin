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

test("context usage copy explains that the meter is request-scoped and compacted", () => {
  const source = readFileSync(
    new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /本次模型请求上下文/);
  assert.match(source, /原始工具结果.*最终回答.*替代/);
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

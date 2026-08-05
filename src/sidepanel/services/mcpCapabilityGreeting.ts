import type { McpAvailableTool } from "../../shared/wsProtocol";

export const MCP_CAPABILITY_GREETING_HEADING =
  "已连接的 MCP 能力（来自 tools/list，仅展示能力，不会自动执行）：";

const MAX_SERVERS = 4;

export type CapabilityOverviewLocale = "zh-CN" | "en";

const CHINESE_CAPABILITY_PROMPTS = new Set([
  "你好",
  "您好",
  "嗨",
  "哈喽",
  "在吗",
  "你能做什么",
  "你会什么",
  "你有哪些功能",
  "你有什么功能",
  "有哪些功能",
  "你有哪些工具",
  "你有什么工具",
  "有哪些工具",
  "mcp有什么功能",
  "mcp有哪些功能",
  "mcp有什么工具",
  "mcp有哪些工具",
]);

const ENGLISH_CAPABILITY_PROMPTS = new Set([
  "hi",
  "hello",
  "hey",
  "whatcanyoudo",
  "whatareyourcapabilities",
  "whatcapabilitiesdoyouhave",
  "whattoolsdoyouhave",
  "whatmcptoolsdoyouhave",
  "whatmcpcapabilitiesdoyouhave",
]);

/**
 * Keep this deliberately strict: a greeting or an explicit capability question
 * may be answered locally, but a real task that merely starts with "hello" must
 * still reach the configured model.
 */
export function getCapabilityOverviewLocale(
  input: string,
): CapabilityOverviewLocale | undefined {
  const normalized = normalizeCapabilityPrompt(input);
  if (!normalized || normalized.length > 80) {
    return undefined;
  }
  if (CHINESE_CAPABILITY_PROMPTS.has(normalized)) {
    return "zh-CN";
  }
  if (ENGLISH_CAPABILITY_PROMPTS.has(normalized)) {
    return "en";
  }
  return undefined;
}

export function buildMcpCapabilityOverview(
  tools: readonly McpAvailableTool[],
  locale: CapabilityOverviewLocale,
): string {
  const groups = groupExternalMcpTools(tools).slice(0, MAX_SERVERS);
  const lines =
    locale === "zh-CN"
      ? [
          "你好，我已就绪。我可以帮你：",
          "- 调试当前页面的 DOM、Network、Console、样式和交互",
          "- 执行页面操作，并用页面状态或截图验证结果",
        ]
      : [
          "Hello, I'm ready. I can help you:",
          "- Debug the current page's DOM, Network, Console, styles, and interactions",
          "- Perform page actions and verify the result from page state or screenshots",
        ];

  if (groups.length > 0) {
    lines.push(
      locale === "zh-CN"
        ? "- 使用已连接的 MCP："
        : "- Use connected MCP servers:",
    );
    for (const group of groups) {
      const categories = describeToolCategories(group.tools, locale);
      const countLabel =
        locale === "zh-CN"
          ? `${group.tools.length} 个工具`
          : `${group.tools.length} tool${group.tools.length === 1 ? "" : "s"}`;
      const separator = locale === "zh-CN" ? "：" : ": ";
      const count =
        locale === "zh-CN" ? `（${countLabel}）` : ` (${countLabel})`;
      lines.push(
        `  - **${group.name}**${categories ? `${separator}${categories}` : ""}${count}`,
      );
    }
  }

  lines.push(
    locale === "zh-CN"
      ? "直接告诉我你想检查或完成什么即可。"
      : "Tell me what you want to inspect or accomplish.",
  );
  return lines.join("\n");
}

export function isGeneratedMcpCapabilityGreeting(
  content: string,
  baseGreeting: string,
): boolean {
  return content.startsWith(
    `${baseGreeting}\n\n${MCP_CAPABILITY_GREETING_HEADING}\n`,
  );
}

function groupExternalMcpTools(
  tools: readonly McpAvailableTool[],
): Array<{ name: string; tools: McpAvailableTool[] }> {
  const groups = new Map<
    string,
    { name: string; tools: McpAvailableTool[] }
  >();
  for (const tool of tools) {
    const id = tool.externalMcpServerId;
    if (!id) {
      continue;
    }
    const name = sanitizeMarkdownText(
      tool.externalMcpServerName || id,
      80,
    );
    if (!name) {
      continue;
    }
    const group = groups.get(id) ?? { name, tools: [] };
    group.tools.push(tool);
    groups.set(id, group);
  }
  return Array.from(groups.values());
}

function describeToolCategories(
  tools: readonly McpAvailableTool[],
  locale: CapabilityOverviewLocale,
): string {
  const searchable = tools
    .map((tool) => `${tool.name} ${tool.title ?? ""}`)
    .join(" ")
    .toLowerCase();
  const categories = new Set<string>();
  for (const category of TOOL_CATEGORY_PATTERNS) {
    if (category.pattern.test(searchable)) {
      categories.add(locale === "zh-CN" ? category.zh : category.en);
    }
    if (categories.size >= 2) {
      break;
    }
  }
  return Array.from(categories).join(locale === "zh-CN" ? "、" : ", ");
}

const TOOL_CATEGORY_PATTERNS = [
  {
    pattern: /prometheus|promql|metric/,
    zh: "Prometheus 指标查询",
    en: "Prometheus metrics",
  },
  {
    pattern: /kubernetes|\bk8s\b|\bpod\b|deployment|\bnode\b/,
    zh: "Kubernetes 状态诊断",
    en: "Kubernetes diagnostics",
  },
  {
    pattern: /source|datasource/,
    zh: "数据源查看",
    en: "data source discovery",
  },
  {
    pattern: /log|trace|alert/,
    zh: "日志与告警查询",
    en: "logs and alerts",
  },
  {
    pattern: /database|\bsql\b|\bquery\b/,
    zh: "数据查询",
    en: "data queries",
  },
  {
    pattern: /file|filesystem/,
    zh: "文件工具",
    en: "file tools",
  },
  {
    pattern: /git|github/,
    zh: "Git 代码协作",
    en: "Git collaboration",
  },
] as const;

function normalizeCapabilityPrompt(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/^请问/u, "");
}

function sanitizeMarkdownText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\`*_{}\[\]()<>#+.!|])/g, "\\$1")
    .slice(0, maxChars);
}

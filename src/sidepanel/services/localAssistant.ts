import type { DomQueryInput } from "../../shared/dom";
import {
  TOOL_NAMES,
  type ToolArgumentMap,
  type ToolName,
} from "../../shared/tools";

export interface AssistantContext {
  hasPageSnapshot: boolean;
  hasSelectedElement: boolean;
}

export type SuggestedToolCall =
  | {
      toolName: typeof TOOL_NAMES.DOM_GET_PAGE_INFO;
      args: ToolArgumentMap[typeof TOOL_NAMES.DOM_GET_PAGE_INFO];
      label: string;
    }
  | {
      toolName: typeof TOOL_NAMES.DOM_QUERY;
      args: DomQueryInput;
      label: string;
    }
  | {
      toolName: typeof TOOL_NAMES.DOM_START_ELEMENT_PICK;
      args: ToolArgumentMap[typeof TOOL_NAMES.DOM_START_ELEMENT_PICK];
      label: string;
    };

export interface AssistantTurn {
  content: string;
  suggestedTool?: SuggestedToolCall;
}

export function createAssistantTurn(
  input: string,
  context: AssistantContext,
): AssistantTurn {
  const text = input.trim();
  const selector = matchCommand(text, /^\/selector\s+(.+)$/i);
  if (selector) {
    return {
      content: `我会查询 selector: ${selector}`,
      suggestedTool: {
        toolName: TOOL_NAMES.DOM_QUERY,
        args: { query: selector, queryType: "selector", limit: 5 },
        label: "查询 selector",
      },
    };
  }

  const className = matchCommand(text, /^\/class(?:Name)?\s+(.+)$/i);
  if (className) {
    return {
      content: `我会查询 className: ${className}`,
      suggestedTool: {
        toolName: TOOL_NAMES.DOM_QUERY,
        args: {
          query: className.replace(/^\./, ""),
          queryType: "className",
          limit: 5,
        },
        label: "查询 className",
      },
    };
  }

  if (/选择|pick|element/i.test(text)) {
    return {
      content: "我会启动元素选择。",
      suggestedTool: {
        toolName: TOOL_NAMES.DOM_START_ELEMENT_PICK,
        args: {},
        label: "选择元素",
      },
    };
  }

  if (/^(\/?读取页面|\/?read page|\/?page snapshot)$/i.test(text)) {
    return {
      content: "我会读取当前页面上下文。",
      suggestedTool: {
        toolName: TOOL_NAMES.DOM_GET_PAGE_INFO,
        args: {},
        label: "读取页面",
      },
    };
  }

  const contextHint = context.hasSelectedElement
    ? "已选中元素，可以继续高亮、看样式或应用 CSS patch。"
    : context.hasPageSnapshot
      ? "已有页面上下文，可以继续查 selector 或 className。"
      : "先读取页面或选择元素会更准。";

  return {
    content: `${contextHint} 支持 /selector <selector> 和 /class <className>。`,
  };
}

export function formatToolResult(toolName: ToolName, data: unknown): string {
  switch (toolName) {
    case TOOL_NAMES.DOM_GET_PAGE_INFO:
      return "页面上下文已更新。";
    case TOOL_NAMES.DOM_QUERY:
      return "DOM 查询完成。";
    case TOOL_NAMES.DOM_START_ELEMENT_PICK:
      return "元素选择已启动。";
    case TOOL_NAMES.DOM_SET_VALUE:
      return "DOM 值已更新。";
    case TOOL_NAMES.CSS_APPLY_PATCH:
      return "CSS patch 已应用。";
    case TOOL_NAMES.CSS_REMOVE_PATCH:
      return "CSS patch 已移除。";
    case TOOL_NAMES.BROWSER_TAKE_SCREENSHOT:
      return "页面截图已捕获。";
    case TOOL_NAMES.BROWSER_NAVIGATE:
      return "页面导航已发起。";
    case TOOL_NAMES.BROWSER_NAVIGATE_BACK:
      return "页面后退已发起。";
    case TOOL_NAMES.BROWSER_NAVIGATE_FORWARD:
      return "页面前进已发起。";
    case TOOL_NAMES.BROWSER_RELOAD:
      return "页面刷新已发起。";
    case TOOL_NAMES.BROWSER_CLOSE:
      return "标签页已关闭。";
    case TOOL_NAMES.BROWSER_RESIZE:
      return "浏览器窗口尺寸已更新。";
    case TOOL_NAMES.BROWSER_CLICK:
      return "元素点击已执行。";
    case TOOL_NAMES.BROWSER_HOVER:
      return "元素悬浮已执行。";
    case TOOL_NAMES.BROWSER_DRAG:
      return "元素拖拽已执行。";
    case TOOL_NAMES.BROWSER_FILL_FORM:
      return "表单已填充。";
    case TOOL_NAMES.BROWSER_TYPE:
      return "文本输入已执行。";
    case TOOL_NAMES.BROWSER_PRESS_KEY:
      return "按键已发送。";
    case TOOL_NAMES.BROWSER_SELECT_OPTION:
      return "下拉选项已选择。";
    case TOOL_NAMES.BROWSER_MOUSE_MOVE:
    case TOOL_NAMES.BROWSER_MOUSE_CLICK:
    case TOOL_NAMES.BROWSER_MOUSE_DOWN:
    case TOOL_NAMES.BROWSER_MOUSE_UP:
    case TOOL_NAMES.BROWSER_MOUSE_DRAG:
    case TOOL_NAMES.BROWSER_MOUSE_WHEEL:
      return "鼠标操作已执行。";
    case TOOL_NAMES.BROWSER_WAIT_FOR:
      return "页面等待已完成。";
    case TOOL_NAMES.BROWSER_EVALUATE:
      return "页面表达式已执行。";
    case TOOL_NAMES.BROWSER_HANDLE_DIALOG:
      return "Dialog 处理策略已设置。";
    case TOOL_NAMES.BROWSER_STORAGE_STATE:
      return "页面 Storage 已读取。";
    case TOOL_NAMES.BROWSER_COOKIE_LIST:
      return "Cookie 已读取。";
    case TOOL_NAMES.BROWSER_COOKIE_SET:
      return "Cookie 已设置。";
    case TOOL_NAMES.BROWSER_COOKIE_DELETE:
      return "Cookie 已删除。";
    case TOOL_NAMES.BROWSER_CONSOLE_MESSAGES:
      return "Console 消息已读取。";
    case TOOL_NAMES.DNR_LIST_RULES:
      return "动态规则已读取。";
    case TOOL_NAMES.DNR_UPSERT_HEADER_RULE:
    case TOOL_NAMES.MOCK_UPSERT_GET:
      return "动态规则已更新。";
    case TOOL_NAMES.DNR_REMOVE_RULE:
    case TOOL_NAMES.MOCK_REMOVE:
      return "动态规则已删除。";
    case TOOL_NAMES.DEBUGGER_FETCH_PREPARE:
      return "CDP Fetch 预留通道已启用。";
    case TOOL_NAMES.DEBUGGER_PROXY_ENABLE:
      return "CDP 请求代理已启用。";
    case TOOL_NAMES.DEBUGGER_PROXY_DISABLE:
      return "CDP 请求代理已停用。";
    case TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES:
      return "代理规则已读取。";
    case TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE:
      return "代理规则已保存。";
    case TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE:
      return "代理规则已删除。";
    case TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES:
      return "代理规则已清空。";
    case TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS:
      return "代理命中记录已读取。";
    case TOOL_NAMES.DEBUGGER_NETWORK_START:
      return "Network 记录已启动。";
    case TOOL_NAMES.DEBUGGER_NETWORK_STOP:
      return "Network 记录已停止。";
    case TOOL_NAMES.DEBUGGER_NETWORK_CLEAR:
      return "Network 记录已清空。";
    case TOOL_NAMES.DEBUGGER_NETWORK_LIST:
      return "Network 请求列表已读取。";
    case TOOL_NAMES.DEBUGGER_NETWORK_GET:
      return "Network 请求详情已读取。";
    case TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY:
      return "Network 响应体已读取。";
    case TOOL_NAMES.DEBUGGER_DETACH:
      return "Debugger 已断开。";
    default:
      return JSON.stringify(data, null, 2).slice(0, 300);
  }
}

function matchCommand(input: string, pattern: RegExp): string | null {
  const match = input.match(pattern);
  return match?.[1]?.trim() || null;
}

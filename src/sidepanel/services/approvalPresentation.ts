import type { WsClientRole } from "../../shared/wsProtocol";
import { getAiProviderOrigin } from "./aiEndpointPolicy";

interface ApprovalDestinationInput {
  requesterRole?: WsClientRole;
  toolName: string;
  aiProviderUrl: string;
}

export function getApprovalEgressDestinations(
  input: ApprovalDestinationInput,
): string[] {
  if (input.requesterRole === "mcp") {
    return ["MCP 客户端：后续模型或数据出站目标由该客户端配置"];
  }

  const providerOrigin = getAiProviderOrigin(input.aiProviderUrl);
  if (input.requesterRole === "ui" || input.toolName === "$web_search") {
    return providerOrigin
      ? [`AI Provider: ${providerOrigin}`]
      : ["AI Provider: 当前地址无效，拒绝发送直到配置修复"];
  }

  if (input.toolName === "web_search") {
    return [
      "Bing RSS: https://www.bing.com",
      "DuckDuckGo fallback: https://api.duckduckgo.com",
    ];
  }

  return [];
}

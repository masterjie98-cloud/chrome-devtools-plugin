import {
  TOOL_NAMES,
  type ToolArgumentMap,
  type ToolName,
  type ToolResultMap,
} from "../../shared/tools";

export const TOOL_PROVIDER_NAMES = {
  EXTENSION_LOCAL: "extension-local",
} as const;

export interface ToolExecutionOptions {
  appendErrorChat?: boolean;
  silentError?: boolean;
  silentStatus?: boolean;
  throwOnError?: boolean;
}

export interface ToolExecutionRequest<TName extends ToolName = ToolName> {
  toolName: TName;
  args: ToolArgumentMap[TName];
  label: string;
}

export type ToolExecutor = <TName extends ToolName>(
  toolName: TName,
  args: ToolArgumentMap[TName],
  label: string,
  options?: ToolExecutionOptions,
) => Promise<ToolResultMap[TName] | undefined>;

export interface ToolProvider {
  name: string;
  supports: (toolName: ToolName) => boolean;
  execute: <TName extends ToolName>(
    request: ToolExecutionRequest<TName>,
    options?: ToolExecutionOptions,
  ) => Promise<ToolResultMap[TName] | undefined>;
}

const ALL_TOOL_NAMES = Object.values(TOOL_NAMES);

export function createToolProvider(
  name: string,
  supportedTools: readonly ToolName[],
  executor: ToolExecutor,
): ToolProvider {
  const supported = new Set<ToolName>(supportedTools);

  return {
    name,
    supports: (toolName) => supported.has(toolName),
    execute: (request, options) =>
      executor(request.toolName, request.args, request.label, options),
  };
}

export function createToolProviderRegistry(providers: ToolProvider[]) {
  const providersByName = new Map(
    providers.map((provider) => [provider.name, provider]),
  );

  return {
    async executeWithFallback<TName extends ToolName>(
      request: ToolExecutionRequest<TName>,
      providerNames: string[],
      options: ToolExecutionOptions = {},
    ): Promise<ToolResultMap[TName] | undefined> {
      const runnableProviders = providerNames
        .map((providerName) => providersByName.get(providerName))
        .filter((provider): provider is ToolProvider => Boolean(provider))
        .filter((provider) => provider.supports(request.toolName));

      for (const [index, provider] of runnableProviders.entries()) {
        const result = await provider.execute(request, {
          ...options,
          silentError: index < runnableProviders.length - 1,
        });
        if (result !== undefined) {
          return result;
        }
      }

      return undefined;
    },
  };
}

export function defaultAiToolProviderOrder(toolName: ToolName): string[] {
  return [TOOL_PROVIDER_NAMES.EXTENSION_LOCAL];
}

export function createDefaultAiToolProviders(executors: {
  executeLocal: ToolExecutor;
  executeViaMcp: ToolExecutor;
}): ToolProvider[] {
  return [
    createToolProvider(
      TOOL_PROVIDER_NAMES.EXTENSION_LOCAL,
      ALL_TOOL_NAMES,
      executors.executeLocal,
    ),
  ];
}

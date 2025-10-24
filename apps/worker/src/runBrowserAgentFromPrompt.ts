import { startBrowserAgent } from "magnitude-core";

import { ACTION_FORMAT_PROMPT } from "./agentActionPrompt";

const DEBUG_AGENT = process.env.DEBUG_BROWSER_AGENT === "1";

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:39382";

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = (value as string).trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

interface DevtoolsVersionResponse {
  readonly webSocketDebuggerUrl: string;
}

type BrowserAgent = Awaited<ReturnType<typeof startBrowserAgent>>;

function parsePrompt(args: readonly string[]): string {
  let prompt = "";

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (typeof token === "undefined") {
      continue;
    }
    if (token === "--prompt") {
      const next = args[index + 1];
      if (typeof next !== "string") {
        throw new Error("--prompt requires a value");
      }
      prompt = next;
      index += 1;
      continue;
    }
    if (token.startsWith("--prompt=")) {
      prompt = token.slice("--prompt=".length);
      continue;
    }
  }

  if (prompt.trim().length === 0) {
    const envPrompt = process.env.BROWSER_AGENT_PROMPT?.trim();
    if (envPrompt && envPrompt.length > 0) {
      prompt = envPrompt;
    }
  }

  if (prompt.trim().length === 0) {
    throw new Error(
      "Prompt is required. Pass --prompt \"<instructions>\" or set BROWSER_AGENT_PROMPT."
    );
  }

  return prompt;
}

async function fetchWebSocketUrl(endpoint: string): Promise<string> {
  const versionUrl = new URL("/json/version", endpoint);
  const response = await fetch(versionUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to load CDP version info (${response.status} ${response.statusText})`
    );
  }

  const payload = (await response.json()) as unknown;
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Partial<DevtoolsVersionResponse>).webSocketDebuggerUrl !==
      "string"
  ) {
    throw new Error("Invalid CDP version response (missing websocket URL)");
  }

  return (payload as DevtoolsVersionResponse).webSocketDebuggerUrl;
}

async function resolveCdpWebSocketUrl(
  endpoint: string,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<string> {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.log(
        `[runBrowserAgentFromPrompt] Resolving CDP websocket (attempt ${attempt}/${attempts})`
      );
      return await fetchWebSocketUrl(endpoint);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  const reason =
    lastError instanceof Error
      ? lastError.message
      : String(lastError ?? "unknown error");

  throw new Error(
    `Failed to resolve CDP websocket after ${attempts} attempts: ${reason}`
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function createAgentWithRetry(
  anthropicApiKey: string,
  cdpWebSocketUrl: string,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<BrowserAgent> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 5000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.log(
        `[runBrowserAgentFromPrompt] Starting browser agent (attempt ${attempt}/${attempts})`
      );
      return await startBrowserAgent({
        llm: {
          provider: "anthropic",
          options: {
            model: "claude-sonnet-4-5",
            apiKey: anthropicApiKey,
          },
        },
        browser: {
          cdp: cdpWebSocketUrl,
        },
        prompt: ACTION_FORMAT_PROMPT,
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(
          `[runBrowserAgentFromPrompt] Browser agent start failed (attempt ${attempt}/${attempts}): ${error.message}`
        );
        if (error.stack) {
          console.error(error.stack);
        }
        console.error(error);
      } else {
        console.error(
          `[runBrowserAgentFromPrompt] Browser agent start failed (attempt ${attempt}/${attempts}): ${String(
            error ?? "unknown"
          )}`
        );
      }
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  const reason =
    lastError instanceof Error
      ? lastError.message
      : String(lastError ?? "unknown error");

  throw new Error(
    `Failed to start browser agent after ${attempts} attempts: ${reason}`
  );
}

async function main(): Promise<void> {
  const prompt = parsePrompt(process.argv.slice(2));

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Populate it in the environment or .env."
    );
  }

  const rawCdpEndpoint = process.env.CDP_ENDPOINT?.trim();
  const cdpEndpoint =
    rawCdpEndpoint && rawCdpEndpoint.length > 0
      ? rawCdpEndpoint
      : DEFAULT_CDP_ENDPOINT;

  console.log(
    `[runBrowserAgentFromPrompt] Using CDP HTTP endpoint: ${cdpEndpoint}`
  );

  const cdpWebSocketUrl = await resolveCdpWebSocketUrl(cdpEndpoint);
  console.log(
    `[runBrowserAgentFromPrompt] Resolved websocket endpoint: ${cdpWebSocketUrl}`
  );

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const agent = await createAgentWithRetry(anthropicApiKey, cdpWebSocketUrl);

    const originalIdentifyAction = agent.identifyAction.bind(agent);
    const originalPartialAct = agent.models.partialAct.bind(agent.models);

    agent.models.partialAct = async (...args) => {
      const result = await originalPartialAct(...args);
      const normalizedActions: unknown[] = [];
      for (const raw of result.actions ?? []) {
        let actionCandidate: unknown = raw;
        if (typeof raw === "string") {
          const trimmed = (raw as string).trim();
          if (
            (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))
          ) {
            try {
              actionCandidate = JSON.parse(trimmed);
            } catch (parseError) {
              console.error(
                "[runBrowserAgentFromPrompt] Failed to parse action JSON",
                trimmed,
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError)
              );
            }
          } else if (trimmed.toLowerCase().startsWith("navigate to ")) {
            actionCandidate = {
              variant: "browser:nav",
              url: trimmed.slice("navigate to ".length).trim(),
            };
          } else {
            console.error(
              "[runBrowserAgentFromPrompt] Received unsupported string action",
              trimmed
            );
          }
        }

        if (
          typeof actionCandidate === "object" &&
          actionCandidate !== null &&
          !Array.isArray(actionCandidate)
        ) {
          const candidate = actionCandidate as {
            variant?: string;
            action?: string;
            name?: string;
            type?: string;
            actionType?: string;
            kind?: string;
          };
          if (!candidate.variant) {
            const actionValue = toNonEmptyString(candidate.action);
            const nameValue = toNonEmptyString(candidate.name);
            const typeValue = toNonEmptyString(candidate.type);
            const actionTypeValue = toNonEmptyString(candidate.actionType);
            const kindValue = toNonEmptyString(candidate.kind);

            candidate.variant =
              actionValue ??
              nameValue ??
              typeValue ??
              actionTypeValue ??
              kindValue ??
              candidate.variant;
          }
          normalizedActions.push(candidate);
        } else {
          normalizedActions.push(actionCandidate);
        }
      }

      result.actions = normalizedActions as typeof result.actions;
      if (DEBUG_AGENT) {
        try {
          console.error(
            "[runBrowserAgentFromPrompt] partialAct actions",
            JSON.stringify(result.actions)
          );
        } catch (error) {
          console.error(
            "[runBrowserAgentFromPrompt] partialAct actions (non-json)",
            result.actions
          );
        }
      }
      return result;
    };

    agent.identifyAction = (rawAction) => {
      if (typeof rawAction === "string") {
        const trimmed = (rawAction as string).trim();
        let parsed: unknown = trimmed;
        if (
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
          try {
            parsed = JSON.parse(trimmed);
          } catch (parseError) {
            console.error(
              "[runBrowserAgentFromPrompt] Failed to parse action JSON",
              trimmed,
              parseError instanceof Error
                ? parseError.message
                : String(parseError)
            );
          }
        }
        if (typeof parsed === "object" && parsed !== null) {
          // eslint-disable-next-line no-param-reassign
          rawAction = parsed as typeof rawAction;
        } else if (trimmed.toLowerCase().startsWith("navigate to ")) {
          rawAction = {
            variant: "browser:nav",
            url: trimmed.slice("navigate to ".length).trim(),
          } as typeof rawAction;
        } else {
          console.error(
            "[runBrowserAgentFromPrompt] Received unsupported string action",
            trimmed
          );
        }
      }

      const action = rawAction as typeof rawAction & {
        variant?: string;
        action?: string;
        name?: string;
        type?: string;
        actionType?: string;
        kind?: string;
      };

      if (!action.variant) {
        const actionValue = toNonEmptyString(action.action);
        const nameValue = toNonEmptyString(action.name);
        const typeValue = toNonEmptyString(action.type);
        const actionTypeValue = toNonEmptyString(action.actionType);
        const kindValue = toNonEmptyString(action.kind);

        action.variant =
          actionValue ??
          nameValue ??
          typeValue ??
          actionTypeValue ??
          kindValue ??
          action.variant;
        if (!action.variant) {
          const actionDump = (() => {
            if (typeof action === "string") {
              return action;
            }
            try {
              return JSON.stringify(action);
            } catch (serializationError) {
              return String(action);
            }
          })();
          console.error(
            "[runBrowserAgentFromPrompt] Received action without variant",
            actionDump,
            typeof action
          );
        }
      }

      if (DEBUG_AGENT) {
        console.error("[runBrowserAgentFromPrompt] Debug action payload", action);
      }
      if (!action.variant || typeof action.variant !== "string") {
        console.error(
          "[runBrowserAgentFromPrompt] Unable to resolve action variant",
          action
        );
      } else if (
        typeof (action as { url?: unknown }).url === "undefined" &&
        action.variant === "browser:nav"
      ) {
        console.error("[runBrowserAgentFromPrompt] Navigation action missing url", action);
      }

      if (action.variant === "task:done") {
        const evidenceValue = toNonEmptyString((action as { evidence?: unknown }).evidence);
        if (evidenceValue) {
          console.log(
            `[runBrowserAgentFromPrompt] Agent evidence: ${evidenceValue}`
          );
        }
      }

      return originalIdentifyAction(action);
    };

    try {
      await agent.act(prompt);
      await agent.stop();
      return;
    } catch (error) {
      await agent.stop().catch(() => {
        // ignore cleanup errors during retries
      });
      const reason =
        error instanceof Error ? error.message : String(error ?? "unknown error");
      console.error(
        `[runBrowserAgentFromPrompt] Attempt ${attempt}/${maxAttempts} failed: ${reason}`
      );
      if (attempt === maxAttempts) {
        throw error;
      }
      await sleep(2_000);
    }
  }
}

(async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error(`[runBrowserAgentFromPrompt] ${reason}`);
    process.exit(1);
  }
})();

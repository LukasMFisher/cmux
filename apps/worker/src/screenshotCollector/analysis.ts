import { Codex, type ThreadEvent, type ThreadItem } from "@openai/codex-sdk";
import { existsSync } from "node:fs";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const screenshotAnalysisSchema = z.object({
  hasUiChanges: z.boolean(),
  uiChangesToScreenshotInstructions: z.string(),
});

export type ScreenshotAnalysis = z.infer<typeof screenshotAnalysisSchema>;

type LogFn = (message: string) => Promise<void> | void;

function describeThreadItem(item: ThreadItem): string {
  switch (item.type) {
    case "agent_message":
      return "agent_message";
    case "command_execution":
      return `command_execution:${item.status}`;
    case "file_change":
      return `file_change:${item.status}`;
    case "mcp_tool_call":
      return `mcp_tool_call:${item.status}`;
    case "reasoning":
      return "reasoning";
    case "todo_list":
      return "todo_list";
    case "web_search":
      return "web_search";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

function describeThreadEvent(event: ThreadEvent): string {
  switch (event.type) {
    case "thread.started":
      return "[codex] thread.started";
    case "turn.started":
      return "[codex] turn.started";
    case "turn.completed":
      return "[codex] turn.completed";
    case "turn.failed":
      return `[codex] turn.failed: ${event.error.message}`;
    case "item.started":
      return `[codex] item.started:${describeThreadItem(event.item)}`;
    case "item.updated":
      return `[codex] item.updated:${describeThreadItem(event.item)}`;
    case "item.completed":
      return `[codex] item.completed:${describeThreadItem(event.item)}`;
    case "error":
      return `[codex] error: ${event.message}`;
    default:
      return `[codex] unknown-event: ${JSON.stringify(event)}`;
  }
}

interface ScreenshotAnalysisOptions {
  apiKey: string;
  workspaceDir: string;
  prompt: string;
  logEvent: LogFn;
}

function resolveCodexPath(): string | null {
  const candidates = [
    process.env.CODEX_PATH_OVERRIDE?.trim() ?? null,
    "/root/.bun/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex",
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function runScreenshotAnalysis({
  apiKey,
  workspaceDir,
  prompt,
  logEvent,
}: ScreenshotAnalysisOptions): Promise<ScreenshotAnalysis> {
  await logEvent("Requesting Codex screenshot summary...");
  const codexPath = resolveCodexPath();
  if (codexPath) {
    await logEvent(`Using Codex binary at ${codexPath}`);
  }
  console.log("apiKey", apiKey);
  const codex = new Codex({
    apiKey,
    codexPathOverride: codexPath ?? undefined,
  });
  const thread = codex.startThread({
    workingDirectory: workspaceDir,
    model: "gpt-5-codex",
  });
  const turn = await thread.runStreamed(prompt, {
    outputSchema: zodToJsonSchema(screenshotAnalysisSchema, {
      target: "openAi",
    }),
  });

  let agentMessage = "";
  for await (const event of turn.events) {
    await logEvent(describeThreadEvent(event));
    if (
      event.type === "item.completed" &&
      event.item.type === "agent_message"
    ) {
      agentMessage = event.item.text;
    }
  }

  const finalResponse = agentMessage.trim();
  if (finalResponse.length === 0) {
    await logEvent("Codex did not return a structured response.");
    throw new Error("Codex did not return a structured response.");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(finalResponse);
  } catch (parseError) {
    const message =
      parseError instanceof Error
        ? parseError.message
        : String(parseError ?? "unknown parse error");
    await logEvent(`Codex response JSON parse failed: ${message}`);
    throw new Error(`Codex response JSON parse failed: ${message}`);
  }

  const parsed = screenshotAnalysisSchema.safeParse(parsedJson);
  if (!parsed.success) {
    await logEvent(`Codex response validation failed: ${parsed.error.message}`);
    throw new Error(
      `Codex response validation failed: ${parsed.error.message}`
    );
  }

  return parsed.data;
}

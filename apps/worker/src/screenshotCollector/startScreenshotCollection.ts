import { startBrowserAgent } from "magnitude-core";

import { ACTION_FORMAT_PROMPT } from "../agentActionPrompt";
import { log } from "../logger";
import { runCommandCapture } from "../crown/utils";
import { filterTextFiles, parseFileList, resolveMergeBase } from "./git";
import {
  SCREENSHOT_COLLECTOR_DIRECTORY_URL,
  SCREENSHOT_COLLECTOR_LOG_PATH,
  logToScreenshotCollector,
} from "./logger";
import { readPrDescription } from "./context";
import { buildScreenshotPrompt, formatFileList } from "./prompt";
import { runScreenshotAnalysis } from "./analysis";

const INTERNAL_CDP_ENDPOINT = "http://127.0.0.1:39382";

export interface StartScreenshotCollectionOptions {
  openAiApiKey?: string | null;
  anthropicApiKey?: string | null;
}

interface DevtoolsVersionResponse {
  webSocketDebuggerUrl: string;
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

export async function startScreenshotCollection(
  options: StartScreenshotCollectionOptions = {}
): Promise<void> {
  try {
    await logToScreenshotCollector("start-screenshot-collection triggered");
    log("INFO", "Screenshot collection trigger recorded", {
      path: SCREENSHOT_COLLECTOR_LOG_PATH,
      openVSCodeUrl: SCREENSHOT_COLLECTOR_DIRECTORY_URL,
    });

    const workspaceDir = "/root/workspace";

    await logToScreenshotCollector(
      "Determining merge base from origin HEAD branch..."
    );
    const { baseBranch, mergeBase } = await resolveMergeBase(workspaceDir);
    await logToScreenshotCollector(
      `Using merge base ${mergeBase} from ${baseBranch}`
    );

    const changedFilesOutput = await runCommandCapture(
      "git",
      ["diff", "--name-only", `${mergeBase}..HEAD`],
      { cwd: workspaceDir }
    );
    const changedFiles = parseFileList(changedFilesOutput);

    if (changedFiles.length === 0) {
      await logToScreenshotCollector(
        `No changes detected relative to ${baseBranch}`
      );
      log("INFO", "No diff files detected for screenshot collection", {
        baseBranch,
        mergeBase,
      });
      return;
    }

    const textFiles = await filterTextFiles(
      workspaceDir,
      mergeBase,
      changedFiles
    );

    await logToScreenshotCollector(
      `Found ${textFiles.length} text file(s) with diffs out of ${changedFiles.length} total`
    );

    if (textFiles.length === 0) {
      await logToScreenshotCollector("All changed files are binary; skipping");
      log("INFO", "Changed files are binary; skipping screenshot collection", {
        baseBranch,
        mergeBase,
        changedFiles,
      });
      return;
    }

    await logToScreenshotCollector(
      `Text files queued for screenshots: ${textFiles.join(", ")}`
    );
    const formattedFileList = formatFileList(textFiles);
    await logToScreenshotCollector(
      `Files included in screenshot prompt:\n${formattedFileList}`
    );
    log("INFO", "Changed text files identified for screenshot collection", {
      baseBranch,
      mergeBase,
      changedFiles,
      textFiles,
    });

    let prDescription: string | null = null;
    try {
      prDescription = await readPrDescription(workspaceDir);
      if (prDescription) {
        await logToScreenshotCollector(
          `PR description detected (${prDescription.length} characters)`
        );
      } else {
        await logToScreenshotCollector(
          "No PR description found; proceeding without additional context"
        );
      }
    } catch (descriptionError) {
      const message =
        descriptionError instanceof Error
          ? descriptionError.message
          : String(descriptionError ?? "unknown PR description error");
      await logToScreenshotCollector(
        `Failed to read PR description: ${message}`
      );
      log("ERROR", "Failed to read PR description for screenshots", {
        error: message,
      });
    }

    const suppliedOpenAiKey = options.openAiApiKey?.trim();
    const openAiApiKey =
      suppliedOpenAiKey && suppliedOpenAiKey.length > 0
        ? suppliedOpenAiKey
        : process.env.OPENAI_API_KEY;

    await logToScreenshotCollector(
      `OPENAI_API_KEY source: ${suppliedOpenAiKey ? "payload" : "environment"}`
    );
    await logToScreenshotCollector(
      `OPENAI_API_KEY (first 8 chars): ${
        openAiApiKey ? openAiApiKey.slice(0, 8) : "<none>"
      }`
    );

    if (!openAiApiKey) {
      await logToScreenshotCollector(
        "OPENAI_API_KEY missing; skipping Codex screenshot instructions"
      );
      log(
        "ERROR",
        "OPENAI_API_KEY is not set; cannot analyze diffs for screenshots",
        { baseBranch, mergeBase }
      );
      return;
    }

    const suppliedAnthropicKey = options.anthropicApiKey?.trim();
    const anthropicApiKey =
      suppliedAnthropicKey && suppliedAnthropicKey.length > 0
        ? suppliedAnthropicKey
        : process.env.ANTHROPIC_API_KEY;

    await logToScreenshotCollector(
      `ANTHROPIC_API_KEY source: ${
        suppliedAnthropicKey ? "payload" : "environment"
      }`
    );
    await logToScreenshotCollector(
      `ANTHROPIC_API_KEY (first 8 chars): ${
        anthropicApiKey ? anthropicApiKey.slice(0, 8) : "<none>"
      }`
    );

    if (!anthropicApiKey) {
      await logToScreenshotCollector(
        "ANTHROPIC_API_KEY missing; cannot start Magnitude computer agent"
      );
      log(
        "ERROR",
        "ANTHROPIC_API_KEY is not set; cannot launch computer use agent",
        { baseBranch, mergeBase }
      );
      return;
    }

    const prompt = buildScreenshotPrompt({
      baseBranch,
      mergeBase,
      formattedFileList,
      prDescription,
    });

    await logToScreenshotCollector(`Codex prompt:\n${prompt}`);

    const analysis = await runScreenshotAnalysis({
      apiKey: openAiApiKey,
      workspaceDir,
      prompt,
      logEvent: logToScreenshotCollector,
    });

    await logToScreenshotCollector(
      `Codex response: ${JSON.stringify(analysis)}`
    );
    log("INFO", "Codex screenshot analysis completed", {
      response: analysis,
      baseBranch,
      mergeBase,
    });

    if (!analysis.hasUiChanges) {
      await logToScreenshotCollector(
        "Codex detected no UI changes; skipping computer agent workflow"
      );
      return;
    }

    const screenshotInstructions =
      analysis.uiChangesToScreenshotInstructions.trim();

    if (screenshotInstructions.length === 0) {
      await logToScreenshotCollector(
        "Codex response did not include UI change instructions; skipping computer agent workflow"
      );
      return;
    }

    await logToScreenshotCollector(
      `Launching Magnitude computer agent with claude-sonnet-4-5 via CDP at ${INTERNAL_CDP_ENDPOINT}`
    );
    await logToScreenshotCollector(
      `Computer agent instructions:\n${screenshotInstructions}`
    );

    let cdpWebSocketUrl: string;
    try {
      await logToScreenshotCollector("Resolving CDP WebSocket endpoint...");
      cdpWebSocketUrl = await fetchWebSocketUrl(INTERNAL_CDP_ENDPOINT);
      await logToScreenshotCollector(
        `CDP WebSocket endpoint resolved (${cdpWebSocketUrl})`
      );
    } catch (cdpError) {
      const message =
        cdpError instanceof Error
          ? cdpError.message
          : String(cdpError ?? "unknown CDP error");
      await logToScreenshotCollector(
        `Failed to resolve CDP WebSocket endpoint: ${message}`
      );
      log("ERROR", "Failed to resolve CDP WebSocket endpoint", {
        error: message,
      });
      throw cdpError;
    }

    const agent = await startBrowserAgent({
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

    try {
      await agent.act(screenshotInstructions);
      await logToScreenshotCollector(
        "Magnitude computer agent completed the UI change instructions"
      );
      log(
        "INFO",
        "Magnitude computer agent completed the UI change instructions",
        { baseBranch, mergeBase }
      );
    } catch (agentError) {
      const message =
        agentError instanceof Error
          ? agentError.message
          : String(agentError ?? "unknown agent error");
      await logToScreenshotCollector(
        `Magnitude computer agent failed: ${message}`
      );
      log(
        "ERROR",
        "Magnitude computer agent failed to run UI change instructions",
        { error: message, baseBranch, mergeBase }
      );
      throw agentError;
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    try {
      await logToScreenshotCollector(
        `start-screenshot-collection failed: ${reason}`
      );
    } catch (logError) {
      log("ERROR", "Failed to write screenshot collector error log", {
        error: logError instanceof Error ? logError.message : String(logError),
      });
    }
    log("ERROR", "Failed to record screenshot collection trigger", {
      path: SCREENSHOT_COLLECTOR_LOG_PATH,
      openVSCodeUrl: SCREENSHOT_COLLECTOR_DIRECTORY_URL,
      error: reason,
    });
    throw error;
  }
}

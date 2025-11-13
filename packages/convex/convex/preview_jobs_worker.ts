import {
  createMorphCloudClient,
  startInstanceInstancePost,
  getInstanceInstanceInstanceIdGet,
  execInstanceInstanceIdExecPost,
  stopInstanceInstanceInstanceIdDelete,
  type InstanceModel,
} from "@cmux/morphcloud-openapi-client";
import { env } from "../_shared/convex-env";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

async function waitForInstanceReady(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
  readinessTimeoutMs = 5 * 60 * 1000,
): Promise<InstanceModel> {
  const start = Date.now();
  while (true) {
    const response = await getInstanceInstanceInstanceIdGet({
      client: morphClient,
      path: { instance_id: instanceId },
    });

    if (response.error) {
      throw new Error(`Failed to get instance status: ${JSON.stringify(response.error)}`);
    }

    const instance = response.data;
    if (!instance) {
      throw new Error("Instance data missing from response");
    }

    if (instance.status === "ready") {
      return instance;
    }
    if (instance.status === "error") {
      throw new Error("Morph instance entered error state");
    }
    if (Date.now() - start > readinessTimeoutMs) {
      throw new Error("Morph instance did not become ready before timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function startMorphInstance(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  options: {
    snapshotId: string;
    metadata?: Record<string, string>;
    ttlSeconds?: number;
    ttlAction?: "stop" | "pause";
    readinessTimeoutMs?: number;
  },
): Promise<InstanceModel> {
  const response = await startInstanceInstancePost({
    client: morphClient,
    query: {
      snapshot_id: options.snapshotId,
    },
    body: {
      metadata: options.metadata,
      ttl_seconds: options.ttlSeconds,
      ttl_action: options.ttlAction,
    },
  });

  if (response.error) {
    throw new Error(`Failed to start instance: ${JSON.stringify(response.error)}`);
  }

  const instance = response.data;
  if (!instance) {
    throw new Error("Instance data missing from start response");
  }

  return await waitForInstanceReady(
    morphClient,
    instance.id,
    options.readinessTimeoutMs,
  );
}

async function stopMorphInstance(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
) {
  await stopInstanceInstanceInstanceIdDelete({
    client: morphClient,
    path: { instance_id: instanceId },
  });
}

async function resolveRepositoryDirectory(
  morphClient: ReturnType<typeof createMorphCloudClient>,
  instanceId: string,
  searchRoot: string,
  preferredRepoDir?: string,
): Promise<string> {
  const repoDetectionScript = `
set -euo pipefail
ROOT="${searchRoot}"
PREFERRED="${preferredRepoDir ?? ""}"

if [ ! -d "$ROOT" ]; then
  exit 2
fi

if [ -n "$PREFERRED" ] && [ -d "$PREFERRED" ]; then
  if git -C "$PREFERRED" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$PREFERRED" rev-parse --show-toplevel
    exit 0
  fi
fi

if git -C "$ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
  git -C "$ROOT" rev-parse --show-toplevel
  exit 0
fi

FIRST_GIT=$(find "$ROOT" -mindepth 1 -maxdepth 4 -type d -name .git 2>/dev/null | sort | head -n 1 || true)

if [ -n "$FIRST_GIT" ]; then
  REPO_DIR="$(dirname "$FIRST_GIT")"
  if git -C "$REPO_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$REPO_DIR" rev-parse --show-toplevel
    exit 0
  fi
fi

exit 3
`.trim();

  const resolveResponse = await execInstanceInstanceIdExecPost({
    client: morphClient,
    path: { instance_id: instanceId },
    body: {
      command: ["bash", "-lc", repoDetectionScript],
    },
  });

  if (resolveResponse.error) {
    throw new Error("Failed to run repository detection script");
  }

  const resolveResult = resolveResponse.data;
  if (!resolveResult || resolveResult.exit_code !== 0) {
    throw new Error(
      `Unable to locate git repository under ${searchRoot} (exit ${resolveResult?.exit_code ?? "unknown"})`,
    );
  }

  const repoDir = resolveResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .pop();

  if (!repoDir) {
    throw new Error(`Repository detection script returned no path for ${searchRoot}`);
  }

  return repoDir;
}

async function triggerWorkerScreenshotCollection(
  workerUrl: string,
): Promise<void> {
  const pollingBase = `${workerUrl}/socket.io/?EIO=4&transport=polling`;

  // Step 1: Handshake to get session ID
  const handshakeResponse = await fetch(`${pollingBase}&t=${Date.now()}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const handshakeText = await handshakeResponse.text();

  // Parse session ID from response like: 0{"sid":"xxx","upgrades":[],"pingInterval":25000,"pingTimeout":20000}
  const startIdx = handshakeText.indexOf('{');
  const endIdx = handshakeText.lastIndexOf('}') + 1;
  if (startIdx === -1 || endIdx === 0) {
    throw new Error("Failed to parse Socket.IO handshake response");
  }
  const handshake = JSON.parse(handshakeText.slice(startIdx, endIdx)) as { sid: string };
  const sid = handshake.sid;

  // Step 2: Connect to /management namespace
  await fetch(`${pollingBase}&sid=${sid}&t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: "40/management",
    signal: AbortSignal.timeout(10_000),
  });

  // Step 3: Send worker:start-screenshot-collection event
  await fetch(`${pollingBase}&sid=${sid}&t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: `42/management,${JSON.stringify(["worker:start-screenshot-collection"])}`,
    signal: AbortSignal.timeout(10_000),
  });
}

export async function runPreviewJob(
  ctx: ActionCtx,
  previewRunId: Id<"previewRuns">,
) {
  const morphApiKey = env.MORPH_API_KEY;
  if (!morphApiKey) {
    console.warn("[preview-jobs] MORPH_API_KEY not configured; skipping run", {
      previewRunId,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "failed",
      stateReason: "Morph API key is not configured",
    });
    return;
  }

  const morphClient = createMorphCloudClient({
    auth: morphApiKey,
  });

  const payload = await ctx.runQuery(internal.previewRuns.getRunWithConfig, {
    previewRunId,
  });
  if (!payload?.run || !payload.config) {
    console.warn("[preview-jobs] Missing run/config for dispatch", {
      previewRunId,
    });
    return;
  }

  const { run, config } = payload;

  if (!config.environmentId) {
    console.warn("[preview-jobs] Preview config missing environmentId; skipping run", {
      previewRunId,
      repoFullName: run.repoFullName,
      prNumber: run.prNumber,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "skipped",
      stateReason: "No environment configured for preview run",
    });
    return;
  }

  const environment = await ctx.runQuery(internal.environments.getByIdInternal, {
    id: config.environmentId,
  });

  if (!environment) {
    console.warn("[preview-jobs] Environment not found for preview run; skipping", {
      previewRunId,
      environmentId: config.environmentId,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "skipped",
      stateReason: "Environment not found for preview run",
    });
    return;
  }

  if (!environment.morphSnapshotId) {
    console.warn("[preview-jobs] Environment missing morph snapshot; skipping", {
      previewRunId,
      environmentId: environment._id,
    });
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "skipped",
      stateReason: "Environment has no associated Morph snapshot",
    });
    return;
  }

  const snapshotId = environment.morphSnapshotId;
  let instance: InstanceModel | null = null;

  console.log("[preview-jobs] Launching Morph instance", {
    previewRunId,
    snapshotId,
    repoFullName: run.repoFullName,
    prNumber: run.prNumber,
    headSha: run.headSha,
    baseSha: run.baseSha,
  });

  await ctx.runMutation(internal.previewRuns.updateStatus, {
    previewRunId,
    status: "running",
    stateReason: "Provisioning Morph workspace",
  });

  try {
    instance = await startMorphInstance(morphClient, {
      snapshotId,
      metadata: {
        app: "cmux-preview",
        previewRunId: previewRunId,
        repo: run.repoFullName,
        prNumber: String(run.prNumber),
        headSha: run.headSha,
      },
      ttlSeconds: 600,
      ttlAction: "stop",
      readinessTimeoutMs: 5 * 60 * 1000,
    });

    const workerService = instance.networking?.http_services?.find(
      (service: { port?: number }) => service.port === 39377,
    );
    if (!workerService) {
      throw new Error("Worker service not found on instance");
    }

    console.log("[preview-jobs] Worker service ready", {
      previewRunId,
      instanceId: instance.id,
      workerUrl: workerService.url,
      workerHealthUrl: `${workerService.url}/health`,
      screenshotLogUrl: `${workerService.url.replace(':39377', ':39376')}/file?path=/root/.cmux/screenshot-collector/screenshot-collector.log`,
    });

    // Step 2: Fetch latest changes and checkout PR
    // Preview environment snapshots have the repo pre-cloned under /root/workspace
    const repoSearchRoot = "/root/workspace";

    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Fetching latest changes",
    });

    console.log("[preview-jobs] Validating pre-cloned repository root", {
      previewRunId,
      repoFullName: run.repoFullName,
      repoSearchRoot,
    });

    // Verify the repo search root exists
    const verifyDirResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["test", "-d", repoSearchRoot],
      },
    });

    if (verifyDirResponse.data?.exit_code !== 0) {
      throw new Error(
        `Repository directory ${repoSearchRoot} not found in snapshot. Expected pre-cloned repository at /root/workspace.`
      );
    }

    const [, repoName] = run.repoFullName.split("/");
    const preferredRepoDir =
      repoName && repoName.length > 0 ? `${repoSearchRoot}/${repoName}` : undefined;

    const repoDir = await resolveRepositoryDirectory(
      morphClient,
      instance.id,
      repoSearchRoot,
      preferredRepoDir,
    );

    console.log("[preview-jobs] Using pre-cloned repository", {
      previewRunId,
      repoFullName: run.repoFullName,
      repoDir,
    });

    // Get GitHub App installation token for fetching from private repos
    if (run.repoInstallationId) {
      const accessToken = await fetchInstallationAccessToken(run.repoInstallationId);
      if (accessToken) {
        // Configure GitHub authentication using gh CLI (same approach as cloud workspaces)
        const ghAuthResponse = await execInstanceInstanceIdExecPost({
          client: morphClient,
          path: { instance_id: instance.id },
          body: {
            command: [
              "bash",
              "-lc",
              `printf %s '${accessToken}' | gh auth login --with-token && gh auth setup-git 2>&1`,
            ],
          },
        });

        if (ghAuthResponse.error || ghAuthResponse.data?.exit_code !== 0) {
          console.warn("[preview-jobs] Failed to configure GitHub authentication", {
            previewRunId,
            exitCode: ghAuthResponse.data?.exit_code,
            stderr: ghAuthResponse.data?.stderr,
            stdout: ghAuthResponse.data?.stdout,
          });
        } else {
          console.log("[preview-jobs] GitHub authentication configured successfully", {
            previewRunId,
          });
        }
      } else {
        console.warn("[preview-jobs] Failed to fetch installation token, falling back to public fetch", {
          previewRunId,
          installationId: run.repoInstallationId,
        });
      }
    }

    // Fetch the latest changes from origin (fetch all refs)
    const fetchResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["git", "-C", repoDir, "fetch", "origin"],
      },
    });

    if (fetchResponse.error || fetchResponse.data?.exit_code !== 0) {
      console.error("[preview-jobs] Fetch failed", {
        previewRunId,
        exitCode: fetchResponse.data?.exit_code,
        stdout: fetchResponse.data?.stdout,
        stderr: fetchResponse.data?.stderr,
      });
      throw new Error(
        `Failed to fetch from origin (exit ${fetchResponse.data?.exit_code}): ${fetchResponse.data?.stderr || fetchResponse.data?.stdout}`
      );
    }

    console.log("[preview-jobs] Fetched latest changes from origin", {
      previewRunId,
      headSha: run.headSha,
    });

    // Step 3: Checkout the PR commit
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Checking out PR commit",
    });

    const checkoutResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["git", "-C", repoDir, "checkout", run.headSha],
      },
    });

    if (checkoutResponse.error) {
      throw new Error(
        `Failed to checkout PR branch ${run.headSha}: ${JSON.stringify(checkoutResponse.error)}`,
      );
    }

    const checkoutResult = checkoutResponse.data;
    if (!checkoutResult) {
      throw new Error("Checkout command returned no data");
    }

    if (checkoutResult.exit_code !== 0) {
      console.error("[preview-jobs] Checkout failed - full output", {
        previewRunId,
        headSha: run.headSha,
        exitCode: checkoutResult.exit_code,
        stdout: checkoutResult.stdout,
        stderr: checkoutResult.stderr,
      });
      throw new Error(
        `Failed to checkout PR branch ${run.headSha} (exit ${checkoutResult.exit_code}): stderr="${checkoutResult.stderr}" stdout="${checkoutResult.stdout}"`,
      );
    }

    console.log("[preview-jobs] Checked out PR branch", {
      previewRunId,
      headSha: run.headSha,
      stdout: checkoutResult.stdout?.slice(0, 200),
    });

    // Step 4: Trigger screenshot collection
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Collecting screenshots",
    });

    console.log("[preview-jobs] Triggering screenshot collection", {
      previewRunId,
      workerUrl: workerService.url,
      screenshotLogUrl: `${workerService.url.replace(':39377', ':39376')}/file?path=/root/.cmux/screenshot-collector/screenshot-collector.log`,
    });

    await triggerWorkerScreenshotCollection(workerService.url);

    console.log("[preview-jobs] Screenshot collection triggered", {
      previewRunId,
    });

    // Step 5: Wait for screenshots to complete (give Claude time to collect)
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Waiting for screenshots to complete",
    });

    console.log("[preview-jobs] Waiting for screenshots to complete...", {
      previewRunId,
      waitTimeSeconds: 120,
    });

    // Wait 2 minutes for Claude to collect screenshots
    await new Promise((resolve) => setTimeout(resolve, 120_000));

    // Step 6: Fetch screenshot file list
    const fileServiceUrl = workerService.url.replace(':39377', ':39376');
    const screenshotDirPath = "/root/.cmux/screenshot-collector/screenshots";

    console.log("[preview-jobs] Fetching screenshot list", {
      previewRunId,
      fileServiceUrl,
      screenshotDirPath,
    });

    // List files via Morph exec
    const listResponse = await execInstanceInstanceIdExecPost({
      client: morphClient,
      path: { instance_id: instance.id },
      body: {
        command: ["find", screenshotDirPath, "-type", "f", "-name", "*.png"],
      },
    });

    if (listResponse.error) {
      console.warn("[preview-jobs] Failed to list screenshots", {
        previewRunId,
        error: listResponse.error,
      });
    }

    const listResult = listResponse.data;
    const screenshotPaths = listResult?.stdout
      ? listResult.stdout.split('\n').map((p: string) => p.trim()).filter((p: string) => p.length > 0)
      : [];

    console.log("[preview-jobs] Found screenshots", {
      previewRunId,
      count: screenshotPaths.length,
      paths: screenshotPaths,
    });

    if (screenshotPaths.length === 0) {
      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId,
        status: "completed",
        stateReason: "No screenshots generated",
      });
      return;
    }

    // Step 7: Download and upload screenshots
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "running",
      stateReason: "Uploading screenshots",
    });

    const uploadedImages: Array<{
      storageId: string;
      mimeType: string;
      fileName: string;
      commitSha: string;
    }> = [];

    for (const screenshotPath of screenshotPaths) {
      try {
        // Download screenshot from file service
        const fileUrl = `${fileServiceUrl}/file?path=${encodeURIComponent(screenshotPath)}`;
        const downloadResponse = await fetch(fileUrl, {
          signal: AbortSignal.timeout(30_000),
        });

        if (!downloadResponse.ok) {
          console.warn("[preview-jobs] Failed to download screenshot", {
            previewRunId,
            screenshotPath,
            status: downloadResponse.status,
          });
          continue;
        }

        const imageBytes = await downloadResponse.arrayBuffer();

        // Upload to Convex storage
        const uploadUrl = await ctx.storage.generateUploadUrl();
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: imageBytes,
        });

        const { storageId } = (await uploadResponse.json()) as { storageId: string };

        uploadedImages.push({
          storageId,
          mimeType: "image/png",
          fileName: screenshotPath.split('/').pop() ?? "screenshot.png",
          commitSha: run.headSha,
        });

        console.log("[preview-jobs] Uploaded screenshot", {
          previewRunId,
          screenshotPath,
          storageId,
        });
      } catch (error) {
        console.warn("[preview-jobs] Failed to process screenshot", {
          previewRunId,
          screenshotPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Step 8: Create screenshot set and trigger GitHub comment
    const screenshotSetId = await ctx.runMutation(
      internal.previewScreenshots.createScreenshotSet,
      {
        previewRunId,
        status: "completed",
        commitSha: run.headSha,
        images: uploadedImages.map(img => ({
          ...img,
          storageId: img.storageId as Id<"_storage">,
        })),
      },
    );

    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId,
      status: "completed",
      stateReason: "Screenshots uploaded",
      screenshotSetId,
    });

    // Trigger GitHub comment
    await ctx.scheduler.runAfter(
      0,
      internal.previewScreenshots.triggerGithubComment,
      { previewRunId },
    );

    console.log("[preview-jobs] Preview job completed", { previewRunId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[preview-jobs] Preview job failed", {
      previewRunId,
      error: message,
    });

    let screenshotSetId: Id<"previewScreenshotSets"> | undefined;
    try {
      screenshotSetId = await ctx.runMutation(
        internal.previewScreenshots.createScreenshotSet,
        {
          previewRunId,
          status: "failed",
          commitSha: run.headSha ?? "unknown",
          error: message,
          images: [],
        },
      );
    } catch (screenshotError) {
      console.error("[preview-jobs] Failed to record failure screenshot set", {
        previewRunId,
        error: screenshotError,
      });
    }

    try {
      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId,
        status: "failed",
        stateReason: message,
        screenshotSetId,
      });
    } catch (statusError) {
      console.error("[preview-jobs] Failed to update preview status", {
        previewRunId,
        error: statusError,
      });
    }

    throw error;
  } finally {
    if (instance) {
      try {
        await stopMorphInstance(morphClient, instance.id);
      } catch (stopError) {
        console.warn("[preview-jobs] Failed to stop Morph instance", {
          previewRunId,
          instanceId: instance.id,
          error: stopError,
        });
      }
    }
  }
}

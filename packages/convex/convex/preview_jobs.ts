import {
  createMorphCloudClient,
  stopInstanceInstanceInstanceIdDelete,
} from "@cmux/morphcloud-openapi-client";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { runPreviewJob } from "./preview_jobs_worker";

export const stopPreviewInstance = internalAction({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, { previewRunId }) => {
    const previewRun = await ctx.runQuery(internal.previewRuns.getById, {
      id: previewRunId,
    });

    if (!previewRun?.morphInstanceId) {
      return;
    }
    if (previewRun.morphInstanceStoppedAt) {
      console.log("[preview-jobs] Morph instance already stopped", {
        previewRunId: previewRun._id,
        morphInstanceId: previewRun.morphInstanceId,
      });
      return;
    }
    const morphApiKey = process.env.MORPH_API_KEY;
    if (!morphApiKey) {
      console.warn(
        "[preview-jobs] Cannot stop Morph instance without MORPH_API_KEY",
        {
          previewRunId: previewRun._id,
          morphInstanceId: previewRun.morphInstanceId,
        }
      );
      return;
    }

    const morphClient = createMorphCloudClient({ auth: morphApiKey });
    const stoppedAt = Date.now();

    try {
      await stopInstanceInstanceInstanceIdDelete({
        client: morphClient,
        path: { instance_id: previewRun.morphInstanceId },
      });
    } catch (error) {
      console.error("[preview-jobs] Failed to stop Morph instance", {
        previewRunId: previewRun._id,
        morphInstanceId: previewRun.morphInstanceId,
        error,
      });
    }

    try {
      await ctx.runMutation(internal.previewRuns.updateInstanceMetadata, {
        previewRunId: previewRun._id,
        morphInstanceStoppedAt: stoppedAt,
      });
    } catch (error) {
      console.error("[preview-jobs] Failed to record Morph instance stop time", {
        previewRunId: previewRun._id,
        error,
      });
    }

    if (previewRun.taskRunId) {
      try {
        await ctx.runMutation(internal.taskRuns.updateVSCodeMetadataInternal, {
          taskRunId: previewRun.taskRunId,
          vscode: {
            provider: "morph",
            status: "stopped",
            containerName: previewRun.morphInstanceId,
            stoppedAt,
          },
          networking: [],
        });
      } catch (error) {
        console.error(
          "[preview-jobs] Failed to update task run VSCode metadata after stop",
          {
            previewRunId: previewRun._id,
            taskRunId: previewRun.taskRunId,
            error,
          }
        );
      }
    }
  },
});

export const requestDispatch = internalAction({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    console.log("[preview-jobs] Starting dispatch process", {
      previewRunId: args.previewRunId,
    });

    const payload = await ctx.runQuery(internal.previewRuns.getRunWithConfig, {
      previewRunId: args.previewRunId,
    });

    if (!payload?.run || !payload.config) {
      console.warn("[preview-jobs] Missing run/config for dispatch", args);
      return;
    }

    console.log("[preview-jobs] Preview run details", {
      previewRunId: args.previewRunId,
      repoFullName: payload.run.repoFullName,
      prNumber: payload.run.prNumber,
      headSha: payload.run.headSha?.slice(0, 7),
      status: payload.run.status,
    });

    try {
      await ctx.runMutation(internal.previewRuns.markDispatched, {
        previewRunId: args.previewRunId,
      });
      console.log("[preview-jobs] Marked as dispatched", {
        previewRunId: args.previewRunId,
      });
    } catch (error) {
      console.error("[preview-jobs] Failed to mark preview run dispatched", {
        previewRunId: args.previewRunId,
        error,
      });
      return;
    }

    console.log("[preview-jobs] Scheduling preview job execution", {
      previewRunId: args.previewRunId,
    });

    try {
      await ctx.scheduler.runAfter(
        0,
        internal.preview_jobs.executePreviewJob,
        {
          previewRunId: args.previewRunId,
        },
      );
      console.log("[preview-jobs] Preview job scheduled", {
        previewRunId: args.previewRunId,
      });
    } catch (error) {
      console.error("[preview-jobs] Failed to schedule preview job", {
        previewRunId: args.previewRunId,
        error,
      });
    }
  },
});

export const executePreviewJob = internalAction({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    await runPreviewJob(ctx, args.previewRunId);
  },
});

import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";
import { internalQuery } from "./_generated/server";

const DEFAULT_BROWSER_PROFILE = "chromium" as const;

type BrowserProfile = "chromium" | "firefox" | "webkit";

function normalizeRepoFullName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes("/")) {
    throw new Error("repoFullName must be in the form owner/name");
  }
  return trimmed.replace(/\.git$/i, "").toLowerCase();
}

function normalizeBrowser(profile?: BrowserProfile | null): BrowserProfile {
  if (profile === "firefox" || profile === "webkit") {
    return profile;
  }
  return DEFAULT_BROWSER_PROFILE;
}

export const listByTeam = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const configs = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .collect();
    return configs;
  },
});

export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    previewConfigId: v.id("previewConfigs"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const config = await ctx.db.get(args.previewConfigId);
    if (!config || config.teamId !== teamId) {
      return null;
    }
    return config;
  },
});

export const getByRepo = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const config = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName),
      )
      .first();
    return config ?? null;
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    environmentSnapshotId: v.optional(v.id("environmentSnapshotVersions")),
    repoInstallationId: v.optional(v.number()),
    providerConnectionId: v.optional(v.id("providerConnections")),
    repoDefaultBranch: v.optional(v.string()),
    browserProfile: v.optional(
      v.union(
        v.literal("chromium"),
        v.literal("firefox"),
        v.literal("webkit"),
      ),
    ),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("paused"),
        v.literal("disabled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    if (!userId) {
      throw new Error("Authentication required");
    }
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const browserProfile = normalizeBrowser(args.browserProfile);
    const now = Date.now();

    // Verify environment snapshot exists and belongs to team if provided
    if (args.environmentSnapshotId) {
      const snapshot = await ctx.db.get(args.environmentSnapshotId);
      if (!snapshot || snapshot.teamId !== teamId) {
        throw new Error("Environment snapshot not found");
      }
    }

    const existing = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        environmentSnapshotId: args.environmentSnapshotId ?? existing.environmentSnapshotId,
        repoInstallationId: args.repoInstallationId ?? existing.repoInstallationId,
        providerConnectionId:
          args.providerConnectionId ?? existing.providerConnectionId,
        repoDefaultBranch: args.repoDefaultBranch ?? existing.repoDefaultBranch,
        browserProfile,
        status: args.status ?? existing.status ?? "active",
        updatedAt: now,
      });
      return existing._id;
    }

    const id = await ctx.db.insert("previewConfigs", {
      teamId,
      createdByUserId: userId,
      repoFullName,
      repoProvider: "github",
      environmentSnapshotId: args.environmentSnapshotId,
      repoInstallationId: args.repoInstallationId,
      providerConnectionId: args.providerConnectionId,
      repoDefaultBranch: args.repoDefaultBranch,
      browserProfile,
      status: args.status ?? "active",
      lastRunAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

export const getByTeamAndRepo = internalQuery({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const config = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", args.teamId).eq("repoFullName", repoFullName),
      )
      .first();
    return config ?? null;
  },
});

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { log } from "../logger";

export interface ScreenshotCollectorModule {
  claudeCodeCapturePRScreenshots: typeof import("./claudeScreenshotCollector").claudeCodeCapturePRScreenshots;
  normalizeScreenshotOutputDir: typeof import("./claudeScreenshotCollector").normalizeScreenshotOutputDir;
  SCREENSHOT_STORAGE_ROOT: string;
}

/**
 * Determines if we're running in staging mode
 */
export function isStaging(): boolean {
  return process.env.CMUX_IS_STAGING === "true";
}

/**
 * Gets the Convex site URL for HTTP endpoints.
 * Note: HTTP endpoints require the .site URL, not .cloud URL
 */
function getConvexSiteUrl(): string | null {
  // CONVEX_SITE_URL should be the .site URL for HTTP endpoints
  if (process.env.CONVEX_SITE_URL) {
    return process.env.CONVEX_SITE_URL;
  }

  // Try to convert .cloud URL to .site URL
  const cloudUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
  if (cloudUrl) {
    // Convert https://xxx.convex.cloud to https://xxx.convex.site
    return cloudUrl.replace(".convex.cloud", ".convex.site");
  }

  return null;
}

/**
 * Downloads the latest screenshot collector from Convex storage
 */
async function downloadScreenshotCollector(): Promise<string | null> {
  const convexUrl = getConvexSiteUrl();
  if (!convexUrl) {
    log("WARN", "No Convex URL configured, cannot fetch remote screenshot collector");
    return null;
  }

  const staging = isStaging();
  const endpoint = `${convexUrl}/api/host-screenshot-collector/latest?staging=${staging}`;

  log("INFO", "Fetching screenshot collector from Convex", {
    endpoint,
    isStaging: staging,
  });

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      const errorText = await response.text();
      log("WARN", "Failed to fetch screenshot collector info from Convex", {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const releaseInfo = await response.json();
    if (!releaseInfo.url) {
      log("WARN", "No URL in screenshot collector release info", {
        releaseInfo,
      });
      return null;
    }

    log("INFO", "Found screenshot collector release", {
      version: releaseInfo.version,
      commitSha: releaseInfo.commitSha,
      url: releaseInfo.url,
    });

    // Download the actual JS file
    const jsResponse = await fetch(releaseInfo.url);
    if (!jsResponse.ok) {
      log("WARN", "Failed to download screenshot collector JS", {
        status: jsResponse.status,
        url: releaseInfo.url,
      });
      return null;
    }

    const jsContent = await jsResponse.text();

    // Save to a temp file for dynamic import
    const tempDir = path.join(os.tmpdir(), "cmux-screenshot-collector");
    await fs.mkdir(tempDir, { recursive: true });

    const tempFile = path.join(tempDir, `collector-${releaseInfo.version}.mjs`);

    // Check if we already have this version cached
    try {
      await fs.access(tempFile);
      log("INFO", "Using cached screenshot collector", {
        version: releaseInfo.version,
        path: tempFile,
      });
      return tempFile;
    } catch {
      // File doesn't exist, write it
    }

    await fs.writeFile(tempFile, jsContent);
    log("INFO", "Downloaded and cached screenshot collector", {
      version: releaseInfo.version,
      path: tempFile,
      size: jsContent.length,
    });

    return tempFile;
  } catch (error) {
    log("ERROR", "Failed to download screenshot collector", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

let cachedModule: ScreenshotCollectorModule | null = null;

/**
 * Loads the screenshot collector module.
 *
 * Priority:
 * 1. Try to fetch the latest version from Convex (based on CMUX_IS_STAGING)
 * 2. Fall back to the bundled version
 */
export async function loadScreenshotCollector(): Promise<ScreenshotCollectorModule> {
  // Return cached module if available
  if (cachedModule) {
    return cachedModule;
  }

  // Try to download the latest version from Convex
  const remotePath = await downloadScreenshotCollector();

  if (remotePath) {
    try {
      // Use file:// URL for dynamic import
      const moduleUrl = `file://${remotePath}`;
      const remoteModule = await import(moduleUrl);

      log("INFO", "Successfully loaded remote screenshot collector", {
        path: remotePath,
      });

      cachedModule = remoteModule as ScreenshotCollectorModule;
      return cachedModule;
    } catch (error) {
      log("ERROR", "Failed to load remote screenshot collector, falling back to bundled", {
        error: error instanceof Error ? error.message : String(error),
        path: remotePath,
      });
    }
  }

  // Fall back to bundled version
  log("INFO", "Using bundled screenshot collector");
  const bundledModule = await import("./claudeScreenshotCollector");
  cachedModule = bundledModule as ScreenshotCollectorModule;
  return cachedModule;
}

/**
 * Clears the cached module (useful for testing or forcing a refresh)
 */
export function clearScreenshotCollectorCache(): void {
  cachedModule = null;
}

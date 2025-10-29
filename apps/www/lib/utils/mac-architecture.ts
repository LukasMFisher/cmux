import type { MacArchitecture } from "@/lib/releases";

const stripQuotes = (value: string): string => value.replaceAll('"', "");

const isMacPlatformValue = (value: string): boolean => {
  const normalized = value.toLowerCase();

  return (
    normalized === "macos" ||
    normalized === "mac os" ||
    normalized === "mac" ||
    normalized === "macintosh"
  );
};

export const normalizeMacArchitecture = (
  value: string | null | undefined,
): MacArchitecture | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "universal" || normalized === "universal2") {
    return "universal";
  }

  if (normalized === "arm" || normalized === "arm64" || normalized === "aarch64") {
    return "arm64";
  }

  if (
    normalized === "x86" ||
    normalized === "x86_64" ||
    normalized === "amd64" ||
    normalized === "x64"
  ) {
    return "x64";
  }

  return null;
};

export const inferMacArchitectureFromUserAgent = (
  userAgent: string | null | undefined,
): MacArchitecture | null => {
  if (typeof userAgent !== "string") {
    return null;
  }

  const normalized = userAgent.toLowerCase();

  if (!normalized.includes("mac")) {
    return null;
  }

  if (normalized.includes("arm") || normalized.includes("aarch64")) {
    return "arm64";
  }

  if (
    normalized.includes("x86_64") ||
    normalized.includes("intel") ||
    normalized.includes("x64") ||
    normalized.includes("amd64")
  ) {
    return "x64";
  }

  return null;
};

export const detectMacArchitectureFromHeaders = (
  headers: Headers,
): MacArchitecture | null => {
  const platformHeader = headers.get("sec-ch-ua-platform");

  if (platformHeader) {
    const normalizedPlatform = stripQuotes(platformHeader).trim();

    if (!isMacPlatformValue(normalizedPlatform)) {
      return null;
    }
  }

  const architectureHeader = headers.get("sec-ch-ua-arch");
  const architectureHint = normalizeMacArchitecture(
    architectureHeader ? stripQuotes(architectureHeader).trim() : null,
  );

  if (architectureHint) {
    return architectureHint;
  }

  return inferMacArchitectureFromUserAgent(headers.get("user-agent"));
};

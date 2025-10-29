import { describe, expect, it } from "vitest";

import {
  detectMacArchitectureFromHeaders,
  inferMacArchitectureFromUserAgent,
  normalizeMacArchitecture,
} from "./mac-architecture";

describe("normalizeMacArchitecture", () => {
  it("normalizes known architecture aliases", () => {
    expect(normalizeMacArchitecture("Universal")).toBe("universal");
    expect(normalizeMacArchitecture("universal2")).toBe("universal");
    expect(normalizeMacArchitecture("arm")).toBe("arm64");
    expect(normalizeMacArchitecture("AARCH64")).toBe("arm64");
    expect(normalizeMacArchitecture("x86")).toBe("x64");
    expect(normalizeMacArchitecture("amd64")).toBe("x64");
  });

  it("returns null for unknown values", () => {
    expect(normalizeMacArchitecture("ppc")).toBeNull();
    expect(normalizeMacArchitecture("")).toBeNull();
    expect(normalizeMacArchitecture(undefined)).toBeNull();
  });
});

describe("inferMacArchitectureFromUserAgent", () => {
  it("detects apple silicon from user agent", () => {
    expect(
      inferMacArchitectureFromUserAgent(
        "Mozilla/5.0 (Macintosh; arm64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
      ),
    ).toBe("arm64");
  });

  it("detects intel mac from user agent", () => {
    expect(
      inferMacArchitectureFromUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      ),
    ).toBe("x64");
  });

  it("returns null for non-mac user agents", () => {
    expect(
      inferMacArchitectureFromUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      ),
    ).toBeNull();
  });
});

describe("detectMacArchitectureFromHeaders", () => {
  it("returns null when platform header indicates non-mac", () => {
    const headers = new Headers({
      "sec-ch-ua-platform": '"Windows"',
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });

    expect(detectMacArchitectureFromHeaders(headers)).toBeNull();
  });

  it("prefers sec-ch-ua-arch when available", () => {
    const headers = new Headers({
      "sec-ch-ua-platform": '"macOS"',
      "sec-ch-ua-arch": '"arm64"',
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
    });

    expect(detectMacArchitectureFromHeaders(headers)).toBe("arm64");
  });

  it("falls back to user agent heuristics", () => {
    const headers = new Headers({
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15",
    });

    expect(detectMacArchitectureFromHeaders(headers)).toBe("x64");
  });
});

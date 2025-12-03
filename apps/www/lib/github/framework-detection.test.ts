import { describe, expect, it } from "vitest";
import { detectFrameworkAndPackageManager } from "./framework-detection";

// These tests make real GitHub API calls.
// Without authentication, we're limited to 60 requests/hour.
// Set GITHUB_TOKEN env var for higher rate limits.
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

describe("detectFrameworkAndPackageManager", () => {
  it("detects stack-auth/stack-auth as pnpm with dev script", async () => {
    const result = await detectFrameworkAndPackageManager("stack-auth/stack-auth", GITHUB_TOKEN);

    expect(result.packageManager).toBe("pnpm");
    expect(result.maintenanceScript).toBe("pnpm install");
    expect(result.devScript).toBe("pnpm run dev");
  }, 30000);

  it("detects manaflow-ai/cmux as bun (no dev script in package.json)", async () => {
    const result = await detectFrameworkAndPackageManager("manaflow-ai/cmux", GITHUB_TOKEN);

    expect(result.packageManager).toBe("bun");
    expect(result.maintenanceScript).toBe("bun install");
    // cmux uses ./scripts/dev.sh, not a package.json script
    expect(result.devScript).toBe("");
  }, 30000);

  it("detects calcom/cal.com as yarn with dev script", async () => {
    const result = await detectFrameworkAndPackageManager("calcom/cal.com", GITHUB_TOKEN);

    expect(result.packageManager).toBe("yarn");
    expect(result.maintenanceScript).toBe("yarn install");
    expect(result.devScript).toBe("yarn dev");
  }, 30000);
});

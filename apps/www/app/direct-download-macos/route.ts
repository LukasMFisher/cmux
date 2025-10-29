import type { MacArchitecture, MacDownloadUrls } from "@/lib/releases";
import { fetchLatestRelease } from "@/lib/fetch-latest-release";
import { detectMacArchitectureFromHeaders } from "@/lib/utils/mac-architecture";

const pickDownloadUrl = (
  macDownloadUrls: MacDownloadUrls,
  fallbackUrl: string,
  architecture: MacArchitecture | null,
): string => {
  if (architecture) {
    const candidate = macDownloadUrls[architecture];

    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }

  if (macDownloadUrls.universal) {
    return macDownloadUrls.universal;
  }

  if (macDownloadUrls.arm64) {
    return macDownloadUrls.arm64;
  }

  if (macDownloadUrls.x64) {
    return macDownloadUrls.x64;
  }

  return fallbackUrl;
};

export async function GET(request: Request): Promise<Response> {
  const { macDownloadUrls, fallbackUrl } = await fetchLatestRelease();
  const architectureHint = detectMacArchitectureFromHeaders(request.headers);
  const redirectUrl = pickDownloadUrl(macDownloadUrls, fallbackUrl, architectureHint);

  return Response.redirect(redirectUrl, 302);
}

"use client";

import {
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
} from "react";

import type { MacArchitecture, MacDownloadUrls } from "@/lib/releases";
import {
  inferMacArchitectureFromUserAgent,
  normalizeMacArchitecture,
} from "@/lib/utils/mac-architecture";

type MacDownloadLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  urls: MacDownloadUrls;
  fallbackUrl: string;
  autoDetect?: boolean;
  architecture?: MacArchitecture;
};

const getNavigatorArchitectureHint = (): MacArchitecture | null => {
  if (typeof navigator === "undefined") {
    return null;
  }

  const platform = navigator.platform?.toLowerCase() ?? "";
  const userAgent = navigator.userAgent;
  const normalizedUserAgent = userAgent.toLowerCase();
  const isMac = platform.includes("mac") || normalizedUserAgent.includes("macintosh");

  if (!isMac) {
    return null;
  }

  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: {
      architecture?: string;
      getHighEntropyValues?: (
        hints: readonly string[],
      ) => Promise<Record<string, unknown>>;
    };
  };

  const uaData = navigatorWithUAData.userAgentData;

  if (uaData) {
    const architectureHint = normalizeMacArchitecture(uaData.architecture);

    if (architectureHint) {
      return architectureHint;
    }
  }

  return inferMacArchitectureFromUserAgent(userAgent);
};

const detectMacArchitecture = async (): Promise<MacArchitecture | null> => {
  const immediateHint = getNavigatorArchitectureHint();

  if (immediateHint) {
    return immediateHint;
  }

  if (typeof navigator === "undefined") {
    return null;
  }

  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: {
      architecture?: string;
      getHighEntropyValues?: (
        hints: readonly string[],
      ) => Promise<Record<string, unknown>>;
    };
  };

  const uaData = navigatorWithUAData.userAgentData;

  if (!uaData || typeof uaData.getHighEntropyValues !== "function") {
    return inferMacArchitectureFromUserAgent(navigator.userAgent);
  }

  const details = await uaData
    .getHighEntropyValues(["architecture"])
    .catch(() => null);

  if (details && typeof details === "object") {
    const maybeValue = (details as Record<string, unknown>).architecture;
    const normalizedArchitecture = normalizeMacArchitecture(
      typeof maybeValue === "string" ? maybeValue : null,
    );

    if (normalizedArchitecture) {
      return normalizedArchitecture;
    }
  }

  return inferMacArchitectureFromUserAgent(navigator.userAgent);
};

const resolveUrl = (
  urls: MacDownloadUrls,
  architecture: MacArchitecture,
  fallbackUrl: string,
): string => {
  const candidate = urls[architecture];

  if (typeof candidate === "string" && candidate.trim() !== "") {
    return candidate;
  }

  return fallbackUrl;
};

export function MacDownloadLink({
  urls,
  fallbackUrl,
  autoDetect = false,
  architecture,
  ...anchorProps
}: MacDownloadLinkProps) {
  const sanitizedUrls = useMemo<MacDownloadUrls>(
    () => ({
      universal:
        typeof urls.universal === "string" && urls.universal.trim() !== ""
          ? urls.universal
          : null,
      arm64:
        typeof urls.arm64 === "string" && urls.arm64.trim() !== ""
          ? urls.arm64
          : null,
      x64:
        typeof urls.x64 === "string" && urls.x64.trim() !== ""
          ? urls.x64
          : null,
    }),
    [urls.arm64, urls.universal, urls.x64],
  );

  const autoDefaultUrl = useMemo(() => {
    if (sanitizedUrls.universal) {
      return sanitizedUrls.universal;
    }

    if (sanitizedUrls.arm64) {
      return sanitizedUrls.arm64;
    }

    if (sanitizedUrls.x64) {
      return sanitizedUrls.x64;
    }

    return fallbackUrl;
  }, [fallbackUrl, sanitizedUrls.arm64, sanitizedUrls.universal, sanitizedUrls.x64]);

  const explicitDefaultUrl = useMemo(() => {
    if (architecture) {
      return resolveUrl(sanitizedUrls, architecture, fallbackUrl);
    }

    if (autoDetect) {
      const detected = getNavigatorArchitectureHint();

      if (detected) {
        return resolveUrl(sanitizedUrls, detected, fallbackUrl);
      }
    }

    return autoDefaultUrl;
  }, [architecture, autoDefaultUrl, autoDetect, fallbackUrl, sanitizedUrls]);

  const [href, setHref] = useState<string>(explicitDefaultUrl);

  useEffect(() => {
    setHref(explicitDefaultUrl);
  }, [explicitDefaultUrl]);

  useEffect(() => {
    if (!autoDetect) {
      return;
    }

    const synchronousHint = getNavigatorArchitectureHint();

    if (synchronousHint) {
      setHref(resolveUrl(sanitizedUrls, synchronousHint, fallbackUrl));
    }

    let isMounted = true;

    const run = async () => {
      const detectedArchitecture = await detectMacArchitecture();

      if (!isMounted || !detectedArchitecture) {
        return;
      }

      setHref(resolveUrl(sanitizedUrls, detectedArchitecture, fallbackUrl));
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [autoDetect, fallbackUrl, sanitizedUrls]);

  return <a {...anchorProps} href={href} />;
}

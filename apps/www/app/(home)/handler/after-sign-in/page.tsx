import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/utils/www-env";
import { OpenCmuxClient } from "./OpenCmuxClient";

export const dynamic = "force-dynamic";

type AfterSignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CMUX_SCHEME = "cmux://";

function getSingleValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function isRelativePath(target: string): boolean {
  if (!target) {
    return false;
  }
  if (target.startsWith("//")) {
    return false;
  }
  return target.startsWith("/");
}

/**
 * Check if a URL is same-origin (safe to redirect to).
 * Returns the pathname if safe, null otherwise.
 */
function getSafeRedirectPath(target: string, currentOrigin: string): string | null {
  if (!target) {
    return null;
  }

  // Relative paths are always safe
  if (isRelativePath(target)) {
    return target;
  }

  // Check if it's an absolute URL pointing to the same origin
  try {
    const targetUrl = new URL(target);

    // Only allow same-origin redirects
    if (targetUrl.origin === currentOrigin) {
      // Return the pathname + search + hash (not the full URL)
      return targetUrl.pathname + targetUrl.search + targetUrl.hash;
    }
  } catch {
    // Invalid URL, not safe
    return null;
  }

  return null;
}

function buildCmuxHref(baseHref: string | null, stackRefreshToken: string | undefined, stackAccessToken: string | undefined): string | null {
  if (!stackRefreshToken || !stackAccessToken) {
    return baseHref;
  }

  const pairedHref = baseHref ?? `${CMUX_SCHEME}auth-callback`;

  try {
    const url = new URL(pairedHref);
    url.searchParams.set("stack_refresh", stackRefreshToken);
    url.searchParams.set("stack_access", stackAccessToken);
    return url.toString();
  } catch {
    return `${CMUX_SCHEME}auth-callback?stack_refresh=${encodeURIComponent(stackRefreshToken)}&stack_access=${encodeURIComponent(stackAccessToken)}`;
  }
}

export default async function AfterSignInPage({ searchParams: searchParamsPromise }: AfterSignInPageProps) {
  const stackCookies = await cookies();
  const stackRefreshToken = stackCookies.get(`stack-refresh-${env.NEXT_PUBLIC_STACK_PROJECT_ID}`)?.value;
  const stackAccessToken = stackCookies.get("stack-access")?.value;

  const searchParams = await searchParamsPromise;
  const afterAuthReturnToRaw = getSingleValue(searchParams?.after_auth_return_to ?? undefined);

  // Get current origin from request headers or env
  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") || "https";
  const currentOrigin = env.NEXT_PUBLIC_BASE_APP_URL
    ? new URL(env.NEXT_PUBLIC_BASE_APP_URL).origin
    : (host ? `${protocol}://${host}` : "https://localhost:3000");

  console.log("[After Sign In] Processing redirect:", {
    afterAuthReturnTo: afterAuthReturnToRaw,
    currentOrigin,
    hasRefreshToken: !!stackRefreshToken,
    hasAccessToken: !!stackAccessToken,
  });

  // Handle Electron deep link redirects
  if (afterAuthReturnToRaw?.startsWith(CMUX_SCHEME)) {
    console.log("[After Sign In] Opening Electron app with deep link");
    const cmuxHref = buildCmuxHref(afterAuthReturnToRaw, stackRefreshToken, stackAccessToken);
    if (cmuxHref) {
      return <OpenCmuxClient href={cmuxHref} />;
    }
  }

  // Handle web redirects (relative paths or same-origin absolute URLs)
  if (afterAuthReturnToRaw) {
    const safePath = getSafeRedirectPath(afterAuthReturnToRaw, currentOrigin);
    if (safePath) {
      console.log("[After Sign In] Redirecting to web path:", safePath);
      redirect(safePath);
    } else {
      console.warn("[After Sign In] Unsafe redirect URL blocked:", afterAuthReturnToRaw);
    }
  }

  // Fallback: try to open Electron app
  console.log("[After Sign In] No return path, using fallback");
  const fallbackHref = buildCmuxHref(null, stackRefreshToken, stackAccessToken);
  if (fallbackHref) {
    return <OpenCmuxClient href={fallbackHref} />;
  }

  // Final fallback: redirect to home
  redirect("/");
}

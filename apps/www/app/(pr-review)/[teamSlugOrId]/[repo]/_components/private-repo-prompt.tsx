"use client";

import { useState } from "react";
import { AlertCircle, Github } from "lucide-react";

interface PrivateRepoPromptProps {
  teamSlugOrId: string;
  repo: string;
  githubOwner: string;
  githubAppSlug?: string;
}

export function PrivateRepoPrompt({
  teamSlugOrId,
  repo,
  githubOwner,
  githubAppSlug: githubAppSlugProp,
}: PrivateRepoPromptProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstallApp = async () => {
    setIsRedirecting(true);
    setError(null);

    try {
      // Check if GitHub App slug is configured
      // Use prop if available, otherwise try to get from client-side env
      const githubAppSlug = githubAppSlugProp || process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
      if (!githubAppSlug) {
        setError("GitHub App is not configured. Please contact support.");
        setIsRedirecting(false);
        return;
      }

      // Generate install state token from API with return URL
      const currentUrl = window.location.href;
      console.log("[PrivateRepoPrompt] Starting installation flow with return URL:", currentUrl);

      const response = await fetch("/api/integrations/github/install-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId,
          returnUrl: currentUrl,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 403) {
          setError("You don't have permission to install the app for this team.");
        } else if (response.status === 401) {
          setError("You need to sign in first. Redirecting...");
          // Redirect to sign in with return path
          setTimeout(() => {
            const returnTo = encodeURIComponent(window.location.pathname);
            window.location.href = `/sign-in?after_auth_return_to=${returnTo}`;
          }, 2000);
        } else {
          setError(`Failed to start installation: ${text}`);
        }
        setIsRedirecting(false);
        return;
      }

      const { state } = await response.json();

      const installUrl = new URL(
        `https://github.com/apps/${githubAppSlug}/installations/new`
      );
      installUrl.searchParams.set("state", state);

      // Redirect to GitHub App installation
      // The return URL is now encoded in the state token
      window.location.href = installUrl.toString();
    } catch (err) {
      console.error("Failed to initiate GitHub App installation:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsRedirecting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-neutral-900">
                Private Repository Access Required
              </h1>
              <p className="mt-3 text-base text-neutral-600 leading-relaxed">
                The repository{" "}
                <span className="font-mono font-medium text-neutral-900">
                  {githubOwner}/{repo}
                </span>{" "}
                appears to be private or you don&apos;t have access to view it.
              </p>

              <div className="mt-6 space-y-4">
                <div className="rounded-lg bg-neutral-50 p-4 border border-neutral-200">
                  <h2 className="text-sm font-semibold text-neutral-900 mb-2">
                    To continue, you need to:
                  </h2>
                  <ol className="space-y-2 text-sm text-neutral-600">
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 font-semibold text-neutral-900">
                        1.
                      </span>
                      <span>
                        Authenticate with GitHub and install the cmux-agent app
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 font-semibold text-neutral-900">
                        2.
                      </span>
                      <span>
                        Grant access to the repository you want to review
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 font-semibold text-neutral-900">
                        3.
                      </span>
                      <span>
                        You&apos;ll be redirected back to this page automatically
                      </span>
                    </li>
                  </ol>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleInstallApp}
                  disabled={isRedirecting}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRedirecting ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Redirecting to GitHub...</span>
                    </>
                  ) : (
                    <>
                      <Github className="h-5 w-5" />
                      <span>Continue with GitHub</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-neutral-500">
                  By continuing, you&apos;ll be redirected to GitHub to authorize the
                  cmux-agent application.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

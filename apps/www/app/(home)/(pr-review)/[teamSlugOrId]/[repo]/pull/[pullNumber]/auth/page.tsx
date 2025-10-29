import { redirect } from "next/navigation";
import { isRepoPublic } from "@/lib/github/check-repo-visibility";
import { stackServerApp } from "@/lib/utils/stack";
import { PublicRepoAnonymousPrompt } from "../../../_components/public-repo-anonymous-prompt";
import { PrivateRepoPrompt } from "../../../_components/private-repo-prompt";
import { env } from "@/lib/utils/www-env";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  pullNumber: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

function parsePullNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const numericValue = Number.parseInt(raw, 10);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

export default async function AuthPage({ params }: PageProps) {
  const resolvedParams = await params;
  const {
    teamSlugOrId: githubOwner,
    repo,
    pullNumber: pullNumberRaw,
  } = resolvedParams;

  const pullNumber = parsePullNumber(pullNumberRaw);
  if (pullNumber === null) {
    redirect(`/${githubOwner}/${repo}/pull/${pullNumberRaw}`);
  }

  // Check if repository is public
  const repoIsPublic = await isRepoPublic(githubOwner, repo);

  // Check if user is already authenticated
  const user = await stackServerApp.getUser({ or: "return-null" });

  // If already authenticated, redirect back to PR page
  if (user) {
    console.log("[AuthPage] User already authenticated, redirecting to PR page");
    redirect(`/${githubOwner}/${repo}/pull/${pullNumber}`);
  }

  // For public repos, show anonymous auth prompt
  if (repoIsPublic) {
    return (
      <PublicRepoAnonymousPrompt
        teamSlugOrId={githubOwner}
        repo={repo}
        githubOwner={githubOwner}
        pullNumber={pullNumber}
        stackProjectId={env.NEXT_PUBLIC_STACK_PROJECT_ID}
        stackPublishableKey={env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY}
      />
    );
  }

  // For private repos, show GitHub app install prompt
  return (
    <PrivateRepoPrompt
      teamSlugOrId={githubOwner}
      repo={repo}
      githubOwner={githubOwner}
      githubAppSlug={env.NEXT_PUBLIC_GITHUB_APP_SLUG}
    />
  );
}

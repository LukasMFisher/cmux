import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return null;
  }

  if (!posthogClient) {
    posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: "https://us.i.posthog.com",
    });
  }

  return posthogClient;
}

type RepoPageViewEvent = {
  repo: string;
  pageType: "pull_request" | "comparison";
  pullNumber?: number;
  comparison?: string;
  userId?: string;
};

export async function trackRepoPageView(event: RepoPageViewEvent): Promise<void> {
  const client = getPostHogClient();
  if (!client) {
    console.warn("[analytics] PostHog client not initialized - missing API key");
    return;
  }

  try {
    client.capture({
      distinctId: event.userId ?? "anonymous",
      event: "repo_page_viewed",
      properties: {
        repo: event.repo,
        page_type: event.pageType,
        pull_number: event.pullNumber,
        comparison: event.comparison,
      },
    });

    await client.shutdown();
  } catch (error) {
    console.error("[analytics] Failed to track repo page view", error);
  }
}

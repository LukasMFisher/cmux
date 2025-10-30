import { Octokit } from "octokit";

const USER_AGENT = "cmux-www-pr-viewer";

export function createGitHubClient(authToken?: string | null): Octokit {
  const normalizedToken =
    typeof authToken === "string" && authToken.trim().length > 0
      ? authToken
      : process.env.GITHUB_TOKEN;

  return new Octokit({
    auth: normalizedToken,
    userAgent: USER_AGENT,
    request: {
      timeout: 20_000,
    },
  });
}

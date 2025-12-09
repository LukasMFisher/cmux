import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import { queryOptions } from "@tanstack/react-query";
import type { GitHubBranchesResponse, GitHubDefaultBranchResponse } from "@cmux/shared";

/**
 * Fast query to get only the default branch (single API call).
 * Use this when the branch selector is closed.
 */
export function defaultBranchQueryOptions({
  teamSlugOrId,
  repoFullName,
}: {
  teamSlugOrId: string;
  repoFullName: string;
}) {
  return queryOptions<GitHubDefaultBranchResponse>({
    queryKey: ["default-branch", teamSlugOrId, repoFullName],
    queryFn: async () => {
      const socket = await waitForConnectedSocket();
      return await new Promise<GitHubDefaultBranchResponse>((resolve, reject) => {
        socket.emit(
          "github-fetch-default-branch",
          { teamSlugOrId, repo: repoFullName },
          (response: GitHubDefaultBranchResponse) => {
            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(response.error || "Failed to load default branch"));
            }
          }
        );
      });
    },
    staleTime: 60_000, // Default branch rarely changes
  });
}

/**
 * Query to fetch branches with optional search filter.
 * Use this when the branch selector is opened or when searching.
 */
export function branchesQueryOptions({
  teamSlugOrId,
  repoFullName,
  search,
}: {
  teamSlugOrId: string;
  repoFullName: string;
  search?: string;
}) {
  return queryOptions<GitHubBranchesResponse>({
    queryKey: ["branches", teamSlugOrId, repoFullName, search ?? ""],
    queryFn: async () => {
      const socket = await waitForConnectedSocket();
      return await new Promise<GitHubBranchesResponse>((resolve, reject) => {
        socket.emit(
          "github-fetch-branches",
          { teamSlugOrId, repo: repoFullName, search },
          (response: GitHubBranchesResponse) => {
            if (response.success) {
              resolve(response);
            } else {
              reject(new Error(response.error || "Failed to load branches"));
            }
          }
        );
      });
    },
    staleTime: 10_000,
  });
}

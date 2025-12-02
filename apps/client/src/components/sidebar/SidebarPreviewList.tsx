import { TaskTree } from "@/components/TaskTree";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQuery as useConvexQuery, useQueries } from "convex/react";
import { useMemo } from "react";

type Props = {
  teamSlugOrId: string;
  limit?: number;
};

// Increase limit to ensure we capture enough preview runs to get all unique tasks
const DEFAULT_LIMIT = 50;

export function SidebarPreviewList({
  teamSlugOrId,
  limit = DEFAULT_LIMIT,
}: Props) {
  const previewRuns = useConvexQuery(api.previewRuns.listByTeam, {
    teamSlugOrId,
    limit,
  });

  const list = useMemo(() => previewRuns ?? [], [previewRuns]);

  // Get unique task IDs from preview runs, preserving order (most recent preview run first)
  // Also track the preview run status for each task to help with sorting
  const { taskIds, taskPreviewStatus } = useMemo(() => {
    const seen = new Set<Id<"tasks">>();
    const ids: Id<"tasks">[] = [];
    const statusMap = new Map<Id<"tasks">, string>();

    for (const run of list) {
      if (run.taskId && !seen.has(run.taskId)) {
        seen.add(run.taskId);
        ids.push(run.taskId);
        // Track the status of the most recent preview run for this task
        statusMap.set(run.taskId, run.status);
      }
    }
    return { taskIds: ids, taskPreviewStatus: statusMap };
  }, [list]);

  // Batch fetch all tasks in parallel using useQueries
  const taskQueries = useMemo(() => {
    return taskIds.reduce(
      (acc, taskId) => ({
        ...acc,
        [taskId]: {
          query: api.tasks.getById,
          args: { teamSlugOrId, id: taskId },
        },
      }),
      {} as Record<
        Id<"tasks">,
        {
          query: typeof api.tasks.getById;
          args: { teamSlugOrId: string; id: Id<"tasks"> };
        }
      >
    );
  }, [taskIds, teamSlugOrId]);

  const taskResults = useQueries(
    taskQueries as Parameters<typeof useQueries>[0]
  );

  // Build ordered list of tasks:
  // 1. Filter out archived tasks
  // 2. Sort by status: in-progress first (pending/running), then completed
  // 3. Within each group, preserve the preview run order (most recent first)
  const tasks = useMemo(() => {
    const validTasks = taskIds
      .map((id) => {
        const task = taskResults?.[id];
        if (!task || task.isArchived) return null;
        const previewStatus = taskPreviewStatus.get(id);
        const isInProgress = previewStatus === "pending" || previewStatus === "running";
        return { task, isInProgress };
      })
      .filter((item): item is NonNullable<typeof item> => item != null);

    // Sort: in-progress first, then completed (preserving original order within groups)
    const inProgress = validTasks.filter((t) => t.isInProgress).map((t) => t.task);
    const completed = validTasks.filter((t) => !t.isInProgress).map((t) => t.task);

    return [...inProgress, ...completed];
  }, [taskIds, taskResults, taskPreviewStatus]);

  if (previewRuns === undefined) {
    return (
      <div className="space-y-px" aria-label="Loading previews">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="px-2 py-1.5">
            <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <p className="mt-1 pl-2 pr-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 select-none">
        No preview runs
      </p>
    );
  }

  if (tasks.length === 0 && taskIds.length > 0) {
    // Still loading tasks
    return (
      <div className="space-y-px" aria-label="Loading previews">
        {Array.from({ length: Math.min(3, taskIds.length) }).map((_, index) => (
          <div key={index} className="px-2 py-1.5">
            <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {tasks.map((task) => (
        <TaskTree
          key={task._id}
          task={task}
          defaultExpanded={false}
          teamSlugOrId={teamSlugOrId}
        />
      ))}
    </div>
  );
}

export default SidebarPreviewList;

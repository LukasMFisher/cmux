import { TaskTree } from "@/components/TaskTree";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useQuery as useConvexQuery } from "convex/react";
import { useMemo } from "react";

type Props = {
  teamSlugOrId: string;
  limit?: number;
};

const DEFAULT_LIMIT = 10;

export function SidebarPreviewList({
  teamSlugOrId,
  limit = DEFAULT_LIMIT,
}: Props) {
  const previewRuns = useConvexQuery(api.previewRuns.listByTeam, {
    teamSlugOrId,
    limit,
  });

  const list = useMemo(() => previewRuns ?? [], [previewRuns]);

  // Get unique task IDs from preview runs
  const taskIds = useMemo(() => {
    const ids = new Set<Id<"tasks">>();
    for (const run of list) {
      if (run.taskId) {
        ids.add(run.taskId);
      }
    }
    return Array.from(ids);
  }, [list]);

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

  return (
    <div className="space-y-px">
      {taskIds.map((taskId) => (
        <PreviewTaskTree
          key={taskId}
          taskId={taskId}
          teamSlugOrId={teamSlugOrId}
        />
      ))}
    </div>
  );
}

type PreviewTaskTreeProps = {
  taskId: Id<"tasks">;
  teamSlugOrId: string;
};

function PreviewTaskTree({ taskId, teamSlugOrId }: PreviewTaskTreeProps) {
  const task = useConvexQuery(api.tasks.getById, {
    teamSlugOrId,
    id: taskId,
  });

  if (!task) {
    return (
      <div className="px-2 py-1.5">
        <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
      </div>
    );
  }

  return (
    <TaskTree
      task={task}
      defaultExpanded={false}
      teamSlugOrId={teamSlugOrId}
    />
  );
}

export default SidebarPreviewList;

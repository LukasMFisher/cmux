import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonitorUp } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TaskRunTerminalSession } from "./task-run-terminal-session";
import { toMorphXtermBaseUrl } from "@/lib/toProxyWorkspaceUrl";
import {
  createTerminalTab,
  terminalTabsQueryKey,
  terminalTabsQueryOptions,
  type TerminalTabId,
} from "@/queries/terminals";

export interface TaskRunTerminalPaneProps {
  workspaceUrl: string | null;
}

const INITIAL_AUTO_CREATE_DELAY_MS = 4_000;
const MAX_AUTO_CREATE_ATTEMPTS = 3;
const AUTO_RETRY_BASE_DELAY_MS = 4_000;

export function TaskRunTerminalPane({ workspaceUrl }: TaskRunTerminalPaneProps) {
  const baseUrl = useMemo(() => {
    if (!workspaceUrl) {
      return null;
    }
    return toMorphXtermBaseUrl(workspaceUrl);
  }, [workspaceUrl]);

  const hasTerminalBackend = Boolean(baseUrl);
  const queryClient = useQueryClient();

  const tabsQuery = useQuery(
    terminalTabsQueryOptions({
      baseUrl,
      contextKey: workspaceUrl,
      enabled: hasTerminalBackend,
    })
  );

  const {
    data: tabs,
    isLoading: isTabsLoading,
    isError: isTabsError,
    error: tabsError,
  } = tabsQuery;

  const terminalIds = useMemo(() => tabs ?? [], [tabs]);
  const tabsQueryKey = useMemo(
    () => terminalTabsQueryKey(baseUrl, workspaceUrl),
    [baseUrl, workspaceUrl]
  );

  const workspaceReadyAtRef = useRef<number | null>(null);
  const autoCreateStateRef = useRef<{
    context: string | null;
    inFlight: boolean;
    attempts: number;
  }>({ context: null, inFlight: false, attempts: 0 });
  const retryTimeoutRef = useRef<number | null>(null);
  const autoCreateAttemptRef = useRef<((options?: { manual?: boolean }) => void) | null>(
    null
  );

  const [autoCreateError, setAutoCreateError] = useState<string | null>(null);
  const [autoCreateAttemptCount, setAutoCreateAttemptCount] = useState(0);

  useEffect(() => {
    if (!baseUrl) {
      workspaceReadyAtRef.current = null;
      return;
    }
    workspaceReadyAtRef.current = Date.now();
  }, [baseUrl]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current !== null) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  const scheduleRetry = useCallback((delayMs: number) => {
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current);
    }
    retryTimeoutRef.current = window.setTimeout(() => {
      retryTimeoutRef.current = null;
      autoCreateAttemptRef.current?.();
    }, delayMs);
  }, []);

  const attemptAutoCreate = useCallback(
    (options?: { manual?: boolean }) => {
      if (!workspaceUrl || !baseUrl || !hasTerminalBackend) {
        return;
      }

      if (terminalIds.length > 0) {
        setAutoCreateError(null);
        setAutoCreateAttemptCount(0);
        const current = autoCreateStateRef.current;
        current.inFlight = false;
        current.attempts = 0;
        if (retryTimeoutRef.current !== null) {
          window.clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        return;
      }

      const contextIdentifier = `${baseUrl}|${workspaceUrl}`;
      const state = autoCreateStateRef.current;

      if (state.context !== contextIdentifier) {
        state.context = contextIdentifier;
        state.attempts = 0;
      }

      if (state.inFlight) {
        return;
      }

      if (!options?.manual) {
        const readyAt = workspaceReadyAtRef.current;
        if (readyAt) {
          const elapsed = Date.now() - readyAt;
          if (elapsed < INITIAL_AUTO_CREATE_DELAY_MS) {
            scheduleRetry(INITIAL_AUTO_CREATE_DELAY_MS - elapsed);
            return;
          }
        }

        if (state.attempts >= MAX_AUTO_CREATE_ATTEMPTS) {
          return;
        }
      }

      state.inFlight = true;
      state.attempts += 1;
      setAutoCreateAttemptCount(state.attempts);
      setAutoCreateError(null);

      (async () => {
        try {
          const created = await createTerminalTab({
            baseUrl,
            request: {
              cmd: "tmux",
              args: ["new-session", "-A", "-s", "cmux"],
            },
          });

          queryClient.setQueryData<TerminalTabId[]>(tabsQueryKey, (current) => {
            if (!current || current.length === 0) {
              return [created.id];
            }
            if (current.includes(created.id)) {
              return current;
            }
            return [...current, created.id];
          });

          state.inFlight = false;
          state.attempts = 0;
          setAutoCreateAttemptCount(0);
          setAutoCreateError(null);
          if (retryTimeoutRef.current !== null) {
            window.clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
          }
        } catch (error) {
          console.error("Failed to auto-create tmux terminal", error);
          state.inFlight = false;

          const shouldRetryAutomatically = !options?.manual && state.attempts < MAX_AUTO_CREATE_ATTEMPTS;
          if (shouldRetryAutomatically) {
            const delay = AUTO_RETRY_BASE_DELAY_MS * state.attempts;
            scheduleRetry(delay);
            return;
          }

          const message =
            error instanceof Error ? error.message : "Unable to connect to tmux session.";
          setAutoCreateError(message);
        }
      })();
    },
    [
      baseUrl,
      hasTerminalBackend,
      queryClient,
      scheduleRetry,
      tabsQueryKey,
      terminalIds.length,
      workspaceUrl,
    ]
  );

  useEffect(() => {
    autoCreateAttemptRef.current = attemptAutoCreate;
  }, [attemptAutoCreate]);

  useEffect(() => {
    if (isTabsLoading || isTabsError) {
      return;
    }
    attemptAutoCreate();
  }, [attemptAutoCreate, isTabsError, isTabsLoading]);

  const handleManualRetry = useCallback(() => {
    const state = autoCreateStateRef.current;
    state.attempts = 0;
    state.inFlight = false;
    setAutoCreateError(null);
    setAutoCreateAttemptCount(0);
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    workspaceReadyAtRef.current = Date.now() - INITIAL_AUTO_CREATE_DELAY_MS;
    attemptAutoCreate({ manual: true });
  }, [attemptAutoCreate]);

  const activeTerminalId = terminalIds[0] ?? null;

  if (!workspaceUrl || !baseUrl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 animate-pulse" aria-hidden />
        <span>Terminal is starting...</span>
      </div>
    );
  }

  if (isTabsLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 animate-pulse" aria-hidden />
        <span>Loading terminal...</span>
      </div>
    );
  }

  if (isTabsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 text-red-500" aria-hidden />
        <span className="text-red-500 dark:text-red-400">
          {tabsError instanceof Error ? tabsError.message : "Failed to load terminal"}
        </span>
      </div>
    );
  }

  if (terminalIds.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-neutral-500 dark:text-neutral-400">
        <MonitorUp className="size-4 animate-pulse" aria-hidden />
        <div className="flex flex-col gap-1">
          <span>
            {autoCreateError
              ? autoCreateError
              : "Waiting for a terminal session..."}
          </span>
          {!autoCreateError && autoCreateAttemptCount > 0 ? (
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              {`Attempt ${Math.min(autoCreateAttemptCount, MAX_AUTO_CREATE_ATTEMPTS)} of ${MAX_AUTO_CREATE_ATTEMPTS}`}
            </span>
          ) : null}
        </div>
        {autoCreateError ? (
          <button
            type="button"
            onClick={handleManualRetry}
            className="inline-flex items-center justify-center rounded border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-100"
          >
            Retry terminal
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-black">
      <TaskRunTerminalSession
        baseUrl={baseUrl}
        terminalId={activeTerminalId}
        isActive={true}
      />
    </div>
  );
}

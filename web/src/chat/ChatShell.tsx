import { Client } from "@langchain/langgraph-sdk";
import { useColorScheme } from "@langchain/macaw-components/hooks/useColorScheme";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { DesktopIcon } from "@phosphor-icons/react/dist/ssr/Desktop";
import { ListIcon } from "@phosphor-icons/react/dist/ssr/List";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SignOutIcon } from "@phosphor-icons/react/dist/ssr/SignOut";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Brand } from "../app/Brand";
import type { Route } from "../app/route";
import { SegmentedControl, type SegmentedOption } from "../app/SegmentedControl";
import { apiFetch, withHeaders, type Session } from "../auth/session";
import type { AgentEnvironment, AppConfig } from "../config";
import { ChatView } from "./ChatView";
import type { FeedbackDeps } from "./FeedbackBar";
import { findProjectId, traceUrl } from "./langsmith";
import { BAR_HEIGHT, ThreadRail, ThreadSidebar } from "./ThreadSidebar";
import { mergeRunIds, toThreadSummaries, toTitle, type ThreadSummary } from "./threads";

interface ChatShellProps {
  readonly config: AppConfig;
  readonly environment: AgentEnvironment;
  readonly threadId: string | null;
  readonly auth: Session;
  readonly onNavigate: (route: Route, options?: { replace?: boolean }) => void;
  readonly onSignOut: () => void;
}

type ThemeMode = "light" | "dark" | "system";

const THEME_OPTIONS: readonly SegmentedOption<ThemeMode>[] = [
  { value: "light", label: "Light theme", icon: SunIcon },
  { value: "dark", label: "Dark theme", icon: MoonIcon },
  { value: "system", label: "Match system theme", icon: DesktopIcon },
];

const COLLAPSED_KEY = "chat-langchain-lite:sidebar-collapsed";

export function ChatShell({
  config,
  environment,
  threadId,
  auth,
  onNavigate,
  onSignOut,
}: ChatShellProps) {
  const client = useMemo(
    () =>
      new Client({
        apiUrl: environment.url,
        onRequest: async (_url, init) => withHeaders(init, await auth.agentHeaders()),
      }),
    [environment.url, auth],
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const toggleCollapsed = () =>
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  // Bumped only by user navigation, so assigning an id to a brand-new thread doesn't remount the stream.
  const [session, setSession] = useState(0);

  const { threads, threadsError, refreshThreads } = useThreads(client, auth.ownerId);
  const { runIds, addLiveRun } = useRunIds(client, threadId);
  const feedback = useFeedbackDeps(config.workspaceId, environment, auth);
  // The server creates a new thread together with its first run, so its title waits for that run.
  const pendingTitle = useRef<{ threadId: string; title: string } | null>(null);

  const finishRun = () => {
    const pending = pendingTitle.current;
    pendingTitle.current = null;
    if (!pending) return refreshThreads();
    client.threads
      .update(pending.threadId, { metadata: { title: pending.title } })
      .catch(() => undefined)
      .finally(refreshThreads);
  };

  const go = (route: Route) => {
    setSidebarOpen(false);
    setSession((value) => value + 1);
    onNavigate(route);
  };

  const sidebar = {
    threads,
    error: threadsError,
    selectedId: threadId,
    onSelect: (id: string) => go({ environment: environment.id, threadId: id }),
    onNewChat: () => go({ environment: environment.id, threadId: null }),
  };

  return (
    <div className="flex h-full bg-surface-level-1 text-primary">
      {/* Desktop: a full-height sidebar that collapses to a rail. */}
      <aside
        className={`hidden shrink-0 border-r border-default transition-[width] duration-200 lg:block ${
          collapsed ? "w-14" : "w-64"
        }`}
      >
        {collapsed ? (
          <ThreadRail onExpand={toggleCollapsed} onNewChat={sidebar.onNewChat} />
        ) : (
          <ThreadSidebar {...sidebar} onHide={toggleCollapsed} hideLabel="Hide threads" />
        )}
      </aside>

      {/* Mobile and tablet: the same sidebar as a drawer. */}
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close threads"
          className="fixed inset-0 z-10 bg-overlay lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-20 w-72 border-r border-default bg-surface-level-1 transition-transform lg:hidden ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <ThreadSidebar
          {...sidebar}
          onHide={() => setSidebarOpen(false)}
          hideLabel="Close threads"
          footer={
            <div className="flex items-center justify-between sm:hidden">
              <Text variant="xs" color="tertiary">
                Theme
              </Text>
              <ThemePicker />
            </div>
          }
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          config={config}
          environment={environment}
          onOpenSidebar={() => setSidebarOpen(true)}
          onSelectEnvironment={(id) => go({ environment: id, threadId: null })}
          onSignOut={onSignOut}
        />
        <main className="min-h-0 flex-1">
          <ChatView
            key={`${environment.id}:${session}`}
            environment={environment}
            client={client}
            threadId={threadId}
            runIds={runIds}
            feedback={feedback}
            onThreadId={(id, firstMessage) => {
              onNavigate({ environment: environment.id, threadId: id }, { replace: true });
              if (firstMessage)
                pendingTitle.current = { threadId: id, title: toTitle(firstMessage) };
            }}
            onRunCreated={addLiveRun}
            onRunFinished={finishRun}
          />
        </main>
      </div>
    </div>
  );
}

function Header({
  config,
  environment,
  onOpenSidebar,
  onSelectEnvironment,
  onSignOut,
}: {
  readonly config: AppConfig;
  readonly environment: AgentEnvironment;
  readonly onOpenSidebar: () => void;
  readonly onSelectEnvironment: (id: AgentEnvironment["id"]) => void;
  readonly onSignOut: () => void;
}) {
  return (
    <header
      className={`flex ${BAR_HEIGHT} shrink-0 items-center gap-space-2 border-b border-default px-space-3`}
    >
      <div className="lg:hidden">
        <IconButton icon={ListIcon} label="Show threads" variant="plain" onClick={onOpenSidebar} />
      </div>
      <Brand />
      <div className="ml-auto flex items-center gap-space-2">
        {config.environments.length > 1 ? (
          <SegmentedControl
            label="Agent environment"
            tone="brand"
            options={config.environments.map((option) => ({
              value: option.id,
              label: option.label,
            }))}
            value={environment.id}
            onChange={onSelectEnvironment}
          />
        ) : (
          <Text variant="xs" color="tertiary">
            {environment.label}
          </Text>
        )}
        <div className="hidden sm:block">
          <ThemePicker />
        </div>
        <IconButton icon={SignOutIcon} label="Sign out" variant="plain" onClick={onSignOut} />
      </div>
    </header>
  );
}

function ThemePicker() {
  const { mode, setMode } = useColorScheme();
  return <SegmentedControl label="Theme" options={THEME_OPTIONS} value={mode} onChange={setMode} />;
}

function useThreads(client: Client, ownerId: string | undefined) {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.threads
      .search({
        limit: 50,
        metadata: ownerId ? { owner: ownerId } : undefined,
        sortBy: "updated_at",
        sortOrder: "desc",
        select: ["thread_id", "updated_at", "metadata"],
        extract: { first: "values.messages[0].content" },
      })
      .then((rows) => {
        if (cancelled) return;
        setThreads(toThreadSummaries(rows as unknown as Parameters<typeof toThreadSummaries>[0]));
        setThreadsError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setThreads([]);
        setThreadsError(cause instanceof Error ? cause.message : "Couldn't load conversations.");
      });
    return () => {
      cancelled = true;
    };
  }, [client, ownerId, version]);

  const refreshThreads = useCallback(() => setVersion((value) => value + 1), []);
  return { threads, threadsError, refreshThreads };
}

function useRunIds(client: Client, threadId: string | null) {
  const [history, setHistory] = useState<{ run_id: string; created_at: string }[]>([]);
  const [live, setLive] = useState<string[]>([]);

  useEffect(() => {
    setLive([]);
    setHistory([]);
    if (!threadId) return;
    let cancelled = false;
    client.runs
      .list(threadId, { limit: 100 })
      .then((runs) => !cancelled && setHistory(runs))
      .catch(() => !cancelled && setHistory([]));
    return () => {
      cancelled = true;
    };
  }, [client, threadId]);

  const runIds = useMemo(() => mergeRunIds(history, live), [history, live]);
  const addLiveRun = useCallback((runId: string) => setLive((ids) => [...ids, runId]), []);
  return { runIds, addLiveRun };
}

function useFeedbackDeps(
  workspaceId: string,
  environment: AgentEnvironment,
  auth: Session,
): FeedbackDeps {
  const projectIds = useRef(new Map<string, Promise<string | null>>());
  return useMemo(() => {
    const deps = { fetchFn: apiFetch(auth) };
    return {
      ...deps,
      openTrace: (runId: string) => {
        // Open synchronously so popup blockers allow it, then point it at the trace once resolved.
        const tab = window.open("about:blank", "_blank");
        let projectId = projectIds.current.get(environment.projectName);
        if (!projectId) {
          projectId = findProjectId(deps, environment.projectName).catch(() => null);
          projectIds.current.set(environment.projectName, projectId);
        }
        void projectId.then((id) => {
          if (!tab) return;
          if (id) tab.location.href = traceUrl(workspaceId, id, runId);
          else tab.close();
        });
      },
    };
  }, [workspaceId, environment.projectName, auth]);
}

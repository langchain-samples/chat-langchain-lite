import { textOf } from "./turns";

export interface ThreadSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
}

interface ThreadRow {
  readonly thread_id: string;
  readonly updated_at: string;
  readonly metadata?: Record<string, unknown> | null;
  readonly extracted?: Record<string, unknown> | null;
}

const TITLE_LENGTH = 60;

export function toTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > TITLE_LENGTH ? `${clean.slice(0, TITLE_LENGTH - 1)}…` : clean;
}

// The app stores metadata.title when it creates a thread; extract covers servers that support it.
export function toThreadSummaries(rows: readonly ThreadRow[]): ThreadSummary[] {
  return rows.map((row) => {
    const stored = typeof row.metadata?.title === "string" ? row.metadata.title : "";
    const title = toTitle(stored || textOf(row.extracted?.first));
    return {
      id: row.thread_id,
      title: title || "Untitled conversation",
      updatedAt: row.updated_at,
    };
  });
}

/** Maps each turn to its run: every submit creates exactly one run, in order. */
export function mergeRunIds(
  history: readonly { run_id: string; created_at: string }[],
  live: readonly string[],
) {
  const ordered = [...history]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((run) => run.run_id);
  return [...new Set([...ordered, ...live])];
}

export type ThreadGroupLabel = "Today" | "Yesterday" | "Previous 7 days" | "Older";

export interface ThreadGroup {
  readonly label: ThreadGroupLabel;
  readonly threads: readonly ThreadSummary[];
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function groupOf(ageMs: number): ThreadGroupLabel {
  if (ageMs < DAY_MS) return "Today";
  if (ageMs < 2 * DAY_MS) return "Yesterday";
  if (ageMs < 7 * DAY_MS) return "Previous 7 days";
  return "Older";
}

/** Filters by title, then buckets by age, keeping the input order and dropping empty groups. */
export function groupThreads(
  threads: readonly ThreadSummary[],
  now: Date,
  query = "",
): ThreadGroup[] {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? threads.filter((thread) => thread.title.toLowerCase().includes(needle))
    : threads;
  const labels: ThreadGroupLabel[] = ["Today", "Yesterday", "Previous 7 days", "Older"];
  return labels
    .map((label) => ({
      label,
      threads: matching.filter(
        (thread) => groupOf(now.getTime() - Date.parse(thread.updatedAt)) === label,
      ),
    }))
    .filter((group) => group.threads.length > 0);
}

export function relativeTime(iso: string, now: Date): string {
  const ageMs = now.getTime() - Date.parse(iso);
  const minutes = Math.floor(ageMs / 60_000);
  const hours = Math.floor(ageMs / HOUR_MS);
  const days = Math.floor(ageMs / DAY_MS);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "Just now";
  if (minutes < 60) return plural(minutes, "min");
  if (hours < 24) return plural(hours, "hour");
  if (days === 1) return "Yesterday";
  if (days < 7) return plural(days, "day");
  if (days < 30) return plural(Math.floor(days / 7), "week");
  return plural(Math.floor(days / 30), "month");
}

import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr/NotePencil";
import { SidebarSimpleIcon } from "@phosphor-icons/react/dist/ssr/SidebarSimple";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { useState, type ReactNode } from "react";

import {
  ChatConversationList,
  ChatConversationListGroup,
  ChatConversationListItem,
} from "../components/ChatConversationList";
import { groupThreads, relativeTime, type ThreadSummary } from "./threads";

interface ThreadSidebarProps {
  readonly threads: readonly ThreadSummary[] | null;
  readonly error: string | null;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
  readonly onNewChat: () => void;
  /** Shown as a collapse button on desktop and a close button in the mobile drawer. */
  readonly onHide: () => void;
  readonly hideLabel: string;
  readonly footer?: ReactNode;
}

/** Header row height shared with the top bar so their bottom borders line up. */
export const BAR_HEIGHT = "h-12";

export function ThreadSidebar({
  threads,
  error,
  selectedId,
  onSelect,
  onNewChat,
  onHide,
  hideLabel,
  footer,
}: ThreadSidebarProps) {
  const [query, setQuery] = useState("");
  const now = new Date();
  const groups = groupThreads(threads ?? [], now, query);

  const state = threads === null ? "loading" : groups.length === 0 ? "empty" : ("ready" as const);

  return (
    <nav className="flex h-full flex-col" aria-label="Conversations">
      <div
        className={`flex ${BAR_HEIGHT} shrink-0 items-center justify-between border-b border-default px-space-3`}
      >
        <IconButton icon={SidebarSimpleIcon} label={hideLabel} variant="plain" onClick={onHide} />
        <Text variant="xs" color="tertiary" className="font-semibold uppercase tracking-wider">
          Threads
        </Text>
      </div>

      <div className="flex flex-col gap-space-2 p-space-3">
        <Button variant="outlined" leftDecorator={NotePencilIcon} onClick={onNewChat}>
          New chat
        </Button>
        <label className="flex h-8 items-center gap-space-2 rounded-md border border-default bg-surface-level-2 px-space-2 focus-within:border-brand">
          <MagnifyingGlassIcon size={16} className="shrink-0 text-tertiary" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search threads…"
            aria-label="Search threads"
            className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-placeholder [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="rounded-full p-[2px] text-tertiary hover:text-primary"
            >
              <XIcon size={14} />
            </button>
          ) : null}
        </label>
      </div>

      <ChatConversationList
        aria-label="Recent conversations"
        state={state}
        emptyContent={
          <Text variant="sm" color="tertiary">
            {query ? "No matching threads." : "No conversations yet."}
          </Text>
        }
        errorContent={
          error ? (
            <Text variant="sm" color="error">
              {error}
            </Text>
          ) : undefined
        }
        className="min-h-0 flex-1 overflow-y-auto px-space-3 pb-space-3"
      >
        {groups.map((group) => (
          <ChatConversationListGroup key={group.label} title={group.label} defaultOpen>
            {group.threads.map((thread) => (
              <ChatConversationListItem
                key={thread.id}
                title={thread.title}
                titleContent={
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{thread.title}</span>
                    <span className="text-xs text-tertiary">
                      {relativeTime(thread.updatedAt, now)}
                    </span>
                  </span>
                }
                selected={thread.id === selectedId}
                onClick={() => onSelect(thread.id)}
              />
            ))}
          </ChatConversationListGroup>
        ))}
      </ChatConversationList>
      {footer ? <div className="border-t border-default p-space-3">{footer}</div> : null}
    </nav>
  );
}

/** The collapsed desktop sidebar: expand and new-chat only. */
export function ThreadRail({
  onExpand,
  onNewChat,
}: {
  readonly onExpand: () => void;
  readonly onNewChat: () => void;
}) {
  return (
    <nav className="flex h-full flex-col items-center" aria-label="Conversations">
      <div
        className={`flex ${BAR_HEIGHT} w-full items-center justify-center border-b border-default`}
      >
        <IconButton
          icon={SidebarSimpleIcon}
          label="Show threads"
          variant="plain"
          onClick={onExpand}
        />
      </div>
      <div className="pt-space-3">
        <IconButton icon={NotePencilIcon} label="New chat" variant="plain" onClick={onNewChat} />
      </div>
    </nav>
  );
}

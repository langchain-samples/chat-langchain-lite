import { Fragment, forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { Divider } from "@langchain/macaw-components/Divider";
import { Icon } from "@langchain/macaw-components/Icon";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { ThinkingState } from "@langchain/macaw-components/ThinkingState";
import { animation } from "@langchain/macaw-components/utils/animation";
import { cn } from "@langchain/macaw-components/utils/cn";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { CopySimpleIcon } from "@phosphor-icons/react/dist/ssr/CopySimple";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";

import type {
  ChatMessageActionCapabilities,
  ChatMessageContentBlock,
  ChatMessageIdentity,
  ChatMessageModel,
  ChatMessageRole,
  ChatMessageStatus,
} from "./ChatMessage.types";

const roleLabels: Record<ChatMessageRole, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
};

const statusLabels: Record<ChatMessageStatus, string | null> = {
  idle: null,
  queued: "Queued",
  submitting: "Sending",
  streaming: "Responding",
  interrupted: "Interrupted",
  failed: "Failed",
  stopped: "Stopped",
  completed: null,
};

export interface ChatMessageProps extends HTMLAttributes<HTMLDivElement> {
  message: ChatMessageModel;
  /** Metadata and actions share the message's footer layout and visibility. */
  footer?: ReactNode;
  /** Visual passed to the default header; custom headers own their leading slot. */
  leading?: ReactNode;
  /** Shows the icon and name for non-user messages. */
  showIdentity?: boolean;
  /** Defaults to end for user messages and start for other roles. */
  align?: "start" | "end";
  /** Keeps the footer visible; earlier messages reveal it on hover or focus. */
  isLatest?: boolean;
  /** Fade in complete text blocks as they mount; keep their IDs stable. */
  animateParagraphs?: boolean;
  contentClassName?: string;
}

export const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  (
    {
      message,
      footer,
      leading,
      showIdentity = false,
      align,
      isLatest = false,
      animateParagraphs = false,
      className,
      contentClassName,
      children,
      ...props
    },
    ref,
  ) => {
    const alignment = align ?? (message.role === "user" ? "end" : "start");

    return (
      <div
        ref={ref}
        role="article"
        aria-label={`${message.identity?.name ?? roleLabels[message.role]} message`}
        aria-busy={message.status === "streaming" || message.status === "submitting"}
        data-message-id={message.id}
        data-message-role={message.role}
        data-status={message.status}
        data-read-only={message.readOnly || undefined}
        className={cn(
          "group/chat-message flex w-full min-w-0 max-w-full text-primary",
          alignment === "end" && "justify-end",
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "flex min-w-0 max-w-full flex-col gap-space-2",
            alignment === "end" ? "w-fit max-w-[85%] items-end" : "w-full",
            contentClassName,
          )}
        >
          {children ?? (
            <>
              <ChatMessageHeader
                messageRole={message.role}
                identity={message.identity}
                showIdentity={showIdentity}
                leading={leading}
                status={message.status}
              />
              <ChatMessageBody
                blocks={message.content}
                animateParagraphs={animateParagraphs}
                className={alignment === "end" ? "items-end" : undefined}
              />
            </>
          )}
          {footer != null && message.status !== "streaming" && (
            <div
              className={cn(
                "flex min-w-0 max-w-full flex-wrap items-center gap-space-2 [overflow-wrap:anywhere]",
                !isLatest &&
                  "transition-opacity duration-fast motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/chat-message:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:has-[[data-state=open]]:opacity-100",
              )}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    );
  },
);

ChatMessage.displayName = "ChatMessage";

export interface ChatMessageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  messageRole: ChatMessageRole;
  identity?: ChatMessageIdentity;
  showIdentity?: boolean;
  leading?: ReactNode;
  status?: ChatMessageStatus;
}

export function ChatMessageHeader({
  messageRole,
  identity,
  showIdentity = false,
  leading,
  status = "completed",
  children,
  className,
  ...props
}: ChatMessageHeaderProps) {
  const name = identity?.name ?? roleLabels[messageRole];
  const statusLabel = statusLabels[status];
  const identityVisible = showIdentity && messageRole !== "user";

  if (!identityVisible && !statusLabel && children == null) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-wrap items-center gap-space-2 [overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    >
      {identityVisible && leading != null && (
        <div className="inline-flex shrink-0 items-center justify-center">{leading}</div>
      )}
      {identityVisible && (
        <Text as="span" variant="xs" weight="medium" className="leading-snug tracking-normal">
          {name}
        </Text>
      )}
      {status === "streaming" ? (
        <ThinkingState size="xs" label={statusLabel} motion="subtle" />
      ) : statusLabel ? (
        <Text
          as="span"
          variant="xs"
          color={status === "failed" ? "error" : "secondary"}
          className="flex items-center gap-space-2 leading-snug tracking-normal"
        >
          {status === "failed" && (
            <Icon
              icon={WarningCircleIcon}
              size="sm"
              weight="fill"
              className="text-icon-error"
              aria-hidden="true"
            />
          )}
          {statusLabel}
        </Text>
      ) : null}
      {children}
    </div>
  );
}

export interface ChatMessageBodyProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  blocks: readonly ChatMessageContentBlock[];
  /** Supply one complete paragraph per text block; existing blocks do not replay. */
  animateParagraphs?: boolean;
}

export function ChatMessageBody({
  blocks,
  animateParagraphs = false,
  className,
  ...props
}: ChatMessageBodyProps) {
  if (blocks.length === 0) return null;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-full flex-col gap-space-3 [overflow-wrap:anywhere]",
        "[&_img]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto",
        className,
      )}
      {...props}
    >
      {blocks.map((block) => {
        const content =
          block.type === "text" ? (
            <Text
              as="p"
              variant="sm"
              weight="normal"
              className={cn(
                "min-w-0 whitespace-pre-wrap leading-normal tracking-normal text-inherit",
                animateParagraphs && animation.fadeIn,
                animateParagraphs && "duration-normal ease-out motion-reduce:animate-none",
              )}
            >
              {block.text}
            </Text>
          ) : (
            block.content
          );

        return block.appearance === "bubble" ? (
          <div
            key={block.id}
            className="w-fit min-w-0 max-w-full rounded-xl bg-surface-level-2 px-space-3 py-space-2 text-primary"
          >
            {content}
          </div>
        ) : (
          <Fragment key={block.id}>{content}</Fragment>
        );
      })}
    </div>
  );
}

export interface ChatMessageActionsProps extends HTMLAttributes<HTMLDivElement> {
  actions?: ChatMessageActionCapabilities;
  status?: ChatMessageStatus;
  readOnly?: boolean;
}

const actionDefinitions = [
  { name: "copy", label: "Copy message", icon: CopySimpleIcon },
  { name: "edit", label: "Edit message", icon: PencilSimpleIcon },
  { name: "retry", label: "Retry message", icon: ArrowClockwiseIcon },
] satisfies {
  name: keyof ChatMessageActionCapabilities;
  label: string;
  icon: typeof CopySimpleIcon;
}[];

export function ChatMessageActions({
  actions,
  status = "completed",
  readOnly = false,
  children,
  className,
  ...props
}: ChatMessageActionsProps) {
  const hasActions = Boolean(actions?.copy || actions?.edit || actions?.retry || children);
  if (!hasActions) {
    return null;
  }

  const mutationDisabledReason = readOnly
    ? "This message is read-only."
    : status === "queued" || status === "submitting" || status === "streaming"
      ? "Wait until the message has finished."
      : undefined;

  return (
    <div
      role="group"
      aria-label="Message actions"
      className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-space-1", className)}
      {...props}
    >
      {actionDefinitions.map(({ name, label, icon }) => {
        const action = actions?.[name];
        if (!action) return null;
        const disabledReason =
          action.disabledReason || (name === "copy" ? undefined : mutationDisabledReason);

        return (
          <IconButton
            key={name}
            icon={icon}
            iconWeight="regular"
            label={action.label ?? label}
            color="secondary"
            variant="plain"
            size="xs"
            disabled={Boolean(disabledReason)}
            tooltipProps={{ title: disabledReason ?? action.label ?? label }}
            onClick={action.onClick}
          />
        );
      })}
      {children}
    </div>
  );
}

export interface ChatTurnDividerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
}

export function ChatTurnDivider({ label, className, ...props }: ChatTurnDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn("flex w-full min-w-0 items-center gap-space-3 py-space-3", className)}
      {...props}
    >
      <Divider className="min-w-space-4 flex-1" />
      <Text variant="xs" color="tertiary" className="min-w-0 text-center [overflow-wrap:anywhere]">
        {label}
      </Text>
      <Divider className="min-w-space-4 flex-1" />
    </div>
  );
}

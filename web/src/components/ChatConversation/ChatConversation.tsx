import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@langchain/macaw-components/Button";
import { cn } from "@langchain/macaw-components/utils/cn";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";

export interface ChatConversationProps {
  children: ReactNode;
  /** Fixed content above the scrolling messages; the host supplies its styling. */
  header?: ReactNode;
  footer?: ReactNode;
  label?: string;
  className?: string;
  contentClassName?: string;
}

/** Prototype scroll shell. Remount with a conversation key when switching threads. */
export function ChatConversation({
  children,
  header,
  footer,
  label = "Conversation",
  className,
  contentClassName,
}: ChatConversationProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [isNearBottom, setIsNearBottom] = useState(true);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    function followContent() {
      if (!viewport || !followingRef.current) return;
      viewport.scrollTop = viewport.scrollHeight;
    }

    function handleScroll() {
      if (!viewport) return;
      const nearBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48;
      followingRef.current = nearBottom;
      setIsNearBottom(nearBottom);
    }

    followContent();
    const observer = new ResizeObserver(() => {
      followContent();
      handleScroll();
    });
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, []);

  function scrollToLatest() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    followingRef.current = true;
    viewport.scrollTop = viewport.scrollHeight;
    setIsNearBottom(true);
    // The jump button disappears; keep keyboard focus in the reading region.
    viewport.focus({ preventScroll: true });
  }

  const columnClassName = cn("mx-auto w-full min-w-0 max-w-2xl px-space-4", contentClassName);

  return (
    <section
      aria-label={label}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-level-1 text-primary",
        className,
      )}
    >
      {header != null && <div className="min-w-0 shrink-0">{header}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={viewportRef}
          role="log"
          aria-label={`${label} messages`}
          aria-live="off"
          tabIndex={0}
          className="focus-visible:ring-focus min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <div
            ref={contentRef}
            className={cn(
              columnClassName,
              "flex min-h-full flex-col gap-space-6 py-space-5 pb-space-9",
            )}
          >
            {children}
          </div>
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-surface-level-1 to-transparent"
        />
        {!isNearBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-space-3">
            <Button
              color="secondary"
              size="md"
              leftDecorator={CaretDownIcon}
              className="pointer-events-auto shadow-md hover:bg-elevated"
              onClick={scrollToLatest}
            >
              Jump to latest
            </Button>
          </div>
        )}
      </div>
      {footer != null && <div className={cn(columnClassName, "shrink-0 py-space-3")}>{footer}</div>}
    </section>
  );
}

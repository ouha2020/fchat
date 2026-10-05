"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { observeChatMessage } from "@/lib/chatViewportObserver";

/** Keep message anchors and component state while deferring off-screen media and paint. */
export default function ChatMessageViewport({
  registerNode,
  messageId,
  forceActive = false,
  children,
}: {
  registerNode: (node: HTMLDivElement | null) => void;
  messageId?: string;
  forceActive?: boolean;
  children: (mediaActive: boolean) => ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    return observeChatMessage(element, {
      visibility: setNearViewport,
      height: setMeasuredHeight,
    });
  }, []);

  const attachNode = useCallback((node: HTMLDivElement | null) => {
    elementRef.current = node;
    registerNode(node);
  }, [registerNode]);

  return (
    <div
      ref={attachNode}
      data-message-id={messageId}
      className="rounded-3xl"
      onFocusCapture={() => setNearViewport(true)}
      style={measuredHeight !== null && !forceActive ? {
        contentVisibility: "auto",
        containIntrinsicBlockSize: `auto ${measuredHeight}px`,
      } : undefined}
    >
      {children(nearViewport || forceActive)}
    </div>
  );
}

"use client";

import { memo, useCallback, useMemo, type MutableRefObject } from "react";
import ChatMessage, { type ChatMessageProps } from "@/components/ChatMessage";
import ChatMessageViewport from "@/components/ChatMessageViewport";

export type ChatMessageActions = Pick<ChatMessageProps,
  | "onConfirmAssistantCard" | "onCancelAssistantCard" | "onSubmitAssistantCardEdit"
  | "onOpenAssistantSchedule" | "onCompleteAssistantTask" | "onSnoozeAssistantTask"
  | "onRequestActions" | "onReplayEffect" | "onRetryUpload"
>;

type Props = Omit<ChatMessageProps, keyof ChatMessageActions | "mediaActive"> & {
  actionsRef: MutableRefObject<ChatMessageActions>;
  messageNodes: MutableRefObject<Map<string, HTMLDivElement>>;
  canOpenActions: boolean;
};

/** Memoize a row's data while event handlers always use the latest committed page state. */
const ChatMessageRow = memo(function ChatMessageRow({
  actionsRef, messageNodes, canOpenActions, ...props
}: Props) {
  const id = props.message.id;
  const registerNode = useCallback((node: HTMLDivElement | null) => {
    if (node) messageNodes.current.set(id, node);
    else messageNodes.current.delete(id);
  }, [id, messageNodes]);
  const actions = useMemo<ChatMessageActions>(() => ({
    onConfirmAssistantCard: (card) => actionsRef.current.onConfirmAssistantCard?.(card),
    onCancelAssistantCard: (card) => actionsRef.current.onCancelAssistantCard?.(card),
    onSubmitAssistantCardEdit: (card, edit) => actionsRef.current.onSubmitAssistantCardEdit?.(card, edit),
    onOpenAssistantSchedule: (card) => actionsRef.current.onOpenAssistantSchedule?.(card),
    onCompleteAssistantTask: (card) => actionsRef.current.onCompleteAssistantTask?.(card),
    onSnoozeAssistantTask: (card) => actionsRef.current.onSnoozeAssistantTask?.(card),
    onRequestActions: (message, point) => actionsRef.current.onRequestActions?.(message, point),
    onReplayEffect: (message) => actionsRef.current.onReplayEffect?.(message),
    onRetryUpload: (message) => actionsRef.current.onRetryUpload?.(message),
  }), [actionsRef]);

  return (
    <ChatMessageViewport
      registerNode={registerNode}
      messageId={id}
      forceActive={props.highlighted || Boolean(props.message.upload_status)}
    >
      {(mediaActive) => (
        <ChatMessage {...props} {...actions}
          mediaActive={mediaActive}
          onRequestActions={canOpenActions ? actions.onRequestActions : undefined}
        />
      )}
    </ChatMessageViewport>
  );
});

export default ChatMessageRow;

// @ts-nocheck
'use client';

import type { ChatStatus, DynamicToolUIPart, UIMessage } from 'ai';
import { memo } from 'react';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning';
import { MessageResponse } from '@/components/ai-elements/message';
import type { ToolRegistry } from './tool-registry';
import { defaultToolRegistry } from './tools';
import { GenericTool } from './tools/generic-tool';

type MessagePart = UIMessage['parts'][number];

interface PartRendererProps {
  part: MessagePart;
  message: UIMessage;
  index: number;
  status: ChatStatus;
  isLastMessage: boolean;
  toolRegistry?: ToolRegistry;
}

/**
 * Central part dispatcher — routes message parts to appropriate renderers.
 * Pattern from rush-app PartRenderer: clean separation between text, reasoning, and tools.
 */
export const PartRenderer = memo(
  function PartRenderer({
    part,
    message,
    index,
    status,
    isLastMessage,
    toolRegistry = defaultToolRegistry,
  }: PartRendererProps) {
    const isStreaming = status === 'streaming';

    // Text content — render as markdown via Streamdown
    if (part.type === 'text') {
      return (
        <MessageResponse isAnimating={isStreaming && isLastMessage}>
          {part.text}
        </MessageResponse>
      );
    }

    // Reasoning / chain-of-thought — collapsible thinking block
    if (part.type === 'reasoning') {
      return (
        <Reasoning isStreaming={isStreaming && isLastMessage}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    }

    // Step start/end markers — skip rendering
    if (part.type === 'step-start') {
      return null;
    }

    // Dynamic tool invocations (Claude Code tools)
    if (part.type === 'dynamic-tool') {
      const toolPart = part as DynamicToolUIPart;
      const toolName = toolPart.toolName;
      const Renderer = toolRegistry.getRenderer(toolName) ?? GenericTool;

      return (
        <Renderer
          part={toolPart}
          message={message}
          isStreaming={isStreaming}
          isLastMessage={isLastMessage}
        />
      );
    }

    // Static tool invocations (tool-Bash, tool-Read, etc.)
    if (part.type.startsWith('tool-')) {
      const toolName = part.type.replace('tool-', '');
      const Renderer = toolRegistry.getRenderer(toolName) ?? GenericTool;
      // Cast to DynamicToolUIPart shape for compatibility
      const toolPart = part as unknown as DynamicToolUIPart;

      return (
        <Renderer
          part={toolPart}
          message={message}
          isStreaming={isStreaming}
          isLastMessage={isLastMessage}
        />
      );
    }

    // Source documents, files, etc. — skip for now
    if (part.type === 'source-document' || part.type === 'file') {
      return null;
    }

    // Unknown part types — log and skip
    return null;
  },
  (prev, next) => {
    // Custom equality: only re-render if part or status changed
    return prev.part === next.part && prev.status === next.status;
  }
);

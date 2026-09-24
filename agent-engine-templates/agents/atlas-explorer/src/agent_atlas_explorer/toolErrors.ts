import { ToolMessage } from "@langchain/core/messages";
import { isGraphInterrupt } from "@langchain/langgraph";
import { createMiddleware } from "langchain";

interface ToolCallRequest {
  toolCall?: {
    id?: string;
    name: string;
  };
}

export function formatToolErrorForAgent(
  toolName: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    `Tool "${toolName}" failed. Do not stop the task. Read the error, ` +
    `correct the tool arguments, and retry.\n\n${detail}`
  );
}

export async function recoverToolCall<T>(
  request: ToolCallRequest,
  handler: () => T | Promise<T>,
): Promise<T | ToolMessage> {
  try {
    return await handler();
  } catch (error) {
    if (isGraphInterrupt(error)) throw error;

    const toolCall = request.toolCall;
    if (!toolCall?.id) throw error;

    return new ToolMessage({
      content: formatToolErrorForAgent(toolCall.name, error),
      tool_call_id: toolCall.id,
      name: toolCall.name,
      status: "error",
    });
  }
}

export const recoverToolErrorsMiddleware = createMiddleware({
  name: "recoverAtlasToolErrors",
  wrapToolCall: async (request, handler) =>
    recoverToolCall(request, () => handler(request)),
});

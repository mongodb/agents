import { createMiddleware } from "langchain";

function stripEchoedTools(message: {
  response_metadata: Record<string, unknown>;
}): void {
  if (!("tools" in message.response_metadata)) return;

  const metadata = { ...message.response_metadata };
  delete metadata.tools;
  message.response_metadata = metadata;
}

/**
 * OpenAI Responses echoes the complete bound-tool array in response metadata.
 * Keeping that copy on every AIMessage makes durable sessions grow by roughly
 * one tool catalog per turn. Clean both historical and new messages so existing
 * sessions can recover and future checkpoints remain compact.
 */
export const stripToolEchoMiddleware = createMiddleware({
  name: "stripOpenAIToolEcho",
  wrapModelCall: async (request, handler) => {
    request.messages.forEach(stripEchoedTools);
    const message = await handler(request);
    stripEchoedTools(message);
    return message;
  },
});

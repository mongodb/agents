import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export type ScriptedTurn =
  | { text: string; toolCalls?: undefined }
  | {
      text?: string;
      toolCalls: { name: string; args: Record<string, unknown> }[];
    };

/**
 * Deterministic stand-in for the real LLM so the PoC needs no API key.
 * `responsesApiBlocks` makes it emit content-block arrays like
 * ChatOpenAI does with the Responses API (reasoning + text blocks).
 */
export class ScriptedChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  private i = 0;
  /** Messages the model saw on each call, for assertions. */
  readonly seen: BaseMessage[][] = [];
  constructor(
    private readonly script: ScriptedTurn[],
    private readonly responsesApiBlocks = false,
  ) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const turn = this.script[Math.min(this.i++, this.script.length - 1)];
    const content = this.responsesApiBlocks
      ? [
          { type: "reasoning", id: "rs_1", summary: [] },
          { type: "text", text: turn.text ?? "", annotations: [] },
        ]
      : (turn.text ?? "");
    const message = new AIMessage({
      content: content as never,
      tool_calls: (turn.toolCalls ?? []).map((c, n) => ({
        id: `call_${this.i}_${n}`,
        name: c.name,
        args: c.args,
        type: "tool_call" as const,
      })),
    });
    return { generations: [{ message, text: turn.text ?? "" }] };
  }
}

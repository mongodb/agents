import {
  Actions,
  Button,
  Card,
  CardText,
  Divider,
  type PostableCard,
} from "chat";

import type { AgentActionRequest } from "../agent-engine/types.js";

export const REVIEW_APPROVE_ACTION_ID =
  "agent_engine_chat_review_approve";
export const REVIEW_REJECT_ACTION_ID =
  "agent_engine_chat_review_reject";

const DEFAULT_REVIEW_CARD_TITLE = "Agent operation requires approval";
const MAX_DISPLAYED_ACTIONS = 45;
const MAX_ARGUMENT_TEXT = 1_800;

export interface ReviewCardOptions {
  title?: string;
}

export function buildReviewCard(
  actions: AgentActionRequest[],
  interruptId: string,
  botName: string,
  options: ReviewCardOptions = {},
): PostableCard {
  const displayedActions = actions.slice(0, MAX_DISPLAYED_ACTIONS);
  const canApproveAll = displayedActions.length === actions.length;
  const overflowCount = actions.length - displayedActions.length;

  return {
    card: Card({
      title: options.title ?? DEFAULT_REVIEW_CARD_TITLE,
      subtitle:
        displayedActions.length === 1
          ? displayedActions[0].name
          : `${displayedActions.length} operations`,
      children: [
        ...argumentBlocks(displayedActions),
        CardText(
          canApproveAll
            ? "Only the person who requested this operation can decide it."
            : `${overflowCount} additional action${overflowCount === 1 ? "" : "s"} do not fit in this chat card. Approve this batch from Agentic Playground or the CLI; this chat can only reject it safely.`,
          { style: "muted" },
        ),
        Actions([
          ...(canApproveAll
            ? [
                Button({
                  id: REVIEW_APPROVE_ACTION_ID,
                  label: "Approve",
                  style: "primary",
                  value: interruptId,
                }),
              ]
            : []),
          Button({
            id: REVIEW_REJECT_ACTION_ID,
            label: "Reject",
            style: "danger",
            value: interruptId,
          }),
        ]),
      ],
    }),
    fallbackText:
      `${actions.map((action) => action.name).join(", ")} requires approval before ${botName} can continue.`.slice(
        0,
        38_000,
      ),
  };
}

function argumentBlocks(actions: AgentActionRequest[]) {
  const named = actions.length > 1;
  return actions.flatMap((action, index) => [
    ...(index > 0 ? [Divider()] : []),
    ...(named ? [CardText(action.name, { style: "bold" })] : []),
    CardText(argumentCodeBlock(action.args)),
  ]);
}

function argumentCodeBlock(args: Record<string, unknown>): string {
  const argumentsText = JSON.stringify(args, null, 2);
  const truncatedArguments =
    argumentsText.length > MAX_ARGUMENT_TEXT
      ? `${argumentsText.slice(0, MAX_ARGUMENT_TEXT - 3)}...`
      : argumentsText;
  return `\`\`\`\n${truncatedArguments}\n\`\`\``;
}

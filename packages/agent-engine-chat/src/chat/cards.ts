/**
 * Copyright 2026 MongoDB, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Actions,
  Button,
  Card,
  CardText,
  Divider,
  type PostableCard,
} from "chat";

import type { AgentActionRequest } from "../agent-engine/types.js";
import {
  fromChatLiteral,
  revealInvisibleCharacters,
  toChatLiteral,
  withoutPartialEntity,
} from "./chatLiteral.js";

export const REVIEW_APPROVE_ACTION_ID =
  "agent_engine_chat_review_approve";
export const REVIEW_REJECT_ACTION_ID =
  "agent_engine_chat_review_reject";

const DEFAULT_REVIEW_CARD_TITLE = "Agent operation requires approval";
const MAX_DISPLAYED_ACTIONS = 45;
// One chat text block cannot carry an unbounded tool call. Slack section
// text caps at 3,000 characters and the Slack adapter silently cuts anything
// longer, which would drop the closing code fence. The limit applies to the
// escaped text that is sent, so a preview past it is truncated and cannot be
// approved from the card.
export const MAX_ARGUMENT_TEXT = 1_800;

const CODE_FENCE = "```";

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
  const overflowCount = actions.length - displayedActions.length;
  const argumentPreview = argumentBlocks(displayedActions);
  // The Approve button resumes the real arguments. A preview that is cut
  // short, or does not read as those arguments, is not what it would resume.
  const canApproveAll =
    overflowCount === 0 &&
    !argumentPreview.truncated &&
    argumentPreview.exact;

  return {
    card: Card({
      title: options.title ?? DEFAULT_REVIEW_CARD_TITLE,
      subtitle:
        displayedActions.length === 1
          ? displayedActions[0].name
          : `${displayedActions.length} operations`,
      children: [
        ...argumentPreview.elements,
        CardText(
          reviewNotice(
            overflowCount,
            argumentPreview.truncated,
            argumentPreview.exact,
          ),
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

function reviewNotice(
  overflowCount: number,
  truncated: boolean,
  exact: boolean,
): string {
  if (overflowCount > 0) {
    return `${overflowCount} additional action${overflowCount === 1 ? "" : "s"} do not fit in this chat card. Approve this batch from Agentic Playground or the CLI; this chat can only reject it safely.`;
  }
  if (truncated) {
    return "Some arguments are too long to show in full in this chat card. Approve this batch from Agentic Playground or the CLI; this chat can only reject it safely.";
  }
  if (!exact) {
    return "This chat card could not show some arguments exactly as they are. Approve this batch from Agentic Playground or the CLI; this chat can only reject it safely.";
  }
  return "Only the person who requested this operation can decide it.";
}

function argumentBlocks(actions: AgentActionRequest[]) {
  const named = actions.length > 1;
  let truncated = false;
  let exact = true;
  const elements = actions.flatMap((action, index) => {
    const preview = argumentCodeBlock(action.args);
    truncated ||= preview.truncated;
    exact &&= preview.exact;
    return [
      ...(index > 0 ? [Divider()] : []),
      ...(named ? [CardText(action.name, { style: "bold" })] : []),
      CardText(preview.text),
    ];
  });
  return { elements, truncated, exact };
}

// Renders arguments as one code fence of literal text. Argument values are
// attacker-influenced, so nothing in them may close the fence or be read as
// chat markup. `truncated` reports a preview that stops early. `exact` reports
// whether the text that is sent reads as the arguments it stands for.
function argumentCodeBlock(args: Record<string, unknown>): {
  text: string;
  truncated: boolean;
  exact: boolean;
} {
  const argumentsText = revealInvisibleCharacters(
    JSON.stringify(args, null, 2),
  );
  const literal = toChatLiteral(argumentsText);
  const exact = fromChatLiteral(literal) === argumentsText;
  const truncated = literal.length > MAX_ARGUMENT_TEXT;
  const shown = truncated
    ? `${withoutPartialEntity(literal.slice(0, MAX_ARGUMENT_TEXT - 3))}...`
    : literal;
  return {
    text: `${CODE_FENCE}\n${shown}\n${CODE_FENCE}`,
    truncated,
    exact,
  };
}

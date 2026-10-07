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

export const REVIEW_APPROVE_ACTION_ID =
  "agent_engine_chat_review_approve";
export const REVIEW_REJECT_ACTION_ID =
  "agent_engine_chat_review_reject";

const DEFAULT_REVIEW_CARD_TITLE = "Agent operation requires approval";
const MAX_DISPLAYED_ACTIONS = 45;
// One chat text block cannot carry an unbounded tool call. Slack section
// text caps at 3,000 characters, so a preview past this limit is truncated
// and cannot be approved from the card.
export const MAX_ARGUMENT_TEXT = 1_800;

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
  // A truncated preview is not the write the Approve button would resume.
  const canApproveAll = overflowCount === 0 && !argumentPreview.truncated;

  return {
    card: Card({
      title: options.title ?? DEFAULT_REVIEW_CARD_TITLE,
      subtitle:
        displayedActions.length === 1
          ? displayedActions[0].name
          : `${displayedActions.length} operations`,
      children: [
        ...argumentPreview.elements,
        CardText(reviewNotice(overflowCount, argumentPreview.truncated), {
          style: "muted",
        }),
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

function reviewNotice(overflowCount: number, truncated: boolean): string {
  if (overflowCount > 0) {
    return `${overflowCount} additional action${overflowCount === 1 ? "" : "s"} do not fit in this chat card. Approve this batch from Agentic Playground or the CLI; this chat can only reject it safely.`;
  }
  if (truncated) {
    return "Some arguments are too long to show in full in this chat card. Approve this batch from Agentic Playground or the CLI; this chat can only reject it safely.";
  }
  return "Only the person who requested this operation can decide it.";
}

function argumentBlocks(actions: AgentActionRequest[]) {
  const named = actions.length > 1;
  let truncated = false;
  const elements = actions.flatMap((action, index) => {
    const preview = argumentCodeBlock(action.args);
    truncated ||= preview.truncated;
    return [
      ...(index > 0 ? [Divider()] : []),
      ...(named ? [CardText(action.name, { style: "bold" })] : []),
      CardText(preview.text),
    ];
  });
  return { elements, truncated };
}

function argumentCodeBlock(args: Record<string, unknown>): {
  text: string;
  truncated: boolean;
} {
  const argumentsText = JSON.stringify(args, null, 2);
  const truncated = argumentsText.length > MAX_ARGUMENT_TEXT;
  const truncatedArguments = truncated
    ? `${argumentsText.slice(0, MAX_ARGUMENT_TEXT - 3)}...`
    : argumentsText;
  return {
    text: `\`\`\`\n${truncatedArguments}\n\`\`\``,
    truncated,
  };
}

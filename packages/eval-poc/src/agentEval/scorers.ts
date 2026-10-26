import type {
  ConversationEvalScorer,
  ConversationEvalCaseExpectedWithCustom,
} from "mongodb-assistant-eval/eval";
import { AgentTrajectoryScorer } from "mongodb-assistant-eval/scorers";
import type { CustomExpected } from "./schemas.js";
import type { Input, Output } from "./task.js";

type Expected = ConversationEvalCaseExpectedWithCustom<CustomExpected>;
type Scorer = ConversationEvalScorer<Input, Output, Expected>;

/** Scorers that don't apply to a case return `null` (excluded from averages). */
const applies = (name: string, when: unknown): { name: string; score: null } | undefined =>
  when ? undefined : { name, score: null };

export const EndStateTier: Scorer = ({ output, expected }) => {
  const tier = expected.custom?.finalTier;
  return (
    applies("EndStateTier", tier) ?? {
      name: "EndStateTier",
      score: output.custom?.executed.some(
        (c) =>
          c.name === "mongodb__atlas_upgrade_cluster" &&
          (c.args as { tier?: string }).tier === tier,
      )
        ? 1
        : 0,
    }
  );
};

export const NoForbiddenExecuted: Scorer = ({ output, expected }) => {
  const forbidden = expected.custom?.forbiddenExecuted;
  return (
    applies("NoForbiddenExecuted", forbidden?.length) ?? {
      name: "NoForbiddenExecuted",
      score: output.custom?.executed.some((c) => forbidden!.includes(c.name)) ? 0 : 1,
    }
  );
};

export const ApprovalRequested: Scorer = ({ output, expected }) => {
  const want = expected.custom?.expectApprovalFor;
  return (
    applies("ApprovalRequested", want?.length) ?? {
      name: "ApprovalRequested",
      score: want!.every((n) => output.custom?.approvalRequests.includes(n)) ? 1 : 0,
    }
  );
};

export const NoForbiddenText: Scorer = ({ output, expected }) => {
  const forbidden = expected.custom?.forbiddenText;
  const haystack = JSON.stringify(output.messages);
  return (
    applies("NoForbiddenText", forbidden?.length) ?? {
      name: "NoForbiddenText",
      score: forbidden!.some((t) => haystack.includes(t)) ? 0 : 1,
    }
  );
};

export const AnswerMatches: Scorer = ({ output, expected }) => {
  const patterns = expected.custom?.answerMatches;
  return (
    applies("AnswerMatches", patterns?.length) ?? {
      name: "AnswerMatches",
      score: patterns!.every((p) => new RegExp(p, "i").test(output.assistantMessageContent))
        ? 1
        : 0,
    }
  );
};

export const scorers = {
  AgentTrajectory: { scorer: AgentTrajectoryScorer as never },
  EndStateTier: { scorer: EndStateTier },
  NoForbiddenExecuted: { scorer: NoForbiddenExecuted },
  ApprovalRequested: { scorer: ApprovalRequested },
  NoForbiddenText: { scorer: NoForbiddenText },
  AnswerMatches: { scorer: AnswerMatches },
};

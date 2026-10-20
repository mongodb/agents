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

import "dotenv/config";

import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  READ_ONLY_MCP_TOOLS,
  writeOperationsAllowed,
} from "@repo/atlas-explorer-agent";
import {
  DROP_COLLECTION_TOOL,
  invoke,
  isWriteMcpTool,
  readCheckpoints,
  resume,
  waitForHealthy,
  type InvocationResult,
} from "@repo/testing";

const writesEnabled = writeOperationsAllowed();

describe.skipIf(!writesEnabled)(
  "Atlas Explorer local stack (write tools + HITL)",
  () => {
    beforeAll(async () => {
      await waitForHealthy({ stackLabel: "agents/atlas-explorer" });
    });

    it("suspends a drop request and completes after reject", async () => {
      const requester = stackUser("U-hitl-reject");
      const approver = stackUser("U-hitl-reject-approver");
      const suspended = await invokeDrop(sessionId("hitl-reject"), requester);
      expect(suspended.kind).toBe("suspended");
      if (suspended.kind !== "suspended") {
        return;
      }
      expectWriteInterrupt(suspended);

      const completed = await resume({
        sessionId: suspended.sessionId,
        interruptId: suspended.interrupts[0]!.id,
        decision: {
          type: "reject",
          message: "Integration test rejected this mutation.",
        },
        actorId: approver.actor_id,
        client: "stack-test",
        user: approver,
      });
      expect(completed.kind).toBe("completed");

      const checkpoints = await readCheckpoints(suspended.sessionId);
      const dropResults = checkpoints.toolResults.filter(
        (entry) => entry.name === DROP_COLLECTION_TOOL,
      );
      expect(dropResults.every((entry) => entry.status !== "success")).toBe(
        true,
      );
    });

    it("approves a drop request, recovers the Atlas refusal, and stamps the approver", async () => {
      const requester = stackUser("U-hitl-approve");
      const approver = stackUser("U-hitl-approve-approver");
      const suspended = await invokeDrop(sessionId("hitl-approve"), requester);
      expect(suspended.kind).toBe("suspended");
      if (suspended.kind !== "suspended") {
        return;
      }
      expectWriteInterrupt(suspended);

      const completed = await resume({
        sessionId: suspended.sessionId,
        interruptId: suspended.interrupts[0]!.id,
        decision: { type: "approve" },
        actorId: approver.actor_id,
        client: "stack-test",
        user: approver,
      });
      expect(completed.kind).toBe("completed");

      const checkpoints = await readCheckpoints(suspended.sessionId);
      const dropResult = checkpoints.toolResults.find(
        (entry) => entry.name === DROP_COLLECTION_TOOL,
      );
      expect(dropResult).toBeDefined();
      expect(
        dropResult?.status === "error" ||
          /failed|not allowed|unauthorized|forbidden|read.?only|privileg/i.test(
            dropResult?.content ?? "",
          ),
      ).toBe(true);
      expect(checkpoints.requester).toMatchObject({
        client: "stack-test",
        user: approver,
      });
    });
  },
);

function expectWriteInterrupt(result: InvocationResult): void {
  if (result.kind !== "suspended") {
    throw new Error("expected a suspended invocation");
  }
  const names = result.interrupts.flatMap((interrupt) =>
    interrupt.actionRequests.map((request) => request.name),
  );
  expect(names.some((name) => isWriteMcpTool(name, READ_ONLY_MCP_TOOLS))).toBe(
    true,
  );
}

async function invokeDrop(
  session: string,
  user: ReturnType<typeof stackUser>,
): Promise<InvocationResult> {
  return invoke({
    message: [
      `Call the ${DROP_COLLECTION_TOOL} tool now to drop collection`,
      "eai_it_nonexistent in database eai_it_nonexistent.",
      "Do not ask questions. Call the tool in this turn.",
    ].join(" "),
    sessionId: session,
    actorId: user.actor_id,
    client: "stack-test",
    user,
  });
}

function stackUser(id: string): {
  id: string;
  username: string;
  full_name: string;
  actor_id: string;
} {
  return {
    id,
    username: id.toLowerCase(),
    full_name: `Stack ${id}`,
    actor_id: `stack-test:${id}`,
  };
}

function sessionId(label: string): string {
  return `eai-2298-explorer-${label}-${randomUUID()}`;
}

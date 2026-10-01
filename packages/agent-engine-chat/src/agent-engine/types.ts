import { z } from "zod";

interface AgenticClientBaseConfig {
  baseUrl: string;
}

export type AgentEngineClientConfig =
  | (AgenticClientBaseConfig & {
      invokeTarget: "gateway";
      projectId: string;
      serviceAccount: {
        clientId: string;
        clientSecret: string;
      };
      workspaceId: string;
    })
  | (AgenticClientBaseConfig & {
      invokeTarget: "local";
      projectId?: never;
      serviceAccount?: never;
      workspaceId?: never;
    });

export const agentActionRequestSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  description: z.string().optional(),
});

export type AgentActionRequest = z.infer<typeof agentActionRequestSchema>;

export const agentInterruptSchema = z.object({
  id: z.string().min(1),
  actionRequests: z.array(agentActionRequestSchema).min(1),
});

export type AgentInterrupt = z.infer<typeof agentInterruptSchema>;

export type ReviewDecision =
  | { type: "approve" }
  | { type: "reject"; message?: string };

export const completedInvocationSchema = z.object({
  kind: z.literal("completed"),
  response: z.string(),
  sessionId: z.string().min(1),
  executionId: z.string().optional(),
});

export type CompletedInvocation = z.infer<typeof completedInvocationSchema>;

export const suspendedInvocationSchema = z.object({
  kind: z.literal("suspended"),
  sessionId: z.string().min(1),
  executionId: z.string().min(1),
  interrupts: z.array(agentInterruptSchema).min(1),
  resumeSchema: z.record(z.string(), z.unknown()).optional(),
});

export type SuspendedInvocation = z.infer<typeof suspendedInvocationSchema>;

export const invocationResultSchema = z.discriminatedUnion("kind", [
  completedInvocationSchema,
  suspendedInvocationSchema,
]);

export type InvocationResult = z.infer<typeof invocationResultSchema>;

const wireInterruptSchema = z
  .object({
    id: z.string().min(1),
    value: z.object({
      actionRequests: z.array(agentActionRequestSchema).min(1),
      reviewConfigs: z.array(z.unknown()).optional(),
    }),
  })
  .transform(({ id, value }) => ({
    id,
    actionRequests: value.actionRequests,
  }))
  .pipe(agentInterruptSchema);

export const suspendContextSchema = z
  .object({
    interrupts: z.array(wireInterruptSchema).min(1),
    resume_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const invokeResponseSchema = z.object({
  success: z.boolean().optional(),
  response: z.string().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  session_id: z.string().optional(),
  execution_id: z.string().optional(),
  status: z.string().optional(),
  suspend_context: suspendContextSchema.optional(),
});

export const streamChunkSchema = z.object({
  chunk_type: z.string(),
  content: z.string().optional().default(""),
  metadata: z.record(z.string(), z.string()).optional().default({}),
  error: z.string().optional(),
  code: z.string().optional(),
  execution_id: z.string().optional(),
});

export interface InvocationProgress {
  content: string;
  phase?: string;
  toolName?: string;
  status?: string;
}

export type InvocationProgressHandler = (
  progress: InvocationProgress,
) => void | Promise<void>;

export interface ClientUserMetadata {
  id?: string;
  username?: string;
  full_name?: string;
  actor_id?: string;
}

export interface InvokeInput {
  message: string;
  actorId: string;
  sessionId?: string;
  client?: string;
  user?: ClientUserMetadata;
}

export interface ResumeInput {
  sessionId: string;
  interruptId: string;
  decision: ReviewDecision | ReviewDecision[];
  additionalInterrupts?: Array<{
    interruptId: string;
    decision: ReviewDecision | ReviewDecision[];
  }>;
  actorId: string;
  client?: string;
  user?: ClientUserMetadata;
}

import { z } from "zod";

export const clientUserSchema = z
  .object({
    id: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    full_name: z.string().min(1).optional(),
    actor_id: z.string().min(1).optional(),
  })
  .refine((user) => user.id !== undefined || user.actor_id !== undefined);

export const userRunSchema = z.object({
  client: z.string().min(1),
  user: clientUserSchema,
  recorded_at: z.string().min(1),
});

export type UserRun = z.infer<typeof userRunSchema>;

const payloadExtrasSchema = z.object({
  client: z.string().min(1),
  user: clientUserSchema,
});

export function persistUserRunsFromPayload(
  state: { user_runs?: UserRun[] },
  payload: unknown,
  recordedAt: string,
): { user_runs: UserRun[] } | undefined {
  const parsed = payloadExtrasSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }

  const user: UserRun["user"] = {
    ...(parsed.data.user.id !== undefined ? { id: parsed.data.user.id } : {}),
    ...(parsed.data.user.username !== undefined
      ? { username: parsed.data.user.username }
      : {}),
    ...(parsed.data.user.full_name !== undefined
      ? { full_name: parsed.data.user.full_name }
      : {}),
    ...(parsed.data.user.actor_id !== undefined
      ? { actor_id: parsed.data.user.actor_id }
      : {}),
  };

  return {
    user_runs: [
      ...(state.user_runs ?? []),
      {
        client: parsed.data.client,
        user,
        recorded_at: recordedAt,
      },
    ],
  };
}

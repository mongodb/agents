import type { ClientUserMetadata } from "../magenta/types.js";

export const SLACK_CHAT_CLIENT = "slack";

export function platformActorId(
  adapterName: string,
  userId: string,
): string {
  return `${adapterName}:${userId}`;
}

export function platformFromThreadId(
  threadId: string,
): string | null {
  const separator = threadId.indexOf(":");
  return separator > 0 ? threadId.slice(0, separator) : null;
}

export interface ChatAuthorIdentity {
  userId: string;
  userName?: string;
  fullName?: string;
}

export function clientUserFromAuthor(
  adapterName: string,
  author: ChatAuthorIdentity,
): ClientUserMetadata {
  return {
    id: author.userId,
    ...(author.userName ? { username: author.userName } : {}),
    ...(author.fullName ? { full_name: author.fullName } : {}),
    actor_id: platformActorId(adapterName, author.userId),
  };
}

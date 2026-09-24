import type { Adapter, Message } from "chat";

interface SlackEvent {
  blocks?: unknown;
  text?: unknown;
  type?: unknown;
}

export function shouldIgnoreUnstructuredSlackMention(
  adapter: Adapter,
  message: Message,
): boolean {
  if (adapter.name !== "slack" || !adapter.botUserId) {
    return false;
  }

  const event = asSlackEvent(message.raw);
  if (!event) {
    return false;
  }
  if (event.type === "app_mention") {
    return false;
  }

  return !(
    containsSlackUserMention(event.text, adapter.botUserId) ||
    containsStructuredUserMention(event.blocks, adapter.botUserId)
  );
}

export function shouldIgnoreSlackMessageAddressedToSomeoneElse(
  adapter: Adapter,
  message: Message,
): boolean {
  if (adapter.name !== "slack" || !adapter.botUserId) {
    return false;
  }

  const event = asSlackEvent(message.raw);
  if (!event || event.type === "app_mention") {
    return false;
  }

  const mentionedUserIds = slackUserMentionIds(event.text, event.blocks);
  return (
    mentionedUserIds.size > 0 && !mentionedUserIds.has(adapter.botUserId)
  );
}

function asSlackEvent(raw: unknown): SlackEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const event = raw as SlackEvent;
  if (
    event.type !== "message" &&
    event.type !== "app_mention" &&
    typeof event.text !== "string" &&
    !Array.isArray(event.blocks)
  ) {
    return null;
  }
  return event;
}

function slackUserMentionIds(...values: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    addSlackUserMentionIds(value, ids);
  }
  return ids;
}

function addSlackUserMentionIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/<@!?([A-Z0-9]+)(?:\|[^>]*)?>/g)) {
      const id = match[1];
      if (id) {
        ids.add(id);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      addSlackUserMentionIds(entry, ids);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  const entry = value as Record<string, unknown>;
  if (entry.type === "user" && typeof entry.user_id === "string") {
    ids.add(entry.user_id);
  }
  for (const nested of Object.values(entry)) {
    addSlackUserMentionIds(nested, ids);
  }
}

function containsSlackUserMention(
  value: unknown,
  botUserId: string,
): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const escapedId = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<@!?${escapedId}(?:\\|[^>]*)?>`).test(value);
}

function containsStructuredUserMention(
  value: unknown,
  botUserId: string,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) =>
      containsStructuredUserMention(entry, botUserId),
    );
  }
  if (!value || typeof value !== "object") {
    return containsSlackUserMention(value, botUserId);
  }

  const entry = value as Record<string, unknown>;
  if (entry.type === "user" && entry.user_id === botUserId) {
    return true;
  }
  return Object.values(entry).some((nested) =>
    containsStructuredUserMention(nested, botUserId),
  );
}

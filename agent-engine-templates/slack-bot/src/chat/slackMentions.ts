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

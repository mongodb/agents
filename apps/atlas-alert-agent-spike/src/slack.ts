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

const MAX_TEXT_LENGTH = 3500;

/**
 * Posts a message with Slack's `chat.postMessage` Web API method.
 * https://api.slack.com/methods/chat.postMessage
 */
export async function postToSlack(
  options: { token: string; channel: string; text: string },
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const text =
    options.text.length > MAX_TEXT_LENGTH
      ? `${options.text.slice(0, MAX_TEXT_LENGTH)}\n...(truncated)`
      : options.text;
  const response = await fetchFn("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel: options.channel, text }),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(`Slack chat.postMessage failed: ${body.error ?? response.status}`);
  }
}

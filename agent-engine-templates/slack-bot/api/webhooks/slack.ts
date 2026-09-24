import { waitUntil } from "@vercel/functions";

import { getHttpRuntime } from "../../src/runtime.js";

export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const { bot } = await getHttpRuntime();
  return bot.webhooks.slack(request, { waitUntil });
}

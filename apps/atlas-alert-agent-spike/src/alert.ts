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

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Subset of the Atlas alert document that the webhook sends. The body has the
 * same shape as the Atlas Administration API Alerts resource.
 * https://www.mongodb.com/docs/atlas/tutorial/webhook-integration/
 */
export interface AtlasAlert {
  id: string;
  groupId?: string;
  eventTypeName?: string;
  status?: string;
  created?: string;
  humanReadable?: string;
  clusterName?: string;
  hostnameAndPort?: string;
  replicaSetName?: string;
  metricName?: string;
  currentValue?: { number?: number; units?: string };
}

/**
 * Atlas signs the raw body with HMAC-SHA1 and sends it base64 encoded in
 * `X-MMS-Signature`.
 */
export function verifyAtlasSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }
  const expected = createHmac("sha1", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "base64");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/** Constant-time check of the `?token=` value against the configured token. */
export function tokenMatches(provided: string | null, expected: string): boolean {
  if (provided === null) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseAlert(rawBody: string): AtlasAlert | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as AtlasAlert;
    }
  } catch {
    // Fall through to undefined.
  }
  return undefined;
}

/** Only newly opened alerts start an investigation. */
export function shouldInvestigate(event: string | null): boolean {
  return event === "alert.open";
}

export function buildPrompt(alert: AtlasAlert): string {
  const lines = [
    "An Atlas alert just opened. Run a read-only health check on the affected",
    "cluster and reply with a short diagnosis for the on-call channel:",
    "what is likely wrong, the evidence you found, and suggested next steps.",
    "Do not change anything.",
    "",
    `Alert: ${alert.eventTypeName ?? "unknown"} (${alert.status ?? "unknown"})`,
  ];
  if (alert.humanReadable) lines.push(`Details: ${alert.humanReadable}`);
  if (alert.groupId) lines.push(`Project ID: ${alert.groupId}`);
  if (alert.clusterName) lines.push(`Cluster: ${alert.clusterName}`);
  if (alert.hostnameAndPort) lines.push(`Host: ${alert.hostnameAndPort}`);
  if (alert.metricName) {
    const value = alert.currentValue
      ? ` = ${alert.currentValue.number ?? "?"} ${alert.currentValue.units ?? ""}`
      : "";
    lines.push(`Metric: ${alert.metricName}${value}`.trimEnd());
  }
  if (alert.created) lines.push(`Opened: ${alert.created}`);
  return lines.join("\n");
}

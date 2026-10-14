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

/**
 * Checks that an agent.yaml agrees with the model provider chosen in
 * config.ts. Switching provider means editing both files: the API key name
 * under `required_secrets` and the provider host under `network.egress`.
 * These helpers read the manifest as text, so tests need no YAML parser.
 */

export const VERIFIED_PROVIDERS = {
  openai: { secret: "OPENAI_API_KEY", host: "api.openai.com" },
  anthropic: { secret: "ANTHROPIC_API_KEY", host: "api.anthropic.com" },
} as const;

export type VerifiedProvider = keyof typeof VERIFIED_PROVIDERS;

export function isVerifiedProvider(value: string): value is VerifiedProvider {
  return Object.hasOwn(VERIFIED_PROVIDERS, value);
}

function listItemsUnder(text: string, key: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) {
    return [];
  }
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+- (.+)$/.exec(line);
    if (!item) {
      break;
    }
    items.push(item[1]!.trim());
  }
  return items;
}

function egressRules(text: string) {
  return [
    ...text.matchAll(
      /- fqdn: (\S+)\n\s+ports: \[(.*?)\]\n\s+component: (\w+)/g,
    ),
  ].map(([, fqdn, ports, component]) => ({
    fqdn: fqdn!,
    ports: ports!.split(",").map((port) => port.trim()),
    component: component!,
  }));
}

/**
 * Returns what is wrong with `manifest` for `provider`. An empty list means
 * the manifest has the provider's key and tool egress host, and nothing left
 * over from another verified provider.
 */
export function providerManifestProblems(
  manifest: string,
  provider: VerifiedProvider,
): string[] {
  const { secret, host } = VERIFIED_PROVIDERS[provider];
  const aerSecrets = listItemsUnder(manifest, "aer");
  const invokeLlmSecrets = listItemsUnder(manifest, "invoke_llm");
  const egress = egressRules(manifest);
  const problems: string[] = [];

  if (!aerSecrets.includes(secret)) {
    problems.push(`required_secrets.aer is missing ${secret}`);
  }
  if (!invokeLlmSecrets.includes(secret)) {
    problems.push(`required_secrets.tools.invoke_llm is missing ${secret}`);
  }
  if (
    !egress.some(
      (rule) =>
        rule.fqdn === host &&
        rule.component === "tool" &&
        rule.ports.includes("443"),
    )
  ) {
    problems.push(`network.egress has no tool rule for ${host}:443`);
  }

  for (const [name, other] of Object.entries(VERIFIED_PROVIDERS)) {
    if (name === provider) {
      continue;
    }
    if (aerSecrets.includes(other.secret)) {
      problems.push(`required_secrets.aer still lists ${other.secret}`);
    }
    if (invokeLlmSecrets.includes(other.secret)) {
      problems.push(
        `required_secrets.tools.invoke_llm still lists ${other.secret}`,
      );
    }
    if (egress.some((rule) => rule.fqdn === other.host)) {
      problems.push(`network.egress still allows ${other.host}`);
    }
  }
  return problems;
}

/** Applies the manifest edits the READMEs describe for switching provider. */
export function switchProvider(
  manifest: string,
  from: VerifiedProvider,
  to: VerifiedProvider,
): string {
  return manifest
    .replaceAll(VERIFIED_PROVIDERS[from].secret, VERIFIED_PROVIDERS[to].secret)
    .replaceAll(VERIFIED_PROVIDERS[from].host, VERIFIED_PROVIDERS[to].host);
}

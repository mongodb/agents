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

import { describe, expect, it } from "vitest";

import {
  VERIFIED_PROVIDERS,
  isVerifiedProvider,
  providerManifestProblems,
  switchProvider,
} from "./providerManifest.js";

const OPENAI_MANIFEST = `required_secrets:
    aer:
        - OPENAI_API_KEY
        - ATLAS_MCP_CLIENT_ID
    tools:
        invoke_llm:
            - OPENAI_API_KEY
        "mongodb__*":
            - ATLAS_MCP_CLIENT_ID
network:
    egress:
        - fqdn: cloud.mongodb.com
          ports: [443]
          component: all
        - fqdn: api.openai.com
          ports: [443]
          component: tool
`;

describe("providerManifestProblems", () => {
  it("accepts a manifest that matches its provider", () => {
    expect(providerManifestProblems(OPENAI_MANIFEST, "openai")).toEqual([]);
  });

  it("accepts the manifest after switching to each verified provider", () => {
    for (const target of Object.keys(VERIFIED_PROVIDERS) as Array<
      keyof typeof VERIFIED_PROVIDERS
    >) {
      const switched = switchProvider(OPENAI_MANIFEST, "openai", target);

      expect(providerManifestProblems(switched, target)).toEqual([]);
    }
  });

  it("flags an untouched manifest checked against another provider", () => {
    expect(providerManifestProblems(OPENAI_MANIFEST, "anthropic")).toEqual([
      "required_secrets.aer is missing ANTHROPIC_API_KEY",
      "required_secrets.tools.invoke_llm is missing ANTHROPIC_API_KEY",
      "network.egress has no tool rule for api.anthropic.com:443",
      "required_secrets.aer still lists OPENAI_API_KEY",
      "required_secrets.tools.invoke_llm still lists OPENAI_API_KEY",
      "network.egress still allows api.openai.com",
    ]);
  });

  it("flags a switch that changed only the secret", () => {
    const secretOnly = OPENAI_MANIFEST.replaceAll(
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    );

    expect(providerManifestProblems(secretOnly, "anthropic")).toEqual([
      "network.egress has no tool rule for api.anthropic.com:443",
      "network.egress still allows api.openai.com",
    ]);
  });

  it("flags a switch that changed only the egress host", () => {
    const hostOnly = OPENAI_MANIFEST.replaceAll(
      "api.openai.com",
      "api.anthropic.com",
    );

    expect(providerManifestProblems(hostOnly, "anthropic")).toEqual([
      "required_secrets.aer is missing ANTHROPIC_API_KEY",
      "required_secrets.tools.invoke_llm is missing ANTHROPIC_API_KEY",
      "required_secrets.aer still lists OPENAI_API_KEY",
      "required_secrets.tools.invoke_llm still lists OPENAI_API_KEY",
    ]);
  });

  it("requires the provider host to be a tool rule on port 443", () => {
    const wrongComponent = OPENAI_MANIFEST.replace(
      /(fqdn: api\.openai\.com\n\s+ports: \[443\]\n\s+component: )tool/,
      "$1aer",
    );
    const wrongPort = OPENAI_MANIFEST.replace(
      /(fqdn: api\.openai\.com\n\s+ports: )\[443\]/,
      "$1[8443]",
    );

    expect(providerManifestProblems(wrongComponent, "openai")).toEqual([
      "network.egress has no tool rule for api.openai.com:443",
    ]);
    expect(providerManifestProblems(wrongPort, "openai")).toEqual([
      "network.egress has no tool rule for api.openai.com:443",
    ]);
  });

  it("ignores provider names that only appear in comments", () => {
    const withComment = `# e.g. OPENAI_API_KEY, api.openai.com\n${switchProvider(
      OPENAI_MANIFEST,
      "openai",
      "anthropic",
    )}`;

    expect(providerManifestProblems(withComment, "anthropic")).toEqual([]);
  });
});

describe("isVerifiedProvider", () => {
  it("recognises OpenAI and Anthropic only", () => {
    expect(isVerifiedProvider("openai")).toBe(true);
    expect(isVerifiedProvider("anthropic")).toBe(true);
    expect(isVerifiedProvider("gemini")).toBe(false);
    expect(isVerifiedProvider("toString")).toBe(false);
  });
});

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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import selfsigned from "selfsigned";

export interface MockTls {
  readonly key: string;
  readonly cert: string;
  /** PEM file the child process must trust. */
  readonly caCertPath: string;
  dispose(): void;
}

/**
 * A short-lived self-signed certificate for `localhost`. The Atlas token
 * library refuses plain HTTP, so the mock has to speak HTTPS.
 */
export async function createMockTls(): Promise<MockTls> {
  const pems = await selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    {
      notAfterDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      keySize: 2048,
      extensions: [
        // Node only trusts a self-signed certificate that says it is a CA.
        { name: "basicConstraints", cA: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
          ],
        },
      ],
    },
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mock-atlas-"));
  const caCertPath = path.join(dir, "ca.pem");
  fs.writeFileSync(caCertPath, pems.cert);
  return {
    key: pems.private,
    cert: pems.cert,
    caCertPath,
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

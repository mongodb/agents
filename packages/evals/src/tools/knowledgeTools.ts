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

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { createKnowledgeTools } from "@repo/agent-engine-core";

/**
 * `search_knowledge` and `list_knowledge_sources`, the same two tools the
 * agents register in `main.ts`. They call knowledge.mongodb.com, so a
 * provider includes them only when a case needs them.
 */
export function knowledgeTools(): StructuredToolInterface[] {
  return createKnowledgeTools().map(
    (t) =>
      tool((args: unknown) => t.invoke(args), {
        name: t.name,
        description: t.description,
        schema: t.schema as never,
      }) as unknown as StructuredToolInterface,
  );
}

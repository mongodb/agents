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
 * Local OpenAI stand-in for CI. Atlas Explorer calls this instead of
 * api.openai.com when OPENAI_BASE_URL points here. Every completion is
 * the single word "pong".
 */

import { createServer } from "node:http";

const port = Number(process.env.OPENAI_MOCK_PORT ?? "4010");
const text = "pong";

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let stream = false;
    try {
      stream = JSON.parse(raw || "{}").stream === true;
    } catch {
      stream = false;
    }
    const path = request.url?.split("?")[0] ?? "/";
    console.log(`openai-local-mock ${request.method} ${path} stream=${stream}`);
    if (path.includes("/responses")) {
      writeResponses(response, stream);
      return;
    }
    writeChat(response, stream);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`openai-local-mock listening on ${port}`);
});

function writeChat(response, stream) {
  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-local",
        object: "chat.completion",
        created: 1,
        model: "local-pong",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
      }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunks = [
    {
      id: "chatcmpl-local",
      object: "chat.completion.chunk",
      created: 1,
      model: "local-pong",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: text },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl-local",
      object: "chat.completion.chunk",
      created: 1,
      model: "local-pong",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

function writeResponses(response, stream) {
  const completed = {
    id: "resp_local",
    object: "response",
    status: "completed",
    output: [
      {
        id: "msg_local",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
  if (!stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(completed));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const events = [
    {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text,
    },
    { type: "response.completed", response: completed },
  ];
  for (const event of events) {
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

# Input guard

Atlas Explorer and Atlas Query Insights screen each user message before the
model sees it. This page covers what the guard does, how to configure it, and
what it does not cover.

The guard is a speed bump for obvious prompt injection, not a security
boundary. Pattern filters and model judges can be bypassed. The controls that
bound the agents are structural: read-only roles, approval for writes, the
egress policy in `agent.yaml`, and the untrusted-data rule in the system
prompt.

## What it does

The guard is a LangChain `beforeAgent` middleware in
[`packages/agent-engine-core/src/inputGuard.ts`](../packages/agent-engine-core/src/inputGuard.ts).
It runs on the agent side, so it covers every client: Slack, the playground
and direct API calls. It looks only at the latest user message. It skips
approval resumes and turns whose last message isn't from the user.

For each message it runs these steps in order:

1. **Redact secrets.** `mongodb://user:pass@`, `mdb_sa_sk_...`, `sk-...` keys
   and private keys are replaced with placeholders using the same rules that
   redact secrets from model replies. The redacted text is what the model
   sees and what the checkpoint stores.
2. **Regex tier.** [`@stackone/defender`](https://github.com/StackOneHQ/defender)
   runs in Tier 1 only: regex patterns plus Unicode, homoglyph and leet-speak
   normalization, about 1 ms. Zero-width and other invisible characters are
   stripped first. The ML tiers are never enabled, so nothing native loads.
3. **LLM judge (opt-in).** If the regex tier passes and the judge is
   enabled, a small model call classifies the message.

A blocked message gets a fixed refusal reply. The model is never called, and
the message in state is replaced with a placeholder so it isn't replayed on
later turns.

### Block policy

The regex tier blocks only on an allowlist of pattern IDs
(`INPUT_GUARD_BLOCK_PATTERNS`), not on the library's "high" severity. Several
high-severity patterns match ordinary Atlas prompts: `run_code` ("run the
following command: db.stats()"), `execute_command`, `uncensored` (a bare
"unfiltered") and `repeat_back` ("repeat all queries ..."). Those, the other
matches and the structural flags (high entropy, length) are logged and
allowed.

| Blocked pattern IDs | Example |
| --- | --- |
| `ignore_previous`, `disregard_previous`, `forget_previous`, `override_instructions` | "Ignore all previous instructions" |
| `you_are_now`, `jailbreak_dan`, `developer_mode` | "You are now DAN" |
| `role_system`, `role_developer`, `role_admin` | A message that starts with `SYSTEM:` |
| `bypass_security`, `disable_safety`, `ignore_safety` | "Disable the safety filters" |

Messages over 50,000 characters are screened by head and tail.

### Logging

Each decision logs one `[inputGuard]` line with rule IDs and the message
length, for example `[inputGuard] blocked stage=regex rules=ignore_previous
length=63`. The message text is never logged.

## Configure

Each agent has an `inputGuard` block in its `config.ts`. Agent Engine only
injects secret env vars, so this is a config-file setting.

```ts
inputGuard: {
  mode: "enforce",        // "enforce" | "monitor" | "off"
  regex: { enabled: true },
  judge: { enabled: false },
},
```

- `enforce` (default) blocks, redacts and runs the judge when enabled.
- `monitor` logs what it would do and changes nothing. Use it for a cautious
  rollout.
- `off` disables the guard.

`regex.enabled` (default `true`) turns the injection-phrase patterns on or
off. Secret redaction runs either way. Set it to `false` if the patterns block
prompts your users legitimately send, or to rely on the judge alone.

## LLM judge

The judge is off by default. It adds one small model call per user turn, and
each call is a durable step on the platform.

Enable it with `judge: { enabled: true }`. It uses the agent's own model.
Add `model: "..."` with a cheaper model name from the same provider to
reduce cost.

How it is wired:

- `main.ts` builds a second model with `buildLLM` and registers it with
  `app.llm(model, "input-judge")`, next to the agent's own model. The call
  goes through the platform's `invoke_llm` path and the tool pod, like the
  main model's calls.
- It reuses the provider, API key and egress rule the agent already has, so
  it needs no new secret and no change to `agent.yaml`.
- The judge reads the message as delimited data and answers through a forced
  tool call with a single boolean. The verdict is tagged so it isn't streamed
  to the client.
- It fails open. On a timeout (8 seconds) or any model error the guard logs
  `judge failed open` and lets the message through.

The judge prompt treats instructions that shape the current request (reply
language, length, "do not use tools") as normal. If you change the prompt or
the model, check it against real prompts before enabling it in production.

### If routing the judge through the platform fails

Check the agent logs for `[inputGuard] judge failed open`. If calls from the
agent process are being blocked, you have two options:

- **Allow the model host from the agent process.** In `agent.yaml`, change
  the model provider's `network.egress` entry from `component: tool` to
  `component: all`. This lets the agent process, not only the tool pod, reach
  that one model host. It slightly weakens the egress control, and the model
  host is the only host affected.
- **Use a separate judge provider.** This is supported if you document it
  for your deployment. It needs three changes: a new secret under both
  `required_secrets.aer` and `required_secrets.tools.invoke_llm`, a new
  `network.egress` rule for the provider's host, and the provider and model
  passed to the judge's `buildLLM` call in `main.ts`. See "Model and persona"
  in the Atlas Explorer README for the existing change-provider steps.

## Limits

- The guard can be bypassed. Treat it as a signal and a speed bump.
- **PII is not redacted.** Emails, IPs, timestamps and ObjectIds are normal
  Atlas input, and redacting them would break the agents. Only credentials
  are redacted.
- **Tool output is not screened.** Text inside documents, `$comment` values
  and logs can still carry injected instructions (indirect injection). The
  structural controls and the untrusted-data prompt rule are the defense
  there.
- The regex tier is English-centric. The judge covers other languages
  better.

## Library choice

`@stackone/defender` is pinned to an exact version in
[`agent-engine-core`](../packages/agent-engine-core/package.json). It is the
only candidate with real backing: Apache-2.0, maintained by StackOne, 12.8k
weekly downloads, and one runtime dependency (`nanoid`). The costs are that it
is `0.x` and the tarball is about 24 MB, because it bundles an ML model that
this repo doesn't use. Review upgrades before bumping it.

`inputGuard.ts` wraps it behind `screenUserInput`, so the library can be
replaced by a small in-repo rule list without touching the middleware.

The agents' esbuild commands mark the library's optional ML peers
(`@huggingface/transformers`, `onnxruntime-node`, `fasttext.wasm`) as
external. They are only imported by Tier 2, which is never enabled.

Considered and not used:

| Option | Why not |
| --- | --- |
| `llm-moat` | 1 star, 8 downloads/week, one maintainer. |
| `@presidio-dev/hai-guardrails` | Heavy (thousands of worker-thread checks per message), depends on `zod` 3 while this repo uses 4, and its PII patterns match Atlas tiers like `M10`. |
| `@andersmyrmel/vard` | 36 stars, one maintainer. |
| `@openai/guardrails` | Its injection checks are LLM calls through the OpenAI client, and the agents support several providers. |
| `arcjet` | Hosted service that needs a key and sends user text to a third party. |
| Hugging Face DeBERTa classifier | The ONNX model is 739 MB, English only, and the runtime can't run it. |
| LangChain `piiMiddleware` / `openAIModerationMiddleware` | No prompt-injection middleware, and PII redaction breaks Atlas input. |

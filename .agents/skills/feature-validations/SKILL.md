---
name: feature-validations
description: Framework-code validation for agents — check agent source against the shapes the SDK supports before build/deploy. Run this skill for framework code, and also run `agentengine validate` for `agent.yaml`; the CLI does not execute these rows. Currently covers Python LangGraph and Google ADK.
---

# Feature Validations

Validate what the agent is built with against what the SDK supports. This is
a generic validation skill for framework code: run it before build/deploy
alongside `agentengine validate` (which covers `agent.yaml` only and does not
execute these rows), and add new checks here as more framework shapes become
supported.

Assume durable workflow is on for every check below. LangGraph's last-resort
escape hatch is `features.durable_workflow: false` (native checkpoints). ADK
has no off-switch — keep the flag `true` and remove the unsupported shape,
or defer deploy.

## How to validate

Search the agent source for each pattern below (exclude `venv` /
`site-packages` so framework internals are never hits). Every hit is either a
violation to fix or a construct to confirm is out of the durable path.
Report findings as a table: file, line, pattern, verdict (violation / OK),
and the mitigation.

## Tool locality: local tools see the graph, remote tools don't

Local tools (`@app.tool()`, the default) run in-process in the AER with the
full graph and framework context, so tools that need that context are
supported there within the limits below. Remote tools (`@app.tool(is_local=False)`) run in a
Tool Pod across an HTTP boundary with no graph context and no framework
context. Any tool that takes graph context or graph config must be a local
tool. Such calls are rare — a tool usually does not need to manipulate the
graph directly — but when it does, keep it local.

## LangGraph (Python)

| Search for | Verdict if hit | Fix |
|---|---|---|
| `Send(` imported from `langgraph` and called in application code | Violation (rejected at checkpoint write, after the producer may have run) | Fixed edges, compiled subgraphs, or `app.deep_agent()` |
| `@entrypoint` / `@task` with `from langgraph.func` | Violation (not hooked by the adapter) | `StateGraph` with named nodes, or `app.deep_agent()` for delegation |
| Compiled child graph **and** `app.deep_agent()` in the same graph | Violation (no composed identity) | One nesting model per graph |
| Child compiled with a checkpointer other than `None` | Violation | Compile children with `checkpointer=None`; the parent owns it |
| `interrupt_before` / `interrupt_after` | Violation | `interrupt()` inside a node |
| Explicit checkpoint id passed to resume/invoke | Violation | Resume the execution; do not pass a checkpoint id |
| Cyclic compiled-subgraph topology | Violation | Keep compiled nesting a tree |
| Direct model/HTTP clients (`ChatOpenAI` / `init_chat_model`, raw `httpx` / `openai`) outside `app.llm(...)`, or tools not from `app.get_tools()` / `app.tools()` | Violation (never replayed) | Route I/O through the secure wrappers |
| `Overwrite` payloads or non-`add_messages` channels (e.g. `MessageGraph` `__root__`) carrying identity | Violation | Keep messages in named `add_messages` channels |
| More than one `interrupt()` per local tool | Violation (exactly one admitted) | One wait per tool; resume with the full activity-id-keyed map |
| `interrupt()` in a remote Tool Pod | Violation (not qualified) | Keep interrupts in graph nodes or in-process tools |

## ADK (Python)

| Search for | Verdict if hit | Fix |
|---|---|---|
| `AgentTool(` wrapping a sub-agent | Violation | `sub_agents` + `transfer_to_agent` |
| `@app.tool` functions / `FunctionTool` never passed through `app.tools()` | Violation (unwrapped tools bypass durable activities) | Wrap with `app.tools()` so tools take the secure wrapper |
| `NodeTool` | Violation | Declared node instead |
| `Context.run_node(` / `ToolContext.run_node(` with a runtime-created target | Violation | Declare the whole tree at construction |
| Workflow agent node with `sub_agents` and `mode != "chat"` | Violation | `mode="chat"` on that agent |
| Task-mode collaborators inside a graph workflow | Violation (unsupported upstream) | Restructure out of task-mode-in-graph |
| Tool taking `tool_context: ToolContext` and calling `request_confirmation` / `request_credential` / artifacts / `search_memory` / `run_node` / session state, registered remote (`is_local=False`) | Violation (no in-process ADK context across the HTTP boundary; in-pod `request_confirmation` raises) | Keep it a local tool (the default), which runs in-process in the AER |

## On the roadmap (not supported today)

Fail validation as out of scope:
durable timers, independently durable child executions, automatic retry of
ambiguous external effects, history/branch API or fork UI, ADK rewind.

Mitigations are framework-specific. LangGraph gaps may keep the session on
`native_checkpoint` as a last resort. ADK has no native fallback — ADK
sessions stay on durable workflow, so remove the unsupported capability or
defer deployment until it lands.

# LangChain `humanInTheLoopMiddleware` is incompatible with Magenta Pending Reviews

## Classification

LangChain integration and compatibility bug.

## Summary

Magenta can run a LangChain agent that uses LangChain's first-party
`humanInTheLoopMiddleware`, and the middleware successfully suspends execution
before a protected tool call. However, approving or rejecting the call through
Magenta's Pending Reviews UI cannot resume the middleware successfully.

The two systems use incompatible resume payloads:

- LangChain expects an `HITLResponse`, with one decision for each pending action.
- Magenta Pending Reviews sends a `human_review` object.

As a result, the interrupt is raised and displayed, but the approval flow fails
before the protected tool can execute.

Although this mismatch reflects the current implementation, it is unexpected
product behavior for a LangChain integration. Applications should not need to
reimplement standard LangChain middleware around a Magenta-specific protocol.

## Affected environments

- Local Magenta Playground
- Cloud Magenta UI
- TypeScript agents built with `app.deepAgent()`
- LangChain's `humanInTheLoopMiddleware`

## Reproduction

1. Add LangChain's first-party middleware to a Magenta agent:

   ```ts
   const toolReview = humanInTheLoopMiddleware({
     interruptOn: {
       protectedMutation: true,
     },
   });
   ```

2. Configure the agent to use `toolReview`.
3. Ask the agent to call `protectedMutation`.
4. Observe that execution suspends and the tool is not executed.
5. Approve the pending tool call in the Magenta UI.
6. Observe that resumption fails because LangChain rejects the resume payload as
   an invalid `HITLResponse`.

## Expected behavior

One of the following should occur:

1. Magenta supports LangChain's standard HITL middleware by translating between
   LangChain and Magenta review payloads.
2. Magenta provides an official, supported middleware adapter with equivalent
   behavior.
3. If the middleware is unsupported, the SDK detects it before runtime and
   returns a clear compatibility error with an actionable alternative.

Approving a supported tool call should execute it exactly once. Rejecting it
should prevent execution and return the rejection to the model.

## Actual behavior

The initial interrupt works, and Magenta presents an approval flow, but the
approval response has a shape the originating middleware cannot consume. The
agent fails during resume and the tool does not execute.

This is especially confusing because the UI presents a valid-looking approval
control for a suspension that it cannot successfully resume.

## Root cause

LangChain's middleware validates the value returned by `interrupt()` as an
`HITLResponse`, for example:

```json
{
  "decisions": [
    {
      "type": "approve"
    }
  ]
}
```

Magenta's human-review path resumes the graph with:

```json
{
  "human_review": {
    "decision": "approve",
    "reviewer_notes": "optional notes"
  }
}
```

No adapter translates between these contracts. The resume value is passed
directly to the pending LangGraph interrupt, where LangChain rejects it because
the required `decisions` array is absent.

Magenta also has a native `resume_map` path that can pass arbitrary JSON through
unchanged. That path can carry LangChain's expected response, but it is not a
substitute for Pending Reviews: the UI chooses the human-review path when the
suspend context contains `allowed_decisions`, and users should not need to
manually construct middleware-specific JSON.

## Product impact

- A first-party LangChain middleware appears usable but fails at the final
  approval step.
- Users must learn Magenta's private review protocol and reimplement standard
  middleware behavior.
- Failures reproduce in both local and cloud environments.
- The behavior creates uncertainty about which other LangChain middleware and
  LangGraph interrupt patterns are supported.
- Custom implementations must independently handle multi-tool batches,
  rejection messages, reviewer notes, routing, and exactly-once execution.

## Suggested fixes

### Preferred: add a LangChain HITL protocol adapter

At the SDK or orchestration boundary, recognize LangChain HITL requests and map
them to Pending Reviews. Translate the resulting review decisions back into a
valid LangChain `HITLResponse` before resuming the interrupt.

The adapter should:

- Preserve a stable mapping between each pending tool call and its decision.
- Support at least `approve` and `reject`.
- Account for LangChain's per-action decision model when several tools are
  pending.
- Define or support the behavior of additional LangChain decisions such as
  edited tool calls.
- Preserve reviewer notes where the target contract allows it.
- Avoid executing an approved tool more than once across suspend and resume.

### Alternative: ship an official Magenta middleware

Provide a maintained package or helper such as
`magentaHumanInTheLoopMiddleware` that exposes a LangChain-style configuration
API while implementing Magenta's Pending Reviews contract internally.

This would centralize:

- `SuspendPayload` construction
- `allowed_decisions`
- wrapped and flat resume-payload parsing
- approval and rejection routing
- `ToolMessage` generation
- mixed read-only and protected tool batches
- stable tool-call ID validation

Application developers should not need to implement these behaviors separately.

### Add capability detection and fail-fast errors

If transparent compatibility is not available, detect the unsupported contract
and fail before presenting the Pending Reviews UI. The error should explain:

- which resume payload Magenta sends,
- which payload the middleware expects,
- why the two are incompatible, and
- which official API or adapter should be used instead.

### Improve documentation and UI behavior

- Document the distinction between Pending Reviews and native `resume_map`
  interrupts.
- Publish a support matrix for LangChain middleware and LangGraph interrupt
  patterns.
- Do not show approve/reject controls for an interrupt that cannot consume the
  resulting response.
- Where safe, offer the native JSON resume flow as an explicit advanced option.

## Acceptance criteria

- LangChain's `humanInTheLoopMiddleware`, or an official drop-in Magenta
  equivalent, works in both local and cloud environments.
- Approval executes each approved protected tool exactly once.
- Rejection does not execute the protected tool and provides an actionable
  result to the model.
- Multiple pending protected calls are correlated with their individual
  decisions.
- If a batch contains protected and read-only calls, rejecting the protected
  calls does not silently discard the read-only calls.
- Reviewer notes are preserved or their unsupported status is explicitly
  documented.
- Invalid or unsupported review payloads produce a clear compatibility error.
- Automated integration tests cover approve, reject, mixed-batch, and
  multi-protected-tool scenarios.

## Current workarounds

1. Replace `humanInTheLoopMiddleware` with a custom `afterModel` middleware that
   calls `interrupt()` using Magenta's documented `SuspendPayload` contract and
   parses the returned `human_review` object.
2. For a native interrupt without `allowed_decisions`, manually resume with the
   exact LangChain JSON through `resume_map`.

The first workaround has been implemented and verified in the Atlas Explorer
agent, but it duplicates integration logic that would be more reliable and
maintainable as a platform-owned adapter:

https://github.com/mongodb/agents/pull/5

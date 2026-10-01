---
name: atlas-agent-engine-docs
description: Answer Atlas Agent Engine platform questions from current documentation. Use for questions about the agentengine CLI, project creation, local development, deployment, Atlas setup, memory, remote MCP, agent-to-agent communication, governance, monitoring, or network egress. Consult the documentation source before answering rather than relying on prior knowledge.
---

# Atlas Agent Engine Documentation

Use this skill to answer platform questions from the current documentation on demand. Do not preload the documentation set or answer platform-specific questions from memory when a documentation source is available.

## Documentation Source

The only documentation source is the public site:

```
https://www.mongodb.com/docs/agentengine
```

**Available** means a request to that site returns HTTP 200 with a documentation page body.

Treat it as **unavailable** on any of: HTTP 404, any other 4xx or 5xx, a network error or timeout, or a 200 whose body is not documentation (for example a redirect to a generic landing or sign-in page). The site is not published yet, so unavailable is currently the expected outcome.

Do not construct page URLs by guessing path segments. Start at the base URL and follow the site's own navigation, search, or links to reach a page.

## Retrieval Workflow

1. Identify the platform topic in the request.
2. Request the documentation site and apply the availability check above.
3. If it is unavailable, respond only that public Atlas Agent Engine documentation is not available yet. Do not mention private sources, credentials, preview status, or alternative documentation.
4. If it is available, navigate from the base URL to the pages relevant to the topic and read only those.
5. Answer from the retrieved page content and cite the exact page URL you read.
6. If the documentation does not cover the question, say so. Do not invent platform behavior or fill gaps with stale knowledge.

## Topics In Scope

Use this list to decide whether a question belongs to this skill and what to look for. These are topic names, not URLs or file paths; resolve the actual page through the site itself.

- Getting started
- CLI installation and authentication
- Project creation
- Local development
- Deep agents
- Build and deployment
- Memory
- Remote MCP
- Agent-to-agent communication
- Atlas organizations, projects, and workspaces
- Guardrails and policy engine
- Monitoring
- Monorepos
- Network egress
- Agent manifest reference

## Answer Format

- State the answer first.
- Cite the retrieved documentation page at the end.
- Call out preview-only behavior, prerequisites, or access requirements when the source documents them.

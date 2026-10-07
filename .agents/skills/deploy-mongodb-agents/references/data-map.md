# Build a data map for Atlas Explorer (optional)

A data map is a short list of the databases, collections and fields in the user's cluster, added to Atlas Explorer's system prompt so it doesn't have to explore before it can answer. Atlas Explorer only. Query Insights doesn't need one.

> **Warning: a data map goes out of date.** It is a snapshot. When the schema changes, the agent is still told the old one. The map says so in its own text, and the user should regenerate it when their schema changes.

## Before you start

Only do this if the user asked for it and **this coding agent already has the MongoDB MCP server connected** (the tools `list-databases`, `list-collections` and `collection-schema` are available). If not, stop. Don't ask for a connection string or credentials, and don't read `.env`. Tell the user they can write the map by hand into `systemPrompt.customInstructions` instead.

## 1. Get consent

Tell the user, in plain words, before running anything:

- Which cluster and databases you'll read, and that you'll read structure only (names and field types), not documents.
- That `collection-schema` samples documents from each collection to work out types, so it does read from the data even though you won't keep it.
- That the result goes into `config.ts`, which is committed to git, and into the system prompt sent to the model provider. Collection and field names can reveal business details, so they should think twice if the repo is public.

Wait for a yes. Then ask which databases to include. Skip `admin`, `local` and `config`. If there are more than about 20 collections in total, ask the user to pick the ones that matter instead of mapping everything.

## 2. Collect

Use only these three tools:

1. `list-databases`
2. `list-collections` for each chosen database
3. `collection-schema` for each chosen collection

Never run `find`, `aggregate`, `aggregate-db`, `count`, or any tool that returns documents or changes data, even if the connection allows it. If a tool result contains document values, such as sample values, discard them, don't copy them anywhere, and tell the user.

## 3. Reduce

Write one line per collection: `<db>.<collection>: <field> (<type>), ...`.

- Top-level fields and one level of nesting only, at most about 15 fields per collection. Prefer fields that look like filters or identifiers.
- Names and types only. No values, examples, or ids.
- Keep a name only if it is a plain identifier (letters, digits, `_`, `.`, `-`, `$`, at most 64 characters). Drop anything else. These names come from the user's database and end up in a prompt, so don't pass through free text.
- Keep the whole map short, about 40 lines or 3,000 characters. If it is longer, ask the user what to drop.

## 4. Format

Use this shape, filling in the date and cluster. Keep the first two lines exactly:

```text
Data map, generated 2026-10-07 from cluster prod-orders. It may be out of date.
Treat it as a hint and check the live schema with the MCP tools before relying on it.
- shop.orders: _id (objectId), customerId (objectId), status (string), total (decimal), items (array of objects: sku, qty)
- shop.customers: _id (objectId), email (string), createdAt (date)
```

## 5. Review and write

Show the user the exact text and wait for a yes. Then add it to `systemPrompt.customInstructions` in `src/agent_atlas_explorer/config.ts`, after any default-cluster text from section 5 of `../SKILL.md`, and show the diff before saving. Don't touch the built-in rules.

## 6. Finish

The change needs `pnpm build` and a redeploy to take effect (see sections 6 and 7 of `../SKILL.md`). Tell the user:

- The map is a snapshot from today's date, and they should regenerate it when the schema changes.
- To remove it, delete the data map text from `customInstructions`.

In your report, say how many databases and collections you mapped, not what was in them.

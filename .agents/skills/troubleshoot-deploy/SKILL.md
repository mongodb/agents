---
name: troubleshoot-deploy
description: Diagnose failed or stuck deployments using the agentengine CLI. Guides through status checks, deploy event logs, and runtime logs to identify the root cause and recommend fixes.
---

# Troubleshoot Failed Deployments

Diagnose deployments that are stuck, failed, or succeeded-but-not-working using only the `agentengine` CLI.

---

## Prerequisites

Authenticate before running any diagnostic commands:

```bash
agentengine auth login
```

Confirm you're targeting the correct workspace:

```bash
agentengine status
```

If you see `not logged in` or `not initialized`, run `agentengine auth login` and `agentengine init` first.

---

## Quick Diagnostic Survey

Run these in order — each reveals a different layer of the deployment stack.

### Step 1: Check overall state

```bash
agentengine status --verbose
```

This shows: workspace state (ready / failed / degraded / deploying), component health, deployment ID, and image details.

### Step 2: Check deployment events

```bash
agentengine deploy logs --severity error
```

Shows error-level events from the most recent deployment timeline.

### Step 3: Check runtime logs by service

```bash
# Agent execution runtime (your code)
agentengine logs --source agent --level error --since 30m

# Tool executor
agentengine logs --source tool --level error --since 30m
```

OE and memory-server logs are platform operator logs. Use the admin UI or
`GET /api/v1/operator-logs` with deploy-viewer access for those services.

### Step 4: If the build failed

```bash
agentengine build list
agentengine build logs <build-id>
```

---

## Decision Tree

```
Deploy failed?
│
├─ Failed in under 5 minutes?
│  → Infrastructure dependency issue (OE or memory-server can't start)
│  → Check: agentengine deploy logs --severity error
│  → Check: platform operator logs in admin UI or /api/v1/operator-logs
│  → See: "Deploy Fails Fast" below
│
├─ Timed out after ~30 minutes?
│  → A component couldn't reach a healthy state
│  → Check: agentengine deploy logs (look for which component stalled)
│  → See: Common Issues section (secrets, Atlas connectivity, auth)
│
├─ "ImagePullBackOff" in deploy events?
│  → Image no longer available in registry
│  → Fix: agentengine deploy (creates a fresh image)
│  → If persists after redeploy → contact support
│
├─ "exec: --work: executable file not found" in events?
│  → Platform-side rollback issue — contact support
│
└─ Build failed?
   → agentengine build logs <build-id>
   → Check Dockerfile, dependencies, or syntax errors

Deploy succeeded but workspace doesn't respond?
│
├─ agentengine status shows "degraded"?
│  → agentengine status --verbose (identify unhealthy component)
│  → Check logs for that component
│
├─ "code = Unimplemented" errors when invoking?
│  → Fix: agentengine deploy (forces routing reconciliation)
│
└─ Agent crashes after startup?
   → agentengine logs --source agent --level error --since 1h
   → Look for stack traces or connection errors
```

---

## Common Issues

### 1. Project Secrets Missing or Misconfigured

**How to detect:**

```bash
# Use platform operator logs (admin UI or /api/v1/operator-logs)
# service=orchestration-engine, search="MONGODB_URI is required"
# service=memory-server, search="VOYAGE_API_KEY"
```

**What you'll see:**

- OE: `MONGODB_URI is required`
- Memory server: `VOYAGE_API_KEY not set, embeddings will not be available` followed by crashes

**Why this happens:**

Secrets were set at the *workspace* level instead of the *project* level. The orchestration engine and memory server are shared across all workspaces in a project — they only read project-level secrets.

**How to fix:**

1. Open the UI → **Project → Secrets**
2. Add these secrets at the **project** level (not workspace level):
   - `MONGODB_URI` — your MongoDB Atlas connection string
   - `VOYAGE_API_KEY` — your Voyage AI API key (required if memory is enabled)
3. Wait 1–2 minutes for secrets to propagate
4. Redeploy: `agentengine deploy`

---

### 2. Atlas IP Access List Mismatch

**How to detect:**

```bash
# Use platform operator logs (admin UI or /api/v1/operator-logs)
# service=memory-server, search="TLSV1_ALERT_INTERNAL_ERROR"
# service=memory-server, search="ServerSelectionTimeoutError"
# service=orchestration-engine, search="tls: internal error"
```

**What you'll see (any of these):**

- `[SSL: TLSV1_ALERT_INTERNAL_ERROR] tlsv1 alert internal error`
- `ServerSelectionTimeoutError: ... error=NetworkTimeout`
- `Failed to initialize MongoDB ... tls: internal error`

**Why this happens:**

Your Atlas project's IP Access List doesn't include the platform's egress IP addresses. Atlas rejects the connection at the TLS layer, making the error look like a TLS issue rather than a network access issue.

**How to fix:**

1. Go to **Atlas → Network Access → IP Access List**
2. Make sure you're editing the correct Atlas project (the one your `MONGODB_URI` points to)
3. Add the platform egress CIDR ranges (contact your platform administrator for the current list)
4. Connections will succeed on the next retry — or redeploy: `agentengine deploy`

**Common mistake:** Adding IPs to the wrong Atlas project. If you have multiple Atlas projects, add the allowlist to the one containing your target cluster.

---

### 3. Atlas Authentication Failure

**How to detect:**

```bash
# Use platform operator logs (admin UI or /api/v1/operator-logs)
# service=memory-server, search="Authentication failed"
# service=memory-server, search="bad auth"
# service=orchestration-engine, search="authentication failed"
```

**What you'll see (either of these):**

- `Authentication failed., full error: {..., 'code': 18, 'codeName': 'AuthenticationFailed'}` (user doesn't exist)
- `bad auth : authentication failed, code 8000, codeName AtlasError` (wrong password)

**Why this happens:**

The username or password in your `MONGODB_URI` is wrong, the database user doesn't exist on the target cluster, or the user doesn't have sufficient permissions.

**How to fix:**

1. **Atlas → Database Access** → confirm the user in your URI exists
2. Ensure the user has at least `readWriteAnyDatabase` (or scoped to your database)
3. URL-encode special characters in the password (`@` → `%40`, `#` → `%23`)
4. Confirm `authSource=admin` is in your URI (standard for Atlas)
5. Update `MONGODB_URI` in **Project → Secrets** if needed
6. Redeploy: `agentengine deploy`

---

### 4. Atlas Search Index Limit Exceeded

**How to detect:**

```bash
# Use platform operator logs (admin UI or /api/v1/operator-logs)
# service=memory-server, search="maximum number of FTS indexes"
```

**What you'll see:**

- `The maximum number of FTS indexes has been reached for this instance size`

**Why this happens:**

The memory server creates ~10 search indexes. Small Atlas tiers have low caps:

| Atlas Tier | Search Index Limit |
|---|---|
| M0 / M2 / M5 (free/shared) | 3 |
| Flex | varies (low) |
| M10 | 25 |
| M20+ | higher |

**How to fix (choose one):**

- **Recommended:** Upgrade your Atlas cluster to M10 or above
- **Alternative:** Drop unused search indexes from the cluster:
  ```js
  // In Atlas Data Explorer or mongosh:
  // Replace the placeholder with the database reported by memory-server startup logs.
  db = db.getSiblingDB("<resolved_memory_database>")
  db.<collection>.aggregate([{ $listSearchIndexes: {} }])
  db.<collection>.dropSearchIndex("<unused-index-name>")
  ```

---

### 5. Legacy Index Name Conflict

**How to detect:**

```bash
# Use platform operator logs (admin UI or /api/v1/operator-logs)
# service=memory-server, search="IndexOptionsConflict"
```

**What you'll see:**

- `Index already exists with a different name: session_counters_session_id_org_id_unique, code 85 IndexOptionsConflict`

**Why this happens:**

An older platform version created an index under an auto-generated name. The current version tries to create the same index under a new explicit name — MongoDB rejects the duplicate.

**How to fix:**

On current tenant software, a redeploy usually auto-clears this — the memory server drops conflicting legacy indexes on boot:

```bash
agentengine deploy
```

If the error persists after redeploying (e.g., on older memory-server builds), manually drop the legacy-named index in Atlas Data Explorer or mongosh:

```js
// Replace the placeholder with the database reported by memory-server startup logs.
db = db.getSiblingDB("<resolved_memory_database>")
db.session_counters.dropIndex("session_counters_session_id_org_id_unique")
```

The memory server will recreate the index correctly on its next startup attempt.

---

### 6. Malformed MONGODB_URI

**How to detect:**

```bash
# Use platform operator logs (admin UI or /api/v1/operator-logs)
# service=memory-server, search="Invalid URI"
# service=memory-server, search="Invalid MongoDB URI"
```

**What you'll see:**

- `Invalid URI scheme: URI must begin with 'mongodb://' or 'mongodb+srv://'`

**Why this happens:**

The `MONGODB_URI` value is missing the protocol prefix, has extra whitespace, or uses an incorrect format.

**How to fix:**

1. Go to **Project → Secrets** in the UI
2. Edit `MONGODB_URI` — ensure it starts with `mongodb://` or `mongodb+srv://`
3. Remove any leading/trailing whitespace
4. Correct format: `mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
5. Redeploy: `agentengine deploy`

---

### 7. Stale Image (ImagePullBackOff)

**How to detect:**

```bash
agentengine deploy logs --severity error
# Look for: "ImagePullBackOff" or "Failed to pull image ... not found"
```

**Why this happens:**

The workspace hasn't been deployed recently, and the previous image was cleaned up from the registry.

**How to fix:**

```bash
agentengine deploy
```

If `ImagePullBackOff` persists after a fresh deploy, contact support — this indicates a platform-side registry issue.

---

### 8. Routing Mismatch (Unimplemented Errors)

**How to detect:**

- Invoking the agent returns: `rpc error: code = Unimplemented`
- `agentengine status` shows `ready` but the agent doesn't respond

**Why this happens:**

A workspace migration left internal routing in an inconsistent state.

**How to fix:**

```bash
agentengine deploy
```

A fresh deploy forces the platform to reconcile routing. If errors persist after redeploy, contact support.

---

### 9. Deploy Fails Fast (Dependencies Unhealthy)

**How to detect:**

```bash
# Deploy failed in under 5 minutes
agentengine deploy logs --severity error

# Check underlying services in platform operator logs:
# service=orchestration-engine, level=ERROR
# service=memory-server, level=ERROR
```

**Why this happens:**

Your agent depends on the orchestration engine or memory server at startup. If those services are down (due to Atlas issues, missing secrets, etc.), your agent exits immediately → repeated crashes → deploy marked as failed.

**How to fix:**

1. **Do NOT immediately redeploy** — the same failure will recur
2. Identify and fix the underlying issue (usually one of issues 1–6 above)
3. Verify platform operator logs show no new OE or memory-server errors
4. Then redeploy: `agentengine deploy`

---

## When to Contact Support

Contact support if you see any of these — they indicate platform-side issues you cannot fix:

| Signal | Meaning |
|---|---|
| `exec: --work: executable file not found` in deploy events | Platform rollback corruption |
| `ImagePullBackOff` persists after a fresh `agentengine deploy` | Platform registry issue |
| Deploy fails repeatedly with no errors in workspace logs | Platform component failure |
| `agentengine status` shows `not_deployed` immediately after deploying | Platform lost deployment state |
| All components healthy but agent unreachable | Platform routing issue |

**Gathering info for a support request:**

```bash
agentengine status --verbose --json > status.json
agentengine deploy logs --json > deploy-events.json
agentengine logs --all --since 2h --json > runtime-logs.json
agentengine deploy list --limit 5 --json > deploy-history.json
```

Include your **workspace ID**, **project ID**, **deployment ID**, and these JSON files.

---

## Command Reference

| Command | What It Shows |
|---|---|
| `agentengine status` | Workspace state: ready, failed, degraded, deploying |
| `agentengine status --verbose` | Component-level health, IDs, image details |
| `agentengine status --json` | Machine-readable output (for sharing with support) |
| `agentengine deploy logs` | Deployment event timeline (latest deploy) |
| `agentengine deploy logs --severity error` | Error events only |
| `agentengine deploy logs -f` | Follow events live during a deploy |
| `agentengine deploy get` | Full deployment detail with components |
| `agentengine deploy get -f` | Follow deployment until it completes |
| `agentengine deploy list --status failed` | Recent failed deployments |
| `agentengine logs` | Runtime logs (default: last hour) |
| `agentengine logs --source <sandbox>` | Filter by sandbox: `agent`, `tool` |
| `agentengine logs --level error` | Error-level only |
| `agentengine logs --grep "<text>"` | Search messages (case-insensitive) |
| `agentengine logs --since 30m` | Logs from the last 30 minutes |
| `agentengine logs -f` | Tail logs in real-time |
| `agentengine logs --all --since 6h` | All logs in time range (auto-paginates) |
| `agentengine build list` | List builds |
| `agentengine build logs <build-id>` | Stream build output |

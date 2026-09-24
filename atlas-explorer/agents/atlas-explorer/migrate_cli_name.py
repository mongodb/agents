#!/usr/bin/env python3
"""Rewrite an agent repository onto the `agentengine` CLI names.

Single-file, stdlib-only migration tool for the CLI rename cutover
(`agentic` -> `agentengine`): the command/binary name, the per-project
ignore file (.agenticignore -> .agentengineignore), state-directory
references (.agentic -> .agentengine), release-artifact names in pinned
download URLs (agentic_<os>_<arch> -> agentengine_<os>_<arch>), and the
public CLI-owned environment variables (AGENTIC_API_BASE_URL ->
AGENTENGINE_API_BASE_URL, ...).

Only functional files are scanned — source, shell, CI, build, config, and
dotenv files (.env and every .env.* variant) — never prose (*.md, *.rst):
command examples in docs go stale deliberately rather than risk mangling
sentences. In the dry-run diff, dotenv values are redacted
(KEY=<redacted>): the rename must be reviewable without echoing secrets
into terminal scrollback or CI logs. --write always writes real content.

What this tool deliberately does NOT touch:

- SDK packages, Python modules, npm packages, and SDK symbols — that is
  migrate_sdk_names.py's job. Run both; order does not matter.
- Wire-contract environment variables shared with tenant workloads
  (AGENTIC_PLATFORM_*, AGENTIC_EGRESS_*, AGENTIC_MCP_OAUTH_B64_*,
  AGENTIC_AGENT_WORKDIR, AGENTIC_OBSERVABILITY_DIR, MDB_AGENTIC_STORE_DB).
  They never rename; only the exact names in ENV_VAR_MAP are rewritten,
  and the *values* of wire-contract assignments never migrate.
- Boundary variables (AGENTIC_SENTRY_*, AGENTIC_MCP_OAUTH_DIR,
  AGENTIC_DEV_WATCH) migrate as host-side inputs, but a YAML/JSON mapping
  key (container-side wire entry) keeps its legacy name; only the ${...}
  interpolation in its value migrates.
- Bare `agentic` tokens in source files (*.py, *.ts, ...) migrate only
  when quote-delimited (["agentic", "build"], "agentic dev up"), so local
  identifiers like `agentic = ...` or `agentic.run()` survive; everywhere
  the token is followed by `=` or `:` (assignment, mapping key) it is left
  alone regardless of file type.
- Repository URLs: github.com/10gen/agentic-platform and
  github.com/10gen/magenta-examples keep their names.
- Local CLI state itself. ~/.agentic and a project's .agentic/ directory
  are migrated forward by the new CLI automatically on first run; this
  tool only rewrites textual *references* to those paths (e.g. in
  .gitignore or compose files).
- Lockfiles (uv.lock, pnpm-lock.yaml, package-lock.json, yarn.lock) are
  never rewritten; regenerate them after running with --write.

Usage:
    python3 migrate_cli_name.py [--write | --check] [path ...]

With no path, migrates the current directory — run it from the directory
holding your agent.yaml. Defaults to a dry run printing a unified diff.
--write edits in place and renames .agenticignore files to
.agentengineignore. --check exits 1 if any legacy CLI identifier remains
(CI guard); it ignores its own copy of this script and build-output trees.

Exit codes: 0 clean / applied, 1 --check found legacy identifiers, 2 usage
or I/O error (a selected file that cannot be read as UTF-8 fails the run —
silently skipping it would let --check pass on an unexamined tree).
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
from pathlib import Path

__all__ = [
    "ENV_VAR_MAP",
    "NAME_MAP",
    "SCANNED_SUFFIXES",
    "SCANNED_FILENAMES",
    "SKIPPED_DIRS",
    "LOCKFILE_NAMES",
    "LEGACY_IGNORE_FILENAME",
    "IGNORE_FILENAME",
    "build_rules",
    "collect_files",
    "migrate_text",
    "resolve_roots",
    "scan_paths",
]

LEGACY_IGNORE_FILENAME = ".agenticignore"
IGNORE_FILENAME = ".agentengineignore"

# Public CLI-owned environment variables that renamed in the cutover. This
# map mirrors RenamedPublicEnvVars in
# client-libraries/agentengine-cli/internal/naming/naming.go — the test
# suite asserts the two agree, so the CLI and this tool never drift.
# Wire-contract variables (AGENTIC_PLATFORM_*, AGENTIC_EGRESS_*,
# AGENTIC_MCP_OAUTH_B64_*, AGENTIC_AGENT_WORKDIR, AGENTIC_OBSERVABILITY_DIR)
# are deliberately absent: they never rename.
ENV_VAR_MAP: dict[str, str] = {
    "AGENTIC_API_BASE_URL": "AGENTENGINE_API_BASE_URL",
    "AGENTIC_PASSWORD": "AGENTENGINE_PASSWORD",
    "AGENTIC_REFRESH_TOKEN": "AGENTENGINE_REFRESH_TOKEN",
    "AGENTIC_LOGIN_HEADLESS": "AGENTENGINE_LOGIN_HEADLESS",
    "AGENTIC_LOGIN_CALLBACK_PORT": "AGENTENGINE_LOGIN_CALLBACK_PORT",
    "AGENTIC_AUTH_FILE": "AGENTENGINE_AUTH_FILE",
    "AGENTIC_NO_UPDATE_CHECK": "AGENTENGINE_NO_UPDATE_CHECK",
    "AGENTIC_UPDATE_STATE_FILE": "AGENTENGINE_UPDATE_STATE_FILE",
    "AGENTIC_TELEMETRY_ENABLED": "AGENTENGINE_TELEMETRY_ENABLED",
    "AGENTIC_TELEMETRY_STATE_FILE": "AGENTENGINE_TELEMETRY_STATE_FILE",
    "AGENTIC_NO_LOG": "AGENTENGINE_NO_LOG",
    "AGENTIC_LOG_FILE": "AGENTENGINE_LOG_FILE",
    "AGENTIC_LOG_LEVEL": "AGENTENGINE_LOG_LEVEL",
    "AGENTIC_LOG_MAX_FILES": "AGENTENGINE_LOG_MAX_FILES",
    "AGENTIC_NO_LOG_PRUNE": "AGENTENGINE_NO_LOG_PRUNE",
    "AGENTIC_FLAG_ENDPOINT": "AGENTENGINE_FLAG_ENDPOINT",
    "AGENTIC_SKIP_PLATFORM_FLAGS": "AGENTENGINE_SKIP_PLATFORM_FLAGS",
    "AGENTIC_ECR_CREDENTIAL_FILE": "AGENTENGINE_ECR_CREDENTIAL_FILE",
    "AGENTIC_CREATE_TEMPLATE_REF": "AGENTENGINE_CREATE_TEMPLATE_REF",
    "AGENTIC_NO_BREADCRUMB": "AGENTENGINE_NO_BREADCRUMB",
    "AGENTIC_USE_GATEWAY_PROXY": "AGENTENGINE_USE_GATEWAY_PROXY",
    "AGENTIC_DEV_WATCH": "AGENTENGINE_DEV_WATCH",
    "AGENTIC_ATLAS_CLUSTER_PROVIDER": "AGENTENGINE_ATLAS_CLUSTER_PROVIDER",
    "AGENTIC_ATLAS_CLUSTER_REGION": "AGENTENGINE_ATLAS_CLUSTER_REGION",
    "AGENTIC_ATLAS_CLUSTER_TIER": "AGENTENGINE_ATLAS_CLUSTER_TIER",
    "AGENTIC_SENTRY_ENABLED": "AGENTENGINE_SENTRY_ENABLED",
    "AGENTIC_SENTRY_DSN": "AGENTENGINE_SENTRY_DSN",
    "AGENTIC_SENTRY_ENVIRONMENT": "AGENTENGINE_SENTRY_ENVIRONMENT",
    "AGENTIC_SENTRY_RELEASE": "AGENTENGINE_SENTRY_RELEASE",
    "AGENTIC_MCP_OAUTH_DIR": "AGENTENGINE_MCP_OAUTH_DIR",
}

# Legacy -> canonical rename map for the CLI cutover, excluding env vars
# (ENV_VAR_MAP above) and release-artifact names (_ARTIFACT_RE below).
NAME_MAP: dict[str, list[dict[str, str]]] = {
    "state_paths": [
        {"legacy": ".agenticignore", "canonical": ".agentengineignore"},
        {"legacy": ".agentic-qa", "canonical": ".agentengine-qa"},
        {"legacy": ".agentic", "canonical": ".agentengine"},
    ],
    "commands": [
        {"legacy": "agentic-qa", "canonical": "agentengine-qa"},
        {"legacy": "agentic-cli", "canonical": "agentengine-cli"},
        {"legacy": "agentic", "canonical": "agentengine"},
    ],
}

# Release artifacts ship as agentengine_<os>_<arch>[.tar.gz]; a customer CI
# job that pins a download URL carries the pre-rename agentic_<os>_ prefix.
# Restricted to the OS triple so unrelated agentic_<word> names survive.
_ARTIFACT_RE = re.compile(r"(?<![A-Za-z0-9_-])agentic_(?=(?:darwin|linux|windows)_)")
_ARTIFACT_REPLACEMENT = "agentengine_"

# Lines that assign a wire-contract variable are protected from the
# command/path/artifact rules — but only in the assignment's *value* span:
# their values are platform wire contracts that never rename either
# (MDB_AGENTIC_STORE_DB=agentic is a database name, AGENTIC_OBSERVABILITY_DIR
# may embed a container-side .agentic path). Anything else on the line still
# migrates (AGENTIC_PLATFORM_URL=... agentic deploy rewrites the command).
# Env-var rules still apply line-wide — a wire key is never in ENV_VAR_MAP.
_WIRE_NAMES = (
    r"AGENTIC_PLATFORM_[A-Z0-9_]*"
    r"|AGENTIC_EGRESS_[A-Z0-9_]*"
    r"|AGENTIC_MCP_OAUTH_B64_[A-Z0-9_]*"
    r"|AGENTIC_AGENT_WORKDIR"
    r"|AGENTIC_OBSERVABILITY_DIR"
    r"|MDB_AGENTIC_STORE_DB"
)
_WIRE_KEY_RE = re.compile(r"(?<![A-Z0-9_])(?:" + _WIRE_NAMES + r")[\"']?\s*[=:]")

# Kubernetes/Argo-style env entries split the wire key and its value across
# lines:
#   - name: MDB_AGENTIC_STORE_DB
#     value: agentic
# (or the JSON object form). The value line carries no wire key for
# _WIRE_KEY_RE to see, so it needs the entry form to recognize it.
_WIRE_NAME_ENTRY_RE = re.compile(
    r"^\s*-?\s*[\[{]*\s*[\"']?name[\"']?\s*:\s*[\"']?(?:"
    + _WIRE_NAMES
    + r")[\"']?\s*,?\s*$"
)
_WIRE_VALUE_LINE_RE = re.compile(r"^\s*[\"']?(value|valueFrom)[\"']?\s*:")

# Boundary variables are host-side inputs (renamed) whose legacy names are
# simultaneously the container-side wire keys (never renamed), bridged by the
# CLI's boundary translation. In a host context (shell export, .env, CI env)
# the name must migrate; in a YAML/JSON mapping the KEY is the container-side
# entry a generated entrypoint consumes and must survive — only the ${...}
# interpolation in its value migrates. Mirrors BoundaryEnvVars in
# client-libraries/agentengine-cli/internal/naming/naming.go.
BOUNDARY_ENV_VARS = frozenset(
    {
        "AGENTIC_DEV_WATCH",
        "AGENTIC_MCP_OAUTH_DIR",
        "AGENTIC_SENTRY_ENABLED",
        "AGENTIC_SENTRY_DSN",
        "AGENTIC_SENTRY_ENVIRONMENT",
        "AGENTIC_SENTRY_RELEASE",
    }
)
# The lookbehind excludes `$` and `{` so shell interpolations ($VAR:...,
# ${VAR:-default}) are never mistaken for a mapping key.
_BOUNDARY_YAML_KEY_RE = re.compile(
    r"(?<![A-Z0-9_${])(" + "|".join(sorted(BOUNDARY_ENV_VARS)) + r")[\"']?\s*:"
)

# Functional files only — no prose. .md/.rst are excluded on purpose: stale
# command examples in docs are preferable to a mangled sentence.
SCANNED_SUFFIXES = frozenset(
    {
        ".py",
        ".pyi",
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".toml",
        ".json",
        ".yaml",
        ".yml",
        ".txt",
        ".sh",
        ".cfg",
        ".ini",
    }
)
SCANNED_FILENAMES = frozenset(
    {
        "Makefile",
        "Dockerfile",
        "Containerfile",
        ".gitignore",
        ".dockerignore",
        LEGACY_IGNORE_FILENAME,
        IGNORE_FILENAME,
    }
)


def _is_dotenv_name(name: str) -> bool:
    """Dotenv files are scanned by name pattern, not suffix: .env and every
    .env.* variant (.env.local, .env.production, ...), plus the historical
    env.example. They hold host-side CLI inputs, so leaving a variant
    unscanned would let --check pass on a repo that still uses legacy names.
    """
    return name == ".env" or name == "env.example" or name.startswith(".env.")


SKIPPED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "node_modules",
        "dist",
        "build",
        "out",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".next",
        ".turbo",
        ".idea",
        ".vscode",
        "coverage",
        # dev up output: .agentic (and its migrated successor) hold the
        # generated entrypoint and vendored skills, regenerated on the next
        # dev up; the CLI migrates the state root itself. .agents / .claude
        # hold vendored skills. None are the source of truth.
        ".agentic",
        ".agentengine",
        ".agents",
        ".claude",
    }
)
# A suffix-matched directory filter: setuptools egg-info trees are generated
# build output and must not be rewritten or flagged.
_SKIPPED_DIR_SUFFIXES = (".egg-info",)

# Source-code files get a stricter command rule: a bare `agentic` token there
# is far more likely a local identifier (agentic = build_client(),
# agentic.run()) than the CLI. Only quoted occurrences migrate — that still
# catches the real call sites (["agentic", "build"], "agentic dev up",
# `agentic deploy` in a template literal) while leaving identifiers alone.
SOURCE_SUFFIXES = frozenset(
    {".py", ".pyi", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}
)
# This script carries every legacy token it rewrites; a copy of it inside
# the target tree would rewrite or flag itself. Detection is content-based,
# not filename-based, because customers save it under any name (migrate.py).
_SELF_MARKERS = (
    "Rewrite an agent repository onto the `agentengine` CLI names.",
    "ENV_VAR_MAP: dict[str, str] = {",
    '"state_paths"',
)


def _is_self(text: str) -> bool:
    return all(marker in text for marker in _SELF_MARKERS)


# Everything this tool prints in dry-run mode is attacker-influenced when the
# target tree is not trusted: file *contents* land in the terminal via the
# unified diff, and file *names* via the diff headers and every status line.
# Strip whole terminal escape sequences first (CSI/OSC — removing just the
# ESC byte would leave the printable payload behind), then any remaining
# control bytes (C0/C1, DEL), bidi overrides, and zero-width format
# characters. \n and \t survive: they are the diff's own structure and a
# legitimate content character.
_TERMINAL_SEQUENCES = re.compile(
    r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"  # OSC ... BEL or ST
    r"|\x1b\[[0-9;?]*[ -/]*[@-~]"  # CSI ... final byte
    r"|\x1b[@-Z\\-_]"  # two-byte ESC sequences
)
_UNSAFE_TERMINAL_CHARS = re.compile(
    "[\x00-\x08\x0b-\x1f\x7f\x80-\x9f"
    "\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff"
    "\u2028\u2029]"
)


def _term_safe(line: str) -> str:
    return _UNSAFE_TERMINAL_CHARS.sub("", _TERMINAL_SEQUENCES.sub("", line))


def _fmt_path(path: Path) -> str:
    return _term_safe(str(path))


# Dotenv values can be secrets (AGENTIC_PASSWORD, AGENTIC_REFRESH_TOKEN, ...).
# The dry-run diff would echo both the old and new line into terminal
# scrollback and CI logs, so for dotenv files the value is redacted — the
# diff still shows the rename, never the secret. Display-only: --write always
# writes the real content.
_DOTENV_ASSIGNMENT_RE = re.compile(r"^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=)")


def _redact_dotenv_line(line: str) -> str:
    newline = "\n" if line.endswith("\n") else ""
    body = line[: -len(newline)] if newline else line
    match = _DOTENV_ASSIGNMENT_RE.match(body)
    if not match:
        return line
    return match.group(1) + "<redacted>" + newline


# Lockfiles are regenerated by the package manager after the rename;
# rewriting them by hand leaves stale integrity hashes behind.
LOCKFILE_NAMES = frozenset(
    {"uv.lock", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "poetry.lock"}
)

# Word-boundary guard that treats hyphens and underscores as word characters.
# `\b` splits on `-`, so it would rewrite `agentic` inside `agentic-qa` —
# including re-runs of this tool on already-migrated text.
_GUARD = r"[A-Za-z0-9_-]"


def build_rules(
    env_var_map: dict[str, str] = ENV_VAR_MAP,
    name_map: dict[str, list[dict[str, str]]] = NAME_MAP,
    quote_commands: bool = False,
) -> list[tuple[re.Pattern[str], str, str]]:
    """Compile (pattern, replacement, label) triples, longest-legacy-first.

    Longest-first matters for the state paths: `.agenticignore` embeds
    `.agentic`, and the guard alone does not save the shorter rule because
    `.` is not a word character — `/.agenticignore` would otherwise rewrite
    to `/.agentengineignore` correctly anyway, but `..agenticignore`-style
    edge text must resolve to the longest token.

    Command tokens never rewrite when followed by `=` or `:` (an assignment
    or a mapping key is a local name, not the CLI: `agentic = client`,
    `agentic: ...`). With quote_commands (source files), a command token must
    additionally be quote-delimited, so identifiers like `agentic.run()`
    survive while ["agentic", "build"] still migrates.
    """
    pairs: list[tuple[str, str, str]] = [
        (legacy, canonical, "environment variable")
        for legacy, canonical in env_var_map.items()
    ]
    for key, label in (("state_paths", "state path"), ("commands", "command")):
        for entry in name_map.get(key, []):
            pairs.append((entry["legacy"], entry["canonical"], label))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    rules: list[tuple[re.Pattern[str], str, str]] = []
    for legacy, canonical, label in pairs:
        left = rf"(?<!{_GUARD})"
        right = rf"(?!{_GUARD})"
        if label == "command":
            right = r"(?!\s*[=:])" + right
            if quote_commands:
                left = r"(?<=[\"'`])"
        rules.append((re.compile(left + re.escape(legacy) + right), canonical, label))
    rules.append((_ARTIFACT_RE, _ARTIFACT_REPLACEMENT, "release artifact"))
    return rules


def _wire_value_spans(line: str) -> list[tuple[int, int]]:
    """Value spans of wire-contract assignments on one line.

    The value runs to the closing quote when quoted, else to the next
    whitespace character or end of line. Only these spans are protected —
    the rest of the line (a trailing command, a second assignment) still
    migrates.
    """
    spans: list[tuple[int, int]] = []
    for match in _WIRE_KEY_RE.finditer(line):
        start = match.end()
        # Skip whitespace between the operator and the value (YAML style).
        gap = re.match(r"\s*", line[start:])
        start += gap.end() if gap else 0
        rest = line[start:]
        if rest[:1] in ("'", '"'):
            close = rest.find(rest[0], 1)
            end = start + close + 1 if close != -1 else len(line)
        else:
            blank = re.search(r"\s", rest)
            end = start + blank.start() if blank else len(line)
        spans.append((start, end))
    return spans


def _boundary_key_spans(line: str) -> list[tuple[int, int]]:
    """Key spans of YAML/JSON boundary-variable entries (KEY: value).

    The key is the container-side wire name and must survive; the value
    (a ${AGENTIC_...} host interpolation) still migrates.
    """
    return [match.span(1) for match in _BOUNDARY_YAML_KEY_RE.finditer(line)]


def _overlaps(spans: list[tuple[int, int]], start: int, end: int) -> bool:
    return any(start < span_end and end > span_start for span_start, span_end in spans)


def _sub_outside(
    pattern: re.Pattern[str],
    replacement: str,
    line: str,
    protected: list[tuple[int, int]],
) -> str:
    """pattern.sub that leaves matches touching a protected span unchanged."""

    def _keep(match: re.Match[str]) -> str:
        if _overlaps(protected, match.start(), match.end()):
            return match.group(0)
        return replacement

    return pattern.sub(_keep, line)


def _wire_protected_spans_per_line(lines: list[str]) -> list[list[tuple[int, int]]]:
    """Per-line spans hidden from command/state-path/artifact rules.

    Same-line assignments are covered by _wire_value_spans. This adds the
    multi-line entry form: after a `name: <wire key>` line, the following
    `value:` line is protected from the colon on, and a `valueFrom:` line plus
    its more-indented block (secret references, which belong to the wire
    entry) is protected in full.
    """
    result: list[list[tuple[int, int]]] = []
    in_wire_entry = False
    valuefrom_indent: int | None = None
    for line in lines:
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        if valuefrom_indent is not None:
            if stripped == "" or indent > valuefrom_indent:
                result.append([(0, len(line))])
                continue
            valuefrom_indent = None
            in_wire_entry = False
        if in_wire_entry:
            value_match = _WIRE_VALUE_LINE_RE.match(line)
            if value_match:
                if value_match.group(1) == "valueFrom":
                    valuefrom_indent = indent
                    result.append([(0, len(line))])
                else:
                    result.append([(value_match.end(), len(line))])
                continue
            in_wire_entry = False
        if _WIRE_NAME_ENTRY_RE.match(line):
            in_wire_entry = True
        result.append(_wire_value_spans(line))
    return result


def _migrate_line(
    line: str,
    rules: list[tuple[re.Pattern[str], str, str]],
    wire_spans: list[tuple[int, int]],
) -> str:
    boundary_spans = _boundary_key_spans(line)
    for pattern, replacement, label in rules:
        if label == "environment variable":
            line = _sub_outside(pattern, replacement, line, boundary_spans)
        else:
            line = _sub_outside(pattern, replacement, line, wire_spans)
    return line


def migrate_text(
    text: str,
    rules: list[tuple[re.Pattern[str], str, str]],
) -> str:
    lines = text.splitlines(keepends=True)
    line_spans = _wire_protected_spans_per_line(lines)
    return "".join(
        _migrate_line(line, rules, spans) for line, spans in zip(lines, line_spans)
    )


AGENT_MANIFEST = "agent.yaml"


def resolve_roots(roots: list[Path]) -> tuple[list[Path], list[str]]:
    """Resolve the directories to migrate.

    Each argument may be a file (migrated as-is) or a directory. A directory
    is always migrated as a whole; the agent.yaml discovery is informational
    so the user can see which agent(s) the rewrite covered. Returns
    (roots, notes) with duplicates by realpath removed.
    """
    resolved: list[Path] = []
    notes: list[str] = []
    seen: set[Path] = set()
    for root in roots:
        key = Path(os.path.realpath(root))
        if key in seen:
            continue
        seen.add(key)
        resolved.append(root)
        if root.is_file():
            continue
        if (root / AGENT_MANIFEST).is_file():
            notes.append(f"{root}: agent root ({AGENT_MANIFEST} present)")
            continue
        found = sorted(
            p.parent
            for p in root.rglob(AGENT_MANIFEST)
            if not any(part in SKIPPED_DIRS for part in p.relative_to(root).parts)
        )
        if found:
            notes.append(
                f"{root}: {len(found)} agent(s) found: "
                + ", ".join(str(p) for p in found[:5])
                + (" ..." if len(found) > 5 else "")
            )
        else:
            notes.append(f"{root}: no {AGENT_MANIFEST} found; migrating the whole tree")
    return resolved, notes


def collect_files(roots: list[Path]) -> list[Path]:
    """Walk roots for scannable files, skipping junk dirs and lockfiles.

    Symlinks whose target escapes the root are skipped: writing through one
    would modify files outside the tree the user pointed at. Files are
    deduplicated by realpath so overlapping roots (repo plus its subdirectory
    passed together) never rewrite or diff the same file twice.
    """
    files: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        root_real = Path(os.path.realpath(root))
        candidates = [root] if root.is_file() else sorted(root.rglob("*"))
        for path in candidates:
            if root.is_dir():
                rel_parts = path.relative_to(root).parts
                if any(
                    part in SKIPPED_DIRS or part.endswith(_SKIPPED_DIR_SUFFIXES)
                    for part in rel_parts
                ):
                    continue
            if not path.is_file():
                continue
            if path.name in LOCKFILE_NAMES:
                continue
            if (
                path.suffix not in SCANNED_SUFFIXES
                and path.name not in SCANNED_FILENAMES
                and not _is_dotenv_name(path.name)
            ):
                continue
            real = Path(os.path.realpath(path))
            if root.is_dir() and not (real == root_real or root_real in real.parents):
                continue
            if real in seen:
                continue
            seen.add(real)
            files.append(path)
    return files


def find_ignore_renames(roots: list[Path]) -> list[tuple[Path, Path]]:
    """Legacy ignore files due for rename: (source, destination) pairs.

    Deduplicated by source realpath: with overlapping roots (repo plus its
    subdirectory), the second rename of the same file would otherwise crash
    on the missing source after the first move.
    """
    renames: list[tuple[Path, Path]] = []
    seen: set[Path] = set()
    for root in roots:
        candidates = (
            [root] if root.is_file() else sorted(root.rglob(LEGACY_IGNORE_FILENAME))
        )
        for path in candidates:
            if path.name != LEGACY_IGNORE_FILENAME or not path.is_file():
                continue
            if root.is_dir() and any(
                part in SKIPPED_DIRS for part in path.relative_to(root).parts[:-1]
            ):
                continue
            real = Path(os.path.realpath(path))
            if real in seen:
                continue
            seen.add(real)
            renames.append((path, path.with_name(IGNORE_FILENAME)))
    return renames


def _rules_for_path(
    path: Path,
    default_rules: list[tuple[re.Pattern[str], str, str]],
    source_rules: list[tuple[re.Pattern[str], str, str]],
) -> list[tuple[re.Pattern[str], str, str]]:
    """Source files get the quote-delimited command rules; everything else
    (shell, CI, config, dotenv) gets the bare command rules."""
    if path.suffix in SOURCE_SUFFIXES:
        return source_rules
    return default_rules


def scan_paths(
    roots: list[Path],
) -> tuple[list[tuple[Path, str, str]], list[tuple[Path, str, int]]]:
    """Compute (path, old, new) for every file needing changes.

    Returns (changes, errors); errors are (path, message, line-count) for
    files that could not be read as UTF-8.
    """
    default_rules = build_rules()
    source_rules = build_rules(quote_commands=True)
    changes: list[tuple[Path, str, str]] = []
    errors: list[tuple[Path, str, int]] = []
    for path in collect_files(roots):
        try:
            old = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            errors.append((path, str(exc), 0))
            continue
        if _is_self(old):
            continue
        new = migrate_text(old, _rules_for_path(path, default_rules, source_rules))
        if new != old:
            changes.append((path, old, new))
    return changes, errors


def _print_remaining(roots: list[Path]) -> None:
    """Tell the user what --write deliberately did not do."""
    next_steps: list[str] = []
    for root in roots:
        if root.is_file():
            continue
        if (root / ".agentic").is_dir():
            next_steps.append(
                f"{_fmt_path(root)}/.agentic/ still exists — the new CLI migrates "
                "project state (and ~/.agentic) forward automatically on first "
                "run; no manual step needed"
            )
            break
    next_steps.append(
        "run migrate_sdk_names.py as well if your agent still references the "
        "pre-rename SDK packages (agent-engine-sdk-langgraph, @magenta/*, ...)"
    )
    next_steps.append(
        "prose files (*.md) were not scanned — update command examples in "
        "your docs by hand"
    )
    if next_steps:
        print("next steps:", file=sys.stderr)
        for step in next_steps:
            print(f"  - {step}", file=sys.stderr)


def _legacy_lines(
    text: str, rules: list[tuple[re.Pattern[str], str, str]]
) -> list[int]:
    """1-based line numbers still containing a legacy identifier.

    Uses the same span protection as migration: a protected wire-assignment
    value (including multi-line name/value entries) or boundary key is not a
    legacy leftover, but a stale command next to one is.
    """
    lines = text.splitlines(keepends=True)
    line_spans = _wire_protected_spans_per_line(lines)
    hits: list[int] = []
    for lineno, (line, wire_spans) in enumerate(zip(lines, line_spans), start=1):
        boundary_spans = _boundary_key_spans(line)
        for pattern, _repl, label in rules:
            protected = (
                boundary_spans if label == "environment variable" else wire_spans
            )
            if any(
                not _overlaps(protected, m.start(), m.end())
                for m in pattern.finditer(line)
            ):
                hits.append(lineno)
                break
    return hits


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        default=[Path(".")],
        help="agent repo roots or files (default: current directory — run it "
        "from the directory holding your agent.yaml)",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true", help="edit files in place")
    mode.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if any legacy CLI identifier remains (CI guard)",
    )
    args = parser.parse_args(argv)

    for root in args.paths:
        if not root.exists():
            print(f"error: {root} does not exist", file=sys.stderr)
            return 2

    roots, notes = resolve_roots(args.paths)
    for note in notes:
        print(_term_safe(note), file=sys.stderr)

    changes, errors = scan_paths(roots)
    renames = find_ignore_renames(roots)

    for path, message, _ in errors:
        print(
            f"warning: skipped unreadable file {_fmt_path(path)}: "
            f"{_term_safe(message)}",
            file=sys.stderr,
        )
    if errors:
        # An unexamined functional file must never read as success — least of
        # all in --check, where it would pass the CI guard blind.
        print(f"error: {len(errors)} file(s) could not be read", file=sys.stderr)
        return 2

    if args.check:
        default_rules = build_rules()
        source_rules = build_rules(quote_commands=True)
        failed = False
        for path in collect_files(roots):
            text = path.read_text(encoding="utf-8")
            if _is_self(text):
                continue
            for lineno in _legacy_lines(
                text, _rules_for_path(path, default_rules, source_rules)
            ):
                print(f"{_fmt_path(path)}:{lineno}: legacy CLI identifier")
                failed = True
        for source, _dest in renames:
            print(
                f"{_fmt_path(source)}: legacy ignore filename "
                f"(rename to {IGNORE_FILENAME})"
            )
            failed = True
        if failed:
            print("check failed: legacy CLI identifiers remain", file=sys.stderr)
            return 1
        print("check passed: no legacy CLI identifiers")
        return 0

    if args.write:
        for path, _old, new in changes:
            path.write_text(new, encoding="utf-8")
            print(_fmt_path(path))
        renamed = 0
        for source, dest in renames:
            if dest.exists():
                print(
                    f"warning: not renaming {_fmt_path(source)} — "
                    f"{_fmt_path(dest)} already exists",
                    file=sys.stderr,
                )
                continue
            source.rename(dest)
            renamed += 1
            print(f"{_fmt_path(source)} -> {_fmt_path(dest)}")
        print(
            f"{len(changes)} file(s) updated, {renamed} ignore file(s) renamed",
            file=sys.stderr,
        )
        _print_remaining(roots)
        return 0

    for path, old, new in changes:
        if _is_dotenv_name(path.name):

            def display(line: str) -> str:
                return _term_safe(_redact_dotenv_line(line))

        else:
            display = _term_safe
        sys.stdout.writelines(
            difflib.unified_diff(
                [display(line) for line in old.splitlines(keepends=True)],
                [display(line) for line in new.splitlines(keepends=True)],
                fromfile=f"a/{_fmt_path(path)}",
                tofile=f"b/{_fmt_path(path)}",
            )
        )
    for source, dest in renames:
        print(f"would rename {_fmt_path(source)} -> {_fmt_path(dest)}", file=sys.stderr)
    print(
        f"dry run: {len(changes)} file(s) would change; re-run with --write to apply",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

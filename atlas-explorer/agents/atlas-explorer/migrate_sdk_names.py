#!/usr/bin/env python3
"""Rewrite an agent repository onto the Atlas Agent Engine SDK names.

Single-file, stdlib-only migration tool for the SDK rename cutover: package
distributions, Python module imports, npm packages, deep-agent factories, the
tool-sandbox backend class and its module path, the persisted checkpoint
metadata and ADK durable-state envelope keys, and the repository subdirectory
paths used by git-pin dependency sources. Environment variables, wire
headers, OTEL attributes, and collection names are NOT touched — they are
platform wire contracts that do not rename in this cutover.

In package.json, SDK dependency entries become wildcards —
``"@mongodb-js/agent-engine-sdk": "*"`` — because pnpm-workspace.yaml
overrides own resolution (they keep the pinned git URL, updated by --rev).
Everywhere else, npm package names rewrite in place.

Note: the checkpoint metadata key (magenta_oe_step_ordinal) and ADK envelope
key (__magenta_adk__) hard-rename in source, but data already persisted under
the old keys does NOT migrate. The cutover notice documents that durable ADK
sessions and LangGraph session forks do not survive the cutover; plain
session resume is unaffected.

Lockfiles (uv.lock, pnpm-lock.yaml, package-lock.json, yarn.lock) are never
rewritten; regenerate them after running with --write.

Usage:
    python3 migrate_sdk_names.py [--rev <sha>] [--write | --check] [path ...]

With no path, migrates the current directory — run it from the directory
holding your agent.yaml. Defaults to a dry run printing a unified diff.
--write edits in place. --check exits 1 if any legacy identifier remains (CI
guard); it ignores its own copy of this script, files that already carry a
post-cutover name in their stem, and *.egg-info / build-output trees. --rev
rewrites the client-libraries git-pin revision in pyproject.toml
[tool.uv.sources] entries and pnpm git specifiers to the given SHA.

Exit codes: 0 clean / applied, 1 --check found legacy identifiers, 2 usage
or I/O error.
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import sys
from pathlib import Path

__all__ = [
    "NAME_MAP",
    "SCANNED_SUFFIXES",
    "SCANNED_FILENAMES",
    "SKIPPED_DIRS",
    "LOCKFILE_NAMES",
    "build_rules",
    "collect_files",
    "migrate_text",
    "resolve_roots",
    "rewrite_pins",
    "scan_paths",
]

# Legacy -> canonical rename map for the Atlas Agent Engine SDK cutover.
# Persisted identifiers (checkpoint metadata keys, ADK durable-state envelope
# keys, env vars, wire headers, OTEL attributes, collection names) are
# deliberately absent: they never rename.
NAME_MAP: dict[str, list[dict[str, str]]] = {
    "repo_subdirectories": [
        {
            "legacy": "packages/runner-shared",
            "canonical": "packages/python/packages/agent-engine-runner-shared",
        },
        {
            "legacy": "packages/magenta-sdklanggraph",
            "canonical": "packages/python/packages/agent-engine-sdk-langgraph",
        },
        {
            "legacy": "packages/magenta-sdk-adk",
            "canonical": "packages/python/packages/agent-engine-sdk-adk",
        },
        {
            "legacy": "packages/sdk-core",
            "canonical": "packages/python/packages/agent-engine-sdk",
        },
        {
            "legacy": "packages/agentic-platform-memory",
            "canonical": "packages/python/packages/agent-engine-sdk-memory",
        },
        {
            "legacy": "packages/sdk-core-ts",
            "canonical": "packages/javascript/packages/agent-engine-sdk",
        },
        {
            "legacy": "packages/magenta-sdklanggraph-ts",
            "canonical": "packages/javascript/packages/agent-engine-sdk-langgraph",
        },
        {
            "legacy": "packages/agentic-platform-memory-ts",
            "canonical": "packages/javascript/packages/agent-engine-memory",
        },
        {
            "legacy": "packages/runner-shared-ts",
            "canonical": "packages/javascript/packages/agent-engine-runner-shared",
        },
    ],
    "python_distributions": [
        {"legacy": "magenta-sdk-core", "canonical": "agent-engine-sdk"},
        {"legacy": "magenta-sdklanggraph", "canonical": "agent-engine-sdk-langgraph"},
        {"legacy": "magenta-sdk-adk", "canonical": "agent-engine-sdk-adk"},
        {"legacy": "agentic-platform-memory", "canonical": "agent-engine-sdk-memory"},
        {"legacy": "runner-shared", "canonical": "agent-engine-runner-shared"},
    ],
    "python_modules": [
        {"legacy": "magenta_sdk_core", "canonical": "agent_engine_sdk"},
        {"legacy": "magenta_sdklanggraph", "canonical": "agent_engine_sdk_langgraph"},
        {"legacy": "magenta_sdk_adk", "canonical": "agent_engine_sdk_adk"},
        {"legacy": "agentic_platform_memory", "canonical": "agent_engine_sdk_memory"},
        {"legacy": "runner_shared", "canonical": "agent_engine_runner_shared"},
    ],
    "npm_packages": [
        {"legacy": "@magenta/sdk-core-ts", "canonical": "@mongodb-js/agent-engine-sdk"},
        {
            "legacy": "@magenta/agentic-platform-memory-ts",
            "canonical": "@mongodb-js/agent-engine-sdk-memory",
        },
        {
            "legacy": "@magenta/magenta-sdklanggraph-ts",
            "canonical": "@mongodb-js/agent-engine-sdk-langgraph",
        },
        {
            "legacy": "@magenta/runner-shared-ts",
            "canonical": "@mongodb-js/agent-engine-runner-shared",
        },
    ],
    "symbols": [
        {
            "legacy": "create_magenta_deep_agent",
            "canonical": "create_agent_engine_deep_agent",
        },
        {
            "legacy": "createMagentaDeepAgent",
            "canonical": "createAgentEngineDeepAgent",
        },
        {
            "legacy": "CreateMagentaDeepAgentOptions",
            "canonical": "CreateAgentEngineDeepAgentOptions",
        },
        {
            "legacy": "MagentaToolPodBackend",
            "canonical": "AgentEngineToolSandboxBackend",
        },
        {"legacy": "magenta-toolpod", "canonical": "agent-engine-toolpod"},
        # The persisted checkpoint metadata key and ADK durable-state envelope
        # key hard-rename in this cutover: customer code that hardcodes them
        # must move too. Data already persisted under the old keys does NOT
        # migrate — the cutover notice documents that durable ADK sessions
        # and LangGraph session forks do not survive.
        {
            "legacy": "magenta_oe_step_ordinal",
            "canonical": "agent_engine_oe_step_ordinal",
        },
        {"legacy": "__magenta_adk__", "canonical": "__agent_engine_adk__"},
    ],
    # Python-only submodule path under the LangGraph SDK. TypeScript imports
    # AgentEngineToolSandboxBackend from the package root, so no TS path entry
    # is needed.
    "module_paths": [
        {"legacy": "backends.toolpod", "canonical": "backends.tool_sandbox"},
    ],
}

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
        ".md",
        ".txt",
        ".sh",
        ".cfg",
        ".ini",
    }
)
SCANNED_FILENAMES = frozenset({"env.example", ".env.example", "Makefile"})
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
        # agentic dev up output: .agentic holds the generated entrypoint,
        # .agents / .claude hold vendored skills. All are regenerated on the
        # next dev up and are never the source of truth.
        ".agentic",
        ".agents",
        ".claude",
    }
)
# A suffix-matched directory filter: setuptools egg-info trees are generated
# build output that records the distribution name and must not be rewritten
# or flagged.
_SKIPPED_DIR_SUFFIXES = (".egg-info",)
# This script carries every legacy token in NAME_MAP; a copy of it inside the
# target tree would rewrite or flag itself. Detection is content-based, not
# filename-based, because customers save it under any name (migrate.py, ...).
_SELF_MARKERS = (
    "Rewrite an agent repository onto the Atlas Agent Engine SDK names.",
    "NAME_MAP: dict[str, list[dict[str, str]]] = {",
    '"repo_subdirectories"',
)


def _is_self(text: str) -> bool:
    return all(marker in text for marker in _SELF_MARKERS)


# Lockfiles are regenerated by the package manager after the rename; rewriting
# them by hand leaves stale integrity hashes and resolution metadata behind.
LOCKFILE_NAMES = frozenset(
    {"uv.lock", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "poetry.lock"}
)

# Word-boundary guard that treats hyphens and underscores as word characters.
# `\b` splits on `-`, so it would rewrite `runner-shared` inside
# `agent-engine-runner-shared` and `runner_shared` inside
# `agent_engine_runner_shared` on every run — including re-runs of this tool.
_GUARD = r"[A-Za-z0-9_-]"

# Client-libraries git URLs whose revision --rev rewrites. The repository
# name is unchanged by the SDK rename.
_REPO_URL_RE = re.compile(r"github\.com[/:]10gen/magenta-client-libraries")
# TOML: rev = "<40-hex>" on a line that also carries the client-libraries URL.
_UV_REV_RE = re.compile(r'\brev\s*=\s*"[0-9a-f]{40}"')
# pnpm/npm git specifiers: `#path:` or `#<40-hex>&path:` after the repo URL.
_PNPM_PIN_RE = re.compile(r"(#)(?:[0-9a-f]{40}&)?(path:)")


def _npm_spec_rules(
    name_map: dict[str, list[dict[str, str]]] = NAME_MAP,
) -> list[tuple[re.Pattern[str], str]]:
    """Dependency-entry rules for package.json only.

    In package.json the SDK dependency spec becomes a wildcard —
    ``"@mongodb-js/agent-engine-sdk": "*"`` — because resolution is owned by
    the pnpm-workspace.yaml overrides (which keep the pinned git URL), not by
    the package.json entry. The whole "name": "spec" pair is replaced in one
    shot so the legacy git URL does not survive inside the value.
    """
    return [
        (
            re.compile(rf'"{re.escape(entry["legacy"])}"\s*:\s*"[^"]*"'),
            '"' + entry["canonical"] + '": "*"',
        )
        for entry in name_map["npm_packages"]
    ]


def build_rules(
    name_map: dict[str, list[dict[str, str]]] = NAME_MAP,
) -> list[tuple[re.Pattern[str], str, str]]:
    """Compile (pattern, replacement, label) triples, longest-legacy-first.

    Repository subdirectory paths run before bare names: a subdirectory value
    embeds the legacy distribution name (`packages/magenta-sdklanggraph`), and
    the guard deliberately allows `/` before a token, so the name rule would
    otherwise rewrite the tail of the path first and strand the prefix.
    """
    pairs: list[tuple[str, str, str]] = []
    for key, label in (
        ("repo_subdirectories", "repo subdirectory"),
        ("python_modules", "python module"),
        ("python_distributions", "python distribution"),
        ("npm_packages", "npm package"),
        ("symbols", "symbol"),
        ("module_paths", "module path"),
    ):
        for entry in name_map.get(key, []):
            pairs.append((entry["legacy"], entry["canonical"], label))
    pairs.sort(key=lambda p: len(p[0]), reverse=True)
    return [
        (
            re.compile(rf"(?<!{_GUARD}){re.escape(legacy)}(?!{_GUARD})"),
            canonical,
            label,
        )
        for legacy, canonical, _label in pairs
    ]


def rewrite_pins(text: str, rev: str | None) -> str:
    """Point client-libraries git pins at the given revision."""
    if rev is None:
        return text
    if not re.fullmatch(r"[0-9a-f]{40}", rev):
        raise ValueError(f"--rev must be a full 40-hex SHA, got {rev!r}")

    out_lines = []
    for line in text.splitlines(keepends=True):
        if _REPO_URL_RE.search(line):
            line = _UV_REV_RE.sub(f'rev = "{rev}"', line)
            line = _PNPM_PIN_RE.sub(rf"\g<1>{rev}&\g<2>", line)
        out_lines.append(line)
    return "".join(out_lines)


def migrate_text(
    text: str,
    rules: list[tuple[re.Pattern[str], str, str]],
    rev: str | None = None,
    *,
    is_package_json: bool = False,
) -> str:
    out = text
    # package.json dependency entries first: the pair-level rewrite consumes
    # the legacy package name AND its spec, so the generic token rules below
    # never see them.
    if is_package_json:
        for pattern, replacement in _npm_spec_rules():
            out = pattern.sub(replacement, out)
    for pattern, replacement, _label in rules:
        out = pattern.sub(replacement, out)
    return rewrite_pins(out, rev)


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
    would modify files outside the tree the user pointed at.
    """
    files: list[Path] = []
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
            ):
                continue
            real = Path(os.path.realpath(path))
            if root.is_dir() and not (real == root_real or root_real in real.parents):
                continue
            files.append(path)
    return files


def _stem_is_canonical(path: Path) -> bool:
    """True when the file stem already carries a post-cutover SDK name.

    A doc or example whose filename is e.g. ``agent_engine_sdk_langgraph.md``
    is about the new SDK; a legacy substring match inside it (``magenta`` in
    prose comparing old and new, a historical note) is not a live reference
    worth flagging. Applies to Markdown only — source and manifest files are
    always checked regardless of name.
    """
    stem = path.stem
    return "agent_engine_" in stem or "agent-engine-" in stem


def scan_paths(
    roots: list[Path], rev: str | None
) -> tuple[list[tuple[Path, str, str]], list[tuple[Path, str, int]]]:
    """Compute (path, old, new) for every file needing changes.

    Returns (changes, errors); errors are (path, message, line-count) for
    files that could not be read as UTF-8.
    """
    rules = build_rules()
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
        new = migrate_text(old, rules, rev, is_package_json=path.name == "package.json")
        if new != old:
            changes.append((path, old, new))
    return changes, errors


def _print_remaining(roots: list[Path]) -> None:
    """Tell the user what --write deliberately did not do."""
    lockfiles: list[Path] = []
    has_dev_up_output = False
    for root in roots:
        if root.is_file():
            continue
        for path in sorted(root.rglob("*")):
            rel_parts = path.relative_to(root).parts
            if any(
                part in SKIPPED_DIRS or part.endswith(_SKIPPED_DIR_SUFFIXES)
                for part in rel_parts
            ):
                continue
            if path.is_file() and path.name in LOCKFILE_NAMES:
                lockfiles.append(path)
        if (root / ".agentic").is_dir():
            has_dev_up_output = True

    next_steps: list[str] = []
    if lockfiles:
        next_steps.append(
            "regenerate the committed lockfile(s) — they still reference the "
            "old names: "
            + ", ".join(str(p) for p in lockfiles[:5])
            + (" ..." if len(lockfiles) > 5 else "")
            + " (uv lock for Python, pnpm install --lockfile-only / npm install "
            "for TypeScript)"
        )
    if has_dev_up_output:
        next_steps.append(
            ".agentic/ still references the old names — it is generated output "
            "and refreshes on the next `agentic dev up`"
        )
    if next_steps:
        print("next steps:", file=sys.stderr)
        for step in next_steps:
            print(f"  - {step}", file=sys.stderr)


def _legacy_lines(
    text: str, rules: list[tuple[re.Pattern[str], str, str]]
) -> list[int]:
    """1-based line numbers still containing a legacy identifier."""
    hits: list[int] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        if any(pattern.search(line) for pattern, _repl, _label in rules):
            hits.append(lineno)
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
        help="exit 1 if any legacy identifier remains (CI guard)",
    )
    parser.add_argument(
        "--rev",
        metavar="SHA",
        default=None,
        help="rewrite client-libraries git pins to this 40-hex revision",
    )
    args = parser.parse_args(argv)

    for root in args.paths:
        if not root.exists():
            print(f"error: {root} does not exist", file=sys.stderr)
            return 2

    roots, notes = resolve_roots(args.paths)
    for note in notes:
        print(note, file=sys.stderr)

    try:
        changes, errors = scan_paths(roots, args.rev)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    for path, message, _ in errors:
        print(f"warning: skipped unreadable file {path}: {message}", file=sys.stderr)

    if args.check:
        rules = build_rules()
        failed = False
        for path in collect_files(roots):
            if path.suffix == ".md" and _stem_is_canonical(path):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if _is_self(text):
                continue
            for lineno in _legacy_lines(text, rules):
                print(f"{path}:{lineno}: legacy SDK identifier")
                failed = True
        if failed:
            print("check failed: legacy SDK identifiers remain", file=sys.stderr)
            return 1
        print("check passed: no legacy SDK identifiers")
        return 0

    if args.write:
        for path, _old, new in changes:
            path.write_text(new, encoding="utf-8")
            print(path)
        print(f"{len(changes)} file(s) updated", file=sys.stderr)
        _print_remaining(roots)
        return 0

    for path, old, new in changes:
        sys.stdout.writelines(
            difflib.unified_diff(
                old.splitlines(keepends=True),
                new.splitlines(keepends=True),
                fromfile=f"a/{path}",
                tofile=f"b/{path}",
            )
        )
    print(
        f"dry run: {len(changes)} file(s) would change; re-run with --write to apply",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

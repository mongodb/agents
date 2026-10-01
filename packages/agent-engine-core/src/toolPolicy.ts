export function writeOperationsAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.ALLOW_WRITE_OPERATIONS?.trim().toLowerCase();
  return Boolean(value) && value !== "false";
}

export function selectTools<T extends { name: string }>(
  tools: readonly T[],
  allowlist: ReadonlySet<string>,
  allowWrites: boolean,
): T[] {
  return tools.filter(
    (tool) => allowlist.has(tool.name) || allowWrites,
  );
}

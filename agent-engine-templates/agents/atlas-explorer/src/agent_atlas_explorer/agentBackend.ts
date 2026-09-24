/**
 * Keep deep-agent file operations on Magenta's audited Tool Pod path without
 * advertising a general-purpose shell to the model. Tool Pod credentials and
 * OAuth cache files live outside the filesystem handler's readable roots, but
 * an unrestricted shell in the same container could otherwise reach them.
 */
export function withoutShellExecution<T extends object>(
  backend: T,
): Omit<T, "execute"> {
  return new Proxy(backend, {
    get(target, property, receiver) {
      if (property === "execute") return undefined;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, property) {
      return property === "execute" ? false : Reflect.has(target, property);
    },
    getOwnPropertyDescriptor(target, property) {
      return property === "execute"
        ? undefined
        : Reflect.getOwnPropertyDescriptor(target, property);
    },
  }) as Omit<T, "execute">;
}

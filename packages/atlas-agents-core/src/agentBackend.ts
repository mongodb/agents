/**
 * Copyright 2026 MongoDB, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Keep deep-agent file operations on Agent Engine's audited Tool Pod path without
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

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
 * An error a route throws to answer with an Atlas-shaped error body. The
 * app's error handler turns it into the response.
 */
export class AtlasError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409,
    readonly errorCode: string,
    readonly detail?: string,
  ) {
    super(detail ?? errorCode);
  }

  toBody() {
    return {
      error: this.status,
      errorCode: this.errorCode,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
    };
  }
}

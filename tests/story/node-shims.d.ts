// Only the built-ins used by the opt-in numeric acceptance audit; no new dependencies.
declare module 'node:process' { export const env: Record<string, string | undefined> }
declare module 'node:fs' { export function mkdirSync(path: string, options: { recursive: true }): string | undefined }

// Минимальные типы встроенного zlib для синтетических KMZ. @types/node в проекте не установлен.
declare module 'node:zlib' {
  export function deflateRawSync(input: Uint8Array): Uint8Array;
  export function inflateRawSync(input: Uint8Array, options?: { maxOutputLength?: number }): Uint8Array;
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function writeFileSync(path: string, data: Uint8Array): void;
}
declare module 'node:os' { export function tmpdir(): string }
declare module 'node:path' { export function join(...parts: string[]): string }
declare module 'node:child_process' {
  export function spawnSync(command: string, args: string[], options: { encoding: 'utf8' }): { status: number | null; stdout: string; stderr: string };
}
declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}

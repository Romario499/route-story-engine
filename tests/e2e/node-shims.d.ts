// @types/node в проекте нет (и ставить его ради двух вызовов незачем) — объявляем только то, чем пользуются e2e и scripts.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
declare module 'node:buffer' {
  export const Buffer: { from(text: string): Uint8Array };
}

# Лицензии шрифтов

Все три гарнитуры — под SIL Open Font License 1.1. Текст лицензии лежит рядом с каждой.

| Гарнитура | Версия / поставка | Источник | Лицензия |
|---|---|---|---|
| Manrope | вариативный `Manrope[wght].ttf` (wght 200–800), `google/fonts` коммит `b31870aff700ab7a1d74fa0c6887d95beb9e0037` | https://github.com/google/fonts/tree/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope | `manrope/OFL.txt` |
| PT Serif | npm `@fontsource/pt-serif` 5.3.0 (файлы 400 и 700, кириллица и латиница) | https://fontsource.org/fonts/pt-serif, исходник ParaType Ltd. | `pt-serif/OFL.txt` (LICENSE из пакета) |
| JetBrains Mono | npm `@fontsource/jetbrains-mono` 5.3.0 (веса 500 и 700, кириллица и латиница) | https://fontsource.org/fonts/jetbrains-mono, исходник https://github.com/JetBrains/JetBrainsMono | `jetbrains-mono/OFL.txt` (LICENSE из пакета) |

PT Serif и JetBrains Mono подключаются из npm-пакетов `@fontsource/*` (импорт в `src/main.ts`), файлы шрифтов в `src/assets/fonts/` не копируются — здесь лежат только их лицензии.

Переходное: `@fontsource/inter` (UI) и `@fontsource/unbounded` (стиль «Экспедиция») ещё подключены и тоже под OFL 1.1; пакеты удаляются в таске 15, когда исчезнет последнее использование.

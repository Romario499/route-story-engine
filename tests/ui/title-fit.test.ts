import { describe, expect, it } from 'vitest';
import { titleFitIssue, titleFits, titleWarningText } from '../../src/ui/studio/title-fit';
import { titleFits as renderTitleFits } from '../../src/render/overlay';

describe('предупреждение о длинном заголовке', () => {
  it('UI берёт настоящую titleFits из оверлея ролика (одна функция для UI, превью и экспорта)', () => {
    expect(titleFits).toBe(renderTitleFits);
    const long = titleFits('ru', 'x'.repeat(80), '9:16', 'epic');
    expect(long.fits).toBe(false);
    expect(long.maxChars).toBeGreaterThan(0);
    expect(long.maxChars).toBeLessThan(80);
    expect(titleFits('ru', 'Турция → Китай', '9:16', 'epic')).toEqual({ fits: true, maxChars: 14 });
  });

  it('titleFitIssue принимает ответ titleFits и отдаёт готовое число символов', () => {
    expect(titleFitIssue('Турция → Китай', (c) => titleFits('ru', c, '9:16', 'epic'))).toBeNull();
    const text = 'Очень длинное название путешествия через горы, пустыни и степи Средней Азии';
    const issue = titleFitIssue(text, (c) => titleFits('ru', c, '9:16', 'epic'));
    expect(issue).not.toBeNull();
    expect(titleFits('ru', text.slice(0, issue!.maxChars).trimEnd(), '9:16', 'epic').fits).toBe(true);
    expect(titleWarningText(issue!.maxChars)).toContain(`${issue!.maxChars} символов`);
  });

  it('помещается или пусто — предупреждения нет', () => {
    expect(titleFitIssue('', () => false)).toBeNull();
    expect(titleFitIssue('   ', () => false)).toBeNull();
    expect(titleFitIssue('Турция → Китай', () => true)).toBeNull();
  });

  it('не помещается — находит наибольшее число символов, которое помещается', () => {
    const fits = (s: string) => s.length <= 23;
    expect(titleFitIssue('Очень длинное название путешествия через горы', fits)).toEqual({ maxChars: 23 });
  });

  it('текст предупреждения называет число символов', () => {
    expect(titleWarningText(23)).toBe('Заголовок слишком длинный для кадра — сократите до 23 символов.');
    expect(titleWarningText(0)).toMatch(/слишком длинный/);
  });
});

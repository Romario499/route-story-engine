import { describe, expect, it } from 'vitest';
import { ExportError } from '../../src/export/errors';
import { describeProgress, exportErrorView, warningText, STAGE_LABELS } from '../../src/export/messages';
import { FontLoadError } from '../../src/render/fonts';

describe('describeProgress', () => {
  it('три этапа с русскими названиями', () => {
    expect(STAGE_LABELS).toEqual({ prepare: 'Подготовка', frames: 'Кадры', finalize: 'Сборка файла' });
  });

  it('подготовка: процентов нет, подпись «Подготовка…»', () => {
    const v = describeProgress({ stage: 'prepare', frame: 0, total: 450, etaSec: null });
    expect(v).toMatchObject({ stage: 'prepare', percent: 0, text: 'Подготовка…' });
  });

  it('кадры: «N из M», процент и оставшееся время', () => {
    const v = describeProgress({ stage: 'frames', frame: 225, total: 450, etaSec: 65 });
    expect(v.percent).toBe(50);
    expect(v.text).toBe('Кадры 225 из 450 · 50% · осталось 1 мин 05 с');
  });

  it('кадры без оценки времени', () => {
    expect(describeProgress({ stage: 'frames', frame: 2, total: 450, etaSec: null }).text).toBe('Кадры 2 из 450 · 0% · считаю время…');
  });

  it('сборка файла: 100% и подпись без «Готово»', () => {
    const v = describeProgress({ stage: 'finalize', frame: 450, total: 450, etaSec: 0 });
    expect(v).toMatchObject({ stage: 'finalize', percent: 100, text: 'Сборка файла…' });
  });

  it('процент не превышает 100 и не отрицателен', () => {
    expect(describeProgress({ stage: 'frames', frame: 999, total: 450, etaSec: 0 }).percent).toBe(100);
    expect(describeProgress({ stage: 'frames', frame: 0, total: 0, etaSec: null }).percent).toBe(0);
  });
});

describe('warningText', () => {
  it('склоняет «кадр» по числу', () => {
    expect(warningText(1)).toBe('Готово с предупреждением: 1 кадр с недогруженной картой');
    expect(warningText(2)).toBe('Готово с предупреждением: 2 кадра с недогруженной картой');
    expect(warningText(5)).toBe('Готово с предупреждением: 5 кадров с недогруженной картой');
    expect(warningText(21)).toBe('Готово с предупреждением: 21 кадр с недогруженной картой');
    expect(warningText(12)).toBe('Готово с предупреждением: 12 кадров с недогруженной картой');
  });
});

describe('exportErrorView', () => {
  it('шрифт: текст FontLoadError как есть, действие «Повторить»', () => {
    const font = new FontLoadError('Manrope');
    const v = exportErrorView(new ExportError('font', font.message, font));
    expect(v).toEqual({ kind: 'font', message: 'Не загрузился шрифт Manrope — проверьте соединение и нажмите «Повторить»', retryLabel: 'Повторить' });
  });

  it('кодек и WebGL: текст ошибки как есть и «Повторить экспорт»', () => {
    const codec = exportErrorView(new ExportError('codec', 'Видео не удалось собрать: x. Повторите экспорт или перезагрузите страницу.'));
    expect(codec).toMatchObject({ kind: 'codec', retryLabel: 'Повторить экспорт' });
    expect(codec.message).toContain('Повторите экспорт или перезагрузите страницу');
    expect(exportErrorView(new ExportError('webgl', 'WebGL')).retryLabel).toBe('Повторить экспорт');
  });

  it('браузер без WebCodecs: повтор не предлагаем', () => {
    const v = exportErrorView(new ExportError('unsupported', 'Экспорт видео работает в Chrome, Edge или Safari 16.4+'));
    expect(v.retryLabel).toBeNull();
    expect(v.message).toContain('Chrome, Edge');
  });

  it('неизвестная ошибка: общий текст с действием и повтором', () => {
    const v = exportErrorView(new Error('boom'));
    expect(v.kind).toBeNull();
    expect(v.message).toBe('Не удалось собрать ролик: boom. Попробуйте ещё раз; если повторяется — перезагрузите страницу.');
    expect(v.retryLabel).toBe('Повторить экспорт');
  });
});

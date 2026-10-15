// Giro 6, r2: le righe della Gestione, domande e pratiche, non si trascinano in una chat di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { installa, apri, sezione, domanda, fb } from './aiuto-g6.mjs';

const trascina = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const dt = new DataTransfer();
  el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  return { draggable: el.draggable, testo: dt.getData('text/plain') };
}, sel);

test('r2 una domanda e una pratica della Gestione si trascinano col loro titolo', async ({ app, openTab }) => {
  await installa(app, { feedback: [fb('fb1', 'aligned')], domande: [domanda(1, { titolo: 'Fondo adesso?' })] });
  const page = await apri(openTab);
  await sezione(page, 'domande').click();
  await expect(page.locator('.mg-domanda[data-id="D-1"]')).toBeVisible();
  const d = await trascina(page, '.mg-domanda[data-id="D-1"]');
  await sezione(page, 'feedback').click();
  await expect(page.locator('#mgList .mg-item').first()).toBeVisible();
  const p = await trascina(page, '#mgList .mg-item');
  expect({ domanda: d.draggable, pratica: p.draggable }).toEqual({ domanda: true, pratica: true });
  expect(d.testo).toContain('Fondo adesso?');
  expect(p.testo).toContain('Feedback fb1');
});

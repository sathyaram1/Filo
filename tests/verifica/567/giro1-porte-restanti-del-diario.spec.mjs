// Le porte restanti della stessa causa di #567.1 e #567.4.
//
// Il titolo del blocco e le righe del diario nascono da due tabelle: un verbo
// per il riassunto e una frase per la riga. Un'azione che non sta in quelle
// tabelle cade nel ripiego generico, e l'utente si ritrova il NOME INTERNO
// dell'azione con il titolo fermo su «Come ha lavorato» — gli stessi due
// sintomi segnalati, su un'altra porta.
//
// Qui si prova la porta peggiore: la cancellazione della memoria di Filo,
// chiesta in chat e confermata digitando la parola.
//
// In coda, il controllo del tema scuro sulle superfici toccate.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

test('la memoria cancellata dalla chat: cosa ne resta nel diario', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Ada.', PREFERENZE: 'Risposte brevi.' });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'm1', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Dimmi di sì e dimentico tutto.' },
  ], '__v567q');

  await chiedi(page, 'dimentica tutto quello che sai di me');
  const btn = page.locator('.dash-action-btn').first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger');

  // È successo davvero.
  await expect.poll(
    () => app.evaluate(async () => {
      const m = await globalThis.SN_FILO_MEMORY.getMemory();
      return String((m && m.PROFILO) || '');
    }),
    { timeout: 10_000 },
  ).toBe('');

  const activity = page.locator('.dash-activity');
  const label = activity.locator('.dash-activity-label');
  await activity.locator('.dash-activity-head').click();
  const righe = activity.locator('.dash-activity-body .dash-activity-row');
  const testi = (await righe.allTextContents()).join(' | ');

  // Il diario non nomina l'azione col suo nome interno…
  expect(testi, `righe del diario: ${testi}`).not.toContain('cancella memoria');
  // …dice che la memoria è stata cancellata…
  expect(testi).toContain('Memoria cancellata');
  // …e il titolo del blocco lo conta, invece di restare su «Come ha lavorato».
  const titolo = await label.textContent();
  expect(titolo).not.toContain('Come ha lavorato');
  expect(titolo).toContain('cancellato la memoria');

  // Il bottone è una ricevuta, non più «Filo vuole…» con la spunta davanti.
  const testoBtn = await btn.textContent();
  expect(testoBtn).toContain('✓');
  expect(testoBtn).not.toContain('Eliminare DEFINITIVAMENTE');

  await restore(app, '__v567q');
});

test('tema scuro: il riquadro del comando bloccato e il diario restano leggibili', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.snTheme || ''), { timeout: 8_000 }).toBe('dark');

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 't1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' },
        { id: 't2', name: 'EVENTO_CALENDARIO', arguments: '{"titolo":"Cena","data":"2026-10-02","ora":"20:30"}' },
      ],
    },
    { text: 'Ecco tutto.' },
  ], '__v567r');

  await chiedi(page, 'elenca i file e segnami la cena');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco tutto.' })).toBeVisible({ timeout: 10_000 });
  await page.locator('.dash-activity .dash-activity-head').click();
  await expect(page.locator('.dash-cmd-blocked')).toBeVisible();

  // Il testo del riquadro non può essere dello stesso colore del suo sfondo.
  const contrasto = await page.evaluate(() => {
    const el = document.querySelector('.dash-cmd-blocked');
    const s = getComputedStyle(el);
    const bg = (function risali(n) {
      while (n) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
        n = n.parentElement;
      }
      return 'rgb(255,255,255)';
    })(el);
    const num = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const [r, g, b] = num(c).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const a = lum(s.color); const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrasto).toBeGreaterThan(3);

  await page.screenshot({ path: 'tests/.shots/567-tema-scuro.png' });
  await restore(app, '__v567r');
});

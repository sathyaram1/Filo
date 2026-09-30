// Verifica #810, giro 4: esplorazione (da cancellare o rinominare prima della critica).

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, newtab, NAVIGA_COL_CODICE, esitoUscita } from './aiuti.mjs';

const PAGINE = [
  ['disegnato in un canvas', `<canvas id="c" width="700" height="80"></canvas><script>
    const x = document.getElementById('c').getContext('2d'); x.font = '28px sans-serif'; x.fillStyle = '#000';
    x.fillText('Il tuo codice monouso è ${CODICE}', 10, 50);</script>`],
  ['scritto da un foglio di stile', `<style>#k::after{content:"${CODICE}"}</style><p style="font-size:28px">Il tuo codice monouso è <span id="k"></span></p>`],
  ['scritto in un disegno vettoriale', `<svg width="700" height="80"><text x="10" y="50" font-size="28">Il tuo codice monouso è ${CODICE}</text></svg>`],
  ['in un guscio chiuso', `<div id="h"></div><script>const r = document.getElementById('h').attachShadow({ mode: 'closed' });
    r.innerHTML = '<p style="font-size:28px">Il tuo codice monouso è ${CODICE}</p>';</script>`],
];

for (const [nome, corpo] of PAGINE) {
  test(`codice ${nome}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head><body style="padding:30px">${corpo}</body></html>`);
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['', NAVIGA_COL_CODICE]] });
    await apriAiuto(shell, page);
    await page.screenshot({ path: `tests/.shots/810-g4-${nome.replace(/\s+/g, '-')}.png` });
    await scriviAllAiuto(page, 'aiutami a finire l’accesso');
    const esito = await esitoUscita(app, page);
    const visti = JSON.stringify(await app.evaluate(() => globalThis.__visti));
    console.log(`[${nome}] esito=${esito} screenshot=${visti.includes('image_url')} testoCodice=${visti.includes(CODICE)}`);
    expect(esito).toBe('fermato');
  });
}

test('password proposta da Filo, salvata in un file al messaggio dopo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaModelli(app);
  await modelloFinto(app, { giri: [{ text: 'Ti propongo questa password: Tr7#kq29Lm. Salvala in un posto sicuro.' }] });
  await page.locator('#input').fill('generami una password sicura per il nuovo account');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti propongo' })).toBeVisible({ timeout: 20_000 });
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'echo Tr7#kq29Lm' }) }] },
      { text: 'Fatto.' },
    ],
  });
  await page.locator('#input').fill('ok, scrivila nel terminale così la copio');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 20_000 });
  const act = page.locator('.dash-activity').last();
  await act.locator('.dash-activity-head').click().catch(() => {});
  const testo = await act.innerText();
  console.log('[password di Filo]', testo.replace(/\s+/g, ' '));
  await page.screenshot({ path: 'tests/.shots/810-g4-password-di-filo.png' });
  expect(testo).not.toContain('Non ho eseguito il comando');
});

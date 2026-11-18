// La prova da utente allegata a una consegna (#2539) come la legge l'owner in Gestione: il turno che il server scrive
// (routine/prova.js di filo-security: esito con i rimandi per numero, poi una riga d'allegato per schermata) diventa una
// bolla dell'agente con il testo dell'esito e le schermate decifrate sotto, nell'ordine dei passi.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'filo://manage/manage.html';
const url = (n) => {
  const u = `0123abcd-0123-4567-89ab-0123456789${String(n).padStart(2, '0')}`;
  return `https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1763469000000_${u}.octetstream?alt=media&token=${u}`;
};
const riga = (n) => `@@filo-attachment ${JSON.stringify({ kind: 'img', url: url(n) })}`;

const NOTES = [
  'Fatto: la nota si salva anche senza titolo.',
  '',
  '--- Aggiornamento dell\'agente del 18/11/26, 14:02 ---',
  '# Prova da utente: riuscito',
  '',
  '- Compito: salva una nota senza titolo',
  '- Esito: Riuscito in 2 passi: la nota compare nell\'elenco',
  '',
  '## Passi',
  '',
  '1. la home → clic su Note  ',
  '   (schermata 1)',
  '2. le note → scrive «ciao» e preme Invio  ',
  '   (schermata 2)',
  '',
  'Schermata finale: (schermata 3)',
  riga(1), riga(2), riga(3),
].join('\n');

const FB = {
  _id: 'prova-2539', name: 'Una nota senza titolo non si salva', text: 'la nota sparisce', seq: 2539, subSeq: 0,
  clientId: 'owner:caf22093', createdAt: '2026-11-18T10:00:00Z', status: 'revision_capability', notes: NOTES,
};

test('l\'owner trova sotto il report l\'esito della prova e le sue schermate, aperte', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  // Una schermata finta grande abbastanza da guardarla nello screenshot.
  const PNG = await page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 640, height: 400 });
    const g = c.getContext('2d');
    g.fillStyle = '#d9c7b0'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = '#3a2f25'; g.font = '48px sans-serif'; g.fillText('schermata', 200, 210);
    return c.toDataURL('image/png');
  });
  await page.evaluate((png) => {
    const orig = window.filo.message.bind(window.filo);
    window.__chieste = [];
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_decrypt_image') { window.__chieste.push(msg.url); return { ok: true, dataUrl: png }; }
      return orig(msg);
    };
  }, PNG);
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(fb._id);
  }, FB);

  const bolla = page.locator('.mg-bubble--model', { hasText: 'Prova da utente: riuscito' });
  await expect(bolla).toHaveCount(1);
  await expect(bolla).toContainText('Riuscito in 2 passi');
  await expect(bolla).toContainText('(schermata 2)');
  await expect(bolla).not.toContainText('@@filo-attachment');
  const imgs = bolla.locator('.mg-bubble-imgs img');
  await expect(imgs).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(imgs.nth(i)).toHaveJSProperty('src', PNG);
  expect(await imgs.evaluateAll((els) => els.map((e) => e.dataset.url))).toEqual([url(1), url(2), url(3)]);

  const dir = join('tests', '.shots');
  mkdirSync(dir, { recursive: true });
  await bolla.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, 'prova-nel-report.png') });
});

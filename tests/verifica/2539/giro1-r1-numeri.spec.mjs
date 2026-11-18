// Verifica #2539 giro 1: una prova da utente di molti passi in Gestione. L'esito rimanda alle schermate per numero
// («(schermata 7)»): l'owner deve poter dire quale miniatura è la 7 senza contarle.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'filo://manage/manage.html';
const N = 21;
const url = (n) => {
  const u = `0123abcd-0123-4567-89ab-0123456789${String(n).padStart(2, '0')}`;
  return `https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1763469000000_${u}.octetstream?alt=media&token=${u}`;
};
const riga = (n) => `@@filo-attachment ${JSON.stringify({ kind: 'img', url: url(n) })}`;

// La forma che il server scrive per un esito vero di 20 passi più la schermata finale.
const passi = [];
for (let n = 1; n < N; n++) passi.push(`${n}. vedo la schermata ${n} → clic su «Avanti»  `, `   (schermata ${n})`);
const NOTES = [
  'Fatto: il percorso arriva in fondo.',
  '',
  '--- Aggiornamento dell\'agente del 18/11/26, 14:02 ---',
  '# Prova da utente: riuscito',
  '',
  '- Compito: arriva in fondo alla procedura',
  `- Esito: Riuscito in ${N - 1} passi`,
  '',
  '## Passi',
  '',
  ...passi,
  '',
  `Schermata finale: (schermata ${N})`,
  ...Array.from({ length: N }, (_, i) => riga(i + 1)),
].join('\n');

const FB = {
  _id: 'prova-2539-lunga', name: 'Procedura lunga', text: 'non arrivo in fondo', seq: 2539, subSeq: 0,
  clientId: 'owner:caf22093', createdAt: '2026-11-18T10:00:00Z', status: 'revision_capability', notes: NOTES,
};

test('r1 in una prova di molti passi ogni schermata porta il numero con cui l\'esito la cita', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  const PNG = await page.evaluate(() => {
    const c = Object.assign(document.createElement('canvas'), { width: 640, height: 400 });
    const g = c.getContext('2d');
    g.fillStyle = '#d9c7b0'; g.fillRect(0, 0, 640, 400);
    return c.toDataURL('image/png');
  });
  await page.evaluate((png) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => (msg && msg.type === 'feedback_decrypt_image' ? { ok: true, dataUrl: png } : orig(msg));
  }, PNG);
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(fb._id);
  }, FB);

  const bolla = page.locator('.mg-bubble--model', { hasText: 'Prova da utente: riuscito' });
  await expect(bolla).toHaveCount(1);
  const imgs = bolla.locator('.mg-bubble-imgs img');
  await expect(imgs).toHaveCount(N);
  const dir = join('tests', '.shots');
  mkdirSync(dir, { recursive: true });
  await imgs.nth(6).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, 'verifica-2539-numeri.png') });

  // La settima miniatura deve dire di essere la «schermata 7»: un numero visibile accanto, o almeno al passaggio del
  // mouse (title/alt). Oggi tutte dicono solo «allegato».
  const settima = imgs.nth(6);
  const etichetta = await settima.evaluate((el) => {
    const vicino = (el.closest('figure, .mg-bubble-img, a, div') || el).textContent || '';
    return [el.getAttribute('title') || '', el.getAttribute('alt') || '', vicino].join(' | ');
  });
  expect(etichetta).toMatch(/\b7\b/);
});

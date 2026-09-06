// Gli stati dell'iter di lavorazione delle routine — `revision_capability` (fix
// pronto su un branch, in attesa della verifica) e `revision_security` (audit di
// sicurezza) — vivono in "In coda" sulla pagina dei feedback, esattamente come
// nella dashboard di gestione; un fix bocciato troppe volte (`design` con motivo
// `loop`) torna nei "Ricevuti", perché aspetta una decisione dell'owner. Su
// tutti si vede il branch del fix e l'etichetta dello stato, col motivo scritto
// in italiano: le PAROLE del motivo si chiedono al vocabolario condiviso, non si
// ricopiano qui (una frase ricopiata è già rimasta indietro una volta, e il
// controllo è stato rosso per tutti finché nessuno l'ha guardato).
//
// Prima del #509 questa pagina aveva due sezioni sue ("In revisione",
// "Bloccati") costruite sui vecchi status `review`/`blocked`, che la gemella non
// conosce: gli stati canonici che arrivavano davvero dal server cadevano invece
// tutti in "Ricevuti". Gli assert sotto diventano rossi se quella logica torna.
//
// I dati arrivano stubbando SN_FEEDBACK.list (niente Firestore live): si
// asserisce il rendering vero delle sezioni e del badge branch.

import { test, expect } from './fixtures/electron.mjs';

const FAKE = [
  {
    _id: 'rev', text: 'Fix pronto, da verificare', name: 'in revisione',
    seq: 40, subSeq: 0, status: 'revision_capability', branch: 'worker/40',
    createdAt: '2026-06-22T11:00:00Z',
  },
  {
    _id: 'sec', text: 'Fix in audit di sicurezza', name: 'in sicurezza',
    seq: 43, subSeq: 0, status: 'revision_security', branch: 'worker/43',
    createdAt: '2026-06-22T10:45:00Z',
  },
  {
    _id: 'blk', text: 'Fix in pausa dopo troppe bocciature', name: 'bloccato',
    seq: 41, subSeq: 0, status: 'design', statusReason: 'loop', branch: 'worker/41.2',
    createdAt: '2026-06-22T10:30:00Z',
  },
  {
    _id: 'td', text: 'Feedback ancora da risolvere', name: 'da fare',
    seq: 42, subSeq: 0, status: 'todo',
    createdAt: '2026-06-22T10:00:00Z',
  },
];

test('gli stati dell\'iter stanno "In coda", il fix bocciato torna nei "Ricevuti"', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, FAKE);
  await page.click('#refresh');

  // Le sezioni sono quelle della macchina a stati, col conteggio giusto.
  const queueTab = page.locator('#tabs [data-tab="queue"]');
  const inboxTab = page.locator('#tabs [data-tab="inbox"]');
  await expect(queueTab).toHaveText(/In coda \(3\)/);
  await expect(inboxTab).toHaveText(/Ricevuti \(1\)/);

  // "In coda": i due passaggi dell'iter più il todo, ciascuno col suo branch e
  // con l'etichetta che dice a che punto è (le sezioni sono quattro, lo stato lo
  // dice la card).
  await queueTab.click();
  await expect(page.locator('.fb-card')).toHaveCount(3);
  const revCard = page.locator('.fb-card', { hasText: 'in revisione' });
  await expect(revCard).toHaveCount(1);
  await expect(revCard.locator('.fb-branch')).toHaveText(/worker\/40/);
  await expect(revCard.locator('.fb-state')).toContainText('Verifica fix');
  const secCard = page.locator('.fb-card', { hasText: 'in sicurezza' });
  await expect(secCard.locator('.fb-state')).toContainText('Audit sicurezza');
  await page.screenshot({ path: 'tests/.shots/feedback-review-tab.png' }).catch(() => {});

  // "Ricevuti": solo il fix bocciato troppe volte, che aspetta l'owner, col
  // motivo scritto accanto allo stato e non solo il codice grezzo.
  //
  // Il motivo si CHIEDE al vocabolario condiviso invece di ricopiarlo qui: la
  // frase è cambiata una volta ("fix bocciato troppe volte" → quella di oggi) e
  // questo controllo è rimasto rosso per tutti, su ogni macchina, finché
  // qualcuno non è andato a leggerselo. Quello che deve restare vero è che il
  // motivo compaia scritto in italiano, non che sia una frase precisa.
  await inboxTab.click();
  await expect(page.locator('.fb-card')).toHaveCount(1);
  const blkCard = page.locator('.fb-card', { hasText: 'bloccato' });
  await expect(blkCard).toHaveCount(1);
  await expect(blkCard.locator('.fb-branch')).toHaveText(/worker\/41\.2/);
  const motivo = await page.evaluate(() => {
    const b = window.SN_MANAGE_REVIEW.stateBadge({ status: 'design', statusReason: 'loop' });
    return b && b.showReason ? b.reasonText : '';
  });
  expect(motivo, 'il motivo `loop` deve avere una frase in italiano nel vocabolario condiviso')
    .not.toBe('');
  expect(motivo).not.toBe('loop');
  await expect(blkCard.locator('.fb-state')).toContainText(motivo);

  // Gli stati dell'iter NON inquinano i "Ricevuti".
  await expect(page.locator('.fb-card', { hasText: 'in revisione' })).toHaveCount(0);
  await expect(page.locator('.fb-card', { hasText: 'in sicurezza' })).toHaveCount(0);
});

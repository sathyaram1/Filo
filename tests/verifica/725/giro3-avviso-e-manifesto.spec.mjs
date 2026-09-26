// Verifica del lavoro «#725», terzo giro.
//
// La segnalazione ha due metà: il manifesto non deve descrivere come voce da
// cliccare una spiegazione che arriva da sola, e l'avviso su un link sospetto
// deve essere una frase che chiunque capisce. Qui si rifà la seconda metà e si
// insiste sulla famiglia già rientrata nei due giri precedenti: l'avviso rosso
// che scatta su indirizzi di tutti i giorni. Un allarme che suona sui link
// normali non viene più letto quando serve davvero.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());

const HTML = `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
  <h1>Pagina di prova</h1>
  <p><a id="cerca" href="https://esempio-tranquillo.test/cerca?q=delete">Cerca la parola «delete»</a></p>
  <p><a id="doc" href="https://esempio-tranquillo.test/docs/Web/API/Element/remove">Documentazione di Element.remove</a></p>
  <p><a id="apply" href="https://apply.com/lavora-con-noi">Candidati</a></p>
  <p><a id="hash" href="https://esempio-tranquillo.test/promo?utm_source=news&hash=8f3a2b1c9d0e">La promozione del mese</a></p>
  <p><a id="falso" href="https://paypa1.com/login">Accedi al tuo conto</a></p>
</body></html>`;

async function avvisoSu(page, id) {
  await page.locator('#' + id).click({ button: 'right' });
  await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
  await page.waitForTimeout(700);
  const warn = page.locator('.sn-menu .sn-menu-link-warn');
  const testo = (await warn.count()) ? ((await warn.first().textContent()) || '').trim() : '';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return testo;
}

test('gli indirizzi di tutti i giorni non si prendono l’avviso rosso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // La parola cercata dentro l'indirizzo non è un'azione: chi cerca «delete»
  // su un sito qualunque non sta per cancellare niente.
  expect.soft(await avvisoSu(page, 'cerca'), 'ricerca della parola «delete»').toBe('');

  // Il nome di una pagina di documentazione non è un'azione: aprirla non
  // rimuove nulla.
  expect.soft(await avvisoSu(page, 'doc'), 'pagina di documentazione .../Element/remove').toBe('');

  // Un indirizzo comune che differisce di una lettera da un nome famoso corto
  // resta un indirizzo comune: apply.com non imita apple.com.
  expect.soft(await avvisoSu(page, 'apply'), 'apply.com').toBe('');

  // Il codice che i siti attaccano agli indirizzi per non servire la copia
  // vecchia non è una chiave d'accesso.
  expect.soft(await avvisoSu(page, 'hash'), 'indirizzo con hash di versione').toBe('');
});

test('il link che imita davvero un sito noto lo dice a parole', async ({ openTab, testServer }) => {
  // La lamentela originale: prima usciva il codice interno. Deve restare vero
  // mentre si toglie l'avviso dai link normali.
  const page = await testServer.openReady(openTab, HTML);
  const testo = await avvisoSu(page, 'falso');
  expect(testo).toContain('paypal.com');
  expect(testo).toMatch(/imitazione/i);
  expect(testo).not.toMatch(/typosquatting|side_effect|token_in_url/);
});

test('il manifesto non dice che Filo non apre il link, se invece lo scarica', () => {
  // Aprendo il menu su un link, Filo chiede al processo principale di scaricare
  // la pagina dell'indirizzo per leggerne titolo e descrizione: il sito riceve
  // una visita, anche quando l'indirizzo è stato appena giudicato un'imitazione.
  // Il manifesto promette il contrario, ed è la stessa classe di bugia della
  // segnalazione: la descrizione di una capacità che non corrisponde ai fatti.
  const actions = readFileSync(join(ROOT, 'src', 'content', 'actions.js'), 'utf8');
  const scarica = /fetch_link_meta/.test(actions);

  const manifesto = readFileSync(join(ROOT, 'src', 'shared', 'capabilities.js'), 'utf8');
  const voce = manifesto.slice(manifesto.indexOf("id: 'explain-link'"), manifesto.indexOf("id: 'explain-link'") + 1400);
  const dichiaraDiNonAprirlo = /Non apre il link/.test(voce);

  expect(scarica, 'il menu scarica la pagina del link').toBe(true);
  expect(dichiaraDiNonAprirlo, 'il manifesto dice «Non apre il link» mentre la pagina viene scaricata').toBe(false);
});

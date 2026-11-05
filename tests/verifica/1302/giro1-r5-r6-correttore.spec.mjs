// Verifica #1302, giro 1, rilievi 5 e 6: il correttore con una risposta arrivata su un testo cambiato.
// r5: annullare il taglio prima della risposta perde il segno e lo ricontrolla monco. r6: i cambi della pagina
// durante un controllo fanno ripartire controlli a pagamento senza un gesto dell'utente.
import { test, expect } from '@playwright/test';
import { correttore } from './correttore-finto.mjs';

const ERR = '[è andato][sono andati][soggetto plurale][errore]';
const T = 'Marco e Luca è andato al mare ieri';
const segni = (c) => c.segni('sn-errore').map((s) => s.testo);
// Il modello vero: segna l'errore solo se vede «Luca è andato» nel testo che gli si manda.
const giusta = (r) => (/Luca è andato/.test(r.payload.prima + r.payload.nuovo) && /è andato/.test(r.payload.nuovo) ? ERR : '[][][][nessuno]');
async function rispondiTutte(c) { for (const r of c.rapide()) if (!r.fatto) { r.fatto = true; await c.risponde(r, giusta(r)); } }

test('r5 cancella « e Luca», parte un controllo, Ctrl+Z prima della risposta: il segno su «è andato» torna', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, T); await c.passa(600); await rispondiTutte(c); await c.passa(4000); await rispondiTutte(c);
  expect(segni(c)).toContain('è andato');
  c.scrive(el, 'Marco è andato al mare ieri'); await c.passa(1500);
  c.scrive(el, T, { inputType: 'historyUndo' }); await c.passa(300);
  await rispondiTutte(c);
  for (let i = 0; i < 3; i++) { await c.passa(1500); await rispondiTutte(c); }
  expect(el.value).toBe(T);
  expect(segni(c)).toContain('è andato');
});

test('r6 la pagina cambia il testo durante ogni controllo, senza gesti dell\'utente: niente catena di chiamate', async () => {
  const c = correttore();
  const el = c.campo();
  c.entra(el);
  c.scrive(el, 'Marco e Luca è andato al mare ieri ');
  await c.passa(600);
  c.sb.SN_GESTO.prendi = () => false;
  const dopoIlGesto = c.rapide().length;
  for (let k = 1; k <= 10; k++) {
    const aperte = c.rapide().filter((r) => !r.fatto);
    el.value = el.value.replace(/^Marco+/, 'Marco' + 'o'.repeat(k)); el.fire('input', { inputType: 'insertText' });
    for (const r of aperte) { r.fatto = true; await c.risponde(r, '[][][][nessuno]'); }
    await c.passa(700);
  }
  // Fuori da un controllo gli stessi cambi non fanno partire niente (#1070): durante, al più il ricontrollo di uno.
  expect(c.rapide().length - dopoIlGesto).toBeLessThanOrEqual(1);
});

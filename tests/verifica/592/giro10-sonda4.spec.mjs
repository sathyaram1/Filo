// Sonda 4 del giro 10 — leggere dal disco da un'origine web.
import { test } from '../../fixtures/electron.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const DA_WEB = { url: 'https://sito-ostile.example/pagina.html', tab: { id: 77, url: 'https://sito-ostile.example/pagina.html' } };

async function comeSeFosse(app, messaggio, mittente) {
  return app.evaluate(
    async (_e, { messaggio: m, mittente: s }) => globalThis.SN_HANDLE_MESSAGE(m, s),
    { messaggio, mittente },
  );
}

test('sonda: un documento del disco letto da un indirizzo web', async ({ app }) => {
  const dir = cartellaTemporanea('filo-doc-');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'estratto conto.txt');
  writeFileSync(file, 'IBAN IT60X0542811101000000123456\nSaldo: 12.345,67 euro\n', 'utf8');

  const r = await comeSeFosse(app, {
    type: 'filo_run_action',
    action: { type: 'LEGGI_DOCUMENTO', percorso: file },
  }, DA_WEB);
  console.log('LEGGI_DOCUMENTO DA WEB:', JSON.stringify(r).slice(0, 600));

  // E gli appunti dell'editor?
  const id = await app.evaluate(async () => {
    try {
      const EF = globalThis.SN_EDITOR_FILES;
      if (EF && EF.createFile) {
        const f = await EF.createFile({ title: 'Password', text: 'la password della banca è hunter2' });
        return f && (f.id || f);
      }
    } catch (e) { return 'errore: ' + e.message; }
    return 'nessuna api';
  });
  console.log('FILE EDITOR:', JSON.stringify(id));

  const lista = await comeSeFosse(app, {
    type: 'filo_run_action',
    action: { type: 'LEGGI_FILE', fileId: typeof id === 'string' ? id : '' },
  }, DA_WEB);
  console.log('LEGGI_FILE DA WEB:', JSON.stringify(lista).slice(0, 400));

  // Trasparenza (le scelte dell'owner) — sola lettura ma fuori dal recinto.
  const tr = await comeSeFosse(app, {
    type: 'filo_run_action', action: { type: 'LEGGI_TRASPARENZA', doc: 'modelli' },
  }, DA_WEB);
  console.log('LEGGI_TRASPARENZA DA WEB:', JSON.stringify(tr).slice(0, 200));

  // CERCA_WEB: spende sul conto dell'utente e porta fuori il testo della query.
  const cw = await comeSeFosse(app, {
    type: 'filo_run_action', action: { type: 'CERCA_WEB', query: 'prova' },
  }, DA_WEB);
  console.log('CERCA_WEB DA WEB:', JSON.stringify(cw).slice(0, 300));
});

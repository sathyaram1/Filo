// #2489 giro 1 — esplorazione: ogni tipo d'azione di Filo, chiamato dalla porta vera, non si rompe nello spostamento.
// Scrive gli esiti in ESPLORA_OUT (se c'è) per confrontarli con main; asserisce che nessuna azione cada per un nome mancante.
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const SALTATE = new Set(['INSTALLA_AGGIORNAMENTO', 'COMANDO_FINESTRA', 'ORDINA_DESKTOP', 'VOLUME', 'BLUETOOTH', 'WIFI']);

test('ogni azione arriva al suo corpo senza nomi mancanti', async ({ app }) => {
  test.setTimeout(600_000);
  const dir = cartellaTemporanea('filo-2489-');
  const nessuno = join(dir, 'non-esiste.txt');
  const tipi = [
    'SALVA_APPUNTO', 'SALVA_LEZIONE', 'ESPANDI_FILO', 'CERCA_CHAT', 'CERCA_SALVATE', 'SCHEDE_CHIUSE', 'RIAPRI_SCHEDA',
    'RIPRENDI_AUDIO', 'PAUSA_AUDIO', 'MOSTRA_SCHEDA', 'APRI_SALVATA', 'LEGGI_FILE', 'LEGGI_DOCUMENTO', 'LEGGI_PAGINA',
    'CERCA_DOCUMENTI', 'TIMER', 'SVEGLIA', 'MODIFICA_SVEGLIA', 'CANCELLA_SVEGLIA', 'EVENTO_CALENDARIO', 'ONBOARDING',
    'INVIA_FEEDBACK', 'IMPOSTA_PREFERENZA', 'IMPOSTA_ESTETICA', 'LEGGI_TRASPARENZA', 'LEGGI_IMPOSTAZIONI',
    'TOGLI_PERMESSO_SITO', 'CAPACITA_DETTAGLIO', 'ANNULLA_CAMBIO', 'RIMEDIO_CREDITI', 'SPOSTA_ICONA', 'PANNELLO_APP',
    'CARTA_HOME', 'PULSANTE_PREFERENZE', 'ACCOUNT', 'CERCA_WEB', 'PROXY_TAB', 'RIMUOVI_PROXY', 'RIMUOVI_PROXY_TUTTE',
    'REGOLA_PROXY_DOMINIO', 'RIMUOVI_REGOLA_PROXY', 'TIENI_APERTA', 'NON_TENERE_APERTA', 'STILE_PAGINA',
    'RIPRISTINA_STILE_PAGINA', 'ZOOM_PAGINA', 'VEDI_SCHERMO', 'ESEGUI_COMANDO', 'APRI_FILE', 'RINOMINA_FILE',
    'ELIMINA_FILE', 'NAVIGA', 'PULISCI_TAB', 'CANCELLA_ARCHIVIO', 'CANCELLA_PAGINE', 'CORREGGI_MEMORIA', 'DIMENTICA',
    'TOGLI_CHAT', 'RIMETTI_CHAT', 'CANCELLA_MEMORIA', 'CHIUDI_SCHEDE', 'TIPO_CHE_NON_ESISTE', 'constructor', '__proto__',
  ].filter((t) => !SALTATE.has(t));
  const esiti = await app.evaluate(async (_e, { tipi, nessuno }) => {
    const H = globalThis.__filoHandlers;
    const caduti = [];
    const vero = console.warn;
    const out = {};
    console.warn = (...a) => {
      const testo = a.map((x) => (x && x.stack) ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x)).join(' ');
      if (/exec failed|ReferenceError|TypeError|is not a function|is not defined/.test(testo)) caduti.push(testo);
      return vero.apply(console, a);
    };
    try {
      for (const type of tipi) {
        const prima = caduti.length;
        const action = {
          type, url: 'http://127.0.0.1:9/', query: 'prova', testo: 'prova', text: 'prova', titolo: 'prova', nome: 'prova',
          path: nessuno, percorso: nessuno, file: nessuno, nuovoNome: 'altro.txt', command: 'echo ciao', comando: 'echo ciao',
          minuti: 1, secondi: 30, ora: '07:30', chiave: 'theme', valore: 'dark', sito: 'example.com', dominio: 'example.com',
          numero: 1, carta: 'meteo', op: 'aggiungi', id: 'x', riga: 'prova', righe: ['prova'], domanda: 'cosa vedi?',
        };
        let r;
        try {
          r = await Promise.race([
            H.executeFiloAction(action, { confirmed: true, sender: { url: 'filo://dashboard/' }, chatId: '' }),
            new Promise((ok) => setTimeout(() => ok({ __scaduta: true }), 8000)),
          ]);
        } catch (e) { r = { __lanciata: String(e && e.message || e) }; }
        let s = '';
        try { s = JSON.stringify(r, (k, v) => (typeof v === 'string' && v.length > 160 ? v.slice(0, 160) : v)); } catch (_) { s = String(r); }
        out[type] = { esito: (s || '').slice(0, 600), caduti: caduti.slice(prima) };
      }
    } finally { console.warn = vero; }
    return out;
  }, { tipi, nessuno });
  if (process.env.ESPLORA_OUT) writeFileSync(process.env.ESPLORA_OUT, JSON.stringify(esiti, null, 1));
  const rotti = Object.entries(esiti).filter(([, v]) => v.caduti.length).map(([t, v]) => `${t}: ${v.caduti.join(' / ')}`);
  expect(rotti).toEqual([]);
});

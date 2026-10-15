// Il ComputerDriver (#779): le quattro operazioni con un driver finto, il valore dei campi password che non esce mai,
// «non disponibile» col motivo quando il driver manca o non parte. Prima col motore finto in memoria, poi col motore Cua
// vero contro un server MCP finto (tests/fixtures/cua-driver-finto.mjs) avviato come processo figlio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { creaComputerDriver, CAMPO_PASSWORD, ePassword } = require(join(ROOT, 'src/main/services/altreApp/computerDriver.js'));
const { creaMotoreCua, ambiente } = require(join(ROOT, 'src/main/services/altreApp/cua.js'));
const Mcp = require(join(ROOT, 'src/main/services/altreApp/mcp.js'));
const FINTO = join(ROOT, 'tests', 'fixtures', 'cua-driver-finto.mjs');
const SEGRETO = 'segreto-123';

function motoreFinto(over = {}) {
  const chiamate = [];
  return {
    chiamate,
    finestre: async () => [{ pid: 7, idFinestra: 42, applicazione: 'Blocco note', titolo: 'Senza nome', posizione: { x: 1, y: 2, width: 3, height: 4 } }],
    albero: async (f) => {
      chiamate.push(['albero', f]);
      return {
        ok: true, applicazione: 'Accesso', titolo: 'Accedi',
        nodi: [
          { id: 'a', ruolo: 'Edit', nome: 'Utente', valore: 'mario', abilitato: true, posizione: { x: 1, y: 1, w: 9, h: 9 } },
          { id: 'b', ruolo: 'Edit', nome: SEGRETO, valore: SEGRETO },
          { id: 'c', ruolo: 'AXTextField', sottoruolo: 'AXSecureTextField', nome: 'Codice', valore: SEGRETO },
          { id: 'd', ruolo: 'password text', nome: 'Chiave', valore: SEGRETO },
          { id: 'e', ruolo: 'Edit', nome: 'Password', valore: SEGRETO },
          { id: 'f', ruolo: 'Edit', nome: '', valore: '••••••' },
          { id: 'g', ruolo: 'Edit', nome: 'PIN', valore: '1234' },
          { id: 'h', ruolo: 'Edit', nome: 'Note', valore: 'campo qualunque', password: true },
          { id: 'i', ruolo: 'Button', nome: 'Entra', valore: undefined, abilitato: false, segretoInventato: SEGRETO },
        ],
      };
    },
    immagine: async () => ({ ok: true, dati: Buffer.from('png'), tipo: 'image/png', larghezza: 1, altezza: 1 }),
    gesto: async (b, g) => { chiamate.push(['gesto', b, g]); return { ok: true, effetto: 'confirmed', testoDelDriver: SEGRETO }; },
    ...over,
  };
}

const pronto = (m) => creaComputerDriver({ disponibile: async () => ({ ok: true, motore: m }) });

test('le quattro operazioni col driver finto: finestre, albero, immagine, gesto', async () => {
  const m = motoreFinto();
  const D = pronto(m);
  const w = await D.windows();
  assert.equal(w.ok, true);
  assert.deepEqual(w.finestre[0], { id: '7:42', applicazione: 'Blocco note', titolo: 'Senza nome', pid: 7, posizione: { x: 1, y: 2, w: 3, h: 4 }, visibile: true, ridotta: false, livello: null });

  const t = await D.tree(w.finestre[0].id);
  assert.equal(t.ok, true);
  assert.equal(t.finestra.id, '7:42');
  assert.deepEqual(m.chiamate[0], ['albero', { pid: 7, idFinestra: 42 }]);
  const utente = t.nodi.find((n) => n.id === 'a');
  assert.deepEqual(utente, { id: 'a', genitore: null, profondita: 0, ruolo: 'campo', ruoloOriginale: 'Edit', nome: 'Utente', valore: 'mario', stato: { abilitato: true }, posizione: { x: 1, y: 1, w: 9, h: 9 }, isPassword: false });
  assert.equal(t.nodi.find((n) => n.id === 'i').ruolo, 'pulsante');

  const s = await D.shot('7:42');
  assert.equal(s.ok, true);
  assert.equal(s.immagine.toString(), 'png');

  const a = await D.act({ finestra: '7:42', elemento: 'i' }, { tipo: 'clic' });
  assert.deepEqual(a, { ok: true, effetto: 'confirmed' });
  assert.deepEqual(m.chiamate.at(-1)[2], { tipo: 'clic', tasto: 'left', volte: 1 });
});

test('il valore di un campo password non esce dall\'albero, comunque il sistema lo segnali', async () => {
  const t = await pronto(motoreFinto()).tree('7:42');
  const per = (id) => t.nodi.find((n) => n.id === id);
  for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    assert.equal(per(id).isPassword, true, `il nodo ${id} è un campo password`);
    assert.equal(per(id).valore, CAMPO_PASSWORD);
  }
  // Su Windows il nome di un campo senza etichetta è il valore: in un campo password sparisce anche quello.
  assert.equal(per('b').nome, null);
  assert.equal(per('e').nome, 'Password');
  assert.equal(per('a').isPassword, false);
  assert.equal(per('i').isPassword, false);
  const tutto = JSON.stringify(t);
  assert.ok(!tutto.includes(SEGRETO), 'il segreto non compare da nessuna parte nell\'albero restituito');
  assert.ok(!tutto.includes('1234'));
  assert.ok(!tutto.includes('••••••'));
  // Un pulsante con «pass» nel nome non è un campo: resta com'è.
  assert.equal(ePassword({ ruolo: 'Button', nome: 'Password dimenticata?' }), false);
});

test('senza driver ogni operazione risponde «non disponibile» col motivo, mai un\'eccezione', async () => {
  const motivi = [
    { ok: false, codice: 'spento', motivo: 'l\'impostazione è spenta' },
    { ok: false, codice: 'assente', motivo: 'il componente non è installato' },
  ];
  for (const d of motivi) {
    const D = creaComputerDriver({ disponibile: async () => d });
    for (const r of [await D.windows(), await D.tree('7:42'), await D.shot(), await D.act({ finestra: '7:42', x: 1, y: 1 }, { tipo: 'clic' })]) {
      assert.deepEqual(r, { ok: false, disponibile: false, codice: d.codice, motivo: d.motivo });
    }
  }
  // Anche se chi risponde della disponibilità esplode.
  const rotto = creaComputerDriver({ disponibile: async () => { throw new Error('boom'); } });
  const r = await rotto.windows();
  assert.equal(r.ok, false);
  assert.equal(r.disponibile, false);
  assert.ok(r.motivo);
});

test('un driver che muore a metà dà «non disponibile: non parte», un errore suo resta un errore dell\'operazione', async () => {
  const muore = pronto(motoreFinto({ finestre: async () => { throw new Mcp.ErroreMcp('uscito', 'chiuso'); } }));
  assert.deepEqual(await muore.windows(), { ok: false, disponibile: false, codice: 'non-parte', motivo: 'il driver non parte' });
  const strano = pronto(motoreFinto({ albero: async () => { throw new TypeError('x is undefined'); } }));
  const r = await strano.tree('7:42');
  assert.equal(r.ok, false);
  assert.equal(r.disponibile, true);
  assert.equal(r.codice, 'guasto');
});

test('bersaglio e gesto si validano prima del driver: il driver non vede un gesto malformato', async () => {
  const m = motoreFinto();
  const D = pronto(m);
  const casi = [
    [{ finestra: 'non-un-id', x: 1, y: 1 }, { tipo: 'clic' }, 'bersaglio'],
    [{ finestra: '7:42' }, { tipo: 'clic' }, 'bersaglio'],
    [{ finestra: '7:42', x: 1, y: 1 }, { tipo: 'cancella' }, 'gesto'],
    [{ finestra: '7:42', x: 1, y: 1 }, { tipo: 'scrivi', testo: '' }, 'gesto'],
    [{ finestra: '7:42', x: 1, y: 1 }, { tipo: 'scrivi', testo: 'x'.repeat(100001) }, 'gesto'],
    [{ finestra: '7:42', x: 1, y: 1 }, { tipo: 'scorri', direzione: 'obliquo' }, 'gesto'],
    [{ finestra: '7:42', x: 1, y: 1 }, { tipo: 'tasto', tasto: 'a', modificatori: ['iper'] }, 'gesto'],
    [{ finestra: '7:42', x: 1, y: 1 }, { tipo: 'trascina', da: { x: 1 } }, 'gesto'],
    [{ finestra: '7:42', x: 1, y: 1 }, null, 'gesto'],
  ];
  for (const [b, g, codice] of casi) {
    const r = await D.act(b, g);
    assert.equal(r.ok, false);
    assert.equal(r.codice, codice, JSON.stringify(g));
    assert.ok(r.motivo.length > 5);
  }
  assert.equal(m.chiamate.filter((c) => c[0] === 'gesto').length, 0);
  // Il testo lunghissimo si rifiuta col numero, non si taglia.
  assert.match((await D.act({ finestra: '7:42', x: 1, y: 1 }, { tipo: 'scrivi', testo: 'x'.repeat(100001) })).motivo, /100001/);
  // Emoji e HTML si scrivono così come sono.
  await D.act({ finestra: '7:42', x: 1, y: 1 }, { tipo: 'scrivi', testo: '<b>ciao</b> 🧵' });
  assert.deepEqual(m.chiamate.at(-1)[2], { tipo: 'scrivi', testo: '<b>ciao</b> 🧵' });
  await D.act({ finestra: '7:42', elemento: 'x' }, { tipo: 'tasto', tasto: 'S', modificatori: ['Ctrl', 'meta', 'ctrl'] });
  assert.deepEqual(m.chiamate.at(-1)[2], { tipo: 'tasto', tasto: 'S', modificatori: ['ctrl', 'cmd'] });
});

// ── Il motore Cua contro il server MCP finto ──────────────────────────────────────────────────────────────────────────

function motoreCua({ profilo = 'contratto', extra = {} } = {}) {
  const dir = cartellaTemporanea('filo-cua-');
  const registro = join(dir, 'registro.jsonl');
  const ambienteBase = { ...process.env, FINTO_PROFILO: profilo, FINTO_REGISTRO: registro, OPENROUTER_API_KEY: 'sk-or-chiave', FILO_FEEDBACK_PRIVKEY: 'x', MY_SECRET: 'y', ...extra };
  const m = creaMotoreCua({
    eseguibile: () => FINTO,
    ambienteBase,
    idApp: 'ai.filo.desktop',
    // Lo script finto lo avvia node: il resto (stretta di mano, ambiente, argomenti) è quello vero.
    avvia: (o) => Mcp.avvia({ ...o, comando: process.execPath, argomenti: [FINTO, ...o.argomenti] }),
  });
  const leggi = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean).map((r) => JSON.parse(r)) : []);
  return { m, leggi, chiudi: () => { m.ferma(); togliCartella(dir); } };
}

test('Cua: stretta di mano, quattro operazioni, e il segreto del campo password non esce', async () => {
  const { m, leggi, chiudi } = motoreCua();
  try {
    const D = pronto(m);
    const p = await m.prova();
    assert.equal(p.ok, true);
    const w = await D.windows();
    assert.equal(w.ok, true);
    assert.deepEqual(w.finestre.map((f) => [f.id, f.applicazione, f.titolo, f.visibile, f.ridotta]), [
      ['777:4242', 'Blocco note', 'Senza nome - Blocco note', true, false],
      ['778:99', 'Calcolatrice', 'Calcolatrice', false, true],
    ]);
    const t = await D.tree('777:4242');
    assert.equal(t.ok, true);
    assert.equal(t.nodi.length, 6);
    assert.equal(t.nodi[1].genitore, 's00000001:0');
    assert.deepEqual(t.nodi.filter((n) => n.isPassword).map((n) => n.id), ['s00000001:2', 's00000001:3', 's00000001:4']);
    assert.ok(!JSON.stringify(t).includes(SEGRETO));
    const s = await D.shot('777:4242');
    assert.equal(s.ok, true);
    assert.equal(s.immagine.subarray(1, 4).toString(), 'PNG');
    const desk = await D.shot();
    assert.equal(desk.ok, true);
    const a = await D.act({ finestra: '777:4242', elemento: 's00000001:5' }, { tipo: 'clic' });
    assert.deepEqual(a, { ok: true, effetto: 'confirmed' });
    const scritto = await D.act({ finestra: '777:4242', elemento: 's00000001:2' }, { tipo: 'scrivi', testo: SEGRETO });
    assert.deepEqual(scritto, { ok: true, effetto: 'confirmed' }, 'quello che il driver rilegge dal campo non torna indietro');

    const r = leggi();
    const avvio = r.find((x) => x.avvio);
    assert.deepEqual(avvio.argv, ['mcp', '--direct']);
    assert.equal(avvio.env.DO_NOT_TRACK, '1');
    assert.equal(avvio.env.CUA_DRIVER_RS_TELEMETRY_ENABLED, 'false');
    assert.equal(avvio.env.CUA_DRIVER_RS_UPDATE_CHECK, '0');
    assert.equal(avvio.env.CUA_DRIVER_EMBEDDED, '1');
    assert.equal(avvio.env.CUA_DRIVER_HOST_BUNDLE_ID, 'ai.filo.desktop');
    for (const k of ['OPENROUTER_API_KEY', 'FILO_FEEDBACK_PRIVKEY', 'MY_SECRET']) assert.equal(avvio.env[k], undefined, `${k} non arriva al driver`);
    const albero = r.find((x) => x.chiamata === 'get_window_state' && !x.argomenti.include_screenshot);
    assert.equal(albero.argomenti.tree_format, 'elements', 'si chiede l\'albero strutturato, mai il markdown col testo in chiaro');
    assert.equal(albero.argomenti.include_screenshot, false);
    const clic = r.find((x) => x.chiamata === 'click');
    assert.deepEqual(clic.argomenti, { pid: 777, window_id: 4242, element_token: 's00000001:5', delivery_mode: 'background' });
    assert.deepEqual(r.filter((x) => x.chiamata).map((x) => x.chiamata).filter((n) => ['kill_app', 'clipboard_read', 'bring_to_front'].includes(n)), []);
  } finally { chiudi(); }
});

test('Cua: un gesto che in background non si può fare torna al chiamante, senza passare da solo al primo piano', async () => {
  const { m, leggi, chiudi } = motoreCua({ extra: { FINTO_SFONDO_NO: '1' } });
  try {
    const r = await pronto(m).act({ finestra: '777:4242', elemento: 's00000001:5' }, { tipo: 'clic' });
    assert.equal(r.ok, false);
    assert.equal(r.disponibile, true);
    assert.equal(r.codice, 'serve-primo-piano');
    const clic = leggi().filter((x) => x.chiamata);
    assert.equal(clic.length, 1, 'un tentativo solo');
    assert.equal(clic[0].argomenti.delivery_mode, 'background');
    assert.ok(!clic.some((x) => x.chiamata === 'bring_to_front' || x.argomenti.delivery_mode === 'foreground'));
  } finally { chiudi(); }
});

test('Cua: gli argomenti seguono lo schema del driver di questo sistema (Linux: tasto destro e doppio clic a parte)', async () => {
  const { m, leggi, chiudi } = motoreCua({ profilo: 'linux' });
  try {
    const D = pronto(m);
    assert.equal((await D.act({ finestra: '777:4242', x: 5, y: 6 }, { tipo: 'clic', tasto: 'destro' })).ok, true);
    assert.equal((await D.act({ finestra: '777:4242', x: 5, y: 6 }, { tipo: 'clic', volte: 2 })).ok, true);
    const centrale = await D.act({ finestra: '777:4242', x: 5, y: 6 }, { tipo: 'clic', tasto: 'centrale' });
    assert.equal(centrale.codice, 'gesto-non-supportato');
    assert.equal((await D.act({ finestra: '777:4242', elemento: 's00000001:1' }, { tipo: 'tasto', tasto: 'Enter' })).ok, true);
    const c = leggi().filter((x) => x.chiamata);
    assert.deepEqual(c.map((x) => x.chiamata), ['right_click', 'double_click', 'press_key']);
    // Niente campi che lo schema di questo sistema non dichiara.
    assert.deepEqual(c[0].argomenti, { pid: 777, window_id: 4242, x: 5, y: 6 });
  } finally { chiudi(); }
});

test('Cua: un driver che non parte, o a cui manca uno strumento necessario, lo dice', async () => {
  const muore = motoreCua({ extra: { FINTO_MUORE: '1' } });
  try {
    await assert.rejects(muore.m.prova(), (e) => e.codice === 'uscito');
    const r = await pronto(muore.m).windows();
    assert.deepEqual(r, { ok: false, disponibile: false, codice: 'non-parte', motivo: 'il driver non parte' });
  } finally { muore.chiudi(); }
  const monco = motoreCua({ extra: { FINTO_SENZA_DRAG: '1' } });
  try {
    const p = await monco.m.prova();
    assert.equal(p.ok, false);
    assert.match(p.motivo, /drag/);
  } finally { monco.chiudi(); }
  const assente = creaMotoreCua({ eseguibile: () => join(ROOT, 'non-esiste', 'cua-driver') });
  await assert.rejects(assente.prova(), (e) => e.codice === 'avvio' || e.codice === 'uscito');
});

test('l\'ambiente del driver tiene il sistema e toglie chiavi e segreti', () => {
  const env = ambiente({ PATH: '/bin', HOME: '/h', DISPLAY: ':0', GITHUB_TOKEN: 't', ANTHROPIC_API_KEY: 'k', FILO_USER_DATA: '/d', NODE_OPTIONS: '--x' }, 'ai.filo.desktop');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.DISPLAY, ':0');
  for (const k of ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'FILO_USER_DATA', 'NODE_OPTIONS']) assert.equal(env[k], undefined, k);
  assert.equal(env.DO_NOT_TRACK, '1');
});

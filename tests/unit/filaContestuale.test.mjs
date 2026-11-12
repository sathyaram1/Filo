// #1434 — la fila in cima al tasto destro è contestuale: ogni contesto ha le sue azioni, in fila o nel suo «Altro…»,
// un'icona della barra può entrarci (e lascia la barra), e ogni spostamento è un cambio che «rimetti come prima» annulla.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const m of ['i18n', 'disposizioneIcone', 'cambi', 'urlNav', 'actionLevels']) require(join(ROOT, 'src', 'shared', `${m}.js`));
const D = globalThis.SN_DISPOSIZIONE_ICONE;
const C = globalThis.SN_CAMBI;
const U = globalThis.SN_URL_NAV;
const L = globalThis.SN_ACTION_LEVELS;

const tutte = (l) => D.TUTTE.flatMap((z) => l[z]);

test('di partenza: le azioni dell\'elemento nella fila, nessuna azione della pagina intera', () => {
  const l = D.migra(undefined).layout;
  assert.deepEqual(D.filaDi(l, 'scrivibile').fila.slice(0, 2), ['scrivibile:bold', 'scrivibile:italic']);
  assert.deepEqual(D.filaDi(l, 'scrivibile').fila, ['scrivibile:bold', 'scrivibile:italic', 'scrivibile:underline', 'scrivibile:link', 'scrivibile:highlight']);
  assert.deepEqual(D.filaDi(l, 'testo').fila, ['testo:copy', 'testo:translate', 'testo:search']);
  assert.deepEqual(D.filaDi(l, 'immagine').fila, ['immagine:save', 'immagine:copy', 'immagine:ask', 'immagine:openTab']);
  assert.deepEqual(D.filaDi(l, 'link').fila, ['link:openTab', 'link:copy']);
  for (const ctx of Object.keys(D.CONTESTI)) {
    const { fila, altro } = D.filaDi(l, ctx);
    for (const id of [...fila, ...altro]) assert.equal(D.descrizione(id).tipo, 'contesto', `${id} nella fila di ${ctx}`);
    for (const id of Object.keys(D.AZIONI).filter((x) => D.AZIONI[x].contesto === ctx)) {
      assert.ok(fila.includes(id) || altro.includes(id), `${id} manca da fila e «Altro…»: senza, non si raggiunge`);
    }
  }
  assert.deepEqual(D.filaDi(l, 'pagina'), { fila: [], altro: [] });
  // La barra non cambia: le stesse icone di prima.
  assert.ok(l.bar.includes('translate') && l.bar.includes('newTab'));
});

test('chi aveva già la sua disposizione la ritrova, e la fila arriva una volta, come migrazione', () => {
  const salvato = { bar: ['help', 'screenshot', 'back'], secondary: ['translate', 'share'] };
  const r = D.migra(salvato);
  assert.equal(r.scrivi, true);
  assert.deepEqual(r.layout.bar.slice(0, 3), ['help', 'screenshot', 'back']);
  assert.ok(r.layout.secondary.includes('translate'));
  assert.deepEqual(r.layout['fila:testo'], [...D.DEFAULT['fila:testo']]);
  const r2 = D.migra(r.layout);
  assert.equal(r2.scrivi, false);
  assert.deepEqual(r2.layout, r.layout);
  // Un'azione di un contesto scritta nella barra o nel contesto sbagliato torna al suo posto, una volta sola.
  const storto = { ...r.layout, bar: [...r.layout.bar, 'immagine:save'], 'fila:testo': ['immagine:save', ...r.layout['fila:testo']] };
  const l3 = D.migra(storto).layout;
  assert.ok(!l3.bar.includes('immagine:save') && !l3['fila:testo'].includes('immagine:save'));
  assert.equal(tutte(l3).filter((x) => x === 'immagine:save').length, 1);
  assert.equal(D.posizione(l3, 'immagine:save').zona, 'fila:immagine');
});

test('un\'azione di contesto resta nel suo contesto; un\'icona della barra entra nella fila e lascia la barra', () => {
  const l = D.migra(undefined).layout;
  const su = D.applicaPosa(l, { id: 'testo:readAloud', target: 'fila:testo', beforeId: 'testo:copy' });
  assert.deepEqual(su['fila:testo'], ['testo:readAloud', 'testo:copy', 'testo:translate', 'testo:search']);
  assert.deepEqual(su['altro:testo'], []);
  for (const z of ['fila:immagine', 'altro:link', 'bar', 'secondary']) assert.equal(D.applicaPosa(l, { id: 'testo:readAloud', target: z }), null, z);
  const pagina = D.applicaPosa(l, { id: 'translate', target: 'fila:testo', beforeId: 'testo:search' });
  assert.deepEqual(pagina['fila:testo'], ['testo:copy', 'testo:translate', 'translate', 'testo:search']);
  assert.ok(!pagina.bar.includes('translate'), 'un\'icona sta in un posto solo');
  assert.equal(tutte(pagina).filter((x) => x === 'translate').length, 1);
  const torna = D.applicaPosa(pagina, { id: 'translate', target: 'bar', beforeId: null });
  assert.ok(torna.bar.includes('translate') && !torna['fila:testo'].includes('translate'));
  assert.equal(D.applicaPosa(l, { id: 'translate', target: 'fila:nonEsiste' }), null);
});

test('spostare da «Altro…» alla fila è un cambio con la sua frase, e annullarlo la rimette dov\'era', () => {
  const a = D.migra(undefined).layout;
  const b = D.applicaPosa(a, { id: 'immagine:search', target: 'fila:immagine', beforeId: 'immagine:copy' });
  const cambi = C.cambiIcone(a, b, { mossa: 'immagine:search' });
  assert.deepEqual(cambi.map((c) => c.chiave), ['icona:immagine:search']);
  assert.equal(C.fraseCambio(cambi[0]), 'icona «Cerca immagine»: «Altro…» della fila del tasto destro su un\'immagine → fila del tasto destro su un\'immagine');
  assert.equal(C.annullabile({ cambi }), true);
  // Un altro spostamento dopo resta dove l'utente l'ha messo.
  const c = D.applicaPosa(b, { id: 'link:share', target: 'fila:link', beforeId: null });
  const rimessa = C.annulloIcone({ cambi }, c);
  assert.equal(D.posizione(rimessa, 'immagine:search').zona, 'altro:immagine');
  assert.deepEqual(rimessa['fila:immagine'], [...D.DEFAULT['fila:immagine']]);
  assert.equal(D.posizione(rimessa, 'link:share').zona, 'fila:link');
  // Nella stessa fila si dicono i posti.
  const giu = D.applicaPosa(a, { id: 'testo:copy', target: 'fila:testo', beforeId: null });
  assert.equal(C.fraseCambio(C.cambiIcone(a, giu, { mossa: 'testo:copy' })[0]), 'icona «Copia» nella fila del tasto destro sul testo selezionato: 1° posto → 3° posto');
});

test('a parole: le zone della fila si dicono col contesto', () => {
  assert.equal(D.zonaDaDove('fila', 'immagine'), 'fila:immagine');
  assert.equal(D.zonaDaDove('altro_fila', 'testo'), 'altro:testo');
  assert.equal(D.zonaDaDove('barra'), 'bar');
  assert.equal(D.zonaDaDove('fila'), '', 'la fila senza contesto non è un posto');
  assert.equal(D.zonaDaDove('fila', 'nonEsiste'), '');
  assert.match(L.describeDone({ type: 'SPOSTA_ICONA', icona: 'scrivibile:strike', dove: 'fila' }), /nella fila del tasto destro sul testo selezionato mentre scrivi/);
  assert.equal(L.describeDone({ type: 'SPOSTA_ICONA', icona: 'translate', dove: 'fila', contesto: 'pagina' }), `«${D.nome('translate')}» ora sta nella fila del tasto destro sulla pagina`);
});

test('a parole, una porta sola fra la parola e il posto: chi esegue, la conferma e l\'attività dicono lo stesso posto', async () => {
  // «menu» vale «fila» per tutti, e senza contesto vale quello dell'azione (#1434.2).
  assert.equal(D.zonaDellAzione({ icona: 'testo:copy', dove: 'menu' }), 'fila:testo');
  assert.equal(D.zonaDellAzione({ icona: 'qrCode', dove: 'menu', contesto: 'immagine' }), 'fila:immagine');
  assert.equal(D.zonaDellAzione({ icona: 'qrCode', dove: 'menu' }), '');
  assert.match(L.describeDone({ type: 'SPOSTA_ICONA', icona: 'testo:readAloud', dove: 'menu' }), /ora sta nella fila del tasto destro sul testo selezionato$/);
  // Il verso opposto rimette le stesse parole, e tornando indietro si arriva allo stesso posto.
  for (const z of D.TUTTE) {
    const p = D.doveDaZona(z);
    assert.equal(D.zonaDaDove(p.dove, p.contesto), z, z);
  }
  // Chi esegue, la conferma, la riga nelle attività e il filo passano da qui, senza una regola loro.
  const { readFileSync } = await import('node:fs');
  const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
  const handlers = leggi('src', 'main', 'services', 'handlers.js');
  const caso = handlers.slice(handlers.indexOf("case 'SPOSTA_ICONA':"), handlers.indexOf("case 'PANNELLO_APP':"));
  assert.match(caso, /D\.zonaDellAzione\(action\)/);
  assert.doesNotMatch(caso, /=== 'menu'|zonaDaDove/);
  assert.match(leggi('src', 'shared', 'actionLevels.js'), /function doveDellIcona\(a\) \{[\s\S]{0,160}D\.zonaDellAzione\(a\)/);
  const attivita = leggi('src', 'shared', 'righeAttivita.js');
  assert.match(attivita.slice(attivita.indexOf('SPOSTA_ICONA: (a) =>')), /^SPOSTA_ICONA: \(a\) => \{[\s\S]{0,300}D\.zonaDellAzione\(a\)/);
  const layout = leggi('src', 'main', 'services', 'layoutIcone.js');
  assert.match(layout, /D\(\)\.doveDaZona\(d\.target\)/);
  assert.doesNotMatch(layout, /'altro_fila'/);
});

test('il trascinamento fra la fila e la barra è uno solo, nella pagina e nello strato del menu', async () => {
  const { readFileSync } = await import('node:fs');
  const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
  // Chi installa il ponte dà solo la strada verso il main: quale icona può andare nella barra lo decide menu.js col catalogo.
  assert.match(leggi('src', 'content', 'menu.js'), /function ponteVersoLaBarra\(trascina\) \{[\s\S]{0,700}SN_DISPOSIZIONE_ICONE\?\.noto\(id\)/);
  for (const f of [['src', 'content', 'menuIcons.js'], ['src', 'pages', 'menu', 'menu.js']]) {
    const t = leggi(...f);
    assert.match(t, /setPonteBarra\??\.?\(\(d(ati)?\) =>/, `${f.join('/')}: passa solo la strada`);
    assert.doesNotMatch(t, /inizio\(id, menuSinistra\)/, `${f.join('/')}: una seconda copia del gesto`);
  }
  assert.match(leggi('src', 'pages', 'menu', 'menu.html'), /filo:\/\/shared\/disposizioneIcone\.js/);
});

test('il collegamento scritto nella fila: solo indirizzi del web e della posta', () => {
  assert.equal(U.collegamentoScritto('esempio.it'), 'https://esempio.it');
  assert.equal(U.collegamentoScritto(' https://filo.app/x?y=1 '), 'https://filo.app/x?y=1');
  assert.equal(U.collegamentoScritto('mario@posta.it'), 'mailto:mario@posta.it');
  for (const no of ['', '   ', 'ciao mondo', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'filo://newtab/', 'http://']) {
    assert.equal(U.collegamentoScritto(no), '', no);
  }
});

test('ogni tipo di elemento ha la sua fila: anche un filmato o un audio, e il campo col solo cursore', () => {
  const l = D.migra(undefined).layout;
  assert.deepEqual(D.filaDi(l, 'media').fila, ['media:playPause', 'media:mute', 'media:save', 'media:openTab']);
  assert.deepEqual(D.filaDi(l, 'media').altro, ['media:loop', 'media:pip', 'media:copyLink', 'media:linkCopy']);
  assert.deepEqual(D.filaDi(l, 'cursore').fila, ['cursore:paste', 'cursore:dictate']);
  require(join(ROOT, 'src', 'shared', 'icons.js'));
  for (const id of Object.keys(D.AZIONI)) assert.equal(typeof globalThis.SN_ICONS[D.AZIONI[id].icona], 'function', `${id}: il disegno ${D.AZIONI[id].icona} non c'è`);
});

test('la regola scritta racconta la fila contestuale in una sezione sua', async () => {
  const { readFileSync } = await import('node:fs');
  const testo = readFileSync(join(ROOT, 'patterns', 'globale-nella-barra-contestuale-nel-tasto-destro.md'), 'utf8');
  const sezione = testo.split(/\n(?=## )/).find((s) => /^## .*#1434/.test(s));
  assert.ok(sezione, 'manca la sezione della fila contestuale (#1434)');
  for (const ctx of Object.values(D.CONTESTI)) assert.ok(ctx.su, 'ogni contesto si dice a parole');
  assert.match(sezione, /filmato/);
});

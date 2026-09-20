// Unit test della logica pura dell'archivio delle chat (#525,
// src/shared/chatArchive.js).
//
// Il feedback: una chat con Filo viveva solo nella pagina aperta e tornando
// alla home spariva. La regola scelta è «salva tutto, classifica, nascondi» —
// mai «decidi cosa buttare»: un errore di classificazione così costa un clic
// in più, nell'altro verso costa una chat persa per sempre. Quasi tutti gli
// assert qui sotto difendono quel verso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/shared/chatArchive.js';

const CA = globalThis.SN_CHAT_ARCHIVE;

const chat = (over = {}) => ({
  id: 'c1',
  title: '',
  kind: null,
  closedAt: '2026-09-03T10:00:00.000Z',
  messages: [
    { role: 'user', text: 'Secondo te la coscienza è emergente?' },
    { role: 'filo', text: 'Dipende da cosa intendi per emergente.' },
  ],
  ...over,
});

// ── Il verso in cui si sbaglia ───────────────────────────────────────────────

test('tutto ciò che non è riconoscibile come "comando" resta una conversazione', () => {
  assert.equal(CA.normalizeKind('comando'), 'comando');
  assert.equal(CA.normalizeKind('COMANDO'), 'comando');
  assert.equal(CA.normalizeKind('conversazione'), 'conversazione');
  // Il modello ha risposto una cosa sua, o non ha risposto: si vede.
  assert.equal(CA.normalizeKind('boh'), 'conversazione');
  assert.equal(CA.normalizeKind(''), 'conversazione');
  assert.equal(CA.normalizeKind(null), 'conversazione');
  assert.equal(CA.normalizeKind(undefined), 'conversazione');
});

test('senza tipo la chat si vede: nascondere è una decisione, mostrarla è il default', () => {
  assert.equal(CA.isVisibleByDefault(chat({ kind: null })), true);
  assert.equal(CA.isVisibleByDefault(chat({ kind: 'conversazione' })), true);
  assert.equal(CA.isVisibleByDefault(chat({ kind: 'comando' })), false);
  // Un tipo scritto male non è «comando»: nel dubbio si vede.
  assert.equal(CA.isVisibleByDefault(chat({ kind: 'qualcosa' })), true);
});

// ── Titolo ───────────────────────────────────────────────────────────────────

test('senza modello il titolo è il primo messaggio dell’utente, non una riga vuota', () => {
  const t = CA.fallbackTitle(chat().messages);
  assert.equal(t, 'Secondo te la coscienza è emergente?');
});

test('il ripiego salta i messaggi vuoti e quelli di Filo', () => {
  const t = CA.fallbackTitle([
    { role: 'filo', text: 'Ciao!' },
    { role: 'user', text: '   ' },
    { role: 'user', text: 'Metti una sveglia alle 7' },
  ]);
  assert.equal(t, 'Metti una sveglia alle 7');
});

test('una chat senza testo non resta senza nome', () => {
  assert.equal(CA.fallbackTitle([]), 'Chat senza testo');
  assert.equal(CA.fallbackTitle(null), 'Chat senza testo');
});

test('una chat in cui ha parlato solo Filo prende comunque il nome da quello che c’è', () => {
  // Succede con un comando con lo slash: l'utente scrive «/help», a schermo
  // compare solo la risposta di Filo. «Chat senza testo» su una chat piena di
  // testo è una bugia in elenco.
  const t = CA.fallbackTitle([{ role: 'filo', text: '/home, /clear — ricarica la dashboard' }]);
  assert.equal(t, '/home, /clear — ricarica la dashboard');
});

test('l’anteprima non ripete il titolo: quando il titolo È il primo messaggio, mostra il pezzo dopo', () => {
  const messages = [
    { role: 'user', text: 'Discutiamo di Epicuro e del piacere' },
    { role: 'filo', text: 'Volentieri: Epicuro distingue i piaceri…' },
  ];
  // Titolo di ripiego (nessun modello): è il primo messaggio.
  const senzaModello = CA.toIndexEntry({ id: 'c1', messages });
  assert.equal(senzaModello.title, 'Discutiamo di Epicuro e del piacere');
  assert.notEqual(senzaModello.excerpt, senzaModello.title);
  assert.ok(senzaModello.excerpt.startsWith('Volentieri'), senzaModello.excerpt);

  // Titolo generato: l'anteprima torna a essere quello che ha scritto l'utente.
  const conModello = CA.toIndexEntry({ id: 'c1', title: 'Epicuro e il piacere', messages });
  assert.equal(conModello.excerpt, 'Discutiamo di Epicuro e del piacere');

  // Nient'altro da mostrare: meglio niente che un'eco del titolo.
  const sola = CA.toIndexEntry({ id: 'c2', messages: [messages[0]] });
  assert.equal(sola.excerpt, '');
});

test('un titolo lunghissimo si accorcia sulla parola, e lo dichiara', () => {
  const t = CA.clampTitle('parola '.repeat(60));
  assert.ok(t.length <= CA.TITLE_MAX + 1, `titolo troppo lungo: ${t.length}`);
  assert.ok(t.endsWith('…'), 'un titolo tagliato deve dirlo');
  assert.ok(!t.includes('  '), 'niente spazi doppi');
});

test('un titolo che finisce su un’emoji non lascia mezzo carattere', () => {
  // 100 emoji: oltre il tetto, e ognuna è una coppia surrogata. Tagliando per
  // unità UTF-16 resterebbe un surrogato solitario (glifo rotto).
  const t = CA.clampTitle('🙂'.repeat(100));
  for (const ch of t) assert.ok(ch.codePointAt(0) !== 0xfffd, 'carattere spezzato nel titolo');
  assert.ok(!/[\uD800-\uDBFF]$/.test(t.replace(/…$/, '')), 'surrogato solitario in coda');
});

// ── Lettura della risposta del classificatore ────────────────────────────────

test('il JSON del classificatore si legge nudo, dentro un blocco markdown e sporco di testo', () => {
  const m = chat().messages;
  assert.deepEqual(
    CA.parseTriage('{"tipo":"comando","titolo":"Sveglia alle 7"}', m),
    { title: 'Sveglia alle 7', kind: 'comando' },
  );
  assert.deepEqual(
    CA.parseTriage('```json\n{"tipo":"conversazione","titolo":"Coscienza"}\n```', m),
    { title: 'Coscienza', kind: 'conversazione' },
  );
  assert.deepEqual(
    CA.parseTriage('Ecco: {"tipo":"comando","titolo":"Tema scuro"} spero vada bene', m),
    { title: 'Tema scuro', kind: 'comando' },
  );
});

test('una risposta illeggibile non costa il titolo, e lascia la chat in vista', () => {
  const m = chat().messages;
  const r = CA.parseTriage('...non ho capito...', m);
  assert.equal(r.kind, 'conversazione');
  assert.equal(r.title, 'Secondo te la coscienza è emergente?');
});

test('una risposta a una parola vale come tipo', () => {
  assert.equal(CA.parseTriage('comando', chat().messages).kind, 'comando');
});

test('un JSON senza titolo prende comunque quello di ripiego', () => {
  const r = CA.parseTriage('{"tipo":"comando"}', chat().messages);
  assert.equal(r.kind, 'comando');
  assert.equal(r.title, 'Secondo te la coscienza è emergente?');
});

// ── Trascrizione mandata al classificatore ───────────────────────────────────

test('una chat corta va al classificatore intera, con chi ha detto cosa', () => {
  const t = CA.transcriptForTriage(chat().messages, 4000);
  assert.match(t, /^Utente: Secondo te la coscienza/);
  assert.match(t, /Filo: Dipende da cosa intendi/);
});

test('una chat lunghissima manda testa e coda, e dichiara il buco in mezzo', () => {
  const messages = [];
  for (let i = 0; i < 400; i++) {
    messages.push({ role: 'user', text: `domanda numero ${i} con del testo attorno` });
    messages.push({ role: 'filo', text: `risposta numero ${i} con del testo attorno` });
  }
  messages[0].text = 'PRIMA RIGA RICONOSCIBILE';
  messages[messages.length - 1].text = 'ULTIMA RIGA RICONOSCIBILE';
  const t = CA.transcriptForTriage(messages, 4000);
  assert.ok(t.length < 4500, `trascrizione fuori misura: ${t.length}`);
  assert.match(t, /PRIMA RIGA RICONOSCIBILE/);
  assert.match(t, /ULTIMA RIGA RICONOSCIBILE/);
  // Il taglio non è muto: senza questa riga «continua» sembra la fine.
  assert.match(t, /parte centrale della conversazione omessa/);
});

// ── Ricerca ──────────────────────────────────────────────────────────────────

test('la ricerca guarda dentro la conversazione, non solo nel titolo', () => {
  const c = chat({ title: 'Due chiacchiere' });
  assert.equal(CA.matches(c, 'coscienza'), true, 'la parola sta in un messaggio, non nel titolo');
  assert.equal(CA.matches(c, 'Due chiacchiere'), true);
  assert.equal(CA.matches(c, 'astronomia'), false);
});

test('la ricerca ignora maiuscole e accenti: si cerca come si scrive di fretta', () => {
  const c = chat({ messages: [{ role: 'user', text: 'Perché è così?' }] });
  assert.equal(CA.matches(c, 'perche'), true);
  assert.equal(CA.matches(c, 'PERCHÉ'), true);
  assert.equal(CA.matches(c, 'cosi'), true);
});

test('più parole = tutte devono esserci, in qualsiasi ordine', () => {
  const c = chat();
  assert.equal(CA.matches(c, 'coscienza emergente'), true);
  assert.equal(CA.matches(c, 'emergente coscienza'), true);
  assert.equal(CA.matches(c, 'coscienza astronomia'), false);
});

test('una ricerca vuota non nasconde niente', () => {
  assert.equal(CA.matches(chat(), ''), true);
  assert.equal(CA.matches(chat(), '   '), true);
});

test('il filtro per tipo e quello del "solo visibili" fanno cose diverse', () => {
  const list = [
    chat({ id: 'a', kind: 'conversazione' }),
    chat({ id: 'b', kind: 'comando' }),
    chat({ id: 'c', kind: null }),
  ];
  assert.deepEqual(CA.search(list, '').map((c) => c.id), ['a', 'b', 'c']);
  assert.deepEqual(CA.search(list, '', { kind: 'comando' }).map((c) => c.id), ['b']);
  // «Solo quelle in vista» tiene anche le non classificate: nel dubbio si vede.
  assert.deepEqual(CA.search(list, '', { onlyVisible: true }).map((c) => c.id), ['a', 'c']);
});

test('il frammento mostra il pezzo che combacia, non sempre l’inizio', () => {
  const c = chat({
    messages: [
      { role: 'user', text: 'Ciao' },
      { role: 'filo', text: `${'x '.repeat(200)}la coscienza fenomenica${' y'.repeat(200)}` },
    ],
  });
  const s = CA.snippetFor(c, 'fenomenica');
  assert.match(s, /coscienza fenomenica/);
  assert.ok(s.length < 250, `frammento troppo lungo: ${s.length}`);
  assert.ok(s.startsWith('…'), 'un frammento che comincia a metà lo dice');
});

test('senza query il frammento è l’inizio della chat', () => {
  assert.match(CA.snippetFor(chat(), ''), /^Secondo te la coscienza/);
});

// ── Voce d’elenco ────────────────────────────────────────────────────────────

test('la voce d’elenco non porta con sé i messaggi', () => {
  const e = CA.toIndexEntry(chat({ title: 'Coscienza', kind: 'conversazione' }));
  assert.equal(e.title, 'Coscienza');
  assert.equal(e.kind, 'conversazione');
  assert.equal(e.messageCount, 2);
  assert.equal('messages' in e, false, 'la lista non deve spedire le conversazioni intere');
  assert.match(e.excerpt, /coscienza/i);
});

test('una chat senza titolo mostra comunque qualcosa in elenco', () => {
  assert.equal(CA.toIndexEntry(chat()).title, 'Secondo te la coscienza è emergente?');
});

// ── Turni da salvare ─────────────────────────────────────────────────────────

test('le immagini incollate NON entrano nell’archivio, il loro numero sì', () => {
  const m = CA.toStoredMessage({ role: 'user', text: 'guarda', images: 2 });
  assert.equal(m.images, 2);
  assert.equal(m.role, 'user');
  // Un data URL da centinaia di KB per messaggio renderebbe l'archivio
  // illeggibile nel giro di poche settimane.
  assert.equal(JSON.stringify(m).length < 200, true);
});

test('di un’azione resta il tipo: serve a raccontare cosa Filo aveva fatto', () => {
  const m = CA.toStoredMessage({
    role: 'filo',
    text: 'Fatto.',
    actions: [{ type: 'SVEGLIA', ora: '07:00', _output: { enorme: 'x'.repeat(5000) } }],
  });
  assert.deepEqual(m.actions, ['SVEGLIA']);
  assert.ok(!JSON.stringify(m).includes('xxxxx'), 'l’esito di un’azione non va in archivio');
});

test('un turno senza azioni non porta un campo azioni vuoto', () => {
  const m = CA.toStoredMessage({ role: 'filo', text: 'Ciao' });
  assert.equal('actions' in m, false);
});

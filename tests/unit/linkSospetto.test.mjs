// Unit test per src/shared/linkSospetto.js — l'euristica sui link e, #725, le
// frasi con cui l'avviso arriva a chi legge: prima il menu mostrava il codice
// interno («⚠️ Link sospetto: typosquatting:paypal.com»).
// Logica pura → niente Electron, gira in millisecondi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

require(join(ROOT, 'src', 'shared', 'linkSospetto.js'));
const LS = globalThis.SN_LINK_SOSPETTO;

test('si registra su globalThis con la sua API', () => {
  assert.ok(LS, 'SN_LINK_SOSPETTO assente');
  for (const fn of ['analizza', 'frasi', 'avviso']) {
    assert.equal(typeof LS[fn], 'function', `manca ${fn}()`);
  }
});

test('riconosce il dominio-imitazione, l’azione a effetto e il codice nell’indirizzo', () => {
  assert.deepEqual(LS.analizza('https://paypa1.com/login'), ['typosquatting:paypal.com']);
  assert.ok(LS.analizza('https://esempio.it/unsubscribe').includes('side_effect'));
  assert.ok(LS.analizza('https://esempio.it/a?token=9f2ba71c4de80a13').includes('token_in_url'));
  assert.deepEqual(LS.analizza('non-un-indirizzo'), ['url_invalido']);
  // Il dominio vero, e un suo sottodominio, non sono sospetti.
  assert.deepEqual(LS.analizza('https://www.paypal.com/it'), []);
  assert.deepEqual(LS.analizza('https://pagamenti.paypal.com/'), []);
});

test('l’avviso è una frase, non un codice interno', () => {
  const avviso = LS.avviso(LS.analizza('https://paypa1.com/'));
  // Il successo per chi legge: capisce cosa non va senza sapere cos'è il
  // typosquatting, e vede il dominio che il link sta imitando.
  assert.ok(avviso.includes('paypal.com'), `l’avviso non nomina il dominio imitato: ${avviso}`);
  assert.ok(/imitazione/i.test(avviso), `l’avviso non dice che può essere un’imitazione: ${avviso}`);
  assert.ok(!/typosquatting|side_effect|token_in_url|url_invalido|_/.test(avviso),
    `l’avviso mostra ancora un codice interno: ${avviso}`);
  assert.match(avviso, /^⚠️ [A-Z’L]/, `l’avviso non è una frase: ${avviso}`);
  assert.match(avviso, /\.$/, `l’avviso non finisce con un punto: ${avviso}`);
});

test('ogni codice prodotto dall’euristica ha la sua frase', () => {
  // Se domani nasce un codice nuovo e nessuno scrive la frase, l'utente si
  // ritroverebbe di nuovo un avviso monco: qui i due elenchi si incrociano.
  const src = readFileSync(join(ROOT, 'src', 'shared', 'linkSospetto.js'), 'utf8');
  const codici = [...src.matchAll(/flags\.push\('([a-z_]+)'(?:\s*\+|\))/g)].map((m) => m[1]);
  const ritornati = [...src.matchAll(/return \['([a-z_]+)'\]/g)].map((m) => m[1]);
  const tutti = [...new Set([...codici, ...ritornati])];
  assert.ok(tutti.length >= 3, `mi aspetto ≥3 codici, trovati ${tutti.length}`);
  for (const c of tutti) {
    const f = LS.frasi([c]);
    assert.equal(f.length, 1, `il codice "${c}" non ha una frase per l’utente`);
    assert.ok(f[0].length > 20 && /\.$/.test(f[0]), `la frase di "${c}" non è una frase: ${f[0]}`);
  }
  assert.equal(LS.frasi(['typosquatting:paypal.com']).length, 1);
  assert.equal(LS.frasi(['marchio_imitato:Poste Italiane']).length, 1);
});

test('più avvisi insieme restano leggibili, e i casi vuoti non mostrano niente', () => {
  const codici = LS.analizza('https://paypa1.com/unsubscribe?token=9f2ba71c4de80a13');
  assert.ok(codici.length >= 3, `mi aspetto tre avvisi insieme, trovati ${codici.join(', ')}`);
  const avviso = LS.avviso(codici);
  assert.equal(avviso.split('⚠️').length, 2, 'un solo simbolo di avviso, in testa');
  assert.equal(LS.frasi(codici).length, codici.length, 'ogni codice porta la sua frase');

  assert.equal(LS.avviso([]), '');
  assert.equal(LS.avviso(null), '');
  assert.equal(LS.avviso(['codice_che_non_esiste']), '');
  assert.equal(LS.avviso([null, 42, {}]), '');
  // Un doppione non si ripete due volte.
  assert.equal(LS.frasi(['side_effect', 'side_effect']).length, 1);
});

test('l’euristica vive in un posto solo: actions.js la chiede qui', () => {
  const actions = readFileSync(join(ROOT, 'src', 'content', 'actions.js'), 'utf8');
  assert.ok(!/function analyzeLinkSuspicious/.test(actions),
    'la copia dell’euristica è tornata in actions.js: due copie divergono in silenzio');
  assert.match(actions, /SN_LINK_SOSPETTO/, 'actions.js non usa più il modulo condiviso');
  // L'avviso lo mostra il menu prima di chiamare il modello: se un giorno
  // tornasse dentro il ramo dello streaming, un provider caduto lo farebbe
  // sparire e il link sospetto passerebbe in silenzio.
  const mount = actions.slice(actions.indexOf('function buildInlineExplainLink'));
  assert.ok(mount.indexOf('LinkSospetto.avviso') < mount.indexOf('port.onMessage'),
    'l’avviso sul link sospetto viene mostrato solo insieme alla risposta del modello');
});

test('un parametro che si chiama come una chiave ma non lo è non fa scattare l’avviso', () => {
  // #725 — il nome da solo accusava di portare una chiave d'accesso i link di
  // tutti i giorni: il segnatempo di un video, il contatore anti-cache. Il
  // successo per chi legge è non vedere niente di rosso su un link normale, così
  // che l'avviso conti ancora quando compare.
  const normali = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
    'https://youtu.be/dQw4w9WgXcQ?t=90',
    'https://esempio.it/articolo?t=1699999999999',
    'https://esempio.it/pagina?key=2',
    'https://esempio.it/lista?hash=1234567890123',
  ];
  for (const u of normali) {
    assert.ok(!LS.analizza(u).includes('token_in_url'), `avviso a sproposito su ${u}`);
    assert.ok(!/chiave/.test(LS.avviso(LS.analizza(u))), `l’avviso parla di chiavi su ${u}`);
  }
  // E il caso vero continua a scattare.
  for (const u of [
    'https://esempio.it/entra?sig=Ab3kZ9qX1p7LmN4r',
    'https://esempio.it/a?access_token=eyJhbGciOiJIUzI1NiJ9',
  ]) {
    assert.ok(LS.analizza(u).includes('token_in_url'), `nessun avviso su ${u}`);
  }
});

test('l’avviso non afferma più di quello che il controllo sa', () => {
  // Il controllo guarda l'indirizzo, non il sito: nessuna delle frasi può
  // dichiarare un fatto. Una che afferma trasforma ogni falso allarme in
  // un'accusa, e chi legge smette di crederci (#725).
  for (const c of ['side_effect', 'token_in_url', 'typosquatting:paypal.com', 'marchio_imitato:PayPal']) {
    const f = LS.frasi([c])[0];
    assert.match(f, /potrebbe|può|sembra/i, `la frase di "${c}" afferma invece di ipotizzare: ${f}`);
  }
});

test('gli indirizzi di tutti i giorni non vengono accusati di imitarne un altro', () => {
  // #725 — il confronto correva su TUTTO l'indirizzo con due lettere di
  // tolleranza fisse: così gitlab.com «imitava» github.com, ogni indirizzo di
  // una o due lettere «imitava» x.com e amazon.de «imitava» amazon.it. Un
  // avviso rosso sui link di ogni giorno smette di essere letto proprio quando
  // servirebbe. Il successo per chi legge è non vedere niente su questi.
  const innocenti = [
    'https://gitlab.com/gitlab-org/gitlab',
    'https://t.co/AbCdEf1234',
    'https://g.co/kgs/abc',
    'https://a.co/d/abcdef',
    'https://fb.com/pagina',
    'https://vk.com/id1',
    'https://3m.com/',
    'https://ge.com/',
    'https://amazon.de/dp/B00ABCDEF',
    'https://google.co/search?q=filo',
    'https://utente.github.io/blog/',
  ];
  for (const u of innocenti) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('un titolo che si chiama come un’azione non è un pulsante', () => {
  // #725 — bastava la parola isolata nell'indirizzo: la voce di enciclopedia
  // «Delete» diventava «aprirlo può bastare a eseguire qualcosa».
  for (const u of ['https://it.wikipedia.org/wiki/Delete', 'https://esempio.it/blog/Cancel']) {
    assert.ok(!LS.analizza(u).includes('side_effect'), `avviso a sproposito su ${u}`);
  }
  // L'azione vera continua a scattare, nel percorso e nella parte dopo il «?».
  for (const u of [
    'https://esempio.it/newsletter/unsubscribe',
    'https://esempio.it/logout',
    'https://esempio.it/azione?do=Confirm',
  ]) {
    assert.ok(LS.analizza(u).includes('side_effect'), `nessun avviso su ${u}`);
  }
});

test('le imitazioni vere continuano a farsi riconoscere', () => {
  // Il contrappeso del test qui sopra: stringere la tolleranza non deve
  // spegnere il controllo. Comprese le scritture con una lettera che ne vale
  // un'altra, che prima passavano o passavano per un pelo.
  const sosia = {
    'https://paypa1.com/login': 'paypal.com',
    'https://gooogle.com/': 'google.com',
    'https://amazn.com/': 'amazon.com',
    'https://arnazon.com/': 'amazon.com',
    'https://micros0ft.com/': 'microsoft.com',
    'https://linkedln.com/in/tizio': 'linkedin.com',
    'https://facebok.com/': 'facebook.com',
  };
  for (const [u, atteso] of Object.entries(sosia)) {
    assert.deepEqual(LS.analizza(u), ['typosquatting:' + atteso], `nessun avviso su ${u}`);
  }
});

// #725.8 — il menu conosceva quattordici nomi famosi e prendeva per vero un nome
// famoso su qualunque dominio di primo livello; il controllo all'apertura della
// pagina ne conosceva una quarantina, coi loro domini ufficiali. Adesso il
// giudizio sul marchio è uno solo, quello del controllo all'apertura.
const Pagina = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'engine.js'));
const { BRANDS } = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'brands.js'));

const IMITAZIONI_ITALIANE = {
  'https://poste.it.accesso-sicuro.net/login': 'Poste Italiane',
  'https://intesasanpaolo.com.accesso.net/': 'Intesa Sanpaolo',
  'https://unicredit-sicurezza.com/': 'UniCredit',
  'https://whatsapp-web.com.accesso.net/': 'WhatsApp',
  'https://bancoposta-online.com/': 'Poste Italiane',
  'https://paypal.support/': 'PayPal',
  'https://netflix.top/': 'Netflix',
  'https://amazon.shop/': 'Amazon',
};

test('le imitazioni di Poste, banche e WhatsApp si fanno riconoscere dal menu del link', () => {
  // Il successo per chi legge: l'avviso c'è e nomina il marchio che il link
  // usa, così capisce di chi diffidare.
  for (const [u, marchio] of Object.entries(IMITAZIONI_ITALIANE)) {
    const avviso = LS.avviso(LS.analizza(u));
    assert.ok(avviso.includes(marchio), `nessun avviso che nomini ${marchio} su ${u}: «${avviso}»`);
    assert.match(avviso, /imitazione/i, `l’avviso su ${u} non dice che può essere un’imitazione`);
  }
});

test('un’imitazione somiglia al sito vero dello stesso Paese', () => {
  assert.deepEqual(LS.analizza('https://arnazon.it/'), ['typosquatting:amazon.it']);
  assert.deepEqual(LS.analizza('https://p0ste.it/'), ['typosquatting:poste.it']);
  assert.match(LS.avviso(LS.analizza('https://arnazon.it/')), /somiglia ad amazon\.it/);
});

test('il menu del link e l’avviso all’apertura della pagina danno lo stesso giudizio', () => {
  // La stessa pagina non può essere sospetta per uno e pulita per l'altro.
  const ufficiali = BRANDS.flatMap((b) => b.domains.map((d) => `https://${d}/`));
  const corpus = [
    ...Object.keys(IMITAZIONI_ITALIANE),
    ...ufficiali,
    'https://paypa1.com/login', 'https://gooogle.com/', 'https://arnazon.com/', 'https://youtub3.com/',
    'https://xn--80ak6aa92e.com/', 'https://tvvitter.com/', 'https://paypal-login.github.io/',
    'https://gitlab.com/gitlab-org/gitlab', 'https://utente.github.io/blog/', 'https://google.co/search?q=filo',
    'https://amazon.de/dp/B00ABCDEF', 'https://wa.me/393331234567', 'https://bancoposta.poste.it/',
    'https://esempio-tranquillo.test/articolo', 'http://127.0.0.1:8080/', 'https://it.wikipedia.org/wiki/PayPal',
  ];
  for (const u of corpus) {
    const menu = LS.analizza(u).some((c) => /^(typosquatting|marchio_imitato):/.test(c));
    const pagina = !!Pagina.evaluate(u).imp;
    assert.equal(menu, pagina, `${u}: menu ${menu ? 'sospetto' : 'pulito'}, apertura ${pagina ? 'sospetta' : 'pulita'}`);
  }
  for (const u of ufficiali) assert.deepEqual(LS.analizza(u), [], `avviso sul sito vero ${u}`);
});

test('l’elenco dei marchi è uno solo: il menu non ne tiene uno suo', () => {
  const src = readFileSync(join(ROOT, 'src', 'shared', 'linkSospetto.js'), 'utf8');
  assert.ok(!/POPULAR|'paypal\.com'|'amazon\.it'/.test(src),
    'linkSospetto.js ha di nuovo un suo elenco di siti famosi: i due controlli divergeranno');
});

test('l’avviso all’apertura della pagina riconosce le stesse imitazioni', () => {
  for (const u of Object.keys(IMITAZIONI_ITALIANE)) {
    assert.notEqual(Pagina.evaluate(u).level, 'safe', `nessun avviso all’apertura di ${u}`);
  }
});

// #725.8 giro 1 — col giudizio unico il menu ereditava i falsi allarmi dell'apertura: indirizzi ufficiali che
// l'elenco non conosceva e parole vere vicine a un marchio. All'apertura telegraph.co.uk o mail.com venivano bloccati.
const SITI_VERI = [
  'https://www.telegraph.co.uk/news/', 'https://www.cloud.it/', 'https://telegra.ph/pagina', 'https://revolut.me/mario',
  'https://apple.co/3abcdEf', 'https://telegram.me/filo', 'https://cdn.discordapp.com/attachments/1/2/foto.png',
  'https://www.aboutamazon.it/', 'https://www.postemobile.it/', 'https://www.nexigroup.com/', 'https://www.imposte.it/',
  'https://www.posterlounge.it/', 'https://www.post.ch/', 'https://www.posti.fi/', 'https://www.mail.com/',
  'https://www.email.it/', 'https://www.stream.it/', 'https://www.revolution.it/', 'https://www.pineapple.com/',
  'https://www.otherwise.com/', 'https://www.connexion.fr/', 'https://www.arubanetworks.com/', 'https://bnl.gov/',
  'https://www.google.com/url?q=https://www.poste.it/',
];

test('i siti veri con un nome vicino a un marchio non si prendono l’avviso, né nel menu né all’apertura', () => {
  for (const u of SITI_VERI) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito nel menu su ${u}`);
    assert.equal(Pagina.evaluate(u).level, 'safe', `avviso a sproposito all’apertura di ${u}`);
  }
});

test('una parola vera non copre il marchio attaccato accanto', () => {
  // Il contrappeso: la parola vale solo dove sta, non scavalca un trattino e non copre un secondo nome.
  for (const u of ['https://infoposte.net/', 'https://risposte-poste.com/', 'https://poste-rimborso.wordpress.com/',
    'https://ebay-login.com/', 'https://wise-transfer.com/', 'https://p-a-y-p-a-l.com/']) {
    assert.ok(LS.analizza(u).some((c) => /^(typosquatting|marchio_imitato):/.test(c)), `nessun avviso su ${u}`);
  }
});

test('ogni parola vera dell’elenco contiene un marchio o gli somiglia', () => {
  // Una parola che non tocca nessun marchio è peso morto; una che ne tocca uno lo spegne dove sta.
  const { PAROLE } = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'brands.js'));
  const { osaDistance } = require(join(ROOT, 'src', 'main', 'services', 'safebrowse', 'signals.js'));
  for (const w of PAROLE) {
    const tocca = BRANDS.some((b) => w.includes(b.token) || osaDistance(w, b.token) <= (b.token.length >= 8 ? 2 : 1));
    assert.ok(tocca, `«${w}» non contiene né somiglia a nessun marchio`);
  }
});

test('il nome attaccato ad altre parole in un sottodominio, o un indirizzo ufficiale intero, fa scattare l’avviso', () => {
  const casi = {
    'https://posteitaliane.it.accesso-sicuro.net/': 'Poste Italiane',
    'https://bancopostaonline.accesso.net/': 'Poste Italiane',
    'https://intesasanpaolomobile.accesso.net/': 'Intesa Sanpaolo',
    'https://unicreditonline.verifica.net/': 'UniCredit',
    'https://whatsappweb.accesso.net/': 'WhatsApp',
    'https://steamcommunity.com.accesso.net/': 'Steam',
    'https://login-microsoftonline-com.sicuro.net/': 'Microsoft',
    'https://office.com.accesso.net/': 'Microsoft',
    'https://x.com.accesso.net/': 'X (Twitter)',
  };
  for (const [u, marchio] of Object.entries(casi)) {
    assert.ok(LS.avviso(LS.analizza(u)).includes(marchio), `nessun avviso che nomini ${marchio} su ${u}`);
    assert.notEqual(Pagina.evaluate(u).level, 'safe', `nessun avviso all’apertura di ${u}`);
  }
});

test('le imitazioni degli enti, delle banche e dei corrieri italiani hanno l’avviso, i loro siti no', () => {
  const casi = {
    'https://inps-rimborso.com/': 'INPS', 'https://agenziaentrate-rimborsi.com/': 'Agenzia delle Entrate',
    'https://agenzia-entrate.info/': 'agenziaentrate.gov.it', 'https://aruba-rinnovo.com/': 'Aruba',
    'https://spid-accesso.com/': 'SPID', 'https://bper-sicurezza.com/': 'BPER Banca',
    'https://mediolanum-accesso.com/': 'Banca Mediolanum', 'https://fineco-sicurezza.com/': 'Fineco',
    'https://isybank-verifica.com/': 'Isybank', 'https://brt-spedizioni.info/': 'BRT',
    'https://telepass-pedaggi.com/': 'Telepass', 'https://gls-consegna.com/': 'GLS', 'https://dhl-pacco.com/': 'DHL',
    'https://bnl-sicurezza.com/': 'BNL', 'https://montepaschi-accesso.com/': 'Monte dei Paschi di Siena',
    'https://bancobpm-verifica.com/': 'Banco BPM',
  };
  for (const [u, marchio] of Object.entries(casi)) {
    assert.ok(LS.avviso(LS.analizza(u)).includes(marchio), `nessun avviso che nomini ${marchio} su ${u}`);
  }
  for (const u of ['https://www.inps.it/', 'https://www.agenziaentrate.gov.it/', 'https://www.aruba.it/', 'https://www.bper.it/',
    'https://www.bancamediolanum.it/', 'https://www.finecobank.com/', 'https://www.brt.it/', 'https://www.gls-italy.com/',
    'https://www.dhl.com/it-it/', 'https://www.telepass.com/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso sul sito vero ${u}`);
  }
});

test('un link che passa da un rinvio si giudica per dove porta', () => {
  // Il menu guardava solo il rinvio e taceva; l'apertura guarda l'indirizzo d'arrivo.
  const casi = {
    'https://www.google.com/url?q=https://poste.it.accesso-sicuro.net/': 'Poste Italiane',
    'https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fposte.it.accesso-sicuro.net%2F&data=x': 'Poste Italiane',
    'https://l.facebook.com/l.php?u=https%3A%2F%2Fpaypal.support%2F': 'PayPal',
  };
  for (const [u, marchio] of Object.entries(casi)) {
    assert.ok(LS.avviso(LS.analizza(u)).includes(marchio), `nessun avviso che nomini ${marchio} su ${u}`);
  }
  assert.deepEqual(LS.analizza('https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/mail/'), []);
});

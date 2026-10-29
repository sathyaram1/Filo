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
  assert.equal(LS.frasi(['nome_altrui:poste.it|accesso-sicuro.net']).length, 1);
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
  for (const c of ['side_effect', 'token_in_url', 'typosquatting:paypal.com', 'nome_altrui:paypal.com|accesso-sicuro.net']) {
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
    const menu = LS.analizza(u).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c));
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
// l'elenco non conosceva e parole vere che contengono un marchio.
const SITI_VERI = [
  'https://www.cloud.it/', 'https://telegra.ph/pagina', 'https://revolut.me/mario',
  'https://apple.co/3abcdEf', 'https://telegram.me/filo', 'https://cdn.discordapp.com/attachments/1/2/foto.png',
  'https://www.aboutamazon.it/', 'https://www.postemobile.it/', 'https://www.nexigroup.com/', 'https://www.imposte.it/',
  'https://www.posterlounge.it/', 'https://www.revolution.it/', 'https://www.pineapple.com/',
  'https://www.otherwise.com/', 'https://www.connexion.fr/', 'https://www.arubanetworks.com/', 'https://bnl.gov/',
  'https://www.google.com/url?q=https://www.poste.it/',
  // Giro 2: le pagine d'accesso dei gestori SPID accreditati e altri indirizzi ufficiali dei marchi.
  'https://spid.register.it/login/selfcare/login', 'https://spid.intesigroup.com/', 'https://loginspid.infocamere.it/',
  'https://spid.intesa.it/', 'https://www.intesa.it/', 'https://github.blog/changelog/', 'https://discordstatus.com/',
  'https://discord.gift/abc', 'https://www.dhlparcel.nl/nl', 'https://gls-us.com/', 'https://gls-spain.es/',
  // Giro 4: La Poste francese, le sedi nazionali di GLS e DHL.
  'https://www.laposte.fr/', 'https://www.laposte.net/', 'https://www.lapostemobile.fr/', 'https://gls-poland.com/',
  'https://www.gls-info.nl/', 'https://www.dhlecommerce.co.uk/',
  // Giro 5: il sito di Postepay; un nome corto (BPER, eBay) che sta dentro il nome di un altro sito.
  'https://www.postepay.it/', 'https://bperfectcosmetics.com/', 'https://www.thebay.com/',
  'https://urldefense.com/v3/__https://www.poste.it/__;!!AbC!x$', 'https://www.poste.it@www.poste.it/', 'https://mario.rossi@example.com/',
];

test('i siti veri con un nome vicino a un marchio non si prendono l’avviso, né nel menu né all’apertura', () => {
  for (const u of SITI_VERI) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito nel menu su ${u}`);
    assert.equal(Pagina.evaluate(u).level, 'safe', `avviso a sproposito all’apertura di ${u}`);
  }
});

// Decisione dell'owner (riallineamento a main): un nome a una lettera da un marchio, anche se è una parola vera, dà
// l'avviso che si chiude e non il blocco; regola in safebrowse/signals.js (#728).
test('un nome a una lettera da un marchio avvisa nel menu e all’apertura, senza bloccare', () => {
  for (const u of ['https://www.pcloud.com/', 'https://posteo.de/', 'https://www.posten.no/', 'https://www.post.ch/',
    'https://www.mail.com/', 'https://www.stream.it/', 'https://www.telegraph.co.uk/news/']) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('typosquatting:')), `nessun avviso nel menu su ${u}`);
    assert.equal(Pagina.evaluate(u).level, 'sospetto', `all’apertura di ${u}`);
  }
});

test('una parola vera non copre il marchio attaccato accanto', () => {
  // Il contrappeso: la parola vale solo dove sta, non scavalca un trattino e non copre un secondo nome.
  for (const u of ['https://accesso-poste.net/', 'https://risposte-poste.com/', 'https://poste-rimborso.wordpress.com/',
    'https://ebay-login.com/', 'https://wise-transfer.com/', 'https://p-a-y-p-a-l.com/',
    // Un nome corto conta attaccato alle parole da truffa, prima o dopo.
    'https://myebay-login.com/', 'https://secureebay.com/', 'https://inpsrimborso.com/', 'https://accessoinps.com/',
    'https://bperonline.com/']) {
    assert.ok(LS.analizza(u).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c)), `nessun avviso su ${u}`);
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
    // Giro 2: la destinazione nel percorso o codificata a modo suo (i collegamenti protetti di Proofpoint).
    'https://urldefense.com/v3/__https://poste.it.accesso-sicuro.net/login__;!!AbC123!xYz$': 'Poste Italiane',
    'https://urldefense.proofpoint.com/v2/url?u=https-3A__paypal.support_login&d=DwMFaQ&c=abc': 'PayPal',
    'https://web.archive.org/web/2020/https://netflix.top/': 'Netflix',
    'https://esempio.it/?next=%2Fvai%3Fu%3Dhttps%3A%2F%2Fpaypal.support': 'PayPal',
  };
  for (const [u, marchio] of Object.entries(casi)) {
    assert.ok(LS.avviso(LS.analizza(u)).includes(marchio), `nessun avviso che nomini ${marchio} su ${u}`);
  }
  assert.deepEqual(LS.analizza('https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/mail/'), []);
});

test('un indirizzo ufficiale prima della chiocciola non fa passare per vero il sito dopo', () => {
  // https://www.paypal.com@altro.net si legge come PayPal e porta ad altro.net: l'apertura guarda giustamente
  // solo il sito d'arrivo, il menu giudica il link com'è scritto.
  const casi = {
    'https://www.paypal.com@accesso-sicuro.net/login': 'PayPal',
    'https://www.poste.it:login@verifica-conto.net/': 'Poste Italiane',
    'https://login:www.paypal.com@evil.net/': 'PayPal',
    'https://www.paypal.com%2Flogin@evil.net/': 'PayPal',
    'https://paypa1.com@verifica-conto.net/': 'paypal.com',
    // Giro 3: una seconda chiocciola in codice dopo il nome non lo sposta.
    'https://www.poste.it%40verifica-conto.net@accesso-sicuro.net/': 'Poste Italiane',
    'https://www.paypal.com%40conto.net@accesso-sicuro.net/login': 'PayPal',
    'https://www.poste.it%2540conto.net@accesso-sicuro.net/': 'Poste Italiane',
  };
  for (const [u, marchio] of Object.entries(casi)) {
    assert.ok(LS.avviso(LS.analizza(u)).includes(marchio), `nessun avviso che nomini ${marchio} su ${u}`);
  }
  assert.deepEqual(LS.analizza('https://user:pass@example.com/'), []);
});

test('un gestore SPID usa il nome di SPID, non quello degli altri marchi', () => {
  // I gestori accreditati valgono solo per SPID: non entrano nella whitelist e non coprono un altro nome.
  assert.ok(LS.avviso(LS.analizza('https://paypal.register.it/')).includes('PayPal'));
  assert.ok(LS.avviso(LS.analizza('https://spid.accesso-sicuro.net/')).includes('SPID'));
  assert.ok(LS.avviso(LS.analizza('https://spid.gov.it.accesso.net/')).includes('SPID'));
});

// #725.8, decisione dell'owner: sui marchi entrati con questo lavoro un nome a una lettera dà l'avviso che si chiude
// con «Continua», e il blocco solo con un altro segnale. Sono siti veri: SAP Ariba, İş Bankası, banche portoghesi.
test('un nome a una lettera da un marchio nuovo avvisa, e blocca solo con un altro segnale', () => {
  const vicini = {
    'https://service.ariba.com/Supplier.aw': 'aruba.it', 'https://www.isbank.com.tr/': 'isybank.com',
    'https://www.bancobpi.pt/': 'bancobpm.it', 'https://www.bancobic.pt/': 'bancobpm.it', 'https://bancobmg.com.br/': 'bancobpm.it',
  };
  for (const [u, vero] of Object.entries(vicini)) {
    assert.match(LS.avviso(LS.analizza(u)), new RegExp('somiglia ad? ' + vero.replace(/\./g, '\\.')), `menu su ${u}`);
    assert.equal(Pagina.evaluate(u).level, 'sospetto', `all’apertura di ${u}`);
    assert.equal(Pagina.evaluate(u, { hasPassword: true }).level, 'pericoloso', `${u} che chiede la password`);
    assert.equal(Pagina.evaluate(u, {}, { ageDays: 3 }).level, 'pericoloso', `${u} registrato da tre giorni`);
    assert.equal(Pagina.evaluate(u, {}, { cert: { status: 'self_signed' } }).level, 'pericoloso', `${u} col certificato autofirmato`);
  }
  // I sosia fatti di lettere che si somigliano si bloccano da soli.
  for (const u of ['https://paypa1.com/', 'https://arnazon.it/', 'https://g00gle.com/']) {
    assert.equal(Pagina.evaluate(u).level, 'pericoloso', `${u} non più bloccato`);
  }
});

test('gli indirizzi da cui Steam distribuisce i file sono suoi, il nome di Steam altrove su quella rete no', () => {
  for (const u of ['https://steamuserimages-a.akamaihd.net/ugc/1234567890/ABCDEF0123456789/', 'https://steamcdn-a.akamaihd.net/apps/570/header.jpg']) {
    assert.deepEqual(LS.analizza(u), [], `avviso nel menu su ${u}`);
    assert.equal(Pagina.evaluate(u).level, 'safe', `avviso all’apertura di ${u}`);
  }
  assert.ok(LS.avviso(LS.analizza('https://steam-login.akamaihd.net/')).includes('Steam'));
  assert.ok(LS.avviso(LS.analizza('https://steamcdn-a.akamaihd.net@accesso-sicuro.net/')).includes('Steam'));
});

test('il nome vero c’è tutto, ma a comandare è un altro dominio', () => {
  // #725.2 — le forme delle mail di phishing: il nome del sito vero davanti a
  // un altro dominio, prima di una «@», o legato col trattino a un'altra parola.
  // Il successo per chi legge è vedere quale sito viene usato e dove porta.
  const casi = {
    'https://paypal.com.accesso-sicuro.net/login': ['paypal.com', 'accesso-sicuro.net'],
    'https://www.paypal.com.accesso-sicuro.net/': ['paypal.com', 'accesso-sicuro.net'],
    'https://paypal.com.verifica.co.uk/': ['paypal.com', 'verifica.co.uk'],
    'https://secure-paypal.com/': ['paypal.com', 'secure-paypal.com'],
    'https://paypal-com.net/': ['paypal.com', 'paypal-com.net'],
    'https://paypal.accesso-sicuro.net/': ['paypal.com', 'accesso-sicuro.net'],
    'https://www.paypal.com@accesso-sicuro.net/': ['paypal.com', 'accesso-sicuro.net'],
    'https://apple.com.id-verifica.net/': ['apple.com', 'id-verifica.net'],
    'https://login-microsoft.com/': ['microsoft.com', 'login-microsoft.com'],
  };
  for (const [u, [nome, dove]] of Object.entries(casi)) {
    const avviso = LS.avviso(LS.analizza(u));
    assert.ok(avviso.includes(nome) && avviso.includes(dove), `su ${u} l’avviso non nomina ${nome} e ${dove}: «${avviso}»`);
    assert.match(avviso, /potrebbe/, `su ${u} l’avviso afferma invece di ipotizzare: ${avviso}`);
  }
});

test('un nome scritto con lettere di un altro alfabeto si fa riconoscere', () => {
  // #725.2 — «раураl» in cirillico a schermo è «paypal»; nell'indirizzo viaggia
  // in punycode (xn--…), e così non somigliava a niente.
  const casi = {
    'https://раураl.com/': 'paypal.com',
    'https://xn--l-7sba6dbr.com/': 'paypal.com',
    'https://pаypal.com/signin': 'paypal.com',
    'https://аррӏе.com/': 'apple.com',
    'https://gооgle.com/': 'google.com',
    'https://ɡoogle.com/': 'google.com',
    'https://paypàl.com/': 'paypal.com',
  };
  for (const [u, atteso] of Object.entries(casi)) {
    assert.deepEqual(LS.analizza(u), ['omografo:' + atteso], `nessun avviso su ${u}`);
    const avviso = LS.avviso(LS.analizza(u));
    assert.ok(avviso.includes(atteso) && /lettere/.test(avviso), `l’avviso su ${u} non spiega il trucco: ${avviso}`);
  }
  // Un nome che mescola gli alfabeti senza imitare un sito noto resta sospetto.
  assert.deepEqual(LS.analizza('https://exаmple.com/'), ['alfabeto_ingannevole']);
  // E così un nome fatto solo di lettere che sembrano latine, sotto un dominio latino.
  assert.deepEqual(LS.analizza('https://сосо.com/'), ['alfabeto_ingannevole']);
  assert.ok(LS.frasi(['alfabeto_ingannevole'])[0].includes('alfabeto'));
});

test('i nomi scritti per intero in un’altra lingua, e i siti che usano un nome famoso di diritto, restano muti', () => {
  // Il contrappeso: stringere le maglie non deve far gridare al lupo su un
  // dominio russo, greco o tedesco, né sui siti che un nome famoso lo portano
  // davvero (i loro sottodomini, i domini ufficiali col trattino).
  const innocenti = [
    'https://пример.рф/', 'https://яндекс.рф/', 'https://münchen.de/', 'https://ελληνικά.gr/',
    'https://日本語.jp/', 'https://😀.com/', 'https://рост.рф/', 'https://сок.ru/', 'https://кот.bg/',
    'https://facebook.github.io/react/', 'https://microsoft.github.io/vscode/',
    'https://apple.stackexchange.com/questions/1', 'https://pineapple.com/',
    'https://appleinsider.com/', 'https://x-plane.com/', 'https://googleblog.com/', 'https://amazonaws.com/',
    'https://www.youtube-nocookie.com/embed/abc',
    'https://login.microsoftonline.com/', 'https://aws.amazon.com/', 'https://www.amazon.co.uk/',
    'https://utente:segreto@esempio.it/',
  ];
  for (const u of innocenti) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('ogni forma di imitazione ha la sua frase', () => {
  for (const c of ['omografo:paypal.com', 'nome_altrui:paypal.com|accesso-sicuro.net', 'alfabeto_ingannevole']) {
    const f = LS.frasi([c]);
    assert.equal(f.length, 1, `il codice "${c}" non ha una frase`);
    assert.ok(!/omografo|nome_altrui|alfabeto_ingannevole|\|/.test(f[0]), `la frase mostra un codice interno: ${f[0]}`);
    assert.match(f[0], /potrebbe/, `la frase di "${c}" afferma invece di ipotizzare: ${f[0]}`);
  }
  // Un codice monco non diventa una frase a metà.
  assert.deepEqual(LS.frasi(['nome_altrui:paypal.com', 'omografo:']), []);
});

test('la decodifica del punycode dà il nome che si legge a schermo', async () => {
  const { domainToASCII } = await import('node:url');
  for (const nome of ['раураl', 'münchen', 'пример', 'ελληνικά', 'bücher', 'аррӏе']) {
    const u = 'https://' + domainToASCII(nome + '.com') + '/';
    // Il nome decodificato è quello che il controllo vede: una delle lettere
    // cirilliche lo fa sospettare, una tedesca no.
    const attesoSospetto = ['раураl', 'аррӏе'].includes(nome);
    assert.equal(LS.analizza(u).length > 0, attesoSospetto, `decodifica sbagliata per ${nome} (${u})`);
  }
  // Un'etichetta punycode rotta non fa esplodere niente.
  for (const u of ['https://xn--zz-zzz.com/', 'https://xn--.com/', 'https://xn--99999999999.com/']) {
    assert.ok(Array.isArray(LS.analizza(u)));
  }
});

test('gli indirizzi che le aziende usano davvero non si prendono l’avviso, i loro inquilini sì', () => {
  // #725.2 — il nome da solo in un pezzo dell'indirizzo accusava la comunità di
  // PayPal, le immagini di Amazon e lo SharePoint di Microsoft: chi è il sito lo
  // dice l'elenco del controllo di navigazione, uno solo per i due controlli.
  for (const u of [
    'https://www.paypal-community.com/t5/Italia/ct-p/it',
    'https://m.media-amazon.com/images/I/81abc.jpg',
    'https://images-na.ssl-images-amazon.com/images/x.jpg',
    'https://microsoft.sharepoint.com/sites/news',
    'https://instagram.fmxp6-1.fna.fbcdn.net/v/t51.2885-15/x.jpg',
    'https://youtube.fandom.com/wiki/YouTube',
    'https://paypal.wikipedia.org/',
    'https://www.youtube-nocookie.com/embed/x',
    'https://c.amazon-adsystem.com/x.js',
  ]) {
    assert.deepEqual(LS.analizza(u), [], `falso allarme su ${u}`);
  }
  // Sulle piattaforme dove ognuno si prende il suo sottodominio il nome resta
  // di chi l'ha scritto, non dell'azienda.
  for (const u of [
    'https://paypal.sharepoint.com/',
    'https://paypal.com.s3.amazonaws.com/x',
    'https://paypal.com.vercel.app/',
    'https://paypal.wordpress.com/',
    'https://paypal.com@wikipedia.evil.net/',
  ]) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:paypal.com')), `nessun avviso su ${u}`);
  }
});

test('sui servizi dove ognuno apre il suo sito, il sito è di chi l’ha aperto', () => {
  // #725.2 — il menu divideva l'indirizzo con una regola sua e credeva che in
  // paypal-login.vercel.app comandasse Vercel: dove finisce il sito lo dice
  // l'elenco dei suffissi del controllo di navigazione.
  for (const [u, dove] of [
    ['https://paypal-login.vercel.app/', 'paypal-login.vercel.app'],
    ['https://secure-paypal.web.app/', 'secure-paypal.web.app'],
    ['https://paypal-secure.netlify.app/', 'paypal-secure.netlify.app'],
    ['https://paypal-login.github.io/', 'paypal-login.github.io'],
    ['https://netflix-account.herokuapp.com/', 'netflix-account.herokuapp.com'],
    ['http://paypal.com@192.168.1.1/login', '192.168.1.1'],
  ]) {
    const codici = LS.analizza(u);
    assert.ok(codici.some((c) => c.startsWith('nome_altrui:') && c.endsWith('|' + dove)), `su ${u}: ${codici}`);
    assert.ok(LS.avviso(codici).includes(dove), `l’avviso su ${u} non dice dove porta: ${LS.avviso(codici)}`);
  }
  assert.deepEqual(LS.analizza('https://paypa1.vercel.app/'), ['typosquatting:paypal.com']);
  // Lì il nome è una parola scelta da chi l'ha aperto: somigliare non basta.
  for (const u of ['https://apply.vercel.app/', 'https://ample.netlify.app/', 'https://googly.github.io/', 'https://amazon.com.mx/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
});

test('il nome vero col trattino si vede in ogni pezzo, non solo nel nome del sito', () => {
  // #725.2 — i pezzi davanti al sito si confrontavano solo interi: paypal-login.wixsite.com
  // e login-paypal.com.altro.net passavano, paypal.altro.net no.
  for (const [u, marchio] of [
    ['https://paypal-login.evil.com/', 'paypal.com'],
    ['https://secure-paypal.accesso-sicuro.net/', 'paypal.com'],
    ['https://login-paypal.com.evil.net/', 'paypal.com'],
    ['https://login-apple.com.evil.net/', 'apple.com'],
    ['https://apple-com.net/', 'apple.com'],
    ['https://paypal-login.wixsite.com/conto', 'paypal.com'],
    ['https://paypal-login.weebly.com/', 'paypal.com'],
    ['https://paypal-login.000webhostapp.com/', 'paypal.com'],
    ['https://paypal-login.ngrok.io/', 'paypal.com'],
    ['https://secure-paypal:x@evil.net/', 'paypal.com'],
  ]) {
    assert.ok(LS.analizza(u).some((c) => c.startsWith('nome_altrui:' + marchio + '|')), `nessun avviso su ${u}`);
  }
  // Le pagine ufficiali dei marchi sui servizi di pagine stanno nell'elenco dei loro domini.
  for (const u of ['https://google-research.github.io/', 'https://amazon-science.github.io/', 'https://google-developers.appspot.com/', 'https://instagram-engineering.com/', 'https://pineapple-com.net/']) {
    assert.deepEqual(LS.analizza(u), [], `avviso a sproposito su ${u}`);
  }
  assert.ok(LS.analizza('https://paypal-login.appspot.com/').some((c) => c.startsWith('nome_altrui:paypal.com')));
});

// #725.8 giro 6: google.com sta anche fra i domini di Gmail, e l'avviso diceva «usa il nome di Gmail (google.com)».
test('l’avviso nomina il marchio di cui il dominio è il sito principale, non un suo prodotto', () => {
  for (const [u, atteso] of [
    ['https://google-login.xyz/', 'Google (google.com)'],
    ['https://appleid-verify.com/', 'Apple (apple.com)'],
    ['https://microsoft-login.xyz/', 'Microsoft (microsoft.com)'],
    ['https://www.google.com@accesso-sicuro.net/', 'Google (google.com)'],
    ['https://icloud-verifica.com/', 'iCloud (icloud.com)'],
    ['https://gmail-accesso.com/', 'Gmail (gmail.com)'],
    ['https://office365-login.com/', 'Microsoft 365 (office.com)'],
    ['https://poste.it.accesso-sicuro.net/', 'Poste Italiane (poste.it)'],
  ]) {
    const testo = LS.avviso(LS.analizza(u));
    assert.ok(testo.includes(`usa il nome di ${atteso},`), `${u} → ${testo}`);
  }
});

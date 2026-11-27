// Unit test per src/shared/guardianoStatico.js — i controlli che fermano un
// avviso senza chiedere a nessun modello (#536).
//
// Si asserisce il SUCCESSO della difesa (la forma pericolosa viene fermata) E
// il suo rovescio, che qui conta uguale: un avviso onesto deve passare. Un
// guardiano che grida al lupo viene spento, quindi i falsi positivi sono un
// guasto quanto i falsi negativi.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'guardianoStatico.js'));

const G = globalThis.SN_GUARDIANO_STATICO;

describe('controlli statici — quello che non deve passare', () => {
  test('un codice usa e getta', () => {
    const r = G.controlla('Il tuo codice OTP è 483920: inseriscilo per continuare.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('un codice monouso chiamato per esteso', () => {
    const r = G.controlla('Il codice usa e getta 991122 serve per autorizzare il bonifico.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('un codice di recupero a blocchi', () => {
    const r = G.controlla('Conserva il codice di recupero A3F9-22KD-9911-BB0X.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('una password scritta per esteso', () => {
    const r = G.controlla('La password temporanea del tuo account è 7781gh22.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'codice');
  });

  test('una chiave riconoscibile dal prefisso', () => {
    const r = G.controlla('Ho trovato questo nel messaggio: sk-abcdefghijklmnopqrst1234.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'chiave');
  });

  test('un segreto che Filo custodisce, anche senza forma sospetta', () => {
    const r = G.controlla('Riepilogo: la stringa xyz-CHIAVE-SEGRETA-99 è nel messaggio.', {
      segreti: ['xyz-CHIAVE-SEGRETA-99'],
    });
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'segreto');
  });

  test('coordinate bancarie vere', () => {
    assert.equal(G.ibanValido('IT60X0542811101000000123456'), true);
    const r = G.controlla('Fai il bonifico su IT60X0542811101000000123456 entro oggi.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'iban');
  });

  test('il numero di una carta', () => {
    const r = G.controlla('Conferma la carta 4539 1488 0343 6467 per continuare.');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'carta');
  });

  test('un collegamento che dice un sito e porta a un altro', () => {
    const r = G.controlla('Accedi subito: [banca.it](https://banca.it.altrove.invalid/accedi)');
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'link');
  });

  test('lo stesso inganno passato come collegamento separato', () => {
    const r = G.controlla('Accedi subito.', {
      link: [{ etichetta: 'https://paypal.com', url: 'https://paypal.com.sicurezza.invalid/x' }],
    });
    assert.equal(r.blocca, true);
    assert.equal(r.regola, 'link');
  });
});

describe('controlli statici — quello che DEVE passare', () => {
  const innocui = [
    'Hai ricevuto una mail da Marco sulla riunione di domani alle 15.',
    'Il tuo ordine 1234567890 è in consegna oggi.',
    'La bolletta di settembre è di 84,30 euro, scade il 30.',
    'Tre nuove mail: due newsletter e una da tua sorella.',
    'La banca ti ha scritto: il conto è stato aggiornato.',
    'Riunione spostata alle 16:30, sala 2.',
    'Il volo AZ1234 del 12 ottobre è confermato.',
    '',
    '   ',
    '🙂🙂🙂',
    '<b>ciao</b> <script>alert(1)</script>',
    // La posta di tutti i giorni parla di codici in continuazione, e quasi mai
    // sono credenziali: qui il controllo statico non deve indovinare, perché
    // l'elenco delle cose che un codice apre non finisce mai. Queste frasi
    // sono tutte state fermate da una versione precedente della regola.
    'Il codice di accesso all\'appartamento è 4821, lo trovi nel messaggio di benvenuto.',
    'La cassetta delle chiavi si apre con il codice di accesso 3390.',
    'Il codice di conferma della prenotazione è 8823, presentalo alla reception.',
    'Il codice di sicurezza del cancello è 2210.',
    'Il codice di verifica della ricevuta è 4409, serve per il reso.',
    'Il codice di accesso al wifi è CASA2026.',
    'Per collegarti al wifi digita la password OSPITI24.',
    'Il pin del cancello è 7788.',
    'Il codice di attivazione della SIM è 9931.',
    'Articolo del 2023: come scegliere una password sicura.',
    'Nel 2024 sono trapelate milioni di password da un forum.',
    'Entro il 2026 dovrai cambiare la password del portale.',
    'Il codice dell\'ordine è 7712345, comunicalo all\'assistenza.',
    'Il codice del telepass è 4821, comunicalo al casello.',
    'Il codice 483920 è nei dettagli della consegna.',
    'Il codice del bonifico è 8823, inoltralo al commercialista.',
  ];
  for (const t of innocui) {
    test(`passa: ${JSON.stringify(t).slice(0, 50)}`, () => {
      assert.equal(G.controlla(t).blocca, false);
    });
  }

  test('un sottodominio del sito nominato non è un inganno', () => {
    const r = G.controlla('Apri [banca.it](https://accedi.banca.it/area) per vedere il saldo.');
    assert.equal(r.blocca, false);
  });

  test('una scritta che non nomina nessun sito non fa scattare niente', () => {
    const r = G.controlla('Guarda [qui](https://qualcosa.invalid/pagina).');
    assert.equal(r.blocca, false);
  });

  test('un segreto troppo corto non si confronta', () => {
    const r = G.controlla('la parola chiave è casa', { segreti: ['casa'] });
    assert.equal(r.blocca, false);
  });

  test('un testo lunghissimo senza forme pericolose passa', () => {
    const r = G.controlla('riepilogo della giornata. '.repeat(2000));
    assert.equal(r.blocca, false);
  });
});

describe('gli attrezzi del confronto fra indirizzi', () => {
  test('la scritta con le credenziali davanti non conta come sito', () => {
    assert.equal(G.hostDi('https://banca.it@altrove.invalid/x'), 'altrove.invalid');
  });
  test('il www non fa differenza', () => {
    assert.equal(G.stessoSito(G.hostNominato('www.banca.it'), G.hostDi('https://banca.it/')), true);
  });
  test('due siti diversi restano diversi', () => {
    assert.equal(G.stessoSito('banca.it', 'banca-it.invalid'), false);
  });
});

// #1403.8 — le etichette della password fuori dall'alfabeto latino, per quello che si legge e per quello che esce.
describe('le etichette non latine della password', () => {
  const ETICHETTE = ['пароль', 'Пароль', 'κωδικός', '密码', '密碼', 'パスワード', '비밀번호', 'كلمة المرور', 'סיסמה'];
  // I due punti larghi li scrivono cinese, giapponese e coreano.
  const LARGHI = ['密码', '密碼', 'パスワード', '비밀번호'];
  test('la password letta dopo un\'etichetta non latina entra nel registro dei letti, anche dopo i due punti larghi', () => {
    for (const e of [...ETICHETTE, 'κωδικός πρόσβασης']) {
      for (const t of [`${e}: Gatto2024!`, `Логин: ivan\n${e}: Gatto2024!`, ...(LARGHI.includes(e) ? [`${e}：Gatto2024!`] : [])]) {
        assert.ok(G.segretiNelTesto(t).some((x) => x.valore === 'Gatto2024!' && x.regola === 'password'), t);
      }
    }
  });
  test('quello che un\'azione porterebbe fuori dopo un\'etichetta non latina è una password, anche codificato nell\'indirizzo', () => {
    for (const e of ETICHETTE) {
      for (const t of [`${e}: Gatto2024!`, `${e}=Gatto2024`, `https://x.example/?q=${encodeURIComponent(`${e}: Gatto2024`)}`,
        ...(LARGHI.includes(e) ? [`${e}：Gatto2024`] : [])]) {
        assert.ok(G.segretiInUscita(t).some((x) => x.regola === 'password'), t);
      }
    }
  });
  test('l\'elenco sta solo in campiSegreti.js: la pagina che chiede la password, le uscite e gli indirizzi lo prendono da lì', () => {
    for (const f of ['content/safebrowseHints.js', 'shared/guardianoStatico.js', 'shared/urlExfil.js', 'shared/pavimento.js']) {
      const src = readFileSync(join(__dirname, '..', '..', 'src', ...f.split('/')), 'utf8');
      // «κωδικός ασφαλείας» è il nome greco del CVV (#2681), non un'etichetta della password.
      assert.doesNotMatch(src, /парол|κωδικ(?![^\n]{0,12}?ασφαλ)|密[码碼]|パスワード|비밀번호/, f);
      assert.match(src, /ETICHETTE_NON_LATINE/, f);
    }
  });
  test('una parola dopo l\'etichetta, un codice greco che non è la password e le parole che la contengono restano', () => {
    for (const t of ['пароль: неверный', 'Пароль: Обязательно', 'Ταχυδρομικός κωδικός: 10431', 'κωδικός παραγγελίας: AB12345',
      '密码学: 2024年课程', '암호화: AES256']) {
      assert.deepEqual(G.segretiInUscita(t).filter((x) => x.regola === 'password'), [], t);
      assert.deepEqual(G.segretiNelTesto(t).filter((x) => x.regola === 'password'), [], t);
    }
  });
  // «la password è …» nella sua lingua vale come in italiano; il valore finisce dove ricomincia la frase senza spazi.
  test('dopo il verbo che la annuncia nella sua lingua la password esce come password, ed è solo lei', () => {
    for (const t of ['我的密码是Kx82mPq9', '密码是 Kx82mPq9', 'パスワードは Kx82mPq9', 'パスワードはKx82mPq9です', '비밀번호는 Kx82mPq9',
      'كلمة المرور هي Kx82mPq9', 'הסיסמה היא Kx82mPq9', 'ο κωδικός πρόσβασης είναι Kx82mPq9', 'мой пароль это Kx82mPq9',
      '密码：Kx82mPq9，然后点击登录']) {
      assert.ok(G.segretiInUscita(t).some((x) => x.regola === 'password' && x.valore === 'Kx82mPq9'), t);
      assert.ok(G.segretiNelTesto(t).every((x) => x.valore === 'Kx82mPq9'), t);
    }
  });
  test('la frase cinese o giapponese dopo l\'etichetta non è una password', () => {
    for (const t of ['请输入密码：密码长度至少8位，包含字母和数字。忘记密码？点击这里重置。', '密码是什么？', '密码为空',
      'パスワード：8文字以上で英数字を含めてください。', 'パスワードはこちらから再設定できます', '비밀번호: 8자 이상, 영문과 숫자']) {
      assert.deepEqual(G.segretiInUscita(t).filter((x) => x.regola === 'password'), [], t);
    }
  });
  // 「『 stanno fra i segni larghi che chiudono il valore, ma lo aprono: staccate prima del taglio (giro 8).
  test('la password fra le virgolette ad angolo esce come password ed entra nel registro dei letti', () => {
    for (const [t, v] of [['password: 「Mela!Verde77」', 'Mela!Verde77'], ['la password è 「 Mela!Verde77 」', 'Mela!Verde77'],
      ['password: 『Mela!Verde77』', 'Mela!Verde77'], ['パスワードは「Kx82mPq9」です', 'Kx82mPq9'], ['パスワード：「Kx82mPq9」', 'Kx82mPq9'],
      ['密码：『Kx82mPq9』', 'Kx82mPq9']]) {
      assert.ok(G.segretiInUscita(t).some((x) => x.regola === 'password' && x.valore === v), `uscita: ${t}`);
      assert.ok(G.segretiNelTesto(t).some((x) => x.regola === 'password' && x.valore === v), `letti: ${t}`);
    }
  });
  // In arabo «e», «con», «per» si attaccano alla parola che segue: «وكلمة المرور» è «e la password».
  test('l\'etichetta araba con la congiunzione o la preposizione attaccata resta un\'etichetta', () => {
    for (const t of ['اسم المستخدم: ahmed وكلمة المرور: Gatto2024!', 'بكلمة المرور: Gatto2024!', 'ولكلمة المرور هي Gatto2024!']) {
      assert.ok(G.segretiInUscita(t).some((x) => x.regola === 'password' && x.valore === 'Gatto2024!'), `uscita: ${t}`);
      assert.ok(G.segretiNelTesto(t).some((x) => x.regola === 'password' && x.valore === 'Gatto2024!'), `letti: ${t}`);
    }
  });
});

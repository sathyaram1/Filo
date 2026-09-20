// Fa in modo che il doppio clic sul pacchetto Linux apra davvero Filo.
//
// PERCHÉ ESISTE
//   Chromium, il motore di Filo, all'avvio si chiude in una gabbia di
//   sicurezza che ha bisogno di un permesso del kernel: gli spazi dei nomi
//   utente non privilegiati. Dove quel permesso è negato ripiega su un
//   aiutante (`chrome-sandbox`) che deve appartenere a root ed essere marcato
//   setuid. Dentro un AppImage quel marchio non può esistere: il pacchetto si
//   monta al volo e i file nascono senza. Allora Chromium non ripiega su
//   niente: si ferma, stampa «No usable sandbox!» sul terminale e muore prima
//   di disegnare la finestra. Chi ha fatto doppio clic non vede niente.
//
//   Quel permesso è negato DI SERIE su Ubuntu dalla 23.10 in avanti (il
//   messaggio di Chromium nomina proprio quella), quindi su Ubuntu 24.04, che è
//   la versione che oggi si scarica dal sito di Ubuntu. Non è un caso raro: è
//   la macchina più probabile di chi prova Filo su Linux.
//
//   La voce di menu dentro il pacchetto il problema non ce l'ha: electron-
//   builder ci scrive `--no-sandbox` da sé. Ma quella riga vale solo per chi ha
//   integrato l'applicazione fra le altre. Il doppio clic sul file passa dal
//   lanciatore interno del pacchetto (`AppRun`), che esegue il programma senza
//   aggiungere niente. Due strade per aprire la stessa applicazione, e una
//   sola funzionava.
//
// COSA FA
//   Sposta il programma vero accanto, col suffisso `-bin`, e mette al suo posto
//   un lanciatore di tre righe che lo avvia aggiungendo `--no-sandbox`. AppRun
//   trova il nome che si aspetta, e da lì in poi tutte le strade (doppio clic,
//   file lanciato a mano, cartella estratta, voce di menu) partono nello stesso
//   modo.
//
// LA GABBIA SI TIENE DOVE IL SISTEMA LA LASCIA
//   Filo è un browser: apre siti qualunque, e la gabbia di Chromium è la
//   barriera fra quei siti e il resto del computer. Spegnerla per tutti quelli
//   che stanno su Linux, anche dove funziona benissimo, sarebbe pagare tutta la
//   difesa per il problema di una parte. Quindi il lanciatore guarda prima le
//   manopole del kernel che decidono la faccenda, e aggiunge `--no-sandbox`
//   SOLO dove dicono di no. Su Ubuntu 22.04, su Fedora, su Arch, su Debian,
//   Filo parte protetto come prima. Le manopole sono tre e sono tutte quelle
//   che portano a «No usable sandbox!»:
//     · apparmor_restrict_unprivileged_userns, la restrizione di Ubuntu 23.10+;
//     · user/max_user_namespaces a zero;
//     · unprivileged_userns_clone a zero, la forma vecchia di Debian e Arch.
//   Se un giorno Filo per Linux uscirà anche in un formato che si installa
//   davvero (un .deb), lì la gabbia regge sempre e il lanciatore non serve.

const fs = require('node:fs');
const path = require('node:path');

const SUFFISSO = '-bin';

// `exec -a` tiene il nome originale come nome del processo: senza, la finestra
// si presenterebbe al sistema come «Filo-bin» e non si aggancerebbe più alla
// sua icona nella barra delle applicazioni (è la riga StartupWMClass della voce
// di menu). AppRun è già uno script bash, quindi bash c'è di sicuro.
const LANCIATORE = (nome) => `#!/bin/bash
# Generato da scripts/after-pack-linux.js. Vedi lì il perché.
QUI="$(dirname "$(readlink -f "\${BASH_SOURCE[0]}")")"

# La gabbia di sicurezza di Chromium ha bisogno degli spazi dei nomi utente non
# privilegiati. Dove il sistema li nega, Chromium non parte affatto: lì, e solo
# lì, Filo si avvia senza la gabbia invece di non avviarsi.
manopola() { [ -r "$1" ] && cat "$1" 2>/dev/null; }
SENZA_GABBIA=()
if [ "$(manopola /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = "1" ] \\
  || [ "$(manopola /proc/sys/user/max_user_namespaces)" = "0" ] \\
  || [ "$(manopola /proc/sys/kernel/unprivileged_userns_clone)" = "0" ]; then
  SENZA_GABBIA=(--no-sandbox)
fi

exec -a "$QUI/${nome}" "$QUI/${nome}${SUFFISSO}" "\${SENZA_GABBIA[@]}" "$@"
`;

exports.default = async function afterPackLinux(context) {
  if (context.electronPlatformName !== 'linux') return;

  const nome = context.packager.executableName || 'filo';
  const programma = path.join(context.appOutDir, nome);
  const vero = path.join(context.appOutDir, nome + SUFFISSO);

  // Idempotente: se il lanciatore c'è già (una seconda passata sulla stessa
  // cartella), non si sposta niente una seconda volta.
  if (fs.existsSync(vero)) {
    console.log(`[after-pack-linux] lanciatore già al suo posto: ${programma}`);
    return;
  }
  if (!fs.existsSync(programma)) {
    throw new Error(`[after-pack-linux] non trovo il programma da avviare: ${programma}`);
  }

  fs.renameSync(programma, vero);
  fs.writeFileSync(programma, LANCIATORE(nome), { mode: 0o755 });
  fs.chmodSync(programma, 0o755);

  // Se il lanciatore non fosse eseguibile, o non nominasse il programma vero,
  // il pacchetto uscirebbe rotto e ce ne accorgeremmo dal tester. Si controlla
  // qui, dove il rosso costa poco.
  const scritto = fs.readFileSync(programma, 'utf8');
  if (!scritto.includes('--no-sandbox') || !scritto.includes(nome + SUFFISSO)) {
    throw new Error('[after-pack-linux] il lanciatore scritto non avvia il programma vero');
  }
  fs.accessSync(programma, fs.constants.X_OK);
  fs.accessSync(vero, fs.constants.X_OK);
  console.log(`[after-pack-linux] lanciatore installato: ${programma} → ${nome}${SUFFISSO} --no-sandbox`);
};

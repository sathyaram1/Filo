# Le automazioni le spinge solo l'owner, a mano

[← Tutti i pattern](../PATTERNS.md)

**La regola.** I file in `.github/workflows` li porta su GitHub solo l'owner, a mano, con una credenziale che usa
solo lui. Le credenziali con cui spingono le routine e il salvataggio automatico locale non devono poterlo fare
(decisione dell'owner, #1140). Un lavoro di routine che deve cambiare un'automazione si ferma e va ai lavori locali.

**Perché.** Un ramo spinto con un'automazione nuova la fa girare subito, senza fusione e senza cancello: non vede i
segreti dell'ambiente di rilascio, ma può chiedere `contents: write` e modificare una release vecchia ancora
modificabile. Il commit `365b6156e1` (un salvataggio automatico locale) mostra che le spinte automatiche portano anche
file di `.github/workflows`.

**Dove si chiude.** Nella credenziale: GitHub rifiuta da sé una spinta che cambia `.github/workflows` se la
credenziale non ha il permesso sulle automazioni (`workflow` per un token OAuth o classico, `workflows` per un'App o un
token a grana fine). Il resto è una rete che spiega:

- il salvataggio automatico (`.claude/hooks/auto-commit-merge.sh`) e il rilascio delle routine
  (`pushRamoCorrente` in `scripts/routine-channel.mjs`, con `scripts/lib/automazioni.mjs`) non spediscono un ramo i
  cui commit nuovi cambiano un'automazione, e dicono alla sessione cosa fare; riconoscono anche il rifiuto di GitHub.
  Una fusione conta solo per ciò che cambia rispetto a tutti i genitori: riallinearsi a main non ferma il ramo.
  Sentinelle: `tests/unit/autoCommitGateAutomazioni.test.mjs` e `tests/unit/routineChannelRilascio.test.mjs`;
- un `git push` scritto a mano non passa da queste reti: lo ferma solo la credenziale.

**Le credenziali (stato al 14/10/2026).**

- **Routine in cloud.** Spingono con la connessione GitHub di claude.ai, come l'owner. Con la Claude GitHub App il
  permesso c'è (l'App chiede «Workflows: read and write», e GitHub non lascia accettare solo una parte dei permessi di
  un'App): il 14/10 una spinta di prova con un file in `.github/workflows` è passata. Le regole di push per percorso
  (push ruleset, «Restrict file paths») esistono solo per i repo privati, e Filo è pubblico. La strada è collegare
  claude.ai con `/web-setup`, che manda il token stampato da `gh auth token` sulla macchina da cui lo lanci e prende il
  posto della connessione dal browser: se quel token non ha il permesso sulle automazioni, `/web-setup` avvisa e GitHub
  rifiuta quelle spinte. Quale token mandare lo sceglie l'owner: uno a grana fine solo per Filo e senza Workflows
  non apre altro ma scade; quello di `gh` non scade ma ha lo scope `repo` su tutti i suoi repo, `filo-security`
  compreso.
- **Salvataggio automatico locale.** Spinge con la credenziale di git della macchina dell'owner (`gh` come aiutante
  di credenziali, `gh auth setup-git`). Senza lo scope: `gh auth refresh -h github.com --remove-scopes workflow`.
- **L'owner.** Per le automazioni usa una credenziale a parte che non sta sul disco (un token a grana fine solo per
  Filo, con Contents e Workflows in scrittura, tenuto nel gestore di password), digitata a mano:
  `git -c credential.helper= push origin refs/heads/<ramo>:refs/heads/<ramo>`, il token come password. Oppure
  l'editor web di GitHub. Dopo la spinta, `npm run finish` come sempre.
- **Il cancello** fonde con la sua App: le automazioni già sul ramo le porta su main senza passare da qui.

**Da osservare.** Se GitHub giudicasse la spinta di un ramo che ha fuso main confrontando la punta vecchia con la nuova,
dopo un cambio di automazione su main anche un riallineamento verrebbe rifiutato. Le reti lo riconoscono e mandano il
lavoro in locale; se succede spesso, il riallineamento lo fa il server.

Vicino: [Due estremi verdi non fanno un filo](due-estremi-verdi-non-fanno-un-filo.md).

**Un worker che dura più di un paio di minuti Claude Code lo sposta da solo in
sottofondo**, e il lancio ti torna mentre lui lavora ancora: il gancio ti dice
che è **ancora vivo**, o Claude Code scrive che l'agente lavora in sottofondo.
Da lì non rilasci il suo biglietto, non lanci comandi sulla cartella, non
chiedi biglietti e non lanci altri worker: lo **vegli**, in primo piano, col
suo biglietto.

```bash
node scripts/routine-channel.mjs veglia <biglietto>
```

Ogni chiamata dura al massimo due minuti, e l'esito dice il passo dopo:

- **exit 5**: lavora ancora. Rilancia lo stesso comando, subito.
- **exit 0**: ha rilasciato il biglietto. Vai avanti come dopo «Worker finito».
- **exit 3**: era fermo da venti minuti senza segni di vita (di solito un
  permesso che in cloud nessuno approva). La veglia ha già rilasciato il suo
  biglietto dichiarando il guasto: chiudi il giro come dopo un guasto, senza
  rilanciarlo e senza rilasciare niente.
- **exit 1**: il comando è scritto male (il biglietto non è quello del worker):
  correggilo e rilancia.

Il passo dopo lo decide solo la veglia. La notifica di fine del worker non fa
ripartire niente: se arriva mentre vegli continua a vegliare, se arriva a giro
chiuso chiudi di nuovo senza fare altro.

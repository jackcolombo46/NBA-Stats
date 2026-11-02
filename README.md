# NBA Stats

Web app che stima le statistiche più probabili dei giocatori NBA nella prossima partita,
in base all'avversario. Funziona dal telefono e dal computer, senza installare nulla.

- **Giocatore**: cerchi un nome, l'app trova la prossima partita e stima punti, rimbalzi, assist,
  triple, rubate, stoppate, palle perse e P+R+A, con la probabilità di superare ogni soglia.
- **Squadra**: scegli una squadra e vedi chi è più probabile che faccia ogni statistica
  (anche tra gli avversari).
- Infortuni letti in tempo reale da ESPN: i giocatori "Out" vengono esclusi, gli altri segnalati.

## Come funziona

```
GitHub Actions (3 volte al giorno)        GitHub Pages
tools/update_data.py  ── ESPN ──►  docs/data/*.json  ──►  docs/index.html + model.js
                                                           (i calcoli girano nel browser)
```

- `tools/update_data.py` scarica da ESPN partite, box score, calendario dei prossimi 14 giorni,
  rose e infortuni. La prima volta scarica anche le 2 stagioni precedenti (circa 40 minuti),
  poi solo le partite nuove.
- `docs/model.js` è il modello: rendimento al minuto pesato sulle partite recenti × minuti attesi
  × ritmo della partita × quanto concede la difesa avversaria (per 100 possessi, rispetto alla
  media NBA) + precedenti diretti. Le probabilità usano una binomiale negativa.
- `docs/app.js` è l'interfaccia. All'apertura scarica direttamente da ESPN le partite finite
  dopo l'ultimo aggiornamento automatico, quindi i dati sono sempre aggiornati.

## Comandi utili

- Non serve aggiornare a mano: l'app recupera da sola le partite più recenti (pulsante **Ricarica**).
  L'aggiornamento automatico su GitHub serve a tenere leggero il caricamento.
- Gli aggiornamenti programmati si fermano se il repository resta senza attività per 60 giorni
  (es. in estate): basta riattivarli dalla tab Actions.

## Limiti

ESPN non ha un'API ufficiale: se cambia formato, `tools/update_data.py` va aggiornato.
Il modello non conosce scelte dell'allenatore, back-to-back e partite già decise.

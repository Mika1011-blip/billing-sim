# Démo billing-sim — script de voix off (français)

Durée cible : environ 1 min 45. Rythme parlé normal (≈ 140 mots/min). Les repères de temps correspondent au montage final ; chaque scène est séparée d'une seconde de silence pour laisser respirer l'image.

| # | Repère | Scène à l'écran | Voix off |
|---|---|---|---|
| 1 | 0:00 | Page Dev, saisie de la demande, clic sur Générer | Une banque décrit son besoin en quelques phrases. L'équipe lui répond par un scénario complet : les lots, les tickets, et un prix fixe par lot, calculé à partir du contrat. |
| 2 | 0:12 | Plan chargé, diagramme de Gantt prévu | Chaque ticket a une taille : S, M, L ou XL. La taille donne un nombre de jours, et le prix, c'est ce nombre de jours multiplié par le tarif journalier du profil. Rien n'est estimé à la main : tout découle du contrat signé. |
| 3 | 0:28 | Curseur temps : barres réelles, un blocage hachuré | Puis la réalité se déroule, jour après jour. Des tickets prennent plus de temps que prévu, un blocage apparaît. Le prix, lui, ne bouge pas : l'écart est absorbé par le prestataire. C'est le principe du forfait. |
| 4 | 0:42 | Page Client, jour 12 : tuiles, lot en cours, fiche ticket ouverte | Côté client, le tableau de bord suit le travail réellement fait. Pour chaque ticket : les étapes prévues, cochées au fur et à mesure, le journal quotidien, et les jours réels face aux jours facturés. |
| 5 | 0:56 | Jour 45 : carte de facture, détail (résumé, tickets, calcul HT → TVA → TTC) | À la livraison d'un lot, une facture est émise. Chaque ligne est justifiée : le résumé de ce qui a été livré, les tickets couverts, et le calcul complet, du hors-taxe jusqu'au TTC. |
| 6 | 1:10 | Clic sur « Marquer comme payée », les tuiles se mettent à jour | Le client règle la facture d'un clic. Le montant payé, le reste à payer et les retards se recalculent immédiatement. |
| 7 | 1:18 | Dernier jour : factures en rouge, tuile « En retard » | Ce qui n'est pas payé finit en retard, puis très en retard. Rien n'est caché : le client voit exactement où il en est. |
| 8 | 1:26 | Question à l'assistant, réponse avec citations, clic sur une citation | L'assistant répond aux questions du client avec les mêmes chiffres que le tableau de bord. Il ne calcule jamais un prix lui-même, et il cite ses sources : un clic sur une citation ouvre la fiche correspondante. |
| 9 | 1:40 | Retour au jour 20 : le paiement disparaît | Et l'on peut remonter le temps : la simulation rejoue l'histoire au jour choisi. Rien n'est inventé, tout est daté. |

## Texte seul (à coller dans ElevenLabs)

Une banque décrit son besoin en quelques phrases. L'équipe lui répond par un scénario complet : les lots, les tickets, et un prix fixe par lot, calculé à partir du contrat.

Chaque ticket a une taille : S, M, L ou XL. La taille donne un nombre de jours, et le prix, c'est ce nombre de jours multiplié par le tarif journalier du profil. Rien n'est estimé à la main : tout découle du contrat signé.

Puis la réalité se déroule, jour après jour. Des tickets prennent plus de temps que prévu, un blocage apparaît. Le prix, lui, ne bouge pas : l'écart est absorbé par le prestataire. C'est le principe du forfait.

Côté client, le tableau de bord suit le travail réellement fait. Pour chaque ticket : les étapes prévues, cochées au fur et à mesure, le journal quotidien, et les jours réels face aux jours facturés.

À la livraison d'un lot, une facture est émise. Chaque ligne est justifiée : le résumé de ce qui a été livré, les tickets couverts, et le calcul complet, du hors-taxe jusqu'au TTC.

Le client règle la facture d'un clic. Le montant payé, le reste à payer et les retards se recalculent immédiatement.

Ce qui n'est pas payé finit en retard, puis très en retard. Rien n'est caché : le client voit exactement où il en est.

L'assistant répond aux questions du client avec les mêmes chiffres que le tableau de bord. Il ne calcule jamais un prix lui-même, et il cite ses sources : un clic sur une citation ouvre la fiche correspondante.

Et l'on peut remonter le temps : la simulation rejoue l'histoire au jour choisi. Rien n'est inventé, tout est daté.

## Conseils ElevenLabs

- Voix française, style « narration posée » ; vitesse 0,95–1,0 ; stabilité ≈ 0,6.
- Générer les neuf paragraphes séparément (un fichier par scène) : le montage final a des durées de scène légèrement différentes de la première version, et des fichiers séparés se calent plus facilement.
- Prononciations : « TJM » se lit « té-ji-aime », « TTC » « té-té-cé », « HT » « hache-té », « S, M, L, XL » en lettres.

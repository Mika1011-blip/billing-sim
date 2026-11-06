"""French system prompt for plan generation. The contract is embedded so the model knows what the sizes mean."""

from __future__ import annotations

import json

from billing_sim.billing.policy import Contract

_CONTRACT_MARKER = "{{CONTRAT_JSON}}"

SYSTEM_PROMPT_FR = f"""Tu es le lead de l'équipe de développement d'une société de services qui réalise un projet logiciel au forfait.
À partir de la demande du client, tu construis le scénario du projet : l'équipe, les lots, les tickets et leurs aléas.

Contrat (JSON). Les tailles S/M/L/XL sont des nombres de jours (rate_card) et les profils sont dev, senior et architect (tjm) :
{_CONTRACT_MARKER}

Règles du plan (kind = "plan") :
- 2 à 4 lots, clés L1, L2, ... ; chaque lot a un nom et une description.
- 12 à 30 tickets, clés BANK-1, BANK-2, ... BANK-n, dans l'ordre, sans doublon.
- Chaque ticket a une taille (S, M, L ou XL) et un profil (dev, senior ou architect) ; ne donne JAMAIS de prix, de TJM, de tarif, de montant ni de nombre de jours, nulle part, y compris dans les titres et les descriptions : seulement la taille. Seule exception : duration_days des beats "blocked" (hors durée des beats blocked, aucun nombre de jours n'apparaît).
- lot_key d'un ticket : la clé d'un des lots. Un ticket hors lot a lot_key = null et charged_separately = true.
- depends_on ne référence que des tickets précédents (clé plus petite), jamais de cycle.
- 3 à 5 membres d'équipe, avec un prénom et un nom français et un profil (dev, senior ou architect).
- Aléas (beats d'un ticket) : au moins deux beats "blocked" sur l'ensemble du plan (duration_days entre 1 et 3, text = une raison concrète en français, par exemple un accès à l'environnement de recette en attente) et au moins un beat "review_changes" (le client demande des modifications après revue). Des beats "scope_note" sont possibles mais facultatifs.
- steps : pour chaque ticket, 2 à 8 étapes de travail concrètes, dans l'ordre, une phrase courte chacune (ce que le développeur fait réellement : créer, brancher, tester, documenter…), sans chiffre de jours ni de prix.
- delivery_summary : pour chaque lot, 2 à 4 phrases que le client, non technique, comprend : ce qu'il peut désormais faire grâce à ce lot ; pas de vocabulaire technique, pas de prix.
- Titres et descriptions en français, dans le domaine bancaire et financier de la demande ; product_summary résume le produit en une ou deux phrases.

Refus : si la demande ne contient aucun projet logiciel identifiable (salutations, charabia, intention vide), renvoie kind = "rejection" avec reason = une seule phrase en français qui explique pourquoi, et pas de plan.
Sinon, renvoie kind = "plan" avec le plan complet et pas de reason.
"""


def system_prompt_fr(contract: Contract) -> str:
    """The system prompt with the contract's JSON (rate card, TJM, ...) embedded."""
    return SYSTEM_PROMPT_FR.replace(_CONTRACT_MARKER, json.dumps(contract.to_dict(), sort_keys=True, ensure_ascii=False))

const CLASS_BY_STATUS: Record<string, string> = {
  // invoices (and a lot's invoice statut)
  'À venir': 'pill-a-venir',
  'À payer': 'pill-info',
  'En retard': 'pill-danger',
  'Très en retard': 'pill-danger-strong',
  'Payée': 'pill-ok',
  // tickets
  'À faire': 'pill-a-faire',
  'En cours': 'pill-en-cours',
  'En revue': 'pill-en-revue',
  'Bloqué': 'pill-bloque',
  'Terminé': 'pill-termine',
}

/** Status badge: the text is the statut itself, the class drives the colour. */
export function Pill({ statut }: { statut: string }) {
  return <span className={`pill ${CLASS_BY_STATUS[statut] ?? ''}`.trim()}>{statut}</span>
}

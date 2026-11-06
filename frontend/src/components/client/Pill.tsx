const CLASS_BY_STATUS: Record<string, string> = {
  // invoices / lots
  'À venir': 'pill-a-venir',
  'Émise': 'pill-emise',
  'Payée partiellement': 'pill-payee-partiellement',
  'Payée': 'pill-payee',
  'En retard': 'pill-en-retard',
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

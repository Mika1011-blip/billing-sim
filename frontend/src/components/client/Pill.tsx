const CLASS_BY_STATUS: Record<string, string> = {
  'À venir': 'pill-a-venir',
  'Émise': 'pill-emise',
  'Payée partiellement': 'pill-payee-partiellement',
  'Payée': 'pill-payee',
  'En retard': 'pill-en-retard',
}

/** Invoice status badge: the text is the statut itself, the class drives the colour. */
export function Pill({ statut }: { statut: string }) {
  return <span className={`pill ${CLASS_BY_STATUS[statut] ?? ''}`.trim()}>{statut}</span>
}

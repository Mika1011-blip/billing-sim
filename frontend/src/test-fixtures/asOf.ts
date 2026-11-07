import type { ClientTicket } from '../types'

/**
 * The snapshot's last-day ticket records as the client API sends them on an earlier date: a start or an end after
 * that date has not happened yet (`debut_reel` / `fin_reel` null, `statut` À faire / En cours). Only the dates and
 * the status are rewound; the plan dates and everything else are the API's own. The client snapshot has no
 * mid-run ticket list, so the chronology tests derive the day-23 one from it this way.
 */
export function ticketsAsOf(tickets: ClientTicket[], iso: string): ClientTicket[] {
  return tickets.map((t) => {
    if (t.debut_reel === null || t.debut_reel > iso) return { ...t, statut: 'À faire', debut_reel: null, fin_reel: null }
    if (t.fin_reel !== null && t.fin_reel > iso) return { ...t, statut: 'En cours', fin_reel: null }
    return t
  })
}

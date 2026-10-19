/**
 * Wat een bijwerking aan de lijst met spellen veranderde. Los van React, net
 * als lib/overview.ts: hier staat alleen wát "aangepast" betekent, het scherm
 * in Games.tsx toont het.
 */

import type { GameMeta } from './games'

/** De drie vormen die een regel kan hebben; ook de modifier van de badge. */
export type GameStatus = 'soon' | 'early' | 'released'

/**
 * Wat er aan een regel veranderd kan zijn. Genre, omschrijving en bronnen
 * tellen niet mee: Steam herschrijft die teksten geregeld, en ingeklapt staat
 * er niets van in de lijst. Waar je de lijst voor bijhoudt is de naam, de
 * releasevorm, de datum, en wat het web over de volgende datum zei.
 */
export type GameField = 'name' | 'status' | 'date' | 'planned'

/**
 * De kant van een regel die in het overzicht leest: voor en na. Niet het hele
 * spel — dit gaat mee de gedeelde staat in, en de omschrijving van Steam zou
 * daar per bijwerking een paar kilobyte in zetten die niemand teruglas.
 */
export type GameSide = {
  name: string
  earlyAccess: boolean
  comingSoon: boolean
  released: boolean
  releaseDate: string
  releaseAt: string | null
  fullRelease?: string
  fullReleaseAt?: string | null
}

/** Eén regel die anders is dan voor het bijwerken. */
export type GameChange = {
  id: string
  before: GameSide
  after: GameSide
  /** Altijd minstens één; een regel zonder verschil levert geen change op. */
  fields: GameField[]
}

/** Wat één bijwerking opleverde. */
export type GameUpdate = {
  /** Wanneer hij klaar was. */
  at: number
  /**
   * Hoeveel regels er opnieuw opgehaald zijn. Wat niet lukte telt niet mee:
   * die regel bleef staan zoals hij was, en de melding bij de knop zegt dat.
   */
  checked: number
  changes: GameChange[]
}

export function statusOf(game: GameSide): GameStatus {
  if (game.comingSoon) return 'soon'
  if (game.earlyAccess) return 'early'
  return 'released'
}

export function sideOf(game: GameMeta): GameSide {
  return {
    name: game.name,
    earlyAccess: game.earlyAccess,
    comingSoon: game.comingSoon,
    released: game.released,
    releaseDate: game.releaseDate,
    releaseAt: game.releaseAt,
    fullRelease: game.fullRelease,
    fullReleaseAt: game.fullReleaseAt,
  }
}

/**
 * De datum zoals de regel hem toont: de hele datum als de bron er een gaf,
 * anders de tekst zelf. Vergelijken op wat er staat en niet op beide velden —
 * schrijft Steam "1 May, 2026" ineens anders terwijl de datum dezelfde blijft,
 * dan is dat geen wijziging om te melden.
 */
function dateOf(game: GameSide): string {
  return game.releaseAt ?? game.releaseDate
}

/** Hetzelfde voor wat het web over de volgende datum zei; leeg als er niets staat. */
function plannedOf(game: GameSide): string {
  return game.fullReleaseAt ?? game.fullRelease ?? ''
}

/** Waarin twee kanten van dezelfde regel verschillen; leeg is onveranderd. */
export function changedFields(before: GameSide, after: GameSide): GameField[] {
  const fields: GameField[] = []
  if (before.name !== after.name) fields.push('name')
  if (statusOf(before) !== statusOf(after)) fields.push('status')
  if (dateOf(before) !== dateOf(after)) fields.push('date')
  if (plannedOf(before) !== plannedOf(after)) fields.push('planned')
  return fields
}

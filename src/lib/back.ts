import { useEffect, useRef } from 'react'

/**
 * De terugknop van het toestel een stap terug laten doen in de app.
 *
 * De app heeft geen router: welk onderdeel openstaat en welke draad je leest
 * zijn gewone useState. Voor de browser is dat één pagina zonder geschiedenis,
 * dus sloot de terugknop meteen de hele app — ook als je alleen een mail
 * dichtsloeg.
 *
 * Hier staat een stapel van dingen die ongedaan gemaakt kunnen worden, met
 * precies één extra history-entry ervoor. Die entry staat er zolang de stapel
 * niet leeg is; hij is de klik die de terugknop opvangt. Is de stapel leeg,
 * dan is er niets te bewaken en sluit de terugknop de app zoals het hoort —
 * een app die je niet meer uit komt is erger dan het probleem.
 *
 * Niet de URL gebruiken: dan zou elk onderdeel een pad krijgen en zou een
 * herlaad ergens middenin openen, terwijl de app juist altijd hetzelfde begint.
 */

/** Wat de terugknop achtereenvolgens ongedaan maakt; achteraan ligt bovenop. */
const stack: (() => void)[] = []

/** Zoveel stappen onthouden we; daarna valt de oudste eraf. */
const MAX_DEPTH = 20

/** Staat onze entry in de geschiedenis? Het is er hooguit één. */
let guarded = false

/** Popstates die we zelf uitlokken, en die dus niets mogen sluiten. */
let ignore = 0

function guard() {
  if (guarded) return
  history.pushState({ appBack: true }, '')
  guarded = true
}

function unguard() {
  if (!guarded) return
  guarded = false
  ignore += 1
  history.back()
}

function onPopState() {
  if (ignore > 0) {
    ignore -= 1
    return
  }

  // Hiermee is onze entry verbruikt.
  guarded = false

  const close = stack.pop()
  if (!close) return

  close()
  // Ligt er nog iets onder, dan hebben we opnieuw een entry nodig.
  if (stack.length > 0) guard()
}

window.addEventListener('popstate', onPopState)

/**
 * Zet een stap op de stapel. Voor wat geen open-of-dicht toestand is maar een
 * sprong — van het ene onderdeel naar het andere.
 */
export function pushBack(close: () => void): void {
  stack.push(close)
  if (stack.length > MAX_DEPTH) stack.shift()
  guard()
}

/** Ging het via het scherm zelf dicht, dan hoeft de terugknop het niet meer. */
function dropBack(close: () => void): void {
  const index = stack.lastIndexOf(close)
  if (index >= 0) stack.splice(index, 1)
  if (stack.length === 0) unguard()
}

/**
 * Laat de terugknop deze laag sluiten zolang hij openstaat. `close` mag elke
 * render een andere functie zijn; alleen `active` zet iets in beweging.
 */
export function useBackLayer(active: boolean, close: () => void): void {
  const latest = useRef(close)
  latest.current = close

  useEffect(() => {
    if (!active) return

    const run = () => latest.current()
    pushBack(run)
    return () => dropBack(run)
  }, [active])
}

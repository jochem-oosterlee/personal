import { useLayoutEffect, type RefObject } from 'react'

/**
 * Laat een textarea meegroeien met wat erin staat in plaats van bij één regel
 * te blijven en de tekst weg te schuiven.
 *
 * De hoogte gaat eerst terug naar `auto`: anders meet `scrollHeight` de vorige
 * hoogte mee en krimpt het veld nooit meer als je tekst weghaalt.
 *
 * `offsetHeight - clientHeight` is de randdikte. Met `box-sizing: border-box`
 * telt een hairline mee in de hoogte, dus zonder die correctie valt de laatste
 * regel er net buiten bij een veld met een rand.
 *
 * De schuifbalk gaat pas aan als een `max-height` de gevraagde hoogte afkapt.
 * `scrollHeight` is afgerond op hele pixels en de regelhoogte niet, dus met
 * `overflow: auto` zou een halve pixel tekort al een schuifbalk laten opdoemen
 * in een veld dat er precies omheen past.
 *
 * Diezelfde afronding zette een veld van één regel net naast de hoogte uit het
 * blad: `--control-h` valt op een breukdeel van een pixel — de wortelgrootte is
 * zelf een `clamp()` — en een hoogte in hele pixels erbovenop legde de
 * onderrand een pixel lager dan die van de + ernaast. Past de tekst binnen wat
 * het blad al geeft, dan blijft de hoogte dus leeg en houdt het blad hem.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    element.style.height = 'auto'
    const height = element.scrollHeight + element.offsetHeight - element.clientHeight
    const natural = element.getBoundingClientRect().height
    element.style.height = Math.abs(height - natural) < 1 ? '' : `${height}px`
    element.style.overflowY = element.offsetHeight < height ? 'auto' : 'hidden'
  }, [ref, value])
}

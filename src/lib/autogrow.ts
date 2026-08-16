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
    element.style.height = `${height}px`
    element.style.overflowY = element.offsetHeight < height ? 'auto' : 'hidden'
  }, [ref, value])
}

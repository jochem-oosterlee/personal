/**
 * Boodschappen van een foto. De server praat met Claude — hier blijft alleen
 * het verzoek over, net als bij de actiepunten uit tekst.
 *
 * De foto wordt nergens bewaard: hij gaat mee in dit ene verzoek en is daarna
 * weg. Verkleinen gebeurt op het toestel, met `prepareImage`.
 */

import type { PreparedImage } from './images'

export async function extractGroceries(image: PreparedImage): Promise<string[]> {
  const response = await fetch('/api/extract-groceries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: { data: image.data, type: image.type } }),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`server antwoordde met ${response.status}`)

  const { items } = await response.json()
  return Array.isArray(items) ? items : []
}

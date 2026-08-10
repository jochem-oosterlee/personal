/**
 * Verkleint een screenshot voordat hij de leiding op gaat.
 *
 * Een telefoonschermafdruk is al gauw enkele megabytes, en dat is zonde van een
 * mobiele verbinding voor iets waar Claude alleen naar hoeft te kijken. Op deze
 * breedte blijft tekst in de afbeelding leesbaar, wat hier het hele punt is.
 */
const MAX_EDGE = 1600
const QUALITY = 0.82

export type PreparedImage = {
  /** Zonder de data:-prefix; de API verwacht kale base64. */
  data: string
  type: string
  name: string
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // In stukken, want één spread over een paar miljoen bytes blaast de
  // argumentenstack op.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas niet beschikbaar')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', QUALITY),
  )
  if (!blob) throw new Error('afbeelding kon niet worden omgezet')

  return {
    data: toBase64(await blob.arrayBuffer()),
    type: 'image/webp',
    name: file.name,
  }
}

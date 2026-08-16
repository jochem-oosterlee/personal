import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { pull, push, wipe } from './sync'

const PREFIX = 'personal:'

/** Every mounted hook per key, so writes reach siblings in this document too. */
const subscribers = new Map<string, Set<Dispatch<unknown>>>()

/** Leest een sleutel buiten een hook om. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/**
 * Schrijft een sleutel buiten een hook om: opslag, de hooks die er in dit
 * document op zitten, en de server. Dat laatste moet expliciet, want een lijst
 * die niet gemonteerd is heeft geen hook die het terugschrijft.
 */
export function writeStored(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  try {
    localStorage.setItem(PREFIX + key, raw)
  } catch {
    // Opslag geblokkeerd: dan alleen de hooks en de server.
  }
  for (const notify of subscribers.get(key) ?? []) notify(value)
  void push(key, raw)
}

export function storageKeys(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith(PREFIX))
}

export function exportAll(): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const full of storageKeys()) {
    try {
      data[full.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(full) as string)
    } catch {
      // Skip entries another tool wrote in a format we cannot parse.
    }
  }
  return data
}

/**
 * Async omdat de serverkant mee moet: een herlaad direct hierna zou een
 * lopende DELETE afbreken, en dan komt bij de volgende synchronisatie alles
 * terug wat je net wiste.
 */
export async function clearAll(): Promise<void> {
  for (const full of storageKeys()) localStorage.removeItem(full)
  await wipe()
}

/**
 * useState that survives reloads, and stays in sync with both other hooks on
 * the same key and other open tabs.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStored(key, initial))

  useEffect(() => {
    const forKey = subscribers.get(key) ?? new Set<Dispatch<unknown>>()
    subscribers.set(key, forKey)
    forKey.add(setValue as Dispatch<unknown>)

    return () => {
      forKey.delete(setValue as Dispatch<unknown>)
      if (forKey.size === 0) subscribers.delete(key)
    }
  }, [key])

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Quota exceeded or storage blocked — keep running with in-memory state.
    }

    // Siblings settle on the same reference, so React bails out of the
    // re-render instead of bouncing the update back.
    for (const notify of subscribers.get(key) ?? []) {
      if (notify !== (setValue as Dispatch<unknown>)) notify(value)
    }

    // Achter de API: schrijf de wijziging terug. Zonder API doet dit niets.
    void push(key, JSON.stringify(value))
  }, [key, value])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === PREFIX + key) setValue(readStored(key, initial))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // `initial` is only read as a fallback for corrupt data, so it is safe to skip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [value, setValue]
}

/**
 * Haalt de serverstaat binnen en zet hem in localStorage, waarna elke hook op
 * die sleutel bijwerkt. Bij het openen en bij terugkeer naar de voorgrond, dus
 * een lijst die je op je laptop aanpaste staat op je telefoon zodra je hem
 * openslaat.
 *
 * `onFirstPull` draait zodra de staat voor het eerst binnen is, of zodra
 * duidelijk is dat er geen API is. Een eenmalige verhuizing hoort dáárna te
 * gebeuren: eerder zou hij op verouderde gegevens werken en zou de
 * binnenkomende serverstaat het een tel later gewoon terugdraaien. Lukt het
 * ophalen niet, dan wacht het tot een volgende poging.
 */
export function startSync(onFirstPull?: () => void): () => void {
  function apply(key: string, raw: string) {
    try {
      if (localStorage.getItem(PREFIX + key) === raw) return
      localStorage.setItem(PREFIX + key, raw)
    } catch {
      // Opslag geblokkeerd: dan alleen de hooks bijwerken.
    }
    const parsed = JSON.parse(raw)
    for (const notify of subscribers.get(key) ?? []) notify(parsed)
  }

  let pending = onFirstPull

  function refresh() {
    if (document.visibilityState !== 'visible') return
    void pull(apply).then((fresh) => {
      if (!fresh) return
      const ready = pending
      pending = undefined
      ready?.()
    })
  }

  refresh()
  document.addEventListener('visibilitychange', refresh)
  return () => document.removeEventListener('visibilitychange', refresh)
}

import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

const PREFIX = 'personal:'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/**
 * useState that survives reloads and stays in sync with other open tabs.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => load(key, initial))

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Quota exceeded or storage blocked — keep running with in-memory state.
    }
  }, [key, value])

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === PREFIX + key) setValue(load(key, initial))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // `initial` is only read as a fallback for corrupt data, so it is safe to skip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return [value, setValue]
}

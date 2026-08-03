import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { usePersistentState } from './storage'

export type ThemePreference = 'system' | 'light' | 'dark'

/** Must match --bg in index.css for each scheme. */
const THEME_COLOR = { light: '#f6f1e7', dark: '#15130f' }

/**
 * Resolves the preference to a concrete scheme and pins it on <html>, so the
 * CSS only ever has to look at [data-theme].
 */
export function useTheme(): [ThemePreference, Dispatch<SetStateAction<ThemePreference>>] {
  const [preference, setPreference] = usePersistentState<ThemePreference>(
    'settings.theme',
    'system',
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    function apply() {
      const resolved =
        preference === 'system' ? (media.matches ? 'dark' : 'light') : preference

      document.documentElement.dataset.theme = resolved
      document.documentElement.style.colorScheme = resolved
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', THEME_COLOR[resolved])
    }

    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  return [preference, setPreference]
}

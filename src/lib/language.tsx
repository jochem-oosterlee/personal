import { createContext, useContext, useMemo } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { usePersistentState } from './storage'
import { translations } from './translations'
import type { Language, Translations } from './translations'

export type LanguagePreference = 'system' | Language

function systemLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('nl') ? 'nl' : 'en'
}

type LanguageContextValue = {
  preference: LanguagePreference
  setPreference: Dispatch<SetStateAction<LanguagePreference>>
  language: Language
  t: Translations
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = usePersistentState<LanguagePreference>(
    'settings.language',
    'system',
  )
  const language = preference === 'system' ? systemLanguage() : preference

  const value = useMemo<LanguageContextValue>(
    () => ({ preference, setPreference, language, t: translations[language] }),
    [preference, setPreference, language],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useLanguage must be used within a LanguageProvider')
  return context
}

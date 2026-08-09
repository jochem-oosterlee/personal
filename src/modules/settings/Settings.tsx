import { useEffect, useState } from 'react'
import { Download, Monitor, Moon, RefreshCw, Sun, Trash2 } from 'lucide-react'
import { clearAll, exportAll, storageKeys, usePersistentState } from '../../lib/storage'
import { DEFAULT_MODEL, MODELS } from '../../lib/models'
import type { ModelId } from '../../lib/models'
import { latestCommit } from '../../lib/version'
import type { ThemePreference } from '../../lib/theme'
import { useLanguage } from '../../lib/language'
import type { LanguagePreference } from '../../lib/language'
import './Settings.css'

type SettingsProps = {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}

export function Settings({ theme, onThemeChange }: SettingsProps) {
  const { preference: languagePreference, setPreference: setLanguagePreference, language, t } =
    useLanguage()
  const [confirming, setConfirming] = useState(false)
  const [model, setModel] = usePersistentState<ModelId>('settings.model', DEFAULT_MODEL)

  const THEMES: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { value: 'system', label: t.settings.themeSystem, Icon: Monitor },
    { value: 'light', label: t.settings.themeLight, Icon: Sun },
    { value: 'dark', label: t.settings.themeDark, Icon: Moon },
  ]

  const LANGUAGES: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t.settings.languageSystem },
    { value: 'nl', label: t.settings.languageNl },
    { value: 'en', label: t.settings.languageEn },
  ]

  const activeModel = MODELS.find((entry) => entry.id === model) ?? MODELS[0]

  // Wat dit toestel draait, tegenover wat er op main staat. Een deploy die
  // strandt laat die twee uit elkaar lopen zonder dat de app er iets van merkt.
  const [latest, setLatest] = useState<string | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)

  const running = __BUILD_VERSION__.split(' ')[1] ?? ''
  const behind = latest !== null && latest !== running

  useEffect(() => {
    let cancelled = false
    latestCommit()
      .then((sha) => {
        if (!cancelled) setLatest(sha)
      })
      .catch(() => {
        if (!cancelled) setCheckFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function refreshApp() {
    // Vraag de service worker eerst om te kijken of er een nieuwe build is;
    // zonder die stap herlaadt hij gewoon dezelfde gecachete versie.
    try {
      const registration = await navigator.serviceWorker?.getRegistration()
      await registration?.update()
    } catch {
      // Geen service worker of update mislukt — herladen kan alsnog helpen.
    }
    location.reload()
  }


  function exportData() {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = 'personal-backup.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function wipe() {
    // Wachten: de serverkant moet weg zijn vóór de herlaad, anders breekt die
    // de DELETE af en synchroniseert alles gewoon weer terug.
    await clearAll()
    // Every module holds its own state; a reload is the honest way to reset
    // all of them at once.
    location.reload()
  }

  return (
    <div className="settings">
      <section className="settings__group">
        <h2 className="settings__heading micro">{t.settings.theme}</h2>
        <div className="segmented" role="group" aria-label={t.settings.theme}>
          {THEMES.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              className={value === theme ? 'segment segment--active' : 'segment'}
              aria-pressed={value === theme}
              onClick={() => onThemeChange(value)}
            >
              <Icon size={14} strokeWidth={1.4} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__heading micro">{t.settings.language}</h2>
        <div className="segmented" role="group" aria-label={t.settings.language}>
          {LANGUAGES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={value === languagePreference ? 'segment segment--active' : 'segment'}
              aria-pressed={value === languagePreference}
              onClick={() => setLanguagePreference(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__heading micro">{t.settings.model}</h2>
        <div className="segmented" role="group" aria-label={t.settings.model}>
          {MODELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === model ? 'segment segment--active' : 'segment'}
              aria-pressed={entry.id === model}
              onClick={() => setModel(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <p className="settings__note">
          {activeModel.hint[language]}. {t.settings.modelNote}
        </p>
      </section>

      <section className="settings__group">
        <h2 className="settings__heading micro">{t.settings.data}</h2>
        <p className="settings__note">{t.settings.dataNote(storageKeys().length)}</p>

        <button className="settings__action" type="button" onClick={exportData}>
          <Download size={14} strokeWidth={1.4} aria-hidden="true" />
          {t.settings.exportJson}
        </button>

        {confirming ? (
          <div className="settings__confirm">
            <span>{t.settings.wipeConfirm}</span>
            <div className="settings__confirm-actions">
              <button
                className="settings__action settings__action--danger"
                type="button"
                onClick={wipe}
              >
                {t.settings.wipeYes}
              </button>
              <button
                className="settings__action"
                type="button"
                onClick={() => setConfirming(false)}
              >
                {t.settings.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="settings__action settings__action--danger"
            type="button"
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={14} strokeWidth={1.4} aria-hidden="true" />
            {t.settings.wipeAll}
          </button>
        )}
      </section>

      <section className="settings__version">
        <p className="settings__version-line">
          {t.settings.version} {__BUILD_VERSION__} —{' '}
          <span className={behind ? 'settings__version-flag' : undefined}>
            {checkFailed
              ? t.settings.versionOffline
              : latest === null
                ? t.settings.versionChecking
                : behind
                  ? t.settings.versionBehind(latest)
                  : t.settings.versionCurrent}
          </span>
        </p>

        {behind && (
          <div className="settings__version-actions">
            <button className="settings__action" type="button" onClick={refreshApp}>
              <RefreshCw size={14} strokeWidth={1.4} aria-hidden="true" />
              {t.settings.refreshApp}
            </button>


            <p className="settings__note">{t.settings.versionHint}</p>
          </div>
        )}
      </section>
    </div>
  )
}

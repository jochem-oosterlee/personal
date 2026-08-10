import { useEffect, useState } from 'react'
import { Download, Monitor, Moon, RefreshCw, Rocket, Sun, Trash2 } from 'lucide-react'
import { clearAll, exportAll, storageKeys, usePersistentState } from '../../lib/storage'
import { DEFAULT_MODEL, MODELS } from '../../lib/models'
import type { ModelId } from '../../lib/models'
import { checkVersion } from '../../lib/version'
import type { VersionState } from '../../lib/version'
import { applyUpdate } from '../../lib/update'
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
  const [state, setState] = useState<VersionState | { kind: 'checking' }>({
    kind: 'checking',
  })

  const running = __BUILD_VERSION__.split(' ')[1] ?? ''

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const result = await checkVersion(running)
        if (!cancelled) setState(result)
        return result.kind
      } catch {
        if (!cancelled) setState({ kind: 'unknown' })
        return 'unknown'
      }
    }

    // Blijven kijken zolang er iets openstaat: een deploy duurt zo'n drie
    // minuten, en dan zie je vanzelf dat verversen nu wél zin heeft in plaats
    // van dat je het zelf moet blijven proberen.
    let timer: number | undefined
    async function loop() {
      const kind = await check()
      if (cancelled || kind === 'current') return
      timer = window.setTimeout(loop, 15_000)
    }
    void loop()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [running])

  const [deploying, setDeploying] = useState(false)
  const [deployStarted, setDeployStarted] = useState(false)
  const [deployError, setDeployError] = useState('')

  // De deploy hangt aan een GitHub-webhook. Komt die niet aan, dan loopt main
  // vooruit op wat er draait en meldt niets dat.
  async function redeploy() {
    setDeploying(true)
    setDeployError('')
    try {
      const response = await fetch('/api/deploy', { method: 'POST' })
      if (!response.ok) throw new Error(await response.text())
      setDeployStarted(true)
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : t.wishes.unknownError)
    } finally {
      setDeploying(false)
    }
  }

  // Het ophalen en installeren duurt even; zonder deze staat is de knop een
  // dode klik en druk je nog een keer.
  const [refreshing, setRefreshing] = useState(false)

  async function refreshApp() {
    setRefreshing(true)
    await applyUpdate()
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
          <span className={state.kind !== 'current' ? 'settings__version-flag' : undefined}>
            {state.kind === 'unknown'
              ? t.settings.versionOffline
              : state.kind === 'checking'
                ? t.settings.versionChecking
                : state.kind === 'client-behind'
                  ? t.settings.versionBehind(state.commit)
                  : state.kind === 'server-behind'
                    ? t.settings.versionDeploying(state.commit)
                    : t.settings.versionCurrent}
          </span>
        </p>

        {/* Alleen de knop die op dit moment kán helpen. Allebei tonen leidde
            ertoe dat je op vernieuwen drukte terwijl de deploy nog liep. */}
        {state.kind === 'client-behind' && (
          <div className="settings__version-actions">
            <button
              className="settings__action"
              type="button"
              onClick={refreshApp}
              disabled={refreshing}
            >
              <RefreshCw size={14} strokeWidth={1.4} aria-hidden="true" />
              {refreshing ? t.settings.refreshing : t.settings.refreshApp}
            </button>
          </div>
        )}

        {state.kind === 'server-behind' && (
          <div className="settings__version-actions">
            <p className="settings__note">{t.settings.deployingHint}</p>

            <button
              className="settings__action"
              type="button"
              onClick={redeploy}
              disabled={deploying || deployStarted}
            >
              <Rocket size={14} strokeWidth={1.4} aria-hidden="true" />
              {deployStarted
                ? t.settings.redeployStarted
                : deploying
                  ? t.settings.redeploySending
                  : t.settings.redeploy}
            </button>

            {deployError && (
              <p className="settings__error" role="alert">
                {deployError}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

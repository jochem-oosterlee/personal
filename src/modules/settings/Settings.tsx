import { useState } from 'react'
import { Download, ExternalLink, Monitor, Moon, Sun, Trash2 } from 'lucide-react'
import { clearAll, exportAll, storageKeys, usePersistentState } from '../../lib/storage'
import { DEFAULT_MODEL, MODELS, NEW_TOKEN_URL } from '../../lib/github'
import type { ModelId } from '../../lib/github'
import type { ThemePreference } from '../../lib/theme'
import './Settings.css'

const THEMES: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'Systeem', Icon: Monitor },
  { value: 'light', label: 'Licht', Icon: Sun },
  { value: 'dark', label: 'Donker', Icon: Moon },
]

type SettingsProps = {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}

export function Settings({ theme, onThemeChange }: SettingsProps) {
  const [confirming, setConfirming] = useState(false)
  const [token, setToken] = usePersistentState('settings.githubToken', '')
  const [model, setModel] = usePersistentState<ModelId>('settings.model', DEFAULT_MODEL)

  const activeModel = MODELS.find((entry) => entry.id === model) ?? MODELS[0]

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

  function wipe() {
    clearAll()
    // Every module holds its own state; a reload is the honest way to reset
    // all of them at once.
    location.reload()
  }

  return (
    <div className="settings">
      <section className="settings__group">
        <h2 className="settings__heading micro">Thema</h2>
        <div className="segmented" role="group" aria-label="Thema">
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
        <h2 className="settings__heading micro">GitHub</h2>
        <p className="settings__note">
          Met een token maakt Wensen de issue direct aan. Zonder token opent de
          app de GitHub-pagina met alles vooringevuld. Het token blijft op dit
          apparaat en gaat alleen naar github.com.
        </p>

        <input
          className="settings__input"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value.trim())}
          placeholder="github_pat_…"
          aria-label="GitHub-token"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />

        <a
          className="settings__action"
          href={NEW_TOKEN_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} strokeWidth={1.4} aria-hidden="true" />
          Token aanmaken
        </a>
        <p className="settings__note">
          Kies "Only select repositories" → personal, en onder Permissions:
          Issues → Read and write.
        </p>
      </section>

      <section className="settings__group">
        <h2 className="settings__heading micro">Model voor wensen</h2>
        <div className="segmented" role="group" aria-label="Model voor wensen">
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
          {activeModel.hint}. Het model gaat mee in de issue; de workflow kiest
          het standaardmodel als het er niet in staat.
        </p>
      </section>

      <section className="settings__group">
        <h2 className="settings__heading micro">Gegevens</h2>
        <p className="settings__note">
          {storageKeys().length} sleutel(s) opgeslagen op dit apparaat. Er is geen
          backend — niets wordt gesynchroniseerd.
        </p>

        <button className="settings__action" type="button" onClick={exportData}>
          <Download size={14} strokeWidth={1.4} aria-hidden="true" />
          Exporteer als JSON
        </button>

        {confirming ? (
          <div className="settings__confirm">
            <span>Alles wissen? Dit kan niet ongedaan worden gemaakt.</span>
            <div className="settings__confirm-actions">
              <button
                className="settings__action settings__action--danger"
                type="button"
                onClick={wipe}
              >
                Ja, wissen
              </button>
              <button
                className="settings__action"
                type="button"
                onClick={() => setConfirming(false)}
              >
                Annuleren
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
            Wis alle gegevens
          </button>
        )}
      </section>
    </div>
  )
}

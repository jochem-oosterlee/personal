import { useState } from 'react'
import { Download, Monitor, Moon, Sun, Trash2 } from 'lucide-react'
import { clearAll, exportAll, storageKeys } from '../../lib/storage'
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

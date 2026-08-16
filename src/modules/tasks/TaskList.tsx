import { Checklist } from '../../components/Checklist'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'
import type { Translations } from '../../lib/translations'
import './TaskList.css'

type ScopeId = 'personal' | 'work'

type Scope = {
  id: ScopeId
  /**
   * Persoonlijk houdt de oude sleutel. Wat daaronder stond bleek werk en is
   * eenmalig naar Werk verhuisd — zie lib/migrations.ts.
   */
  storageKey: string
  label: (t: Translations) => string
}

const SCOPES: Scope[] = [
  { id: 'personal', storageKey: 'tasks.items', label: (t) => t.tasks.personal },
  { id: 'work', storageKey: 'tasks.work.items', label: (t) => t.tasks.work },
]

export function TaskList() {
  const { t } = useLanguage()
  const [scopeId, setScopeId] = usePersistentState<ScopeId>('tasks.scope', 'personal')

  const scope = SCOPES.find((entry) => entry.id === scopeId) ?? SCOPES[0]

  return (
    <Checklist
      // Remount per lijst: usePersistentState leest zijn sleutel bij het opzetten,
      // dus zonder dit zou de ene lijst over de andere heen geschreven worden.
      key={scope.id}
      storageKey={scope.storageKey}
      placeholder={t.tasks.placeholder}
      addLabel={t.tasks.addLabel}
      emptyText={t.tasks.emptyText}
      deadlines
      extract
      tabs={
        <div className="scopes" role="group" aria-label={t.tasks.scopeAria}>
          {SCOPES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === scope.id ? 'scope scope--active' : 'scope'}
              aria-pressed={entry.id === scope.id}
              onClick={() => setScopeId(entry.id)}
            >
              {entry.label(t)}
            </button>
          ))}
        </div>
      }
    />
  )
}

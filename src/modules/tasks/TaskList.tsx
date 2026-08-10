import { Checklist } from '../../components/Checklist'
import { useLanguage } from '../../lib/language'

export function TaskList() {
  const { t } = useLanguage()

  return (
    <Checklist
      storageKey="tasks.items"
      placeholder={t.tasks.placeholder}
      addLabel={t.tasks.addLabel}
      emptyText={t.tasks.emptyText}
      deadlines
      extract
    />
  )
}

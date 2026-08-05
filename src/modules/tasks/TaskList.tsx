import { Checklist } from '../../components/Checklist'

export function TaskList() {
  return (
    <Checklist
      storageKey="tasks.items"
      placeholder="Wat moet er gebeuren?"
      addLabel="Taak toevoegen"
      emptyText="Geen openstaande taken."
    />
  )
}

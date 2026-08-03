import { Checklist } from '../../components/Checklist'

export function ShoppingList() {
  return (
    <Checklist
      storageKey="shopping.items"
      placeholder="Wat heb je nodig?"
      addLabel="Boodschap toevoegen"
      emptyText="Je lijstje is leeg."
    />
  )
}

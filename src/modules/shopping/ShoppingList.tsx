import { Checklist } from '../../components/Checklist'
import { useLanguage } from '../../lib/language'

export function ShoppingList() {
  const { t } = useLanguage()

  return (
    <Checklist
      storageKey="shopping.items"
      placeholder={t.shopping.placeholder}
      addLabel={t.shopping.addLabel}
      emptyText={t.shopping.emptyText}
    />
  )
}

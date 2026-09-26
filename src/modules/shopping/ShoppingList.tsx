import { Checklist } from '../../components/Checklist'
import { useLanguage } from '../../lib/language'

/**
 * Het boodschappenlijstje: dezelfde lijst als Taken, maar zonder deadlines en
 * met een camera in plaats van een plakvak — een foto van een briefje, een
 * schap of een lege verpakking levert de regels aan.
 */
export function ShoppingList() {
  const { t } = useLanguage()

  return (
    <Checklist
      storageKey="shopping.items"
      placeholder={t.shopping.placeholder}
      addLabel={t.shopping.addLabel}
      emptyText={t.shopping.emptyText}
      photo
    />
  )
}

import { useState, type ComponentType, type ReactNode } from 'react'
import { Lightbulb, ListTodo, Settings2, ShoppingCart, StickyNote } from 'lucide-react'
import { useTheme } from './lib/theme'
import type { ThemePreference } from './lib/theme'
import { LanguageProvider, useLanguage } from './lib/language'
import type { Translations } from './lib/translations'
import { ShoppingList } from './modules/shopping/ShoppingList'
import { TaskList } from './modules/tasks/TaskList'
import { Notes } from './modules/notes/Notes'
import { Wishes } from './modules/wishes/Wishes'
import { Settings } from './modules/settings/Settings'
import './App.css'

type ModuleContext = {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
}

type Module = {
  id: string
  title: (t: Translations) => string
  Icon: ComponentType<{ size?: number; strokeWidth?: number }>
  render: (context: ModuleContext) => ReactNode
}

/** Add a module here and it shows up in the tab bar. */
const MODULES: Module[] = [
  { id: 'shopping', title: (t) => t.nav.shopping, Icon: ShoppingCart, render: () => <ShoppingList /> },
  { id: 'tasks', title: (t) => t.nav.tasks, Icon: ListTodo, render: () => <TaskList /> },
  { id: 'notes', title: (t) => t.nav.notes, Icon: StickyNote, render: () => <Notes /> },
  { id: 'wishes', title: (t) => t.nav.wishes, Icon: Lightbulb, render: () => <Wishes /> },
  {
    id: 'settings',
    title: (t) => t.nav.settings,
    Icon: Settings2,
    render: ({ theme, onThemeChange }) => (
      <Settings theme={theme} onThemeChange={onThemeChange} />
    ),
  },
]

function AppShell() {
  const [activeId, setActiveId] = useState(MODULES[0].id)
  const [theme, setTheme] = useTheme()
  const { t } = useLanguage()

  const active = MODULES.find((module) => module.id === activeId) ?? MODULES[0]

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title micro">{active.title(t)}</h1>
      </header>

      <main className="app__main">
        {active.render({ theme, onThemeChange: setTheme })}
      </main>

      <nav className="app__nav" aria-label={t.nav.aria}>
        {MODULES.map(({ id, title, Icon }) => (
          <button
            key={id}
            type="button"
            className={id === activeId ? 'tab tab--active' : 'tab'}
            aria-current={id === activeId ? 'page' : undefined}
            onClick={() => setActiveId(id)}
          >
            <Icon size={18} strokeWidth={id === activeId ? 1.6 : 1.25} />
            <span className="tab__label">{title(t)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <LanguageProvider>
      <AppShell />
    </LanguageProvider>
  )
}

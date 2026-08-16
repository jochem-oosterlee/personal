import { useRef, useState } from 'react'
import type { ComponentType, ReactNode, TouchEvent } from 'react'
import { Lightbulb, ListTodo, Settings2, StickyNote } from 'lucide-react'
import { useTheme } from './lib/theme'
import type { ThemePreference } from './lib/theme'
import { LanguageProvider, useLanguage } from './lib/language'
import type { Translations } from './lib/translations'
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

/** Hoe ver een veeg moet halen (px) voordat hij van onderdeel wisselt. */
const SWIPE_MIN_X = 56

function AppShell() {
  const [activeId, setActiveId] = useState(MODULES[0].id)
  const [theme, setTheme] = useTheme()
  const { t } = useLanguage()
  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  const activeIndex = Math.max(
    0,
    MODULES.findIndex((module) => module.id === activeId),
  )
  const active = MODULES[activeIndex]

  /**
   * Zijwaarts vegen loopt dezelfde volgorde af als de tabbalk, zonder rondgang:
   * bij het eerste en laatste onderdeel houdt het op, net als daar. Alleen
   * touch — met een muis is slepen tekstselectie.
   */
  function onTouchStart(event: TouchEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null

    // Slepen in een tekstveld verzet de cursor, en over een schermvullende
    // schermafdruk hoort de veeg bij die weergave, niet bij de tabbalk.
    if (
      event.touches.length !== 1 ||
      target?.closest('input, textarea, [role="dialog"]')
    ) {
      swipeStart.current = null
      return
    }

    swipeStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return

    const dx = event.changedTouches[0].clientX - start.x
    const dy = event.changedTouches[0].clientY - start.y

    // Schuin vegen is vrijwel altijd scrollen; alleen een duidelijk
    // horizontale haal telt.
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * 2) return

    const next = MODULES[activeIndex + (dx < 0 ? 1 : -1)]
    if (next) setActiveId(next.id)
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title micro">{active.title(t)}</h1>
      </header>

      <main className="app__main" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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

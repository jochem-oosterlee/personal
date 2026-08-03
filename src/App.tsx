import { useState, type ReactNode } from 'react'
import { ShoppingList } from './modules/shopping/ShoppingList'
import './App.css'

type Module = {
  id: string
  title: string
  icon: string
  render: () => ReactNode
}

/** Add a module here and the bottom nav appears automatically. */
const MODULES: Module[] = [
  { id: 'shopping', title: 'Boodschappen', icon: '🛒', render: () => <ShoppingList /> },
]

export default function App() {
  const [activeId, setActiveId] = useState(MODULES[0].id)
  const active = MODULES.find((module) => module.id === activeId) ?? MODULES[0]

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">{active.title}</h1>
      </header>

      <main className="app__main">{active.render()}</main>

      {MODULES.length > 1 && (
        <nav className="app__nav">
          {MODULES.map((module) => (
            <button
              key={module.id}
              type="button"
              className={module.id === activeId ? 'tab tab--active' : 'tab'}
              onClick={() => setActiveId(module.id)}
              aria-current={module.id === activeId}
            >
              <span className="tab__icon" aria-hidden="true">
                {module.icon}
              </span>
              {module.title}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

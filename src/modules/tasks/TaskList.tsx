import { useEffect, useState } from 'react'
import { Checklist } from '../../components/Checklist'
import './TaskList.css'

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
}

/** Today, rolled over at midnight so an app left open doesn't go stale. */
function useToday() {
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    let timer = 0

    function schedule() {
      window.clearTimeout(timer)
      const now = new Date()
      // Only swap the date object on an actual day change, so a resume in the
      // middle of the day doesn't re-render for nothing.
      setToday((current) =>
        current.toDateString() === now.toDateString() ? current : now,
      )

      const midnight = new Date(now)
      midnight.setHours(24, 0, 0, 0)
      timer = window.setTimeout(schedule, midnight.getTime() - now.getTime())
    }

    schedule()
    // Timers are throttled while the app sits in the background, so also
    // re-check whenever it comes back into view.
    document.addEventListener('visibilitychange', schedule)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [])

  return today
}

/** YYYY-MM-DD in local time — toISOString() would shift across midnight. */
function isoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function TaskList() {
  const today = useToday()

  return (
    <Checklist
      storageKey="tasks.items"
      placeholder="Wat moet er gebeuren?"
      addLabel="Taak toevoegen"
      emptyText="Geen openstaande taken."
      header={
        <time className="tasks__date" dateTime={isoDate(today)}>
          {today.toLocaleDateString('nl-NL', DATE_FORMAT)}
        </time>
      }
    />
  )
}

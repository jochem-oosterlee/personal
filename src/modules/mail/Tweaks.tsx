import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { SKIPS } from '../../lib/mail'
import type { SummarySkip } from '../../lib/mail'
import type { SummaryRule } from '../../lib/overview'
import { usePersistentState } from '../../lib/storage'
import { useLanguage } from '../../lib/language'

/**
 * Wat er wel en niet in mag: drie vaste vinkjes en je eigen regels. Eén
 * paneel voor de samenvatting én het overzicht — ze lezen dezelfde sleutels,
 * dus wat je hier zet geldt voor allebei.
 */
export function Tweaks() {
  const { t } = useLanguage()
  const [skip, setSkip] = usePersistentState<SummarySkip[]>('mail.summary.skip', [
    'promotions',
    'updates',
  ])
  const [rules, setRules] = usePersistentState<SummaryRule[]>('mail.summary.rules', [])
  const [draft, setDraft] = useState('')

  function toggleSkip(item: SummarySkip) {
    setSkip((current) =>
      current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
    )
  }

  function addRule() {
    const text = draft.trim()
    if (!text) return
    setRules((current) => [...current, { id: crypto.randomUUID(), text, on: true }])
    setDraft('')
  }

  function toggleRule(id: string) {
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, on: !rule.on } : rule)),
    )
  }

  function removeRule(id: string) {
    setRules((current) => current.filter((rule) => rule.id !== id))
  }

  return (
    <div className="summary__tweak">
      {SKIPS.map((item) => (
        <label key={item} className="summary__skip">
          <input
            className="tick-input"
            type="checkbox"
            checked={skip.includes(item)}
            onChange={() => toggleSkip(item)}
          />
          <span className="tick" aria-hidden="true">
            <Check size={11} strokeWidth={2.5} />
          </span>
          <span className="summary__skipName">{t.mail.skip[item]}</span>
        </label>
      ))}

      {rules.map((rule) => (
        <div key={rule.id} className="summary__rule">
          <label className="summary__skip">
            <input
              className="tick-input"
              type="checkbox"
              checked={rule.on}
              onChange={() => toggleRule(rule.id)}
            />
            <span className="tick" aria-hidden="true">
              <Check size={11} strokeWidth={2.5} />
            </span>
            <span className="summary__skipName">{rule.text}</span>
          </label>
          <button
            type="button"
            className="summary__remove"
            aria-label={t.mail.removeRule(rule.text)}
            onClick={() => removeRule(rule.id)}
          >
            <X size={13} strokeWidth={1.4} aria-hidden="true" />
          </button>
        </div>
      ))}

      <form
        className="summary__add"
        onSubmit={(event) => {
          event.preventDefault()
          addRule()
        }}
      >
        <input
          className="send__field"
          value={draft}
          maxLength={200}
          placeholder={t.mail.rulePlaceholder}
          aria-label={t.mail.ruleLabel}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="mail__icon"
          disabled={!draft.trim()}
          aria-label={t.mail.addRule}
        >
          <Plus size={14} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </form>

      <p className="summary__hint">{t.mail.instructionsHint}</p>
    </div>
  )
}

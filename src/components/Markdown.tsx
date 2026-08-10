import type { ReactNode } from 'react'
import './Markdown.css'

/**
 * Een kleine markdown-weergave voor wat Claude terugschrijft.
 *
 * Zijn antwoorden zijn markdown: koppen, opsommingen, `code`. Als platte tekst
 * lees je de tekens in plaats van de structuur. Een bibliotheek erbij zou voor
 * één tekstblok meer bundel kosten dan de rest van de app, dus dit dekt precies
 * wat er in die antwoorden voorkomt en laat de rest staan zoals het er staat.
 *
 * Er komt geen HTML aan te pas — alles wordt React-elementen — dus tekst uit een
 * antwoord kan nooit als opmaak van de app zelf gaan meedoen.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'rule' }

const FENCE = /^\s*```/
const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+(.*)$/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
/** Een vervolgregel van een opsommingspunt: ingesprongen, geen nieuw punt. */
const CONTINUATION = /^\s{2,}\S/

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  function flush() {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (FENCE.test(line)) {
      flush()
      const body: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (RULE.test(line)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }

    const item = BULLET.exec(line) ?? ORDERED.exec(line)
    if (item) {
      flush()
      const ordered = !BULLET.test(line)
      const last = blocks[blocks.length - 1]
      // Geneste punten worden één vlakke lijst; de tekst blijft heel, alleen
      // het niveau gaat verloren.
      if (last && last.kind === 'list' && last.ordered === ordered) last.items.push(item[1])
      else blocks.push({ kind: 'list', ordered, items: [item[1]] })
      continue
    }

    const last = blocks[blocks.length - 1]
    if (paragraph.length === 0 && last && last.kind === 'list' && CONTINUATION.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`
      continue
    }

    if (!line.trim()) {
      flush()
      continue
    }

    paragraph.push(line.trim())
  }

  flush()
  return blocks
}

/** `code` gaat voor, anders zouden sterretjes in een codefragment opmaak worden. */
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0

  for (const match of text.matchAll(INLINE)) {
    const start = match.index
    if (start > last) nodes.push(text.slice(last, start))
    last = start + match[0].length

    if (match[1] !== undefined) nodes.push(<code key={start}>{match[1]}</code>)
    else if (match[2] !== undefined) nodes.push(<strong key={start}>{match[2]}</strong>)
    else if (match[3] !== undefined) nodes.push(<em key={start}>{match[3]}</em>)
    else if (/^https?:\/\//i.test(match[5])) {
      nodes.push(
        <a key={start} href={match[5]} target="_blank" rel="noreferrer noopener">
          {match[4]}
        </a>,
      )
    } else {
      // Alleen http(s) wordt een link; de rest blijft staan zoals geschreven.
      nodes.push(match[0])
    }
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    // Een antwoord staat in een lijstitem, dus de koppen erin beginnen laag en
    // lopen niet dieper dan h6.
    case 'heading': {
      const content = renderInline(block.text)
      if (block.level <= 1) return <h3 key={key}>{content}</h3>
      if (block.level === 2) return <h4 key={key}>{content}</h4>
      if (block.level === 3) return <h5 key={key}>{content}</h5>
      return <h6 key={key}>{content}</h6>
    }
    case 'code':
      return <pre key={key}>{block.text}</pre>
    case 'rule':
      return <hr key={key} />
    case 'list':
      return block.ordered ? (
        <ol key={key}>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    default:
      return <p key={key}>{renderInline(block.text)}</p>
  }
}

export function Markdown({ text }: { text: string }) {
  return <div className="markdown">{parseBlocks(text).map(renderBlock)}</div>
}

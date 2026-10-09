/**
 * Human-readable pages, rendered on the server:
 *
 *   /                      every document
 *   /:doc                  → its first table
 *   /:doc/:table           records, with search, sorting and paging
 *   /:doc/:table/:id       one record
 */
import {
  cellValue,
  choice,
  ids,
  linkedTable,
  mediaUrlFor,
  plainValue,
  recordLabel,
  type Field,
  type MediaUrl,
  type Project,
  type RecordRow,
  type Table
} from './crow'
import { parseQuery, QueryError, runQuery } from './query'
import type { RequestContext } from './api'
import { tableOf } from './api'

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

class Html {
  constructor(readonly value: string) {}
  toString() {
    return this.value
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function render(value: unknown): string {
  if (value instanceof Html) return value.value
  if (Array.isArray(value)) return value.map(render).join('')
  if (value === null || value === undefined || value === false) return ''
  return escape(String(value))
}

/** Template tag: interpolations are escaped unless they're already Html. */
function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  return new Html(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''))
}

const enc = encodeURIComponent
const docHref = (doc: string) => `/${enc(doc)}`
const tableHref = (doc: string, table: Table) => `/${enc(doc)}/${enc(table.name)}`
const recordHref = (doc: string, table: Table, id: string) => `${tableHref(doc, table)}/${enc(id)}`

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const STYLE = `
:root {
  --bg: #fbfbfa; --panel: #ffffff; --text: #1f2328; --muted: #6b7280; --border: #e5e7eb;
  --accent: #2563eb; --row-hover: #f5f7fb; --chip-text: #1f2328;
  --c-gray: #e5e7eb; --c-red: #fecaca; --c-orange: #fed7aa; --c-amber: #fde68a; --c-green: #bbf7d0;
  --c-teal: #99f6e4; --c-blue: #bfdbfe; --c-indigo: #c7d2fe; --c-purple: #e9d5ff; --c-pink: #fbcfe8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111214; --panel: #18191c; --text: #e6e6e6; --muted: #9ca3af; --border: #2a2c31;
    --accent: #7aa2ff; --row-hover: #1f2126; --chip-text: #f3f4f6;
    --c-gray: #3f3f46; --c-red: #7f1d1d; --c-orange: #7c2d12; --c-amber: #78350f; --c-green: #14532d;
    --c-teal: #134e4a; --c-blue: #1e3a8a; --c-indigo: #312e81; --c-purple: #581c87; --c-pink: #831843;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header { padding: 14px 24px; border-bottom: 1px solid var(--border); background: var(--panel);
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
header .sep { color: var(--muted); }
header .brand { font-weight: 600; color: var(--text); }
main { padding: 24px; max-width: 1400px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 16px; }
.muted { color: var(--muted); }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tabs a { padding: 8px 12px; border-bottom: 2px solid transparent; color: var(--muted); }
.tabs a.active { color: var(--text); border-color: var(--accent); font-weight: 600; }
.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.toolbar input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--panel); color: var(--text); min-width: 240px; font: inherit; }
.scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th { font-weight: 600; white-space: nowrap; position: sticky; top: 0; background: var(--panel); }
th a { color: var(--text); }
tbody tr:hover { background: var(--row-hover); }
tbody tr:last-child td { border-bottom: none; }
td { max-width: 320px; }
td .clip { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
.chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; margin: 1px 4px 1px 0;
  background: var(--c-gray); color: var(--chip-text); white-space: nowrap; }
.thumb { height: 40px; max-width: 80px; object-fit: cover; border-radius: 4px; display: block; }
.stars { color: #f59e0b; letter-spacing: 1px; }
.pager { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
dl.record { display: grid; grid-template-columns: minmax(120px, 200px) 1fr; gap: 0; background: var(--panel);
  border: 1px solid var(--border); border-radius: 10px; margin: 0; }
dl.record dt, dl.record dd { padding: 10px 14px; border-bottom: 1px solid var(--border); margin: 0; }
dl.record dt { color: var(--muted); }
dl.record dd { white-space: pre-wrap; overflow-wrap: anywhere; }
dl.record img.full { max-width: 100%; max-height: 480px; border-radius: 6px; }
.meta { margin-top: 12px; font-size: 12px; }
@media (max-width: 640px) {
  main { padding: 16px; }
  dl.record { grid-template-columns: 1fr; }
  dl.record dt { border-bottom: none; padding-bottom: 0; }
}
`

function page(title: string, crumbs: Html, body: Html, status = 200): Response {
  const doc = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${new Html(STYLE)}</style>
</head>
<body>
<header><a class="brand" href="/">Crow</a>${crumbs}</header>
<main>${body}</main>
</body>
</html>`
  return new Response(doc.value, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export function notFoundPage(message: string): Response {
  return page('Not found', html``, html`<h1>Not found</h1><p class="muted">${message}</p><p><a href="/">All documents</a></p>`, 404)
}

const crumb = (href: string, label: string) => html`<span class="sep">/</span><a href="${href}">${label}</a>`

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatInstant(iso: unknown, withTime: boolean): string {
  const d = new Date(String(iso))
  if (Number.isNaN(d.getTime())) return String(iso ?? '')
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day
}

const chip = (name: string, color = 'gray') => html`<span class="chip" style="background:var(--c-${color})">${name}</span>`

function fieldValue(
  project: Project,
  doc: string,
  field: Field,
  record: RecordRow,
  media: MediaUrl,
  full: boolean
): Html {
  const raw = cellValue(field, record)
  if (raw === undefined || raw === null || raw === '') return html``
  switch (field.type) {
    case 'select': {
      const c = choice(field, raw)
      return c ? chip(c.name, c.color) : html``
    }
    case 'multiSelect':
      return html`${ids(raw).map((id) => {
        const c = choice(field, id)
        return c ? chip(c.name, c.color) : ''
      })}`
    case 'checkbox':
      return raw === true ? html`✓` : html``
    case 'rating': {
      const n = Math.max(0, Math.min(5, Number(raw) || 0))
      return html`<span class="stars" title="${n} of 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`
    }
    case 'date':
      return html`${String(raw).replace('T', ' ')}`
    case 'createdTime':
    case 'lastModifiedTime':
      return html`${formatInstant(raw, (field.dateFormat ?? '').includes('Time') || full)}`
    case 'url': {
      const url = String(raw)
      return /^https?:\/\//i.test(url) ? html`<a href="${url}" rel="noopener noreferrer" target="_blank">${url}</a>` : html`${url}`
    }
    case 'image': {
      const src = media(raw)
      if (!src) return html``
      return full ? html`<a href="${src}"><img class="full" src="${src}" alt=""></a>` : html`<img class="thumb" src="${src}" alt="" loading="lazy">`
    }
    case 'audio': {
      const src = media(raw)
      if (!src) return html``
      return full ? html`<audio controls preload="none" src="${src}"></audio>` : html`<a href="${src}">♪ Play</a>`
    }
    case 'video': {
      const v = raw as any
      const src = media(v?.url)
      if (!src) return html``
      const poster = media(v?.poster)
      if (full) return html`<video controls preload="none" src="${src}" ${poster ? html`poster="${poster}"` : ''} style="max-width:100%"></video>`
      return poster ? html`<a href="${src}"><img class="thumb" src="${poster}" alt="" loading="lazy"></a>` : html`<a href="${src}">▶ ${v?.name ?? 'Video'}</a>`
    }
    case 'attachment':
      return html`${(plainValue(field, record) as any[]).map((a, i) => {
        const src = media(a?.url)
        const sep = i > 0 ? (full ? html`<br>` : ', ') : ''
        return src ? html`${sep}<a href="${src}?download=1">${a?.name ?? 'file'}</a>` : ''
      })}`
    case 'relation': {
      const target = linkedTable(project, field)
      if (!target) return html``
      const byId = new Map(target.records.map((r) => [r.id, r]))
      return html`${ids(raw).map((id, i) => {
        const row = byId.get(id)
        if (!row) return ''
        return html`${i > 0 ? ', ' : ''}<a href="${recordHref(doc, target, id)}">${recordLabel(target, row)}</a>`
      })}`
    }
    case 'number':
      return html`${typeof raw === 'number' ? raw.toLocaleString('en-US', { maximumFractionDigits: 10 }) : String(raw)}`
    default:
      return full ? html`${String(raw)}` : html`<div class="clip">${String(raw)}</div>`
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export async function homePage(ctx: RequestContext): Promise<Response> {
  const docs: { name: string; project: Project }[] = []
  for (const name of await ctx.store.list()) {
    const project = await ctx.store.load(name).catch(() => null)
    if (project) docs.push({ name, project })
  }
  const body = docs.length
    ? html`<div class="scroll"><table>
        <thead><tr><th>Document</th><th>Tables</th><th class="num">Records</th><th>Updated</th></tr></thead>
        <tbody>${docs.map(
          ({ name, project }) => html`<tr>
            <td><a href="${docHref(name)}">${name}</a></td>
            <td>${project.tables.map(
              (t, i) => html`${i > 0 ? ', ' : ''}<a href="${tableHref(name, t)}">${t.name}</a>`
            )}</td>
            <td class="num">${project.tables.reduce((n, t) => n + t.records.length, 0).toLocaleString('en-US')}</td>
            <td class="muted">${formatInstant(project.updatedAt, true)}</td>
          </tr>`
        )}</tbody>
      </table></div>`
    : html`<p class="muted">No .crow documents in <code>${ctx.store.dir}</code>.</p>`
  return page('Crow documents', html``, body)
}

export async function documentPage(ctx: RequestContext): Promise<Response> {
  const doc = ctx.params.doc!
  const project = await ctx.store.load(doc)
  const first = project.tables[0]
  if (!first) return page(doc, crumb(docHref(doc), doc), html`<p class="muted">This document has no tables.</p>`)
  return Response.redirect(tableHref(doc, first), 302)
}

export async function tablePage(ctx: RequestContext): Promise<Response> {
  const doc = ctx.params.doc!
  const project = await ctx.store.load(doc)
  const table = tableOf(project, ctx.params.table!)
  const params = ctx.url.searchParams
  let result
  try {
    result = runQuery(table, parseQuery(table, params))
  } catch (err) {
    if (!(err instanceof QueryError)) throw err
    return page(table.name, crumb(docHref(doc), doc), html`<p class="muted">${err.message}</p>`, 400)
  }
  const media = mediaUrlFor('', doc)
  const sort = params.get('sort') ?? ''
  const q = params.get('q') ?? ''

  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    const s = next.toString()
    return `${tableHref(doc, table)}${s ? `?${s}` : ''}`
  }
  const sortLink = (field: Field) =>
    link({ sort: sort === field.name ? `-${field.name}` : sort === `-${field.name}` ? null : field.name, page: null })
  const sortMark = (field: Field) => (sort === field.name ? ' ↑' : sort === `-${field.name}` ? ' ↓' : '')

  const tabs = html`<nav class="tabs">${project.tables.map(
    (t) => html`<a href="${tableHref(doc, t)}" class="${t === table ? 'active' : ''}">${t.name}</a>`
  )}</nav>`

  const toolbar = html`<form class="toolbar" method="get">
    <input type="search" name="q" value="${q}" placeholder="Search ${table.name}…">
    ${sort ? html`<input type="hidden" name="sort" value="${sort}">` : ''}
    <span class="muted">${result.totalItems} ${result.totalItems === 1 ? 'record' : 'records'}</span>
  </form>`

  const rows = result.records.map(
    (record) => html`<tr>${table.fields.map((field, i) => {
      const value = fieldValue(project, doc, field, record, media, false)
      const cls = field.type === 'number' || field.type === 'rating' ? 'num' : ''
      if (i === 0) {
        const label = value.value === '' ? html`<span class="muted">Untitled</span>` : value
        return html`<td class="${cls}"><a href="${recordHref(doc, table, record.id)}">${label}</a></td>`
      }
      return html`<td class="${cls}">${value}</td>`
    })}</tr>`
  )

  const grid = table.fields.length
    ? html`<div class="scroll"><table>
        <thead><tr>${table.fields.map(
          (f) => html`<th><a href="${sortLink(f)}">${f.name}${sortMark(f)}</a></th>`
        )}</tr></thead>
        <tbody>${rows.length ? rows : html`<tr><td colspan="${table.fields.length}" class="muted">No records</td></tr>`}</tbody>
      </table></div>`
    : html`<p class="muted">This table has no fields.</p>`

  const pager =
    result.totalPages > 1
      ? html`<div class="pager">
          ${result.page > 1 ? html`<a href="${link({ page: String(result.page - 1) })}">← Previous</a>` : ''}
          <span class="muted">Page ${result.page} of ${result.totalPages}</span>
          ${result.page < result.totalPages ? html`<a href="${link({ page: String(result.page + 1) })}">Next →</a>` : ''}
        </div>`
      : html``

  return page(
    `${table.name} · ${doc}`,
    html`${crumb(docHref(doc), doc)}${crumb(tableHref(doc, table), table.name)}`,
    html`<h1>${doc}</h1>${tabs}${toolbar}${grid}${pager}`
  )
}

export async function recordPage(ctx: RequestContext): Promise<Response> {
  const doc = ctx.params.doc!
  const project = await ctx.store.load(doc)
  const table = tableOf(project, ctx.params.table!)
  const record = table.records.find((r) => r.id === ctx.params.id)
  if (!record) return notFoundPage(`No record "${ctx.params.id}" in "${table.name}".`)
  const media = mediaUrlFor('', doc)
  const title = recordLabel(table, record)
  return page(
    `${title} · ${table.name}`,
    html`${crumb(docHref(doc), doc)}${crumb(tableHref(doc, table), table.name)}${crumb(recordHref(doc, table, record.id), title)}`,
    html`<h1>${title}</h1>
      <dl class="record">${table.fields.map(
        (f) => html`<dt>${f.name}</dt><dd>${fieldValue(project, doc, f, record, media, true)}</dd>`
      )}</dl>
      <div class="meta muted">Created ${formatInstant(record.createdAt, true)} · Updated ${formatInstant(record.updatedAt ?? record.createdAt, true)}</div>`
  )
}

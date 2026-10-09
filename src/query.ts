/**
 * Record listing shared by the JSON API and the HTML pages:
 *
 *   where    JSON object of field name → value, like the crow CLI's --where:
 *            {"Status":"Done"} matches records whose Status is Done; a
 *            multi-valued field matches when it contains the value; null
 *            matches empty.
 *   q        case-insensitive text search across the record's values
 *   sort     comma-separated field names (or @createdAt/@updatedAt), `-` for
 *            descending; empty values always sort last
 *   page, perPage
 */
import { findField, plainValue, type Field, type RecordRow, type Table } from './crow'

export const DEFAULT_PER_PAGE = 50
export const MAX_PER_PAGE = 500

export class QueryError extends Error {}

export interface Query {
  where: [Field, unknown][]
  q: string
  sort: { desc: boolean; read: (r: RecordRow) => unknown }[]
  page: number
  perPage: number
}

export interface QueryResult {
  records: RecordRow[]
  page: number
  perPage: number
  totalItems: number
  totalPages: number
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** Text a record can be found by: shown values only, not ids or media urls. */
function searchText(field: Field, record: RecordRow): string {
  if (['relation', 'image', 'audio', 'video'].includes(field.type)) return ''
  const value = plainValue(field, record)
  if (field.type === 'attachment') return (value as any[]).map((a) => a?.name ?? '').join(' ')
  if (field.type === 'checkbox') return ''
  return Array.isArray(value) ? value.join(' ') : String(value ?? '')
}

export function parseQuery(table: Table, params: URLSearchParams): Query {
  const where: [Field, unknown][] = []
  const whereParam = params.get('where')
  if (whereParam) {
    let parsed: unknown
    try {
      parsed = JSON.parse(whereParam)
    } catch {
      throw new QueryError('where must be a JSON object, e.g. {"Status":"Done"}')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new QueryError('where must be a JSON object, e.g. {"Status":"Done"}')
    }
    for (const [name, expected] of Object.entries(parsed)) {
      const field = findField(table, name)
      if (!field) throw new QueryError(`No field named "${name}" in "${table.name}"`)
      where.push([field, expected])
    }
  }

  const sort = (params.get('sort') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((key) => {
      const desc = key.startsWith('-')
      const name = key.replace(/^[-+]/, '')
      if (name === '@createdAt') return { desc, read: (r: RecordRow) => r.createdAt }
      if (name === '@updatedAt') return { desc, read: (r: RecordRow) => r.updatedAt ?? r.createdAt }
      const field = findField(table, name)
      if (!field) throw new QueryError(`Can't sort by "${name}": no such field in "${table.name}"`)
      return { desc, read: (r: RecordRow) => plainValue(field, r) }
    })

  const int = (value: string | null, fallback: number) => {
    const n = Math.floor(Number(value ?? fallback))
    return Number.isFinite(n) ? n : fallback
  }
  return {
    where,
    q: (params.get('q') ?? '').trim().toLowerCase(),
    sort,
    page: Math.max(1, int(params.get('page'), 1)),
    perPage: Math.min(MAX_PER_PAGE, Math.max(1, int(params.get('perPage'), DEFAULT_PER_PAGE)))
  }
}

function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null) return isEmpty(actual)
  if (Array.isArray(actual)) return actual.some((v) => String(v) === String(expected))
  return String(actual) === String(expected)
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v))
  return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function runQuery(table: Table, query: Query): QueryResult {
  let records = table.records.filter(
    (r) =>
      query.where.every(([field, expected]) => matches(plainValue(field, r), expected)) &&
      (!query.q || table.fields.some((f) => searchText(f, r).toLowerCase().includes(query.q)))
  )
  if (query.sort.length > 0) {
    records = [...records].sort((a, b) => {
      for (const { desc, read } of query.sort) {
        const va = read(a)
        const vb = read(b)
        if (isEmpty(va) || isEmpty(vb)) {
          if (isEmpty(va) !== isEmpty(vb)) return isEmpty(va) ? 1 : -1
          continue
        }
        const c = compare(va, vb)
        if (c !== 0) return desc ? -c : c
      }
      return 0
    })
  }
  const { page, perPage } = query
  return {
    records: records.slice((page - 1) * perPage, page * perPage),
    page,
    perPage,
    totalItems: records.length,
    totalPages: Math.ceil(records.length / perPage)
  }
}

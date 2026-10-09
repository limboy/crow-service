/**
 * Reading `.crow` documents. Mirrors the parts of crow/src/shared/types.ts the
 * service needs; see crow/docs/crow-format.md for the full format.
 */

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'image'
  | 'audio'
  | 'video'
  | 'relation'
  | 'rating'
  | 'attachment'
  | 'createdTime'
  | 'lastModifiedTime'

export interface SelectChoice {
  id: string
  name: string
  color: string
}

export interface Field {
  id: string
  name: string
  type: FieldType
  options?: { choices: SelectChoice[] }
  relation?: { tableId: string; multiple: boolean; inverseFieldId?: string }
  dateFormat?: string
}

export interface RecordRow {
  id: string
  createdAt: string
  updatedAt?: string
  values: Record<string, unknown>
}

export interface View {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
}

export interface Table {
  id: string
  name: string
  fields: Field[]
  records: RecordRow[]
  views: View[]
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  tables: Table[]
}

/**
 * Accepts any version's `data.json`. Projects saved before multi-table
 * support keep fields/records/views at the top level; they become one table
 * named after the project, as the app does.
 */
export function migrateProject(raw: any): Project {
  const tables = Array.isArray(raw.tables)
    ? raw.tables
    : [{ id: 'table', name: raw.name?.trim() || 'Table', fields: raw.fields, records: raw.records, views: raw.views }]
  return {
    ...raw,
    tables: tables.map((t: any) => ({
      id: String(t.id),
      name: String(t.name ?? 'Table'),
      fields: Array.isArray(t.fields) ? t.fields : [],
      records: (Array.isArray(t.records) ? t.records : []).map((r: any) => ({ ...r, values: r.values ?? {} })),
      views: Array.isArray(t.views) ? t.views : []
    }))
  }
}

/** Case-insensitive lookup by name, falling back to id. */
export function findTable(project: Project, ref: string): Table | undefined {
  const lower = ref.toLowerCase()
  return project.tables.find((t) => t.id === ref) ?? project.tables.find((t) => t.name.toLowerCase() === lower)
}

export function findField(table: Table, ref: string): Field | undefined {
  const lower = ref.toLowerCase()
  return table.fields.find((f) => f.id === ref) ?? table.fields.find((f) => f.name.toLowerCase() === lower)
}

export function linkedTable(project: Project, field: Field): Table | undefined {
  return project.tables.find((t) => t.id === field.relation?.tableId)
}

/** The value a field reads for a record, whether it's stored or derived. */
export function cellValue(field: Field, record: RecordRow): unknown {
  if (field.type === 'createdTime') return record.createdAt
  if (field.type === 'lastModifiedTime') return record.updatedAt ?? record.createdAt
  return record.values[field.id]
}

export function choice(field: Field, id: unknown): SelectChoice | undefined {
  return field.options?.choices.find((c) => c.id === id)
}

export const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** How a record reads when linked from elsewhere: its first field's text, like the app. */
export function recordLabel(table: Table, record: RecordRow): string {
  const primary = table.fields[0]
  if (!primary || primary.type === 'relation' || primary.type === 'video' || primary.type === 'attachment') return 'Untitled'
  const value = plainValue(primary, record)
  if (value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0)) return 'Untitled'
  return Array.isArray(value) ? value.join(', ') : value === true ? 'Checked' : String(value)
}

/**
 * A field's value in human terms, without media urls rewritten: choice names
 * instead of ids, a checkbox as a boolean, relations as record ids.
 */
export function plainValue(field: Field, record: RecordRow): unknown {
  const raw = cellValue(field, record)
  switch (field.type) {
    case 'checkbox':
      return raw === true
    case 'select':
      return choice(field, raw)?.name ?? null
    case 'multiSelect':
      return ids(raw).flatMap((id) => choice(field, id)?.name ?? [])
    case 'relation':
      return ids(raw)
    case 'attachment':
      return Array.isArray(raw) ? raw : []
    default:
      return raw ?? null
  }
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaFolder = 'images' | 'audio' | 'video' | 'attachments'
export const MEDIA_FOLDERS: MediaFolder[] = ['images', 'audio', 'video', 'attachments']

const SCHEME_FOLDER: Record<string, MediaFolder> = {
  'app-image': 'images',
  'app-audio': 'audio',
  'app-video': 'video',
  'app-attachment': 'attachments'
}

/** A bare file name: no directories, not hidden. */
export const isSafeFileName = (name: string) =>
  name.length > 0 && name.length <= 255 && !name.startsWith('.') && !/[/\\\0]/.test(name)

/** `app-image:///<projectId>/<file>` → where the file lives in the document. */
export function parseAppUrl(url: unknown): { folder: MediaFolder; file: string } | null {
  if (typeof url !== 'string') return null
  const match = /^(app-image|app-audio|app-video|app-attachment):\/\/\/[^/]+\/([^/]+)$/.exec(url)
  if (!match) return null
  const file = decodeURIComponent(match[2]!)
  return isSafeFileName(file) ? { folder: SCHEME_FOLDER[match[1]!]!, file } : null
}

/** Maps a stored media reference to the url this service serves it at; external urls pass through. */
export type MediaUrl = (url: unknown) => string | null

export function mediaUrlFor(baseUrl: string, docName: string): MediaUrl {
  return (url) => {
    const ref = parseAppUrl(url)
    if (ref) return `${baseUrl}/api/documents/${encodeURIComponent(docName)}/files/${ref.folder}/${encodeURIComponent(ref.file)}`
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null
  }
}

// ---------------------------------------------------------------------------
// API shape
// ---------------------------------------------------------------------------

export interface ApiRecord {
  id: string
  createdAt: string
  updatedAt: string
  fields: Record<string, unknown>
  expand?: Record<string, ApiRecord[]>
}

/** A field's value as the API returns it: human values, media as urls into this service. */
export function apiValue(field: Field, record: RecordRow, media: MediaUrl): unknown {
  const value = plainValue(field, record)
  switch (field.type) {
    case 'image':
    case 'audio':
      return media(value)
    case 'video': {
      const v = value as any
      if (!v || typeof v !== 'object') return null
      return {
        url: media(v.url),
        ...(typeof v.name === 'string' ? { name: v.name } : {}),
        ...(v.poster ? { poster: media(v.poster) } : {})
      }
    }
    case 'attachment':
      return (value as any[]).map((a) => ({
        url: media(a?.url),
        name: a?.name ?? null,
        ...(typeof a?.size === 'number' ? { size: a.size } : {})
      }))
    default:
      return value
  }
}

export function apiRecord(table: Table, record: RecordRow, media: MediaUrl): ApiRecord {
  const fields: Record<string, unknown> = {}
  for (const field of table.fields) fields[field.name] = apiValue(field, record, media)
  return { id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt ?? record.createdAt, fields }
}

export function fieldSchema(project: Project, field: Field) {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    ...(field.options ? { choices: field.options.choices.map(({ id, name, color }) => ({ id, name, color })) } : {}),
    ...(field.type === 'relation'
      ? { relation: { table: linkedTable(project, field)?.name ?? null, multiple: field.relation?.multiple !== false } }
      : {}),
    ...(field.dateFormat ? { dateFormat: field.dateFormat } : {})
  }
}

export function tableSchema(project: Project, table: Table) {
  return {
    id: table.id,
    name: table.name,
    recordCount: table.records.length,
    fields: table.fields.map((f) => fieldSchema(project, f)),
    // Config is passed through as stored: it refers to fields by id, which the fields above carry.
    views: table.views.map((v) => ({ id: v.id, name: v.name, type: v.type, config: v.config ?? {} }))
  }
}

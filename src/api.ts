/**
 * Read-only JSON API, everything under /api.
 */
import { existsSync } from 'node:fs'
import {
  apiRecord,
  findField,
  findTable,
  ids,
  MEDIA_FOLDERS,
  mediaUrlFor,
  tableSchema,
  type ApiRecord,
  type MediaFolder,
  type MediaUrl,
  type Project,
  type RecordRow,
  type Table
} from './crow'
import { parseQuery, QueryError, runQuery } from './query'
import { NotFound, type DocumentStore } from './store'

export interface RequestContext {
  store: DocumentStore
  url: URL
  params: Record<string, string>
  req: Request
  baseUrl: string
}

export class BadRequest extends Error {}

export const json = (data: unknown, status = 200) => Response.json(data, { status })

export function tableOf(project: Project, ref: string): Table {
  const table = findTable(project, ref)
  if (!table) throw new NotFound(`No table named "${ref}" in "${project.name}"`)
  return table
}

/** `?expand=Comments,Author` inlines linked records, one level deep. */
function expand(ctx: RequestContext, project: Project, table: Table, records: RecordRow[], items: ApiRecord[], media: MediaUrl) {
  const param = ctx.url.searchParams.get('expand')
  if (!param) return
  for (const name of param.split(',').map((s) => s.trim()).filter(Boolean)) {
    const field = findField(table, name)
    if (!field || field.type !== 'relation') throw new BadRequest(`Can't expand "${name}": it isn't a relation field of "${table.name}"`)
    const target = project.tables.find((t) => t.id === field.relation?.tableId)
    const byId = new Map(target?.records.map((r) => [r.id, r]) ?? [])
    records.forEach((record, i) => {
      const linked = ids(record.values[field.id]).flatMap((id) => {
        const row = byId.get(id)
        return row && target ? [apiRecord(target, row, media)] : []
      })
      ;(items[i]!.expand ??= {})[field.name] = linked
    })
  }
}

export async function listDocuments(ctx: RequestContext) {
  const items = []
  for (const name of await ctx.store.list()) {
    const project = await ctx.store.load(name).catch(() => null)
    if (!project) continue
    items.push({
      name,
      id: project.id,
      updatedAt: project.updatedAt,
      version: ctx.store.version(name),
      tables: project.tables.map((t) => ({ id: t.id, name: t.name, recordCount: t.records.length }))
    })
  }
  return json({ items })
}

export async function getDocument(ctx: RequestContext) {
  const name = ctx.params.doc!
  const project = await ctx.store.load(name)
  return json({
    name,
    id: project.id,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tables: project.tables.map((t) => tableSchema(project, t))
  })
}

export async function getTable(ctx: RequestContext) {
  const project = await ctx.store.load(ctx.params.doc!)
  return json(tableSchema(project, tableOf(project, ctx.params.table!)))
}

export async function listRecords(ctx: RequestContext) {
  const doc = ctx.params.doc!
  const project = await ctx.store.load(doc)
  const table = tableOf(project, ctx.params.table!)
  let result
  try {
    result = runQuery(table, parseQuery(table, ctx.url.searchParams))
  } catch (err) {
    throw err instanceof QueryError ? new BadRequest(err.message) : err
  }
  const media = mediaUrlFor(ctx.baseUrl, doc)
  const items = result.records.map((r) => apiRecord(table, r, media))
  expand(ctx, project, table, result.records, items, media)
  const { records: _, ...page } = result
  return json({ ...page, items })
}

export async function getRecord(ctx: RequestContext) {
  const doc = ctx.params.doc!
  const project = await ctx.store.load(doc)
  const table = tableOf(project, ctx.params.table!)
  const record = table.records.find((r) => r.id === ctx.params.id)
  if (!record) throw new NotFound(`No record "${ctx.params.id}" in "${table.name}"`)
  const media = mediaUrlFor(ctx.baseUrl, doc)
  const item = apiRecord(table, record, media)
  expand(ctx, project, table, [record], [item], media)
  return json(item)
}

/** A media file, with Range support for audio/video. `?download=1` forces a download. */
export async function getFile(ctx: RequestContext) {
  const { doc, folder, file: name } = ctx.params as Record<string, string>
  if (!MEDIA_FOLDERS.includes(folder as MediaFolder)) throw new NotFound('File not found')
  await ctx.store.load(doc!)
  const path = ctx.store.mediaPath(doc!, folder as MediaFolder, name!)
  if (!existsSync(path)) throw new NotFound('File not found')

  const file = Bun.file(path)
  const size = file.size
  const headers = new Headers({
    'Content-Type': file.type || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    // Stored HTML/SVG must not run script on this origin.
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
  })
  if (ctx.url.searchParams.has('download')) {
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name!)}`)
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.get('range')?.trim() ?? '')
  if (match && (match[1] !== '' || match[2] !== '')) {
    const start = match[1] === '' ? Math.max(0, size - Number(match[2])) : Number(match[1])
    const end = match[1] === '' || match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
    if (start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
    return new Response(file.slice(start, end + 1), { status: 206, headers })
  }
  headers.set('Content-Length', String(size))
  return new Response(file, { headers })
}

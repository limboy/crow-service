import * as api from './api'
import { BadRequest, json, type RequestContext } from './api'
import * as pages from './pages'
import { notFoundPage } from './pages'
import { DocumentStore, NotFound } from './store'

export interface ServerOptions {
  docsDir: string
  port?: number
  hostname?: string
  /** Base for file urls in API responses (e.g. https://crow.example.com); defaults to the request's origin. */
  publicUrl?: string
}

type Handler = (ctx: RequestContext) => Promise<Response>

export function startServer(options: ServerOptions) {
  const store = new DocumentStore(options.docsDir)

  const wrap = (handler: Handler, kind: 'api' | 'page') => async (req: Request & { params?: Record<string, string> }) => {
    const url = new URL(req.url)
    const ctx: RequestContext = { store, req, url, params: req.params ?? {}, baseUrl: options.publicUrl ?? url.origin }
    let res: Response
    try {
      res = await handler(ctx)
    } catch (err) {
      const status = err instanceof NotFound ? 404 : err instanceof BadRequest ? 400 : 500
      if (status === 500) console.error(err)
      const message = status === 500 ? 'Something went wrong' : (err as Error).message
      res = kind === 'api' ? json({ status, message }, status) : notFoundPage(message)
      if (kind === 'page' && status !== 404) res = new Response(res.body, { status, headers: res.headers })
    }
    if (kind === 'api') res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  }
  const get = (handler: Handler, kind: 'api' | 'page') => ({ GET: wrap(handler, kind) })

  const DOC = '/api/documents/:doc'
  const TABLE = `${DOC}/tables/:table`

  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    routes: {
      '/api': get(async () => json(API_INDEX), 'api'),
      '/api/documents': get(api.listDocuments, 'api'),
      [DOC]: get(api.getDocument, 'api'),
      [TABLE]: get(api.getTable, 'api'),
      [`${TABLE}/records`]: get(api.listRecords, 'api'),
      [`${TABLE}/records/:id`]: get(api.getRecord, 'api'),
      [`${DOC}/files/:folder/:file`]: get(api.getFile, 'api'),

      '/favicon.ico': new Response(null, { status: 204 }),
      '/': get(pages.homePage, 'page'),
      '/:doc': get(pages.documentPage, 'page'),
      '/:doc/:table': get(pages.tablePage, 'page'),
      '/:doc/:table/:id': get(pages.recordPage, 'page')
    },
    fetch(req) {
      const path = new URL(req.url).pathname
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return json({ status: 405, message: 'This server is read-only' }, 405)
      }
      return path === '/api' || path.startsWith('/api/')
        ? json({ status: 404, message: `No route for ${path}` }, 404)
        : notFoundPage(`Nothing at ${path}.`)
    }
  })
}

const API_INDEX = {
  name: 'crow-service',
  readOnly: true,
  endpoints: [
    'GET /api/documents',
    'GET /api/documents/:doc',
    'GET /api/documents/:doc/tables/:table',
    'GET /api/documents/:doc/tables/:table/records?where=&q=&sort=&page=&perPage=&expand=',
    'GET /api/documents/:doc/tables/:table/records/:id?expand=',
    'GET /api/documents/:doc/files/:folder/:file'
  ]
}

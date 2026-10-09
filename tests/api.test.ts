import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/server'

let dir: string
let base: string
let server: ReturnType<typeof startServer>

const PID = 'proj-1'
const now = '2026-10-01T09:00:00.000Z'

/** A two-table document in the on-disk format the Crow app writes. */
function fixture() {
  return {
    id: PID,
    name: 'Library',
    createdAt: now,
    updatedAt: now,
    tables: [
      {
        id: 'tbl-books',
        name: 'Books',
        fields: [
          { id: 'f-title', name: 'Title', type: 'text' },
          {
            id: 'f-status',
            name: 'Status',
            type: 'select',
            options: { choices: [{ id: 'ch-todo', name: 'Todo', color: 'gray' }, { id: 'ch-done', name: 'Done', color: 'green' }] }
          },
          {
            id: 'f-tags',
            name: 'Tags',
            type: 'multiSelect',
            options: { choices: [{ id: 'ch-sf', name: 'sci-fi', color: 'blue' }, { id: 'ch-cl', name: 'classic', color: 'amber' }] }
          },
          { id: 'f-pages', name: 'Pages', type: 'number' },
          { id: 'f-cover', name: 'Cover', type: 'image' },
          { id: 'f-files', name: 'Files', type: 'attachment' },
          { id: 'f-comments', name: 'Comments', type: 'relation', relation: { tableId: 'tbl-comments', multiple: true, inverseFieldId: 'f-books' } }
        ],
        records: [
          {
            id: 'b1',
            createdAt: now,
            values: {
              'f-title': 'Dune',
              'f-status': 'ch-done',
              'f-tags': ['ch-sf', 'ch-cl'],
              'f-pages': 412,
              'f-cover': `app-image:///${PID}/cover.png`,
              'f-files': [{ url: `app-attachment:///${PID}/a1.txt`, name: 'notes.txt', size: 5 }],
              'f-comments': ['c1']
            }
          },
          { id: 'b2', createdAt: now, values: { 'f-title': 'Piranesi', 'f-status': 'ch-done', 'f-pages': 272 } },
          { id: 'b3', createdAt: now, values: { 'f-title': '<script>alert(1)</script>', 'f-pages': 937 } }
        ],
        views: [{ id: 'v1', name: 'Table', type: 'table', config: { hiddenFieldIds: [] } }]
      },
      {
        id: 'tbl-comments',
        name: 'Comments',
        fields: [
          { id: 'f-body', name: 'Body', type: 'text' },
          { id: 'f-books', name: 'Books', type: 'relation', relation: { tableId: 'tbl-books', multiple: true, inverseFieldId: 'f-comments' } }
        ],
        records: [{ id: 'c1', createdAt: now, values: { 'f-body': 'A classic.', 'f-books': ['b1'] } }],
        views: []
      }
    ]
  }
}

const docPath = () => join(dir, 'Library.crow')

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'crow-service-'))
  mkdirSync(join(docPath(), 'images'), { recursive: true })
  mkdirSync(join(docPath(), 'attachments'), { recursive: true })
  writeFileSync(join(docPath(), 'data.json'), JSON.stringify(fixture()))
  writeFileSync(join(docPath(), 'images', 'cover.png'), new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6]))
  writeFileSync(join(docPath(), 'attachments', 'a1.txt'), 'hello')
  server = startServer({ docsDir: dir, port: 0, hostname: '127.0.0.1' })
  base = server.url.origin
})

afterAll(() => {
  server?.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

async function get(path: string) {
  const res = await fetch(`${base}${path}`)
  return { status: res.status, data: (await res.json()) as any }
}

const books = '/api/documents/Library/tables/Books/records'

describe('JSON API', () => {
  test('documents and schema', async () => {
    const list = await get('/api/documents')
    expect(list.data.items).toEqual([
      {
        name: 'Library',
        id: PID,
        updatedAt: now,
        tables: [
          { id: 'tbl-books', name: 'Books', recordCount: 3 },
          { id: 'tbl-comments', name: 'Comments', recordCount: 1 }
        ]
      }
    ])
    const doc = await get('/api/documents/Library')
    const status = doc.data.tables[0].fields[1]
    expect(status.choices.map((c: any) => c.name)).toEqual(['Todo', 'Done'])
    expect(doc.data.tables[0].fields[6].relation).toEqual({ table: 'Comments', multiple: true })
    expect(doc.data.tables[0].views).toEqual([{ id: 'v1', name: 'Table', type: 'table', config: { hiddenFieldIds: [] } }])
    expect((await get('/api/documents/Nope')).status).toBe(404)
    expect((await get('/api')).data.readOnly).toBe(true)
  })

  test('records use names and file urls', async () => {
    const res = await get(`${books}/b1?expand=Comments`)
    const f = res.data.fields
    expect(f.Status).toBe('Done')
    expect(f.Tags).toEqual(['sci-fi', 'classic'])
    expect(f.Cover).toBe(`${base}/api/documents/Library/files/images/cover.png`)
    expect(f.Files).toEqual([{ url: `${base}/api/documents/Library/files/attachments/a1.txt`, name: 'notes.txt', size: 5 }])
    expect(f.Comments).toEqual(['c1'])
    expect(res.data.expand.Comments[0].fields.Body).toBe('A classic.')
    expect((await get(`${books}/nope`)).status).toBe(404)
    expect((await get(`${books}/b1?expand=Title`)).status).toBe(400)
  })

  test('where, search, sort and paging', async () => {
    const titles = (r: any) => r.data.items.map((i: any) => i.fields.Title)
    expect(titles(await get(`${books}?where=${encodeURIComponent('{"Status":"Done"}')}&sort=-Pages`))).toEqual(['Dune', 'Piranesi'])
    expect(titles(await get(`${books}?where=${encodeURIComponent('{"Tags":"classic"}')}`))).toEqual(['Dune'])
    expect(titles(await get(`${books}?where=${encodeURIComponent('{"Status":null}')}`))).toEqual(['<script>alert(1)</script>'])
    expect(titles(await get(`${books}?q=PIRA`))).toEqual(['Piranesi'])
    expect(titles(await get(`${books}?q=notes`))).toEqual(['Dune'])
    // Empty values sort last whichever the direction.
    expect(titles(await get(`${books}?sort=-Status,Title`))).toEqual(['Dune', 'Piranesi', '<script>alert(1)</script>'])

    const paged = await get(`${books}?sort=Pages&perPage=2&page=2`)
    expect(paged.data).toMatchObject({ page: 2, perPage: 2, totalItems: 3, totalPages: 2 })
    expect(titles(paged)).toEqual(['<script>alert(1)</script>'])

    expect((await get(`${books}?where=nope`)).status).toBe(400)
    expect((await get(`${books}?sort=Nope`)).status).toBe(400)
  })

  test('files, ranges and path safety', async () => {
    const res = await fetch(`${base}/api/documents/Library/files/images/cover.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')

    const partial = await fetch(`${base}/api/documents/Library/files/images/cover.png`, { headers: { Range: 'bytes=2-5' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(new Uint8Array([78, 71, 1, 2]))

    expect((await fetch(`${base}/api/documents/Library/files/images/..%2Fdata.json`)).status).toBe(404)
    expect((await fetch(`${base}/api/documents/Library/files/other/cover.png`)).status).toBe(404)
    expect((await fetch(`${base}/api/documents/..%2F..%2Fetc/tables/x/records`)).status).toBe(404)
  })

  test('read-only', async () => {
    expect((await fetch(`${base}${books}`, { method: 'POST', body: '{}' })).status).toBe(405)
    expect((await fetch(`${base}${books}/b1`, { method: 'DELETE' })).status).toBe(405)
  })

  test('edits made in the app show up', async () => {
    const data = JSON.parse(readFileSync(join(docPath(), 'data.json'), 'utf-8'))
    data.tables[0].records[1].values['f-title'] = 'Piranesi (edited)'
    await Bun.sleep(5)
    writeFileSync(join(docPath(), 'data.json'), JSON.stringify(data))
    expect((await get(`${books}/b2`)).data.fields.Title).toBe('Piranesi (edited)')
  })
})

describe('HTML pages', () => {
  async function page(path: string) {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' })
    return { status: res.status, type: res.headers.get('content-type'), location: res.headers.get('location'), body: await res.text() }
  }

  test('home lists documents', async () => {
    const res = await page('/')
    expect(res.type).toContain('text/html')
    expect(res.body).toContain('href="/Library/Books"')
    expect(res.body).toContain('<td class="num">4</td>')
  })

  test('a document opens its first table', async () => {
    const res = await page('/Library')
    expect(res.status).toBe(302)
    expect(res.location).toBe('/Library/Books')
  })

  test('table page renders values and escapes them', async () => {
    const res = await page('/Library/Books?sort=Title')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<a href="/Library/Books/b1"><div class="clip">Dune</div></a>')
    expect(res.body).toContain('background:var(--c-green)">Done</span>')
    expect(res.body).toContain('src="/api/documents/Library/files/images/cover.png"')
    expect(res.body).toContain('<a href="/Library/Comments/c1">A classic.</a>')
    expect(res.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(res.body).not.toContain('<script>alert(1)</script>')
    // Clicking the sorted column flips the direction.
    expect(res.body).toContain('href="/Library/Books?sort=-Title">Title ↑</a>')
  })

  test('search and paging links keep the query', async () => {
    const res = await page('/Library/Books?q=dune')
    expect(res.body).toContain('1 record<')
    expect(res.body).toContain('value="dune"')
    const paged = await page('/Library/Books?perPage=1&sort=Pages')
    expect(paged.body).toContain('href="/Library/Books?perPage=1&amp;sort=Pages&amp;page=2">Next')
  })

  test('record page', async () => {
    const res = await page('/Library/Comments/c1')
    expect(res.body).toContain('<h1>A classic.</h1>')
    expect(res.body).toContain('<a href="/Library/Books/b1">Dune</a>')
  })

  test('not found', async () => {
    expect((await page('/Nope')).status).toBe(404)
    expect((await page('/Library/Nope')).status).toBe(404)
    expect((await page('/Library/Books/nope')).status).toBe(404)
  })
})

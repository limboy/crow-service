# crow-service

A read-only web viewer and JSON API for a folder of [Crow](../crow) documents, built on Bun.

Point it at a directory of `.crow` documents. Browsers get readable pages at `/`, and web or mobile
clients get JSON under `/api`. There are no accounts and nothing can be edited: the `.crow` files
are only ever read, so the Crow app and CLI can keep editing them. Changes show up on the next
request.

> Anyone who can reach the server can read every document in the folder. Bind it to `127.0.0.1`
> (`--host`) or put it behind something that controls access if that matters.

## Running

Install the `crowd` command once:

```bash
bun install
bun link
```

Then run it from a directory with a `crows` folder of `.crow` documents, or point it elsewhere:

```bash
crowd
crowd --dir ~/Documents/Crow --port 3000
```

| Option | Default | |
| --- | --- | --- |
| `-d`, `--dir` | `./crows` | Folder of `.crow` documents, relative to where you run it |
| `-p`, `--port` | `8090` | |
| `--host` | `0.0.0.0` | Interface to bind; `127.0.0.1` keeps it to this machine |
| `--public-url` | request origin | Base for file urls in API responses (set it behind a proxy) |

```bash
bun test
bun run typecheck
```

## Pages

| | |
| --- | --- |
| `/` | Every document and its tables |
| `/:doc` | Redirects to the document's first table |
| `/:doc/:table` | Records as a table, with search (`?q=`), click-to-sort columns and paging |
| `/:doc/:table/:id` | One record, with images, audio and video players, attachments and links to related records |

A document's name is its folder name without `.crow` (`Reading List.crow` → `/Reading%20List`).
Tables can be referenced by name (case-insensitive) or id.

## API

All endpoints are `GET` and send `Access-Control-Allow-Origin: *`.

```http
GET /api                                              endpoint list
GET /api/documents                                    documents with their tables and record counts
GET /api/documents/:doc                               schema: tables, fields (with choices), views (with config)
GET /api/documents/:doc/tables/:table                 one table's schema
GET /api/documents/:doc/tables/:table/records         ?where=&q=&sort=&page=&perPage=&expand=
GET /api/documents/:doc/tables/:table/records/:id     ?expand=
GET /api/documents/:doc/files/:folder/:file           media (Range supported; ?download=1)
```

A record is keyed by field name, with choices by name, relations as linked record ids, and media as
urls into this server:

```json
{
  "id": "b1",
  "createdAt": "2026-10-01T09:00:00.000Z",
  "updatedAt": "2026-10-01T09:00:00.000Z",
  "fields": {
    "Title": "Dune",
    "Status": "Done",
    "Tags": ["sci-fi", "classic"],
    "Pages": 412,
    "Cover": "http://localhost:8090/api/documents/Library/files/images/cover.png",
    "Files": [{ "url": "http://localhost:8090/api/documents/Library/files/attachments/a1.txt", "name": "notes.txt", "size": 5 }],
    "Comments": ["c1"]
  },
  "expand": { "Comments": [{ "id": "c1", "fields": { "Body": "A classic.", "Books": ["b1"] } }] }
}
```

Listing parameters:

| | |
| --- | --- |
| `where` | JSON object of field name → value, like the crow CLI's `--where`. `{"Status":"Done"}` matches that value. A multi-valued field matches if it contains the value, and `null` matches empty. |
| `q` | Case-insensitive text search across the record's values |
| `sort` | Comma-separated field names (or `@createdAt` / `@updatedAt`), `-` for descending. Empty values sort last. |
| `page`, `perPage` | `perPage` defaults to 50 (max 500) |
| `expand` | Comma-separated relation fields whose linked records to include inline |

Response: `{ page, perPage, totalItems, totalPages, items }`. Without `sort`, records come in the
document's own order.

## Notes

- Documents are loaded whole into memory and cached by `data.json`'s modification time. That suits
  Crow-sized data: thousands of records, not millions.
- Crow's saved views (filters, kanban, dashboards) are listed in the schema with their `config` as
  stored (see crow/docs/crow-format.md), but the service doesn't apply them to record listings.

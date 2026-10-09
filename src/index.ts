#!/usr/bin/env bun
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { startServer } from './server'

const HELP = `Usage: crowd [options]

Serves a folder of .crow documents: readable pages at /, a JSON API under /api.

Options:
  -d, --dir <path>     Folder of .crow documents (default: ./crows)
  -p, --port <port>    Port to listen on (default: 8090)
      --host <host>    Interface to bind (default: 0.0.0.0, all interfaces)
      --public-url <url>  Base for file urls in API responses, e.g. behind a proxy
  -h, --help           Show this help
`

let values
try {
  ;({ values } = parseArgs({
    options: {
      dir: { type: 'string', short: 'd' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      'public-url': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  }))
} catch (err) {
  console.error(`${(err as Error).message}\n\n${HELP}`)
  process.exit(1)
}

if (values.help) {
  console.log(HELP)
  process.exit(0)
}

const port = Number(values.port ?? 8090)
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid port "${values.port}"`)
  process.exit(1)
}

const docsDir = resolve(values.dir ?? 'crows')

const server = startServer({
  docsDir,
  hostname: values.host ?? '0.0.0.0',
  port,
  publicUrl: values['public-url']?.replace(/\/+$/, '') || undefined
})

console.log(`crowd listening on ${server.url}`)
console.log(`  serving documents in ${docsDir} (read-only)`)

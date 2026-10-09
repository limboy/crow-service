import { resolve } from 'node:path'
import { startServer } from './server'

const docsDir = resolve(process.env.CROW_DOCS_DIR ?? './data/documents')

const server = startServer({
  docsDir,
  hostname: process.env.CROW_HOST ?? '0.0.0.0',
  port: Number(process.env.CROW_PORT ?? process.env.PORT ?? 8090),
  publicUrl: process.env.CROW_PUBLIC_URL?.replace(/\/+$/, '') || undefined
})

console.log(`crow-service listening on ${server.url}`)
console.log(`  serving documents in ${docsDir} (read-only)`)

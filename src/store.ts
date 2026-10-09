/**
 * The folder of `.crow` documents being served, read-only. Each document is a
 * directory holding `data.json` plus media folders. Reads are cached by
 * `data.json`'s mtime/size, so edits made in the app or CLI show up on the
 * next request.
 */
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { isSafeFileName, migrateProject, type MediaFolder, type Project } from './crow'

const EXT = '.crow'

export class NotFound extends Error {}

export class DocumentStore {
  private cache = new Map<string, { mtimeMs: number; size: number; project: Project }>()
  readonly dir: string

  constructor(dir: string) {
    this.dir = resolve(dir)
  }

  /** Names (without `.crow`) of every document in the folder. */
  async list(): Promise<string[]> {
    const entries = await fs.readdir(this.dir, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((e) => e.isDirectory() && e.name.endsWith(EXT) && !e.name.startsWith('.'))
      .map((e) => e.name.slice(0, -EXT.length))
      .sort((a, b) => a.localeCompare(b))
  }

  private docPath(name: string): string {
    const path = resolve(this.dir, `${name}${EXT}`)
    if (!isSafeFileName(name) || !path.startsWith(this.dir + '/')) throw new NotFound(`No document named "${name}"`)
    return path
  }

  async load(name: string): Promise<Project> {
    const dataPath = join(this.docPath(name), 'data.json')
    const stat = await fs.stat(dataPath).catch(() => null)
    if (!stat) throw new NotFound(`No document named "${name}"`)
    const cached = this.cache.get(name)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.project

    let raw: any
    try {
      raw = JSON.parse(await fs.readFile(dataPath, 'utf-8'))
    } catch {
      throw new NotFound(`Document "${name}" has no readable data.json`)
    }
    if (!raw || typeof raw.name !== 'string' || (!Array.isArray(raw.tables) && !Array.isArray(raw.fields))) {
      throw new NotFound(`"${name}" isn't a Crow document`)
    }
    const project = migrateProject(raw)
    this.cache.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, project })
    return project
  }

  mediaPath(name: string, folder: MediaFolder, file: string): string {
    if (!isSafeFileName(file)) throw new NotFound('File not found')
    return join(this.docPath(name), folder, file)
  }
}

import { existsSync, readFileSync, writeFileSync } from 'fs'

export class JsonStore<T> {
  constructor(
    private filePath: string,
    private defaults: T
  ) {}

  read(): T {
    if (!existsSync(this.filePath)) return this.defaults
    try {
      return { ...this.defaults, ...JSON.parse(readFileSync(this.filePath, 'utf-8')) }
    } catch {
      return this.defaults
    }
  }

  write(data: T): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
  }
}

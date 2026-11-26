declare module 'unzipper' {
  export class Open {
    static file(path: string): Promise<OpenFile>
  }

  export interface OpenFile {
    files: Array<{
      path: string
      extract(targetPath: string): Promise<void>
    }>
  }
}

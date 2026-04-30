declare module "pdf-parse/lib/pdf-parse.js" {
  import type { Buffer } from "node:buffer"

  interface PdfParseResult {
    text: string
    numpages?: number
    numrender?: number
    info?: unknown
    metadata?: unknown
    version?: string
  }

  interface PdfParseOptions {
    pagerender?: (pageData: unknown) => string | Promise<string>
    max?: number
    version?: string
  }

  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>

  export default pdfParse
}

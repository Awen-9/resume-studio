import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false })
  const pdf = await loadingTask.promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const rows: Array<{ y: number; items: Array<{ x: number; value: string }> }> = []

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      const y = item.transform[5]
      const x = item.transform[4]
      const row = rows.find((candidate) => Math.abs(candidate.y - y) < 2.5)
      if (row) row.items.push({ x, value: item.str })
      else rows.push({ y, items: [{ x, value: item.str }] })
    }

    rows.sort((left, right) => right.y - left.y)
    pages.push(
      rows
        .map((row) =>
          row.items
            .sort((left, right) => left.x - right.x)
            .map((item) => item.value)
            .join(' '),
        )
        .join('\n'),
    )
  }

  return pages.join('\n')
}

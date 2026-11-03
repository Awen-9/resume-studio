import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** 琛屽唴鎷兼帴鍙渶瑕併€岃捣鐐广€佸搴︺€佸瓧鍙枫€嶏紝涓嶉渶瑕佸熀绾?y锛屽崟娴嬪彲浠ョ洿鎺ユ瀯閫犮€?*/
export interface RowTextPiece {
  value: string
  x: number
  width: number
  height: number
}

interface PositionedText extends RowTextPiece {
  y: number
}

/** 鍚屼竴琛岀殑 y 瀹瑰樊锛氬瓧鍙疯秺澶э紝鍩虹嚎鎶栧姩瓒婃槑鏄俱€?*/
const rowTolerance = (height: number): number => Math.max(2, height * 0.35)

/**
 * 琛屽唴鎷兼帴锛氬彧鍦ㄣ€岃瑙変笂鐪熺殑鏈夐棿闅欍€嶆椂鎻掑叆绌烘牸銆? *
 * 涔嬪墠鐨勫疄鐜版槸鎶婂悓涓€琛岀殑鎵€鏈?`item.str` 鐩存帴 `join(' ')`锛岃€?PDF 閲岀殑涓枃甯歌鎷嗘垚
 * 涓€瀛椾竴涓?item锛岀粨鏋滄瘡涓眽瀛椾箣闂撮兘琚杩涚┖鏍硷紙`涓?饧?绠€浠媊锛夛紝涓嬫父鐨勬爣棰樺尮閰嶅叏閮ㄥけ鏁堛€? * 鍙嶈繃鏉ワ紝鑻辨枃鍗曡瘝涔嬮棿濡傛灉瀹屽叏涓嶆彃绌烘牸鍙堜細绮樿繛銆傜敤鍧愭爣绠楅棿璺濇槸鍞竴绋冲Ε鐨勫仛娉曪細
 * 鐩搁偦涓ゆ鐨勯棿璺濊秴杩囬槇鍊兼墠琛ヤ竴涓┖鏍笺€? */
/** 瀵煎嚭浠ヤ究鍗曟祴锛氳鍐呮嫾鎺ヤ笉渚濊禆 PDF锛屽彧渚濊禆鍧愭爣涓庡搴︺€?*/
export const joinTextRow = (items: RowTextPiece[]): string => {
  let line = ''
  let previousEnd: number | null = null
  let previousHeight = 0

  for (const item of items) {
    if (previousEnd !== null) {
      const gap = item.x - previousEnd
      const threshold = Math.max(0.6, previousHeight * 0.15)
      const previousChar = line.slice(-1)
      const nextChar = item.value[0] ?? ''
      const needsSpace =
        gap > threshold && previousChar !== '' && !/\s/.test(previousChar) && !/\s/.test(nextChar)
      if (needsSpace) line += ' '
    }
    line += item.value
    previousEnd = item.x + item.width
    previousHeight = item.height || previousHeight
  }

  return line
}

const joinRow = joinTextRow

export interface PdfTextExtraction {
  text: string
  /** 页数：用于在导入结果里给出"这份 PDF 有多少页"的判断依据。 */
  pages: number
}

export const extractPdfText = async (buffer: Buffer): Promise<PdfTextExtraction> => {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false })
  const pdf = await loadingTask.promise
  const pages: string[] = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const rows: Array<{ y: number; items: PositionedText[] }> = []

    for (const item of content.items) {
      if (!('str' in item) || item.str.length === 0 || item.str.trim().length === 0) continue
      const [x, y] = [item.transform[4], item.transform[5]]
      const height = item.height || item.transform[3] || 0
      const positioned: PositionedText = { value: item.str, x, y, width: item.width, height }
      const row = rows.find(
        (candidate) => Math.abs(candidate.y - y) < rowTolerance(Math.max(height, 1)),
      )
      if (row) row.items.push(positioned)
      else rows.push({ y, items: [positioned] })
    }

    rows.sort((left, right) => right.y - left.y)
    pages.push(
      rows.map((row) => joinRow(row.items.sort((left, right) => left.x - right.x))).join('\n'),
    )
  }

  return { text: pages.join('\n'), pages: pdf.numPages }
}

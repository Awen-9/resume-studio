/**
 * PDF 行内拼接的回归测试。
 *
 * 这里是「汉字之间被塞空格」的根因所在：早期实现直接 `join(' ')`，
 * 导致 `个 人 简介` 这种文本，下游模块标题全部匹配失败。
 */
import { joinTextRow } from '../../server/services/pdfTextExtractor'

interface Piece {
  value: string
  x: number
  width: number
  height: number
}

const piece = (value: string, x: number, width: number, height = 12): Piece => ({
  value,
  x,
  width,
  height,
})

describe('pdf text row joining', () => {
  it('does not insert spaces between adjacent CJK glyphs', () => {
    // 中文常被拆成一字一个 item，字之间只有 0 间距
    const row = joinTextRow([
      piece('个', 0, 12),
      piece('人', 12, 12),
      piece('简', 24, 12),
      piece('介', 36, 12),
    ])
    expect(row).toBe('个人简介')
  })

  it('keeps the space between latin words', () => {
    const row = joinTextRow([piece('Spring', 0, 36), piece('Boot', 40, 24)])
    expect(row).toBe('Spring Boot')
  })

  it('keeps the visual space between CJK and latin when there is a gap', () => {
    const row = joinTextRow([piece('Java', 0, 26), piece('后端', 30, 24)])
    expect(row).toBe('Java 后端')
  })

  it('does not glue glyphs split by kerning inside one word', () => {
    const row = joinTextRow([piece('Re', 0, 12), piece('Act', 12, 20)])
    expect(row).toBe('ReAct')
  })

  it('keeps punctuation tight to the preceding character', () => {
    const row = joinTextRow([piece('经验', 0, 24), piece('。', 24, 12)])
    expect(row).toBe('经验。')
  })
})

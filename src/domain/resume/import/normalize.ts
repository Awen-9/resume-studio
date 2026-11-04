import {
  CJK_CHAR_PATTERN,
  CJK_END_GAP_PATTERN,
  CJK_GAP_PATTERN,
  RADICAL_FALLBACK,
} from './patterns.js'

const normalizeCjkRadicals = (value: string): string =>
  value.replace(/[\u2E80-\u2EFF\u2F00-\u2FDF]/g, (char) => {
    const fallback = RADICAL_FALLBACK[char.codePointAt(0) ?? 0]
    if (fallback) return fallback
    const normalized = char.normalize('NFKC')
    return normalized === char ? char : normalized
  })

/**
 * 汉字之间空格兜底清理：`个 ⼈ 简介` → `个人简介`。
 *
 * 根因已在 `pdfTextExtractor` 修掉（按字间距判断是否补空格、中文之间不补），
 * 这里保留一遍作为保险，兼容旧提取器产出的文本或源文件自带多余空格的 PDF。
 * 单遍足够，不再反复压缩。
 */
export const collapseCjkSpaces = (value: string): string =>
  value.replace(CJK_GAP_PATTERN, '$1').replace(CJK_END_GAP_PATTERN, '$1')

const normalizeLine = (line: string): string => {
  return collapseCjkSpaces(
    normalizeCjkRadicals(
      line
        .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*([丨|｜])\s*/g, ' | '),
    ),
  ).trim()
}

const isNoiseLine = (line: string): boolean => {
  return (
    (line.length > 16 && /^[A-Za-z0-9_-]+$/.test(line)) ||
    (line.length > 24 && !CJK_CHAR_PATTERN.test(line) && !/[.@]/.test(line))
  )
}

export const normalizeResumeLines = (text: string): string[] => {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line.length > 0 && !isNoiseLine(line))
}

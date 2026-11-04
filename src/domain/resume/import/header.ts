import type { ResumeDocument } from '../model.js'
import { collapseCjkSpaces } from './normalize.js'
import {
  BARE_DOMAIN_PATTERN,
  CJK_CHAR_PATTERN,
  CONTACT_LABEL_PATTERN,
  EMAIL_PATTERN,
  NAME_PATTERN,
  PHONE_PATTERN,
  URL_PATTERN,
} from './patterns.js'

/** 把一条联系方式从正文里摘掉，避免它被当成姓名或职位。 */
const stripContactFragments = (line: string): string =>
  line
    .replace(PHONE_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(/\s*[|丨｜]\s*(?=[|丨｜]|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const pickName = (preamble: string[]): { name: string; line: string } => {
  for (const line of preamble) {
    const candidate = stripContactFragments(line)
    if (!candidate || CONTACT_LABEL_PATTERN.test(candidate)) continue
    if (/\d/.test(candidate)) continue
    if (NAME_PATTERN.test(candidate)) return { name: candidate, line }
  }
  const fallback = preamble
    .map(stripContactFragments)
    .find((line) => CJK_CHAR_PATTERN.test(line) && !CONTACT_LABEL_PATTERN.test(line))
  if (!fallback) return { name: '未填写姓名', line: '' }
  // 姓名通常写在行尾（`Java后端开发 测试用户`），所以从后往前找匹配的片段
  const token = fallback
    .split(/\s+/)
    .reverse()
    .find((part) => NAME_PATTERN.test(part))
  const runs = [...fallback.matchAll(/[\u4e00-\u9fa5]{2,4}\*{0,4}/g)].map((match) => match[0])
  return { name: token ?? runs.at(-1) ?? '未填写姓名', line: fallback }
}

const pickHeadline = (preamble: string[], nameLine: string, detailLine: string): string => {
  const roleLine = preamble.find(
    (line) =>
      line !== nameLine &&
      line !== detailLine &&
      !PHONE_PATTERN.test(line) &&
      !EMAIL_PATTERN.test(line) &&
      /(工程师|开发|架构|经理|产品|运营|设计|分析师|专家|负责人|程序员)/.test(line),
  )
  if (!roleLine) return '目标职位'
  // 去掉行尾的「博客：xxx」「GitHub：xxx」等附带信息，只留职位本身。
  return roleLine
    .split(/[丨|｜]/)
    .map((part) => part.replace(/(博客|blog|github|主页|网站)\s*[:：].*$/i, '').trim())
    .filter((part) => part.length > 0)
    .join(' / ')
    .slice(0, 60)
}

export const parseProfile = (
  preamble: string[],
): { profile: ResumeDocument['profile']; used: Set<string> } => {
  const allText = preamble.join(' | ')
  const phone = allText.match(PHONE_PATTERN)?.[0]?.trim() ?? ''
  const email = allText.match(EMAIL_PATTERN)?.[0]?.trim() ?? ''
  // 域名要从「去掉邮箱之后」的文本里找，否则会把 `****@163.com` 的 `163.com` 当成个人网站
  const withoutEmails = allText.replace(EMAIL_PATTERN, ' ')
  const website =
    withoutEmails.match(URL_PATTERN)?.[0] ?? withoutEmails.match(BARE_DOMAIN_PATTERN)?.[0] ?? ''

  const { name, line: nameLine } = pickName(preamble)
  const detailLine =
    preamble.find(
      (line) => /[岁年男女性]/.test(line) && !PHONE_PATTERN.test(line) && !EMAIL_PATTERN.test(line),
    ) ?? ''
  const headline = pickHeadline(preamble, nameLine, detailLine)
  // 姓名与职位写在同一行时（`Java后端开发 测试用户`），姓名前面那段就是展示职位
  const nameIndex = nameLine.indexOf(name)
  const displayTitle =
    nameIndex > 0
      ? nameLine
          .slice(0, nameIndex)
          .replace(/[|丨｜]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : ''
  const location = collapseCjkSpaces(allText.match(/现居\s*[:：]\s*([^|丨｜]+)/)?.[1]?.trim() ?? '')

  const used = new Set<string>([nameLine, detailLine])
  const headlineLine = preamble.find((line) => line.includes(headline.split(' / ')[0] ?? ''))
  if (headlineLine) used.add(headlineLine)
  for (const value of [phone, email, website]) {
    if (!value) continue
    const sourceLine = preamble.find((line) => line.includes(value))
    if (sourceLine) used.add(sourceLine)
  }

  return {
    profile: {
      name,
      headline,
      displayTitle: displayTitle || undefined,
      detail: detailLine || undefined,
      headerLayout: displayTitle || detailLine ? 'compact' : 'stacked',
      phone,
      email,
      location,
      website,
    },
    used,
  }
}

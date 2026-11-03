import { describe, expect, it } from 'vitest'
import {
  buildAgentTools,
  findResumeSection,
  splitResumeSections,
} from '../../server/services/agentGraph/tools'

const RESUME = [
  '基本信息',
  '吴泽宇 / 男 / 上海',
  '教育经历',
  'XX大学 计算机科学与技术 本科',
  '工作经历',
  '负责公司后端接口开发，提升了系统性能。',
  '项目经历',
  '开发简历编辑器，使用 Vue 3 和 Fastify。',
  '专业技能',
  'Java、Spring Boot、MySQL、Redis',
].join('\n')

describe('resume sections', () => {
  it('splits plain-text resume by known headings', () => {
    const sections = splitResumeSections(RESUME)
    expect(sections.map((section) => section.name)).toEqual([
      '基本信息',
      '教育经历',
      '工作经历',
      '项目经历',
      '专业技能',
    ])
    expect(sections.find((section) => section.name === '项目经历')?.content).toContain('Vue 3')
  })

  it('finds a section by exact or fuzzy name', () => {
    expect(findResumeSection(RESUME, '工作经历')).toContain('后端接口开发')
    expect(findResumeSection(RESUME, '项目')).toContain('简历编辑器')
    expect(findResumeSection(RESUME, '获奖经历')).toBeNull()
  })
})

describe('agent tools', () => {
  const tools = buildAgentTools({
    resume: RESUME,
    jd: '负责 Java 后端开发',
    draftRewrite: async () => ({
      summary: '改写',
      edits: [{ before: '原文', after: '改写后', reason: '更贴合岗位' }],
    }),
  })
  const invoke = (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const found = tools.find((candidate) => candidate.name === name)
    if (!found) throw new Error(`missing tool ${name}`)
    const call = found.invoke.bind(found) as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>
    return call(args)
  }

  it('reads a resume section through the read_resume_section tool', async () => {
    await expect(invoke('read_resume_section', { section: '专业技能' })).resolves.toContain('Redis')
  })

  it('returns the JD through the read_jd tool', async () => {
    await expect(invoke('read_jd', {})).resolves.toContain('Java 后端开发')
  })

  it('drafts a rewrite through the draft_rewrite tool', async () => {
    const result = (await invoke('draft_rewrite', { target: '原文' })) as {
      edits: Array<{ after: string }>
    }
    expect(result.edits[0]?.after).toBe('改写后')
  })
})

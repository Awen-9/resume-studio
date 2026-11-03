import { createDefaultDocument } from '@/domain/resume/defaults'
import { applyResumeEdits } from '@/domain/resume/applyEdits'

describe('applying AI resume edits', () => {
  it('replaces a matching bullet in place', () => {
    const document = createDefaultDocument()
    const work = document.sections.find((section) => section.type === 'experience')
    work!.items[0].bullets = ['负责订单系统的稳定性建设', '推动公共组件抽取']
    const { applied, failed } = applyResumeEdits(document, [
      {
        before: '负责订单系统的稳定性建设',
        after: '主导高并发改造，支撑 10 万 QPS',
        reason: '量化',
      },
    ])
    expect(applied).toBe(1)
    expect(failed).toHaveLength(0)
    expect(work!.items[0].bullets[0]).toContain('QPS')
  })

  it('replaces text inside a single-paragraph content and keeps the tag', () => {
    const document = createDefaultDocument()
    const work = document.sections.find((section) => section.type === 'experience')
    work!.items[0].content = '<p>负责订单系统的稳定性建设</p>'
    const { applied } = applyResumeEdits(document, [
      {
        before: '负责订单系统的稳定性建设',
        after: '主导高并发改造，支撑 10 万 QPS',
        reason: '量化',
      },
    ])
    expect(applied).toBe(1)
    expect(work!.items[0].content).toBe('<p>主导高并发改造，支撑 10 万 QPS</p>')
  })

  it('marks unmatched edits as failed instead of guessing', () => {
    const document = createDefaultDocument()
    const { applied, failed } = applyResumeEdits(document, [
      { before: '一句简历里不存在的话', after: '改写', reason: '不存在' },
    ])
    expect(applied).toBe(0)
    expect(failed).toHaveLength(1)
  })

  it('does not mangle multi-paragraph content', () => {
    const document = createDefaultDocument()
    const work = document.sections.find((section) => section.type === 'experience')
    work!.items[0].content = '<p>第一段</p><p>负责订单系统的稳定性建设</p>'
    const { applied, failed } = applyResumeEdits(document, [
      { before: '负责订单系统的稳定性建设', after: '主导改造', reason: '量化' },
    ])
    expect(applied).toBe(0)
    expect(failed).toHaveLength(1)
    expect(work!.items[0].content).toBe('<p>第一段</p><p>负责订单系统的稳定性建设</p>')
  })
})

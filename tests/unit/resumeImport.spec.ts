import { parseResumeText } from '@/domain/resume/importParser'

describe('resume PDF text import parser', () => {
  it('maps a Chinese resume into profile and structured sections', () => {
    const result = parseResumeText(
      [
        'Java后端开发 测试用户',
        '13800000000 | test@example.com',
        '24岁 | 男 | 示例大学 本科',
        '教育经历',
        '示例大学 2017年09月 - 2021年06月',
        '计算机科学与工程学院 示例城市',
        '相关课程：Java程序设计，数据结构',
        '专业技能',
        '熟练使用 Java 和 Spring Boot。',
        '工作经历',
        '示例科技有限公司 2022年06月 - 2023年04月',
        'Java开发工程师 示例城市',
        '负责需求评审和模块开发。',
        '项目经历',
        '业务协同平台',
        '项目详情：面向多部门协作。',
        '个人总结',
        '注重代码质量和团队协作。',
      ].join('\n'),
      'reference.pdf',
    )

    expect(result.document.profile.name).toBe('测试用户')
    expect(result.document.profile.displayTitle).toBe('Java后端开发')
    expect(result.document.profile.headline).toBe('目标职位')
    expect(result.document.profile.detail).toContain('24岁')
    expect(result.document.profile.phone).toBe('13800000000')
    expect(result.document.profile.email).toBe('test@example.com')
    expect(result.document.title).toBe('reference')
    expect(result.document.sections.map((section) => section.type)).toEqual([
      'education',
      'skills',
      'experience',
      'project',
      'summary',
    ])
    expect(
      result.document.sections.find((section) => section.type === 'experience')?.items[0].title,
    ).toBe('示例科技有限公司')
    expect(
      result.document.sections.find((section) => section.type === 'education')?.items[0].bullets,
    ).toContain('相关课程：Java程序设计，数据结构')
  })

  it('keeps unstructured text in an import section', () => {
    const result = parseResumeText('我的个人简历\n这里是一段没有标准标题的内容', 'plain.pdf')
    expect(result.document.sections).toHaveLength(1)
    expect(result.document.sections[0].title).toBe('导入内容')
    expect(result.warnings).toContain('没有识别到标准模块标题，已将全文放入“导入内容”。')
  })
})

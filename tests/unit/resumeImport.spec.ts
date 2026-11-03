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
    expect(result.document.title).toBe('测试用户')
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

  // 子集化字体常把汉字映射到康熙部首，并在字间插空格；这是真实 PDF 导入最大的坑。
  it('normalizes Kangxi radicals and collapsed CJK spacing from subset fonts', () => {
    const result = parseResumeText(
      [
        '电话：177****8476 ｜ 邮箱：****@163.com',
        '吴**',
        '现居： ⻄ 安 ｜ 27 岁 ｜ 男',
        'Agent 应⽤ 开发⼯程师',
        '个 ⼈ 简介',
        '5 年以上 Java 后端经验。',
        '核 ⼼ 技能',
        'Spring Boot、MySQL。',
        '⼯ 作经历',
        '某智慧空间公司 2023.07 - ⾄ 今',
        '负责后端系统建设。',
      ].join('\n'),
      'masked.pdf',
    )

    expect(result.document.profile.name).toBe('吴**')
    expect(result.document.profile.phone).toBe('177****8476')
    expect(result.document.profile.email).toBe('****@163.com')
    expect(result.document.profile.location).toBe('西安')
    expect(result.document.sections.map((section) => section.type)).toEqual([
      'summary',
      'skills',
      'experience',
    ])
    expect(result.document.sections[2].items[0].period).toBe('2023.07-至今')
    expect(result.warnings).toContain('手机号是脱敏格式，使用前请补全。')
    expect(result.warnings).toContain('邮箱是脱敏格式，使用前请补全。')
  })

  it('rejoins paragraphs that the PDF layout wrapped mid-sentence', () => {
    const result = parseResumeText(
      [
        '工作经历',
        '某公司 2023.07 - 至今',
        '负责订单服务的重构与优化，把平均响应时间从 3 秒降到 0.8 秒，整体',
        '性能提升约 70%。',
      ].join('\n'),
      'wrapped.pdf',
    )

    const item = result.document.sections[0].items[0]
    expect(item.title).toBe('某公司')
    expect(item.period).toBe('2023.07-至今')
    expect(item.subtitle).toContain('整体性能提升约 70%')
    expect(item.subtitle).not.toContain('整体\n')
  })

  it('does not treat body text mentioning a section as a new section header', () => {
    const result = parseResumeText(
      ['教育经历', '示例大学 2017.09 - 2021.06', '工作经历', '示例公司 2021.07 - 至今'].join('\n'),
      'sections.pdf',
    )
    const summaryLike = result.document.sections.find((section) => section.type === 'summary')
    expect(summaryLike).toBeUndefined()
    expect(result.document.sections.map((section) => section.type)).toEqual([
      'education',
      'experience',
    ])
  })

  it('does not treat numbers and percentages as ordered-list markers', () => {
    const result = parseResumeText(
      [
        '个人简介',
        '5 年以上 Java 后端开发经验，做过政务 SaaS、企业行政服务，问答优秀率从',
        '68.0% 提升到 89.3%。',
        '核心技能',
        '1. 熟悉 Spring Boot',
        '2. 熟悉 Redis',
      ].join('\n'),
      'percent.pdf',
    )

    const summary = result.document.sections.find((section) => section.type === 'summary')
    const summaryText = summary ? JSON.stringify(summary.items[0]) : ''
    // 68.0% 不能被当成编号剥成 0%，也不能被当成独立要点
    expect(summaryText).toContain('68.0% 提升到 89.3%。')
    expect(summaryText).not.toContain('"0% 提升到')

    // 真正的编号列表仍然要识别
    const skills = result.document.sections.find((section) => section.type === 'skills')
    expect(skills?.items[0].bullets).toEqual(['熟悉 Spring Boot', '熟悉 Redis'])
  })

  it('keeps dateless personal projects as separate entries', () => {
    const result = parseResumeText(
      [
        '项目经历',
        '业务平台 ｜ 公司项目 2023.07 - 至今',
        '技术栈：Java 17、MySQL',
        '负责后端开发。',
        '个人博客 ｜ 个人项目 · awen-9.github.io',
        '技术栈：Astro、TypeScript',
        '用 Astro 做的静态博客。',
        'Resume Studio ｜ 个人项目 · 本地简历编辑器',
        '技术栈：Vue 3、Fastify',
        '本机运行的简历编辑器。',
      ].join('\n'),
      'projects.pdf',
    )

    const items =
      result.document.sections.find((section) => section.type === 'project')?.items ?? []
    // 后两条没有日期，只靠「竖线 + 下一行是技术栈」判定，不能被上一条吞掉
    expect(items).toHaveLength(3)
    expect(items[1].title).toContain('个人博客')
    expect(items[2].title).toContain('Resume Studio')
    expect(items[2].subtitle).toContain('技术栈')
  })
})

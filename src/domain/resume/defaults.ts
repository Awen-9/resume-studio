import type { ResumeDocument, ResumeItem, ResumeSection, ResumeTheme, SectionType } from './model'

/**
 * 简历默认值与工厂函数。
 *
 * 提供默认主题、默认文档，以及创建 id / 条目 / 模块的辅助工厂，
 * 保证新建简历与导入结果遵循统一的数据结构，避免散落各处手写对象字面量。
 */

export const DEFAULT_THEME: ResumeTheme = {
  templateId: 'classic',
  pageMode: 'standard',
  fontFamily: 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
  fontSize: 12.5,
  lineHeight: 1.65,
  pageMargin: 18,
  sectionGap: 18,
  accentColor: '#315D8C',
  showPageNumber: false,
}

export const createId = (prefix: string): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const createItem = (overrides: Partial<ResumeItem> = {}): ResumeItem => ({
  id: createId('item'),
  title: '',
  subtitle: '',
  period: '',
  location: '',
  content: '',
  bullets: [],
  ...overrides,
})

export const createSection = (
  type: SectionType,
  overrides: Partial<ResumeSection> = {},
): ResumeSection => ({
  id: createId('section'),
  type,
  title: overrides.title ?? '',
  visible: overrides.visible ?? true,
  items: overrides.items ?? [createItem()],
})

export const createDefaultDocument = (): ResumeDocument => ({
  id: createId('resume'),
  title: '我的简历',
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  profile: {
    name: '你的姓名',
    headline: '目标职位',
    phone: '138 0000 0000',
    email: 'name@example.com',
    location: '所在城市',
    website: '',
  },
  theme: { ...DEFAULT_THEME },
  sections: [
    createSection('education', {
      title: '教育经历',
      items: [
        createItem({
          title: '某某大学',
          subtitle: '计算机科学与技术 · 本科',
          period: '2018.09 - 2022.06',
          location: '所在城市',
          content: '<p>相关课程：数据结构、数据库原理、软件工程、计算机网络</p>',
        }),
      ],
    }),
    createSection('skills', {
      title: '专业技能',
      items: [
        createItem({
          content:
            '<p>熟悉 Java、Spring Boot 和常用后端开发模式，能够独立完成模块设计、编码、测试与部署。</p>',
          bullets: [
            '熟悉 MySQL、Redis，了解索引设计、缓存策略和常见性能问题。',
            '熟悉 Git、Maven、Docker 等项目协作和交付工具。',
          ],
        }),
      ],
    }),
    createSection('experience', {
      title: '工作经历',
      items: [
        createItem({
          title: '某某科技有限公司',
          subtitle: '后端开发工程师',
          period: '2022.07 - 至今',
          location: '上海',
          content: '<p>负责业务需求分析、技术方案设计、核心模块开发和线上问题处理。</p>',
          bullets: ['推动公共组件抽取，减少重复代码并提升交付效率。'],
        }),
      ],
    }),
    createSection('project', {
      title: '项目经历',
      items: [
        createItem({
          title: '业务协同平台',
          subtitle: '核心开发成员',
          period: '2023.01 - 2024.03',
          location: '',
          content: '<p>面向多部门协作的业务平台，支持流程流转、数据统计和权限管理。</p>',
          bullets: [
            '设计并实现核心业务模块，完善异常处理和操作日志。',
            '优化高频查询接口，使平均响应时间降低约 35%。',
          ],
        }),
      ],
    }),
    createSection('summary', {
      title: '个人总结',
      items: [
        createItem({
          content: '<p>注重代码质量和协作效率，能够快速理解业务并持续改进交付结果。</p>',
        }),
      ],
    }),
  ],
})

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

/** 一份填好的示例简历：让新用户一眼看到「成品」长什么样。人名用虚构的。 */
export const createSampleDocument = (): ResumeDocument => ({
  id: createId('resume'),
  title: '示例 · 后端工程师',
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  profile: {
    name: '示例候选人',
    headline: '后端工程师',
    phone: '138 0000 0000',
    email: 'sample@example.com',
    location: '上海',
    website: '',
  },
  theme: { ...DEFAULT_THEME },
  sections: [
    createSection('summary', {
      title: '个人总结',
      items: [
        createItem({
          content:
            '<p>5 年后端开发经验，主导过高并发订单系统的架构改造，擅长性能优化与稳定性建设。</p>',
        }),
      ],
    }),
    createSection('experience', {
      title: '工作经历',
      items: [
        createItem({
          title: '示例科技有限公司',
          subtitle: '资深后端工程师',
          period: '2021.07 - 至今',
          location: '上海',
          content: '<p>负责订单系统的高并发改造与稳定性保障。</p>',
          bullets: [
            '主导订单系统改造，支撑大促峰值 10 万 QPS，P99 从 480ms 降到 90ms。',
            '搭建公共组件库，减少重复代码约 30%，缩短新项目交付周期。',
          ],
        }),
      ],
    }),
    createSection('project', {
      title: '项目经历',
      items: [
        createItem({
          title: '高并发订单系统改造',
          subtitle: '技术负责人',
          period: '2023.01 - 2024.06',
          location: '',
          content: '<p>重构下单链路，引入缓存与异步化，支撑大促峰值流量。</p>',
          bullets: [
            '设计 Redis 缓存 + 延迟消息方案，将下单接口平均耗时降低 45%。',
            '建立全链路压测与限流演练机制，保障大促 0 事故。',
          ],
        }),
      ],
    }),
    createSection('skills', {
      title: '专业技能',
      items: [
        createItem({
          content: '<p>精通 Java、Spring Boot；熟悉 Redis、MySQL 与分布式系统设计。</p>',
          bullets: [
            '熟练使用 Docker、K8s 完成服务部署与治理。',
            '具备性能调优与线上故障排查经验。',
          ],
        }),
      ],
    }),
    createSection('education', {
      title: '教育经历',
      items: [
        createItem({
          title: '示例大学',
          subtitle: '计算机科学与技术 · 本科',
          period: '2014.09 - 2018.06',
          location: '上海',
          content: '<p>主修数据结构、数据库原理、操作系统、计算机网络。</p>',
        }),
      ],
    }),
  ],
})

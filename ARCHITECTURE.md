# Resume Studio 架构说明

## 设计目标

Resume Studio 是本地优先的单机简历编辑器。数据只保存在浏览器 IndexedDB（旧版本会从 localStorage 迁移），浏览器与 Fastify 服务只通过本机地址通信。架构调整以职责清晰、可测试和可继续扩展为目标，不引入登录、云同步或远程数据存储。

## 目录分层

```text
src/
  app/                         应用启动、根组件和全局样式
  domain/resume/               简历模型、默认值、导入解析、分页、检查、HTML 渲染和模板样式
  features/
    home/                      首页简历列表与模板选择
    editor/                    编辑器、检查弹窗、属性面板和 A4 预览
    import-review/             PDF 导入确认与修订
  infrastructure/
    api/                       浏览器调用本机 API 的适配器
    export/                    DOCX 渲染适配器
    state/                     Pinia 编辑状态
    storage/                   IndexedDB、备份和模板样式持久化
  shared/utils/                与业务无关的浏览器工具
  main.ts                      Vite 保留的兼容入口

server/
  app.ts                       Fastify 应用组装，不负责进程启动
  config.ts                    端口、主机、静态目录和浏览器配置
  routes/                      HTTP 路由，仅处理协议和错误码
  services/                    PDF 文字提取、PDF 渲染和 DOCX 导出
  shared/                      服务端请求校验和本机来源校验
  index.ts                     唯一的进程启动入口

tests/
  unit/                        领域规则和本地存储测试
  integration/                 本机导入、PDF、DOCX 服务测试
  e2e/                         浏览器流程测试
```

## 依赖方向

页面组件依赖领域模型和基础设施接口；领域层不依赖 Vue、Fastify 或浏览器存储；服务端只调用领域渲染器和基础设施导出器。新增功能优先放在对应 feature 或 domain 子目录，避免把业务逻辑重新放回 `App.vue`、`server/index.ts` 或通用 `lib` 目录。

```text
features -> infrastructure -> browser/local API
    \-> domain/resume
server/routes -> server/services -> domain/infrastructure
```

## 兼容出口

历史版本的 `src/lib`、`src/data`、`src/types` 和 `src/stores` 目录已移除。这些路径曾作为极薄的 re-export 用于兼容旧测试和外部脚本，现已全部迁移到分层路径，不再保留任何兼容出口。

## 服务端请求流

1. `server/index.ts` 读取配置并调用 `buildServer`。
2. `server/app.ts` 注册 CORS、multipart、静态文件和所有路由。
3. 路由校验文件类型或简历结构，然后委托给 service。
4. service 调用领域解析/渲染逻辑，返回 Buffer 或结构化导入结果。
5. 路由统一转换为 HTTP 状态码和响应类型。

这样可以在不启动监听端口的情况下测试 `buildServer`，也可以单独测试 PDF 文字提取和导出服务。

## 信任边界

HTTP 请求体和备份文件都来自外部，进入系统前统一经过 `domain/resume/validation.ts` 的 `isResumeDocument` 结构校验；业务规则（姓名必填、邮箱格式等）由 `validateResumeDocument` 和导出前检查负责，两者分开。富文本在渲染前一律经过 `domain/resume/html.ts` 的 `sanitizeRichHtml`，它按白名单重建标签且不保留任何属性，预览、PDF 和 DOCX 共用这一份实现。

本地服务只监听本机地址，并由 `server/shared/localOriginGuard.ts` 校验每个请求：`Host` 必须是本机地址，带 `Origin` 的请求必须来自本机页面或桌面端，防止其他网站的跨站请求和 DNS 重绑定。

## 模板样式

简历页面和三套模板的样式只在 `domain/resume/templateStyles.ts` 定义一次。前端在 `app/main.ts` 把它注入页面，导出渲染器把它内联进 PDF 用的 HTML。`app/styles.css` 只保留预览专属的纸张阴影和选中高亮。新增或调整模板时只改这一处。

## 编辑历史

撤销/重做是 `resumeStore` 中的内存快照栈，只在当前会话有效。持久化的历史版本由 `indexedDbStorage` 管理：自动保存在两分钟窗口内合并为一条，手动保存和恢复历史始终新建，每份简历最多保留 20 条。

## 扩展约定

- 新增简历字段：先更新 `domain/resume/model.ts`，再补默认值、导入映射、渲染和测试。
- 新增导出格式：在 `infrastructure/export` 增加渲染器，在 `server/services` 增加适配器，在 `server/routes` 增加接口，并从 `localResumeApi.ts` 暴露给前端。
- 新增持久化能力：在 `infrastructure/storage` 增加实现，不直接在 Vue 组件中操作 IndexedDB。
- 新增页面流程：放入对应 `features` 子目录，由 `app/App.vue` 负责路由状态和跨页面编排。

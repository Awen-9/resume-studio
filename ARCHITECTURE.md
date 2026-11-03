# Resume Studio 架构说明

## 设计目标

Resume Studio 是本地优先的单机简历编辑器。数据只保存在浏览器 IndexedDB（旧版本会从 localStorage 迁移），浏览器与 Fastify 服务只通过本机地址通信。架构调整以职责清晰、可测试和可继续扩展为目标，不引入登录、云同步或远程数据存储。

## 目录分层

```text
src/
  app/                         应用启动、根组件和全局样式
  domain/resume/               简历模型、默认值、导入/备份解析、内容整形、分页装箱、检查和 HTML 渲染
  features/
    home/                      首页简历列表与模板选择
    editor/                    编辑器、检查弹窗、A4 预览、JD 匹配
      inspector/               属性面板的三个分区：个人信息 / 页面样式 / 模块内容
      ResumeHeaderBlock.vue    预览与测量共用的头部
      ResumeSectionBlock.vue   预览与测量共用的模块渲染单元
    import-review/             PDF 导入确认与修订
  infrastructure/
    api/                       浏览器调用本机 API 的适配器（含 AI 状态探测）
    export/                    DOCX 渲染适配器
    state/                     Pinia 编辑状态
    storage/                   IndexedDB、备份和模板样式持久化
  shared/
    utils/                     与业务无关的浏览器工具
    ui/                        Vue 组合式函数：对话框可访问性、AI 可用性、撤销焦点路由
  main.ts                      Vite 保留的兼容入口

server/
  app.ts                       Fastify 应用组装，不负责进程启动
  config.ts                    端口、主机、静态目录和浏览器配置
  routes/                      HTTP 路由，仅处理协议和错误码（含 ai/rewrite、ai/match、ai/status）
  services/                    PDF / Word 文字提取、PDF 渲染（两遍：测量后分页）和 DOCX 导出
  shared/                      服务端请求校验与 AI 并发闸门
  index.ts                     唯一的进程启动入口

tests/
  unit/                        领域规则、分页装箱、状态仓库和本地存储测试
  integration/                 本机导入、PDF、DOCX 服务测试
  e2e/                         浏览器流程测试
```

## 依赖方向

页面组件依赖领域模型和基础设施接口；领域层不依赖 Vue、Fastify 或浏览器存储；服务端只调用领域渲染器和基础设施导出器。新增功能优先放在对应 feature 或 domain 子目录，避免把业务逻辑重新放回 `App.vue`、`server/index.ts` 或通用 `lib` 目录。

```text
app -> features -> infrastructure -> domain
server/routes -> server/services -> domain
```

**这套方向由 ESLint 的 `no-restricted-imports` 强制**（见 `eslint.config.js`），目录结构本身拦不住违规。具体规则：

- `domain`：不能 import `@/features`、`@/infrastructure`、`@/app`、`@/shared/ui`、`server/`；
- `infrastructure`：只依赖 `domain`，不能反向依赖 features/app；
- `features`：不能 import `@/app` 与 `server/`；跨进程能力走 `infrastructure/api`；
- `server`：只能复用 `domain`，不能 import 前端 UI/存储。

曾经有一处真实违规：Word 渲染器放在 `src/infrastructure/export/`，但只有服务端用到——已移到 `server/services/docxRenderer.ts`。

## 错误处理

- 前端：`app.config.errorHandler`、`unhandledrejection`、`window.onerror` 统一走 `shared/ui/errorBus.ts`，
  由 `App.vue` 订阅后弹提示；`AbortError`（用户主动取消）被过滤，不算故障。
- 服务端：`setErrorHandler` 保证 4xx 透传业务消息、5xx 只回一句人话（完整堆栈进日志）；
  `setNotFoundHandler` 让 404 也是 `{ message }`，前端可以统一解析。
- 数据版本：`CURRENT_SCHEMA_VERSION`（当前 v1）之外的新版本备份会被**明确拒绝**，
  而不是静默归一化——后者会表现为「导入成功但数据缺了一块」。

## 兼容出口

历史版本的 `src/lib`、`src/data`、`src/types` 和 `src/stores` 目录已移除。这些路径曾作为极薄的 re-export 用于兼容旧测试和外部脚本，现已全部迁移到分层路径，不再保留任何兼容出口。

## 排版与导出的单一来源

分页是这类产品最容易「预览一套、导出另一套」的地方，所以这里把三件事分开：

1. **内容整形**（`pagination.ts` → `prepareSections`）：过滤隐藏模块、把超长条目切成「（续）」条目。只影响「切不切」，不影响「放哪页」。
2. **分页决策**（`layout.ts` → `planFragments`）：输入是「每个模块标题与每条内容量到的高度」和「每页可用高度」，输出是每页放哪些条目的片段。纯函数、有单测，预览和导出共用同一份。
3. **高度测量**：谁渲染谁量。预览在浏览器里用离屏测量层量（`ResumePreview.vue`），导出在无头 Chromium 里用测量页量（`pdfExporter.ts`）。

导出因此是**两遍渲染**：先出测量页拿高度，Node 里跑 `planFragments`，再按结果渲染正式页面打印。
不再有「打印时用脚本搬块」的 `__resumeReflow`——那正是过去预览与导出漂移的根源。

模板样式也只剩一份：`renderer.ts` 的 `RESUME_CONTENT_CSS` 既被导出内联，也被 `main.ts` 注入到预览；
`styles.css` 只保留编辑器外壳（页面投影、选中高亮、滚动定位）。预览、测量、导入确认三处共用
`ResumeHeaderBlock` / `ResumeSectionBlock`，所以「量高度的结构」和「最终看到的结构」是同一份组件。

分页单位是**条目**：模块在页边界处会被切开，续页重新渲染模块标题（纸质简历的常规做法）；
模块标题不会单独留在页底。目前只有「单条内容自身超过一页」时会独占一页并提示溢出——
把一段文字按行拆开需要逐行测量，暂不做。

### 固定页数

`theme.targetPages` 设置后，排版走另一条路径：

1. **先配平页数**：实测内容高度与「目标页数 × 每页容量」比较，按比例缩放字号/行距/模块间距后重测
   （内容多就压、少就撑；压缩没有人工下限，只在 0.25 倍处兜底防止无限循环，放大上限 1.25 倍）。
   缩放由 `nextFitFactor()` 逐轮给出，直到页数正好等于目标；缩得很小时预览会说明当前正文字号。
2. **再均摊**：`planFragments` 从较小的每页预算往上扫，取第一个恰好得到 N 页的方案——
   继续加大预算会让前面几页吃太满、最后一页空着，那就不是「铺满」了。
3. **最后撑开**：每页算出的剩余空间按「模块间距 + 条目间距」的个数平分，写进 `--resume-stretch`
   （上限 36px/处），预览与导出用同一份。

实测一份自然 2 页、第 2 页只有 77% 满的简历，固定 2 页后两页分别是 100% / 95%。

## 撤销的作用域

撤销只有一个入口（工具栏按钮 + `Ctrl/⌘+Z`），粒度由焦点决定：

- 焦点在富文本正文里 → 交给编辑器自身的历史（按字符/按段）；
- 焦点在普通输入框里 → 交给浏览器原生撤销；
- 焦点在别处 → 走应用历史栈（按保存点），覆盖加模块、删模块、排序这类结构修改。

实现在 `shared/ui/activeEditor.ts`（焦点注册表）+ `App.vue`（路由）。工具栏按钮带 `@mousedown.prevent`，
避免点按钮时编辑器先失焦、路由判断错。结构修改统一走自动保存的防抖队列，不要在 store 里直接落盘，
否则同一次操作会写两条历史，撤销会「看起来没反应」。

## 服务端请求流

1. `server/index.ts` 读取配置并调用 `buildServer`。
2. `server/app.ts` 注册 CORS、multipart、静态文件和所有路由。
3. 路由校验文件类型或简历结构，然后委托给 service。
4. service 调用领域解析/渲染逻辑，返回 Buffer 或结构化导入结果。
5. 路由统一转换为 HTTP 状态码和响应类型。

这样可以在不启动监听端口的情况下测试 `buildServer`，也可以单独测试 PDF 文字提取和导出服务。

## AI 请求流

AI 能力全部走本机 Ollama，不引入云服务，也不在浏览器里拼 prompt：

1. 前端先请求 `GET /api/ai/status`（3 秒超时），拿不到就禁用「AI 改写」和「开始体检」，并把原因写在入口旁边。
2. `POST /api/ai/rewrite/stream` 把 Ollama 的 NDJSON 逐块转成 SSE：`{"chunk":"…"}` / `{"done":true}` / `{"error":"…"}`。前端边收边显示，采用时用一次事务插入，因此 Ctrl+Z 能整段撤回。
3. `POST /api/ai/match` 让模型只输出 JSON（`format: 'json'`），再由服务端的**确定性校验**兜底：关键词回查原文（`reconcileTerms`）、删掉与命中项矛盾的建议（`dropContradictingSuggestions`）、核对模型引用的原文（`sanitizeEvidence`）。模型负责打分与措辞，事实判断交给可测试的代码。
4. 两类请求共用 `server/shared/aiLimiter.ts` 的串行队列，避免单卡并发互相拖慢；超时从真正拿到槽位后开始计时。
5. 客户端取消（关闭对话框 / 点「取消评估」）会断开连接，路由监听 `reply.raw` 的 `close` 并 abort 上游请求。

## 扩展约定

- 新增简历字段：先更新 `domain/resume/model.ts`，再补默认值、导入映射、渲染和测试；若该字段来自导入，还要确认预览与导出走同一个判断（例如头部版式的 `usesCompactHeader`）。
- 新增导出格式：在 `infrastructure/export` 增加渲染器，在 `server/services` 增加适配器，在 `server/routes` 增加接口，并从 `localResumeApi.ts` 暴露给前端。
- 新增持久化能力：在 `infrastructure/storage` 增加实现，不直接在 Vue 组件中操作 IndexedDB。撤销/重做只能在历史版本之间移动游标（`overwriteStoredDocument`），不要用「再保存一次」实现回退。
- 新增导入/恢复入口：解析与校验放在 `domain` 层（如 `backup.ts`），并且必须在写入之前完成——校验失败的路径不允许动到已有数据。
- 新增导入格式：文字提取放 `server/services`（如 `docxTextExtractor.ts`，用 mammoth 转 HTML 再还原成「一行一段、要点带 `- `」的文本），然后复用 `parseResumeText` 与导入确认页，不要另写一套解析。
- 新增弹窗：复用 `shared/ui/useDialogA11y`，保证 Esc 关闭、焦点陷阱和焦点归还，避免每个弹窗各写一套。
- 新增模板样式：只改 `renderer.ts` 的 `RESUME_CONTENT_CSS`（预览会注入同一份），不要往 `styles.css` 里加纸张内部规则。
- 调整字号：改 `domain/resume/typography.ts` 的 `TYPE_RATIO`，不要在各个渲染出口写死像素值；预览/PDF 用 `calc()` 换算，Word 用 `resolveSizes()` 转半磅并强制层级递增。
- 调整正文强调：`domain/resume/leadIn.ts` 负责「短标签：」前缀加粗，预览与导出都调用同一份；改规则时补 `tests/unit/leadIn.spec.ts` 的用例（尤其是「不该被当成标签」的反例）。
- 调整分页：改 `layout.ts` 的 `planPages` 并补单测；不要在预览或导出里各写一套循环。
- 新增页面流程：放入对应 `features` 子目录，由 `app/App.vue` 负责路由状态和跨页面编排。
- 新增 AI 能力：沿用「模型出结构化结果 + 本地确定性校验」的模式，并接入同一条 AI 队列与状态探测。
- 新增重依赖（编辑器、大弹窗）：用 `defineAsyncComponent` 按需加载，主包保持在 200 kB 以内。

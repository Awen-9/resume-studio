# 五轮迭代计划

## 第一轮：核心可靠性（已完成）

- PDF 原文与模板结果并排确认
- 导入后修改个人信息
- 模块移动、删除和新增
- 一页优先/强制一页模式
- 导出前检查和溢出阻断
- 导入头部和教育课程的语义化映射

## 第二轮：编辑效率（已完成）

- 编辑器撤销/重做
- 模块拖拽排序
- IndexedDB 历史版本
- 历史版本恢复
- 模板缩略图和实际模板样式区分

## 第三轮：产品化能力（已完成）

- DOCX 导出接口和编辑器导出入口
- 自定义强调色、模板样式保存和恢复
- OCR 引擎状态接口和扫描版 PDF 的明确错误提示
- OCR 状态路由改为动态检测 Tesseract（返回版本与可用性）

## 第四轮：工程与体验完善（已完成）

- 环境自愈：`npm run setup` 自动补装 rollup 原生包、清除 macOS Gatekeeper 对 fsevents 的隔离标记；README 新增常见问题章节
- 排版：超长内容块（单条超过页容量）按句子边界做段落级拆分，续段以「（续）」条目呈现，标题只在首段保留
- 模板变体：属性面板新增五组配色预设（藏蓝/青绿/石板灰/酒红/墨黑）与字体预设下拉
- Tiptap 2 → 3 升级（`setContent` 选项对象化；审计中的 Tiptap 中危告警消除）
- 移除 `src/lib`、`src/data`、`src/types`、`src/stores` 兼容 re-export，测试全部迁移到分层路径
- 集成测试超时加固（exporter 启动等待 20s → 40s，hook 超时 60s），修复并行执行时的偶发失败
- Tauri 2 桌面打包：`src-tauri` Rust 壳 + 前端静态加载 + Fastify 编译产物随包分发；应用启动时自动探测 node 并拉起导出服务，退出时回收子进程；已产出 `Resume Studio.app`（约 10 MB）
- 服务端 tsconfig 收窄 include，避免前端 API 文件进入服务端编译

## 第五轮：数据健壮性与工程收敛（已完成）

- 数据校验增强：`validateResumeDocument` 新增邮箱/手机号格式校验与 `schemaVersion` 版本校验（空值不误报，仅在有内容时校验格式）
- 修复 `importParser.ts` 中冗余的三元表达式（`dateInfo ? block.slice(1) : block.slice(1)` 两个分支相同），并补全文件级与正则注释
- 页面模式收敛：移除 `PageMode` 中与 `one-page-strict` 语义重复的历史遗留值 `'one-page'`，新增 `normalizePageMode` 归一化函数，旧数据自动映射为 `one-page-strict`；同步清理 checks / pagination / 属性面板 / 导出检查弹窗中的冗余判断
- 渲染漂移治理：为 `renderer.ts` 内联模板 CSS 与 `styles.css` 预览模板样式补充交叉引用注释，明确「预览与导出需保持视觉一致」的约定；补全 renderer / model / defaults / docxRenderer / resumeStore / indexedDbStorage 的中文注释
- 文档与 CI：同步 `README.en.md`（补充 Features、Not Included、常见问题、桌面打包章节）、更新 `CHANGELOG.md`；CI 新增独立的 typecheck 步骤
- 测试：新增邮箱/手机号/schemaVersion 校验、遗留 `one-page` 归一化共 4 个单元测试

已知遗留：

1. 桌面端子进程在本沙箱化环境中偶发被系统拦截导致导出服务延迟启动；浏览器/开发模式不受影响。真机验证与 sidecar 二进制化（`@yao-pkg/pkg`）列入下一轮。
2. vitest 3 的 dev 依赖链（tinypool）仍有审计告警，升级 vitest 5 需同步评估 vite 版本，暂缓。
3. DMG 打包依赖 hdiutil 挂载，在沙箱环境被拦截；普通终端执行 `npm run tauri:build` 即可产出完整 dmg。
4. `renderer.ts` 内联 CSS 与 `styles.css` 模板样式仍是两份独立定义，仅通过注释约定同步；彻底收敛为单一数据源需引入模板样式配置化重构，留待后续。

## 第六轮：安全与数据正确性修复（本次）

本轮来自一次整体代码审查，集中修复会导致数据丢失或注入的问题。

富文本清洗改为白名单重建：只输出 `p`、`strong`、`em`、`ul`、`ol`、`li`、`br` 这几个不带任何属性的标签，文本中零散的尖括号会被转义，原先正则清洗可被 `<scr<script>ipt>`、未闭合属性等写法绕过的问题随之消失。`escapeHtml`、`sanitizeRichHtml`、`stripHtml` 统一放到 `domain/resume/html.ts`，前端预览、服务端导出和 DOCX 渲染共用同一份实现，`stripHtml` 不再依赖 DOM。

导出接口和备份导入都改用 `isResumeDocument` 做结构校验。主题字段会写进内联样式，所以颜色只接受十六进制，字体名不允许出现 `;{}<>\`，数值限定在合理范围。备份导入先整体校验再写入，任何一份简历损坏都会放弃导入，不再出现清空现有数据后只写进一半的情况。

超长内容块拆分重写：先切正文、再切要点，按 700 字一段装箱，每个字符只出现一次。旧实现会在续段里重复整段正文。

撤销/重做改为内存快照栈（最多 100 步），支持连续撤销，未保存的编辑也算一步。自动保存在两分钟内合并为同一条历史版本，避免连续输入把有用的旧版本挤出 20 条上限；手动保存和恢复历史始终新建版本。

其他修复：邮箱正则补上首尾锚点，导出前检查新增邮箱错误与手机号提醒；PDF 导出复用同一个 Chromium 实例，每次请求使用独立的离线上下文，服务关闭时释放浏览器；桌面端去掉写死的本机 Node 路径，健康检查改用 TCP 连接，`is_executable` 在非 Unix 平台也能编译。

预览与导出的模板样式合并为 `domain/resume/templateStyles.ts` 一份定义：前端启动时注入页面，导出渲染器内联进 HTML，不再靠注释约定两边同步。

本地数据保护：启动时调用 `navigator.storage.persist()` 申请持久化存储，避免浏览器在磁盘紧张时清掉简历；距上次备份（或首次使用）超过 14 天时，首页提示导出备份。

本地服务新增来源校验：`Host` 必须是本机地址，带 `Origin` 的请求必须来自本机页面或桌面端，其他网站发来的跨站请求和 DNS 重绑定一律返回 403。

编辑器和导入确认页改为按需加载，首屏 JS 从 518 KB 降到 103 KB。CI 新增 macOS 和 Windows 上的 `cargo check`。

测试新增 `html.spec.ts`、`resumeStore.spec.ts`、`persistence.spec.ts`，并补充拆分不丢字不重复、损坏备份不覆盖数据、主题注入被拒绝、跨站请求被拒绝等用例；e2e 新增连续撤销/重做和备份恢复两个流程。

已知遗留：

1. 桌面安装包仍未内置服务端 `node_modules` 和 Chromium，干净机器上导出服务无法启动。需要把服务端打成 sidecar 二进制，并在首次导出时下载或复用系统浏览器。
2. 预览与导出已共用样式，但页面结构仍由 `ResumePreview.vue` 模板和 `renderResumeHtml` 各写一份。两边改动结构时需要同步，后续可考虑预览直接渲染 `renderResumeHtml` 的结果。
3. 撤销栈只存在内存中，刷新页面后清空；跨会话的回退依赖历史版本。

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

## 第五轮：数据健壮性与工程收敛（本次）

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

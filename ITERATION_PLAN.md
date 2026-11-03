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

## 第六轮：收口与加固（本次，分三批）

> 触发原因：功能已经多轮叠加，但「承诺」和「实现」有多处没接上——导出事件接错线、
> 「去修改」传错参数、AI 能力没写进文档、导入字段能存不能改。这一轮不加新功能，
> 只把已有能力收口，并把过去只能靠人眼确认的地方变成可回归的断言。

### 第一批：数据安全与入口闭环

- 备份解析下沉到 `domain/resume/backup.ts`：结构不可用的记录跳过并计数，字段缺失回落默认值，旧 `one-page` 归一化；**校验全部发生在写库之前**
- 恢复备份改为可撤销：导入前拍快照，toast 里给 6 秒撤销入口
- 本地库打不开时给出可读错误页和重试按钮，不再白屏；自动保存失败改为常驻横幅
- 防抖窗口内关闭页面会提示未保存
- 富文本清洗从「黑名单正则」改为「白名单词法解析 + 属性全丢弃」，修复 `<li/onclick>` 绕过
- JD「去修改」按建议里的词条反查模块，并把富文本正文纳入匹配；对话框关闭后保留结果

### 第二批：编辑器体验与一致性

- 属性面板拆开「密度」和「页数」：密度只写字号/行距/边距/间距，不再顺手改 `pageMode`
- 「强制一页 / 一页优先」显示预览实测页数，做不到时如实说明还差几页
- 导入写入的 `displayTitle` / `detail` / `headerLayout` 进属性面板；`usesCompactHeader` 让显式设置优先，可改回分层版式
- 编辑器改为三栏独立滚动，长简历不再把大纲滚出视野
- 修正 `layout-status` 接线（预览上报、编辑器消费），删掉导出前的重复 DOM 测量
- 新增 `useDialogA11y`：Esc 关闭、焦点陷阱、焦点归还；首页卡片去掉交互元素嵌套
- 导入时把识别到的目标职位写入 `targetRole`

### 第三批：可验证性与 AI 收口

- 新增 `resumeStore` 测试（撤销/重做游标、删除最后一份、模块顺序、保存失败上报），并把撤销从「再保存一次」改为移动游标（修复连按两次来回跳）
- 新增备份解析测试、清洗绕过用例、保存失败归一化用例
- 导出集成测试从「只校验 `%PDF` 魔数」升级为**页数与正文断言**，并新增多页简历不丢尾部的用例
- E2E 新增：删除后撤销、密度与页数互不覆盖、模型不可用时的降级与 Esc 关闭
- AI 入口接上 `GET /api/ai/status`；JD 体检支持取消，关闭弹窗即中断上游；错误文案去掉内部黑话
- 两类 AI 请求接入同一条串行队列；删除无人使用的非流式 `/api/ai/rewrite`
- README / README.en / ARCHITECTURE / CHANGELOG 同步 AI 能力与新约定

## 第七轮：把上一轮的遗留清掉（本次）

> 上一轮结束时的四条遗留：排版三份实现、属性面板单体、撤销两套语义、主包过大。
> 这一轮不加功能，只做收敛与拆解。

### 1. 排版收敛为「测量 + 单一装箱算法」

- 新增 `domain/resume/layout.ts`：`planFragments` 是**唯一**的分页决策实现，纯函数、有单测
- **模块可以跨页**：按条目装箱，续页重新渲染模块标题；标题不会被孤零零留在页底
- 预览改成「离屏测量一次 → 装箱 → 渲染」，删掉最多 40 轮的 DOM 搬运
- 导出改成**两遍渲染**：先量高度，再在 Node 里用同一个 `planFragments` 分批，最后按结果渲染；删除内联的 `__resumeReflow` 运行时重排脚本
- `pagination.ts` 只保留「内容整形」（过滤隐藏模块、超长条目拆「（续）」），不再决定页归属
- 模板样式收敛为 `RESUME_CONTENT_CSS`：导出内联、预览在 `main.ts` 注入同一份；`styles.css` 只留编辑器外壳（投影、选中高亮、滚动定位）
- 预览、测量、导入确认三处共用 `ResumeHeaderBlock` / `ResumeSectionBlock`，量到的结构和画出来的结构是同一份组件
- 实测：9 条工作经历的简历，预览 2 页 = 导出 PDF 2 页，模块在页边界处按条目切开、标题在续页重复

### 2. 属性面板拆成三个分区

- `inspector/PersonalInfoSection.vue`：个人信息 + 头部排版
- `inspector/PageStyleSection.vue`：密度 / 页数 / 配色 / 字体 / 高级
- `inspector/SectionContentEditor.vue`：模块标题与条目编辑（富文本按需加载）
- `InspectorPanel.vue` 只剩编排，从 496 行降到约 40 行

### 3. 撤销语义统一为「按焦点路由」

- 焦点在正文编辑器 → 走编辑器自身的撤销（按字符/按段，粒度更细）
- 焦点在别处 → 走应用历史栈（按保存点，覆盖加模块、删模块、排序等结构修改）
- 撤销/重做按钮与 `Ctrl/⌘+Z`、`Ctrl/⌘+Shift+Z` 走同一套路由，输入框内保留浏览器原生撤销
- 顺带修掉「一次结构操作写两条历史」：结构修改改走自动保存的防抖队列（`scheduleSave`），不再在 store 里立即落盘
- 工具栏在脏状态下显示「保存中…」，并暴露 `data-dirty` 供自动化等待真实落盘

### 4. 首屏分包

- JD 体检弹窗、Tiptap 富文本编辑器改为异步组件
- 主包从 548 kB（gzip 183 kB）降到 151 kB（gzip 55 kB）；Tiptap 单独成 394 kB 的按需 chunk，构建不再有超限告警

### 5. 收尾：把上一版列出的遗留逐条消掉

- **单条内容比一整页还高**：测量后按实测高度再切一次（句号分句、必要时均分要点），续段标「（续）」；最多补两轮，避免循环。实测一条 2400 字的段落（18px/2.4 行距）被切成 4 页，预览 4 = PDF 4，且不再提示溢出
- **预览自适应缩放**：按预览区宽度等比缩小纸张，1280 宽的屏幕上不再横向裁纸，页数旁显示缩放比例
- **vitest 3 → 5**：vite 仍是 6.4，无需一起升级；`npm audit` 从「3 个漏洞（2 critical）」变成 **0 漏洞**
- **视觉基线**：已提交 `tests/e2e/app.spec.ts-snapshots`，本机用 `npx playwright test --grep "visual baseline"` 校验，预期改动加 `--update-snapshots`

### 6. 桌面端的 Windows 支持

- **修掉编译不过的代码**：`src-tauri/src/lib.rs` 无条件用了 `std::os::unix::fs::PermissionsExt`，这个模块在 Windows 上根本不存在——之前这份代码在 Windows 上连编译都过不了
- **node 探测跨平台化**：新增 `Program Files\nodejs`、`%LOCALAPPDATA%\Programs\nodejs`、nvm-windows、Scoop 等候选；版本目录同时识别 `bin/node`（macOS）与 `node.exe`（Windows）
- **健康检查去掉 `sh -c "curl …"`**：Windows 上没有 `sh`，原写法会静默失效；改成直接连 TCP 127.0.0.1:4173
- **Windows 上以 `CREATE_NO_WINDOW` 启动 node**，避免打开应用时闪一个控制台窗口；找不到 node 时不再 panic，改为记录日志并让前端提示
- **修掉 `build:tauri` 的 Unix 写法**：`VITE_API_BASE_URL=... vite build` 在 Windows 的 cmd 下不成立，改成 `vite build --mode tauri` + 仓库内的 `.env.tauri`
- **新增 `npm run desktop:doctor`**：按平台检查 Rust / MSVC / WebView2 / Xcode / hdiutil，缺什么就打印对应的安装命令
- **CI 新增 `desktop` job**：在 `windows-latest`（自带 Rust + MSVC）上跑 `cargo check`，从此桌面壳的跨平台改动有编译反馈

## 环境限制（不是代码遗留）

1. 本机没有 Rust 与 MSVC 生成工具（`D:\Dev\Env\cargo` 是空的，`vswhere` 也不存在），且当前账号不是管理员，装不了 MSVC；所以 Windows 安装包要在装了工具链的机器上出，或者直接看 CI 的 `desktop` job。
2. macOS 的 DMG 依赖 `hdiutil`、签名/公证依赖 Apple 开发者证书，只能在 macOS 上产出。
3. 视觉基线依赖本机字体渲染，CI 上刻意跳过；换机器或换字体后用 `--update-snapshots` 重录即可。
4. Tauri 桌包子进程在带沙箱的 GUI 环境里可能被系统拦截，需要在真机上复核一次启动与退出回收。

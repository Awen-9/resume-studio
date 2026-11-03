import { expect, test } from '@playwright/test'

test('creates and edits a local resume', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ 新建简历' }).click()

  await expect(page.getByTestId('resume-preview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('姓名')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('姓名').fill('测试工程师')
  await page.getByLabel('目标职位').fill('Java 后端开发')
  await page.getByLabel('添加模块').selectOption('custom')
  await page.getByTestId('add-section').click()
  await expect(page.getByText('新模块').first()).toBeVisible()

  await page.getByLabel('模板').selectOption('accent')
  // 离屏测量层里也有同样结构的页面，断言要限定在可见的纸堆里
  await expect(page.locator('.paper-stack .resume-page.template-accent')).toBeVisible()
  await page.getByRole('button', { name: '一页优先' }).click()
  await expect(page.getByRole('button', { name: '一页优先' })).toHaveClass(/active/)
  // 等自动保存真正落盘：先确认进入「保存中」，再等它回到已保存
  await expect(page.locator('.editor-view')).toHaveAttribute('data-dirty', 'true')
  await expect(page.locator('.editor-view')).toHaveAttribute('data-dirty', 'false', {
    timeout: 15_000,
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('未命名简历')).toBeVisible()
  await page.getByText('未命名简历').click()
  await expect(page.getByLabel('姓名')).toHaveValue('测试工程师')
  await page.getByRole('button', { name: '历史' }).click()
  await expect(page.getByRole('heading', { name: '历史版本' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '恢复' }).first()).toBeVisible({ timeout: 15_000 })
})

test('requests a PDF export from the local exporter', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/api/export/pdf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: '%PDF-1.4 local-test',
    })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByLabel('姓名').fill('PDF 导出测试')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '预览并导出' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '导出 PDF' }).click()
  const download = await downloadPromise
  // 文件名带姓名，比「未命名简历.pdf」更像成品
  expect(download.suggestedFilename()).toContain('PDF 导出测试')
  expect(download.suggestedFilename()).toContain('.pdf')
})

test('imports parsed PDF content into the editor', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/api/import/pdf', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        document: {
          id: 'imported-e2e',
          title: '导入的简历',
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          profile: {
            name: '导入测试工程师',
            headline: 'Java 后端开发',
            phone: '13800000000',
            email: 'import@example.com',
            location: '西安',
            website: '',
          },
          theme: {
            templateId: 'classic',
            fontFamily: 'Arial, sans-serif',
            fontSize: 12.5,
            lineHeight: 1.65,
            pageMargin: 18,
            sectionGap: 18,
            accentColor: '#315D8C',
            showPageNumber: false,
          },
          sections: [
            {
              id: 'imported-summary',
              type: 'summary',
              title: '个人总结',
              visible: true,
              items: [
                {
                  id: 'summary-item',
                  title: '',
                  subtitle: '',
                  period: '',
                  location: '',
                  content: '<p>导入成功</p>',
                  bullets: [],
                },
              ],
            },
          ],
        },
        warnings: [],
        extractedLines: 5,
        sourceText: '导入测试工程师\nJava 后端开发\n个人总结\n导入成功',
      }),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await page.locator('#import-file').setInputFiles({
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  })
  await expect(page.getByText('确认导入内容')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('PDF 原文')).toBeVisible()
  await expect(page.getByRole('link', { name: '打开原文件' })).toBeVisible()
  // 同样的姓名也会出现在离屏测量层（不可见），断言要限定在可见纸堆里
  await expect(page.locator('.paper-stack').getByText('导入测试工程师').first()).toBeVisible()
  await page.getByRole('button', { name: '导入并开始编辑' }).click()
  await expect(page.getByTestId('resume-preview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('姓名')).toHaveValue('导入测试工程师', { timeout: 15_000 })
})

test('clicking a section in the preview scrolls the inspector to its editor', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(800)

  const panel = page.locator('.inspector-panel')
  const before = await panel.evaluate((element) => element.scrollTop)

  // 点预览里靠下的模块，右栏应滚到对应编辑区
  await page.locator('.paper-stack .resume-section').filter({ hasText: '个人总结' }).first().click()

  await expect(page.getByLabel('模块标题')).toHaveValue('个人总结', { timeout: 10_000 })
  const after = await panel.evaluate((element) => element.scrollTop)
  expect(after).toBeGreaterThan(before)
})

test('editing only the title still autosaves', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()

  // 不手动失焦：只改标题，等自动保存落盘后刷新页面
  await page.getByLabel('简历名称').fill('只改标题的简历')
  await page.waitForTimeout(900)
  await page.reload()
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await page.getByText('只改标题的简历').click()
  await expect(page.getByLabel('简历名称')).toHaveValue('只改标题的简历', { timeout: 10_000 })
})

test('adding a content item opens it, and deleting it can be undone', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(600)

  const items = page.locator('.item-editor')
  await expect(items).toHaveCount(1)
  await page.getByRole('button', { name: '+ 添加一条内容' }).click()
  await expect(items).toHaveCount(2)
  // 新条目要自动展开并聚焦，否则用户会以为没生效
  await expect(page.locator('.item-editor__body')).toHaveCount(1)
  expect(
    await page.evaluate(() => document.activeElement?.closest('[data-item-id]') !== null),
  ).toBe(true)

  await items.first().getByRole('button', { name: '删除' }).click()
  await expect(items).toHaveCount(1)
  await page.locator('.toast__action').click()
  await expect(items).toHaveCount(2, { timeout: 10_000 })
})

test('a new section is selected right away and deleting keeps a neighbour selected', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(600)

  await page.getByTestId('add-section').click()
  // 新模块自动选中，右栏直接显示它的编辑区
  await expect(page.getByLabel('模块标题')).toHaveValue('新模块', { timeout: 10_000 })

  await page.getByRole('button', { name: '删除模块' }).click()
  await expect(page.locator('.section-list__item.selected')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.getByLabel('模块标题')).toBeVisible()
})

test('content items can be reordered without deleting them', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(600)

  await page.locator('.item-editor').first().locator('input[type="text"]').first().fill('第一条')
  await page.getByRole('button', { name: '+ 添加一条内容' }).click()
  await page.locator('.item-editor').nth(1).locator('input[type="text"]').first().fill('第二条')
  await expect(page.locator('.item-editor__label')).toHaveText(['第一条', '第二条'])

  await page.locator('.item-editor').nth(1).getByRole('button', { name: '上移这条内容' }).click()
  await expect(page.locator('.item-editor__label')).toHaveText(['第二条', '第一条'])
})

test('a fixed page count disables the page-mode presets', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()

  const standard = page.getByRole('button', { name: '标准', exact: true })
  await expect(standard).toBeEnabled()
  await page.getByLabel('固定页数').selectOption('2')
  // 两个控件互斥，禁用比「能点但没效果」诚实
  await expect(standard).toBeDisabled()
  await page.getByLabel('固定页数').selectOption('')
  await expect(standard).toBeEnabled()
})

test('the check dialog can be opened without exporting', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()

  await page.getByRole('button', { name: /^检查/ }).click()
  const dialog = page.getByRole('dialog')
  // 检查模式：标题不同、没有导出格式切换、底部只有一个「开始修改」
  await expect(dialog.getByRole('heading', { name: '简历检查' })).toBeVisible()
  await expect(dialog.locator('.export-dialog__format')).toHaveCount(0)
  await expect(dialog.locator('footer button')).toHaveCount(1)
  await expect(dialog.locator('footer button')).toHaveText(/开始修改/)
  await dialog.getByRole('button', { name: '开始修改' }).click()
  await expect(dialog).toHaveCount(0)
})

test('a content item can be duplicated in place', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(600)

  const items = page.locator('.item-editor')
  await expect(items).toHaveCount(1)
  await page.locator('.item-editor').first().getByRole('button', { name: '复制这条内容' }).click()
  await expect(items).toHaveCount(2)
  // 复制出来的是同一条内容（默认选中的是教育经历），两条能各自编辑
  const labels = await page.locator('.item-editor__label').allTextContents()
  expect(labels).toHaveLength(2)
  expect(labels[0]).toBe(labels[1])
})

test('Escape closes the history drawer too', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()

  await page.getByRole('button', { name: '历史' }).click()
  await expect(page.locator('.history-drawer')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.history-drawer')).toHaveCount(0)
})

test('the inspector still fits on a 1024px laptop screen', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(800)

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('.inspector-panel')?.getBoundingClientRect()
    return {
      panelRight: panel ? Math.round(panel.right) : null,
      viewport: window.innerWidth,
      hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
  // 右栏不能被视口裁掉，整页也不该出现横向滚动
  expect(geometry.panelRight).toBeLessThanOrEqual(geometry.viewport)
  expect(geometry.hasHorizontalScroll).toBe(false)
})

test('narrow screens turn the inspector into a drawer', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()

  // 窄屏默认收起，靠把手滑出，且不能出现横向滚动
  await expect(page.locator('.inspector-panel')).toHaveCount(0)
  await page.getByRole('button', { name: '展开属性面板' }).click()
  await expect(page.locator('.inspector-panel')).toHaveCount(1)
  await page.getByRole('button', { name: '收起属性面板' }).click()
  await expect(page.locator('.inspector-panel')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  )
})

test('imports a Word document through the same review flow', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/api/import/docx', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        document: {
          id: 'imported-docx-e2e',
          title: 'Word 导入的简历',
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          profile: {
            name: 'Word 测试',
            headline: '行政主管',
            phone: '13800000000',
            email: 'word@example.com',
            location: '西安',
            website: '',
          },
          theme: {
            templateId: 'classic',
            fontFamily: 'Arial, sans-serif',
            fontSize: 12.5,
            lineHeight: 1.65,
            pageMargin: 18,
            sectionGap: 18,
            accentColor: '#315D8C',
            showPageNumber: false,
          },
          sections: [
            {
              id: 'word-summary',
              type: 'summary',
              title: '个人总结',
              visible: true,
              items: [
                {
                  id: 'word-item',
                  title: '',
                  subtitle: '',
                  period: '',
                  location: '',
                  content: '<p>Word 导入成功</p>',
                  bullets: [],
                },
              ],
            },
          ],
        },
        warnings: [],
        extractedLines: 4,
        sourceText: 'Word 测试\n行政主管\n个人总结\nWord 导入成功',
      }),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await page.locator('#import-file').setInputFiles({
    name: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PK-docx'),
  })

  await expect(page.getByText('确认导入内容')).toBeVisible({ timeout: 15_000 })
  // 来源文案要跟着格式走，别把 Word 说成 PDF
  await expect(page.getByText('Word 原文')).toBeVisible()
  await expect(page.getByText('PDF 原文')).toHaveCount(0)
  await page.getByRole('button', { name: '导入并开始编辑' }).click()
  await expect(page.getByTestId('resume-preview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('姓名')).toHaveValue('Word 测试', { timeout: 15_000 })
})

test('deletes a resume and restores it from the undo toast', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我的简历' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByLabel('姓名').fill('撤销测试')
  // 等自动保存真正落盘，再回列表删除
  await expect(page.locator('.editor-view')).toHaveAttribute('data-dirty', 'true')
  await expect(page.locator('.editor-view')).toHaveAttribute('data-dirty', 'false', {
    timeout: 15_000,
  })
  await page.getByRole('button', { name: '返回简历列表' }).click()
  await expect(page.locator('.document-card').first()).toBeVisible({ timeout: 15_000 })

  await page.locator('.document-card__delete').first().click()
  await expect(page.getByText('简历已删除')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.document-card__body strong').first()).toHaveText('未命名简历', {
    timeout: 10_000,
  })
})

test('density presets do not reset the page target', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByRole('button', { name: '一页优先' }).click()
  await expect(page.getByRole('button', { name: '一页优先' })).toHaveClass(/active/)

  // 之前「排版档位」会顺手把 pageMode 改回标准，这里锁住这个回归
  await page.getByRole('button', { name: '紧凑' }).click()
  await expect(page.getByRole('button', { name: '一页优先' })).toHaveClass(/active/)
  await expect(page.getByRole('button', { name: '紧凑' })).toHaveClass(/active/)
})

test('disables ai entries and closes dialogs with Escape when the model is down', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.route('**/api/ai/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: false, model: 'qwen3-8b', models: [] }),
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByRole('button', { name: 'JD 匹配' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/本机模型未就绪/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: '开始体检' })).toBeDisabled()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('undo follows focus: text inside the editor, structure outside', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()

  // 1) 焦点在正文里：Ctrl+Z 走编辑器自己的历史（按字符/按段）
  const content = page.locator('.rich-editor__content').first()
  await content.click()
  await page.keyboard.type('临时输入的句子')
  await expect(content).toContainText('临时输入的句子')
  await page.keyboard.press('Control+z')
  await expect(content).not.toContainText('临时输入的句子')

  // 2) 焦点在正文外：Ctrl+Z 走应用历史（按保存点，覆盖结构修改）
  const sectionCount = page.locator('.section-list__item')
  const initial = await sectionCount.count()
  await page.getByLabel('添加模块').selectOption('custom')
  await page.getByTestId('add-section').click()
  await expect(sectionCount).toHaveCount(initial + 1)
  // 等自动保存把这次结构修改写进历史
  await page.waitForTimeout(800)

  await page.getByRole('heading', { name: '属性面板' }).click()
  await page.keyboard.press('Control+z')
  await expect(sectionCount).toHaveCount(initial)
})

/**
 * 默认视口只有 1280 宽，放不下「大纲 + A4 纸 + 属性面板」。
 * 预览必须等比缩小到容器宽度，而不是让纸张被横向裁掉。
 */
test('preview scales the page down to fit the pane', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.getByRole('button', { name: '+ 新建简历' }).click()
  await page.getByTestId('resume-preview').waitFor()
  await page.waitForTimeout(700)

  const stage = await page.locator('.preview-stage').boundingBox()
  const stack = await page.locator('.paper-stack').boundingBox()
  expect(stage).not.toBeNull()
  expect(stack).not.toBeNull()
  expect(stack!.width).toBeLessThanOrEqual(stage!.width + 1)
  // 缩小后在页数旁边显示比例，用户知道自己在看缩放版
  await expect(page.locator('.preview-stage__meta').getByText(/\d+%/)).toBeVisible()
})

/**
 * 像素级视觉基线：只截纸张本身，不含工具栏时间等易变内容。
 *
 * 依赖本机字体渲染，因此在 CI 上跳过；本机改动排版后跑
 * `npx playwright test --grep "visual baseline"` 就能看出有没有意外的视觉漂移，
 * 确实是预期改动时用 `--update-snapshots` 重录基线。
 *
 * 视口固定为 1440×900：默认的 1280 宽不够放「大纲 + A4 纸 + 属性面板」，
 * 纸张会横向溢出预览区，截出来的就不是一张完整的纸。
 */
test.describe('visual baseline', () => {
  // 视口要同时满足两条：宽度放得下三栏 + 一张 A4 纸（1280 放不下），
  // 高度放得下一整页 297mm（否则纸张在滚动容器里被截断，截图会带上下半截底色）。
  test.use({ viewport: { width: 1440, height: 1300 } })

  test('resume paper matches the visual baseline', async ({ page }) => {
    test.skip(Boolean(process.env.CI), '视觉基线依赖本机字体，CI 上跳过')
    test.setTimeout(60_000)
    await page.goto('/')
    await page.getByRole('button', { name: '+ 新建简历' }).click()
    await page.getByTestId('resume-preview').waitFor()
    // 等首次测量、字体加载与页面高度稳定后再截，避免截到布局中间帧
    await page.waitForTimeout(1500)
    await expect(page.locator('.paper-stack .resume-page').first()).toHaveScreenshot(
      'resume-page.png',
      // 0.1%：能容忍抗锯齿噪声，又能抓到「某个标签没加粗」这种小改动
      { maxDiffPixelRatio: 0.001, animations: 'disabled' },
    )
  })
})

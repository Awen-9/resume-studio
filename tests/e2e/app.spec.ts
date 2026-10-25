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
  await expect(page.locator('.resume-page.template-accent')).toBeVisible()
  await page.getByRole('button', { name: '一页优先' }).click()
  await expect(page.getByRole('button', { name: '一页优先' })).toHaveClass(/active/)
  await page.getByTitle('保存').click()

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
  await page.getByRole('button', { name: '↓ 导出 PDF' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '导出 PDF' }).click()
  const download = await downloadPromise
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
  await page.locator('#import-pdf').setInputFiles({
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  })
  await expect(page.getByText('确认导入内容')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('PDF 原文')).toBeVisible()
  await expect(page.getByRole('link', { name: '打开原文件' })).toBeVisible()
  await expect(page.getByText('导入测试工程师').first()).toBeVisible()
  await page.getByRole('button', { name: '导入并开始编辑' }).click()
  await expect(page.getByTestId('resume-preview')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('姓名')).toHaveValue('导入测试工程师', { timeout: 15_000 })
})

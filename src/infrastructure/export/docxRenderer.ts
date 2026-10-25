import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx'
import { stripHtml } from '../../domain/resume/validation.js'
import type { ResumeDocument, ResumeItem } from '../../domain/resume/model.js'

const A4_WIDTH_TWIPS = 11906
const A4_HEIGHT_TWIPS = 16838

const textRuns = (
  value: string,
  options: { bold?: boolean; size?: number; color?: string } = {},
): TextRun[] => {
  return [
    new TextRun({
      text: value,
      bold: options.bold,
      size: options.size ?? 22,
      color: options.color,
      font: 'Arial Unicode MS',
    }),
  ]
}

const itemParagraphs = (item: ResumeItem): Paragraph[] => {
  const paragraphs: Paragraph[] = []
  if (item.title || item.period) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 80, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          ...textRuns(item.title, { bold: true, size: 22 }),
          new TextRun({ text: `\t${item.period}`, size: 20, font: 'Arial Unicode MS' }),
        ],
      }),
    )
  }
  if (item.subtitle || item.location) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          ...textRuns(item.subtitle, { size: 20, color: '4B5560' }),
          new TextRun({
            text: `\t${item.location}`,
            size: 20,
            color: '4B5560',
            font: 'Arial Unicode MS',
          }),
        ],
      }),
    )
  }
  const content = stripHtml(item.content)
  if (content)
    paragraphs.push(new Paragraph({ text: content, spacing: { after: 20 }, style: 'ResumeBody' }))
  for (const bullet of item.bullets.filter(Boolean)) {
    paragraphs.push(
      new Paragraph({
        text: bullet,
        bullet: { level: 0 },
        spacing: { after: 12 },
        style: 'ResumeBody',
      }),
    )
  }
  return paragraphs
}

export const renderResumeDocx = async (resume: ResumeDocument): Promise<Buffer> => {
  const profile = resume.profile
  const profileLine = [profile.phone, profile.email, profile.location, profile.website]
    .filter(Boolean)
    .join('  |  ')
  const headerTitle = [profile.displayTitle, profile.name].filter(Boolean).join(' ') || '未填写姓名'
  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 50 },
      children: [
        new TextRun({
          text: headerTitle,
          bold: true,
          size: profile.headerLayout === 'compact' ? 30 : 36,
          font: 'Arial Unicode MS',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 30 },
      children: textRuns(profileLine, { size: 19, color: '535353' }),
    }),
  ]
  if (profile.detail)
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 20 },
        children: textRuns(profile.detail, { size: 20 }),
      }),
    )
  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: textRuns(profile.headline || '目标职位', { size: 22 }),
    }),
  )

  for (const section of resume.sections.filter((item) => item.visible)) {
    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 140, after: 70 },
        border: { bottom: { color: '222222', style: BorderStyle.SINGLE, size: 8, space: 5 } },
        children: textRuns(section.title || '未命名模块', { bold: true, size: 25 }),
      }),
    )
    for (const item of section.items) paragraphs.push(...itemParagraphs(item))
  }

  const document = new Document({
    creator: 'Resume Studio',
    title: resume.title,
    styles: {
      paragraphStyles: [
        {
          id: 'ResumeBody',
          name: 'Resume Body',
          basedOn: 'Normal',
          run: { size: 21, font: 'Arial Unicode MS' },
          paragraph: { spacing: { line: 270 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH_TWIPS, height: A4_HEIGHT_TWIPS },
            margin: { top: 900, right: 900, bottom: 900, left: 900 },
          },
        },
        children: paragraphs,
      },
    ],
  })
  return Buffer.from(await Packer.toBuffer(document))
}

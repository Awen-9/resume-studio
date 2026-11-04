/**
 * 导入解析用到的正则与字符集。
 *
 * 单独放一份，避免 600 多行的解析器里到处散落正则常量；
 * 这些模式只描述“文本长什么样”，不包含任何解析流程。
 */

/**
 * 日期区间：`2018.09 - 2022.06`、`2018 年 9 月 至 2022 年 6 月`、`2020.1-至今`、`2024 - 至今`。
 * 最后一种（只有年份）在真实简历里很常见，必须支持，否则条目切不开。
 */
export const DATE_PATTERN =
  /((?:19|20)\d{2}\s*(?:[年./-]\s*\d{1,2}\s*月?)?\s*(?:-|–|—|~|至|到)\s*(?:(?:19|20)\d{2}\s*(?:[年./-]\s*\d{1,2}\s*月?)?|至今|现在))/i

/**
 * 手机号：允许 `+86` 前缀、`-`/空格分隔，**也允许脱敏写法**（如 `177****8476`）。
 * 原始实现只认 11 位纯数字，脱敏简历会直接漏掉。
 */
export const PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d[\d\s*-]{7,9}\d/

/** 邮箱：本地部分允许 `*`，兼容 `****@163.com` 这类脱敏地址。 */
export const EMAIL_PATTERN = /[A-Za-z0-9._%*+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/

/** 带协议的网址。 */
export const URL_PATTERN = /https?:\/\/[^\s|丨｜]+/i

/** 不带协议但在简历里常见的站点（`awen-9.github.io`、`github.com/Awen-9`）。 */
export const BARE_DOMAIN_PATTERN =
  /(?:[a-z0-9-]+\.)+(?:github\.io|com|cn|net|dev|me|io)(?:\/[^\s|丨｜]*)?/i

/** 姓名：2-4 个汉字，允许尾部脱敏星号（`吴**`、`张*`）。 */
export const NAME_PATTERN = /^[\u4e00-\u9fa5]{1,4}\*{0,4}$/

/** 联系方式/个人属性行的标签，识别姓名时用于排除。 */
export const CONTACT_LABEL_PATTERN =
  /(电话|手机|联系方式|邮箱|e-?mail|微信|现居|所在|地址|年龄|性别|生日)/i

/** 短标签行（`技术栈：`、`多 Agent 架构：`）——这类行不应与上一行拼接。 */
export const LABEL_LINE_PATTERN = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9/ ]{0,10}[：:]/

export const CJK = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF'
export const CJK_CHAR_PATTERN = new RegExp(`[${CJK}]`)
export const CJK_GAP_PATTERN = new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g')
export const CJK_END_GAP_PATTERN = new RegExp(`([${CJK}])[ \\t]+(?=[，。、；：！？）】」])`, 'g')

/**
 * 部分 PDF（尤其是子集化字体）会把汉字映射到「康熙部首」区（U+2E80–U+2FDF），
 * 例如 `人` 变成 `⼈`(U+2F08)、`心` 变成 `⼼`(U+2F3C)。
 *
 * U+2F00–U+2FD5（Kangxi Radicals）有 NFKC 映射，直接归一化即可；
 * 但 U+2E80–U+2EFF（CJK Radicals Supplement）里有相当一部分**没有**映射，
 * 例如 `⻄`(U+2EC4)、`⻋`(U+2ECB)，NFKC 后原样返回，必须自己补表。
 * 只对这两个区做替换，避免整段 NFKC 把中文全角标点改成半角。
 */
export const RADICAL_FALLBACK: Record<number, string> = {
  0x2ea0: '民',
  0x2ec4: '西',
  0x2ec5: '见',
  0x2ec6: '角',
  0x2ecb: '车',
  0x2ed3: '长',
  0x2ed4: '门',
  0x2eda: '页',
  0x2edb: '风',
  0x2edd: '食',
}

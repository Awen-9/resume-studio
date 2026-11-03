import {
  cleanRewrite,
  createRewriteStreamFilter,
  stripThinking,
} from '../../server/services/ollama'

describe('cleaning up model output', () => {
  // 标签用拼接写，避免编辑器/管道把尖括号吞掉
  const open = '<' + 'think>'
  const close = '<' + '/think>'

  it('drops a complete think block', () => {
    const raw = `${open}用户想要更好的说法，我先分析一下……${close}\n- 负责官网改版，首屏加载时间缩短`
    expect(stripThinking(raw)).toBe('\n- 负责官网改版，首屏加载时间缩短')
    expect(cleanRewrite(raw)).toBe('- 负责官网改版，首屏加载时间缩短')
  })

  it('drops a think block closed by the qwen special token', () => {
    const raw = `${open}先分析……<｜end▁of▁thinking｜>\n- 负责官网改版`
    expect(cleanRewrite(raw)).toBe('- 负责官网改版')
  })

  it('drops an unterminated think block instead of leaking half a reasoning chain', () => {
    const raw = `好的，我先分析一下\n${open}用户在描述一段工作经历`
    expect(cleanRewrite(raw)).toBe('')
  })

  it('removes the opening pleasantries small models love', () => {
    const raw = '好的，以下是改写结果：\n1. 负责订单系统稳定性建设\n2. 优化查询接口，响应时间下降'
    expect(cleanRewrite(raw)).toBe('- 负责订单系统稳定性建设\n- 优化查询接口，响应时间下降')
  })

  it('normalises bullet markers and numbering', () => {
    expect(cleanRewrite('• 负责 A\n* 负责 B\n3、负责 C')).toBe('- 负责 A\n- 负责 B\n- 负责 C')
  })

  it('drops closing small talk and caps the bullet count', () => {
    const raw = '- 负责一\n- 负责二\n- 负责三\n- 负责四\n希望有帮助！'
    expect(cleanRewrite(raw)).toBe('- 负责一\n- 负责二\n- 负责三')
  })

  it('returns nothing when the model only produced chatter', () => {
    expect(cleanRewrite('好的，我可以帮你改写这段内容。')).toBe('')
  })
})

describe('streaming prefix gate', () => {
  it('holds the text until it can strip the preamble, then passes the rest through', () => {
    const filter = createRewriteStreamFilter()
    expect(filter.push('好的，以下是')).toBe('')
    const released = filter.push('改写结果：\n- 负责官网改版')
    expect(released).toBe('- 负责官网改版\n')
    expect(filter.push('，首屏加载时间缩短')).toBe('，首屏加载时间缩短')
  })

  it('releases long text even without a newline', () => {
    const filter = createRewriteStreamFilter()
    const released = filter.push('- ' + '负'.repeat(250))
    expect(released.startsWith('- 负')).toBe(true)
  })
})

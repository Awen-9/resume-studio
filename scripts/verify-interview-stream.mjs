/**
 * 复现 / 验证：用假的 OpenAI 兼容服务驱动真实的出题链路。
 *
 * 直接起一个假 DeepSeek（中文枚举、JSON 数组、代码块三种输出都模拟），
 * 再起真实服务端指向它，调用 /api/interview/questions/stream 看事件流。
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const fakePort = 4300
const appPort = 4301

// 模拟网关的三种常见输出形态，轮流返回
const replies = [
  // 形态 1：一行一个 JSON，但枚举是中文
  [
    '{"type":"场景题","question":"大促流量突增十倍，你的排查顺序是什么？","answer":"**简要回答**\\n先看入口 QPS 与错误率，再看 DB 连接数。\\n\\n**详细回答**\\n1) 先确认是流量问题还是故障。\\n2) 再看慢查询与锁等待。","difficulty":"中等"}',
    '{"type":"算法题","question":"实现一个令牌桶限流器","answer":"**简要回答**\\n令牌桶按速率补充令牌，取令牌 O(1)。","difficulty":"困难"}',
  ].join('\n'),
  // 形态 2：一个 JSON 数组（pretty-printed）
  JSON.stringify(
    {
      questions: [
        {
          type: 'scenario',
          question: '大促流量突增十倍，你的排查顺序是什么？',
          answer: '**简要回答** 先看入口 QPS 与错误率，再看 DB 连接数。',
          difficulty: '中等',
        },
      ],
    },
    null,
    2,
  ),
  // 形态 3：代码块包裹的数组
  '```json\n[{"type":"项目深挖","question":"你的 Agent 评测集怎么建的？","answer":"**简要回答** 从线上 trace 采样，覆盖成功与失败 case。","difficulty":"中等"}]\n```',
]

let callIndex = 0

const fake = createServer((req, res) => {
  if (req.url?.includes('/models')) {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }))
    return
  }
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const content = replies[Math.min(callIndex, replies.length - 1)]
    callIndex += 1
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
})

await new Promise((resolve) => fake.listen(fakePort, '127.0.0.1', resolve))

const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(appPort),
    HOST: '127.0.0.1',
    OLLAMA_URL: 'http://127.0.0.1:9',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
  },
  stdio: 'ignore',
})

const base = `http://127.0.0.1:${appPort}`
for (let i = 0; i < 60; i += 1) {
  try {
    const health = await fetch(`${base}/api/health`)
    if (health.ok) break
  } catch {
    // 还在启动
  }
  await sleep(500)
}

const payload = {
  jd: '负责 Agent 系统的架构设计与落地，熟悉 LangGraph 与 RAG',
  resume: '五年后端，做过 Agent 工具层与 RAG 检索链路',
  types: ['scenario', 'algorithm', 'project'],
  count: 2,
  provider: 'deepseek',
  apiKey: 'sk-fake',
  profile: 'deep',
  model: 'deepseek-flash',
}

for (const round of [1, 2, 3]) {
  const response = await fetch(`${base}/api/interview/questions/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  const events = text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice(6)))
  const questions = events.filter((event) => event.question)
  const error = events.find((event) => event.error)
  console.log(
    `round ${round}: status=${response.status} questions=${questions.length} done=${events.some((event) => event.done === true)}`,
    error ? `error=${JSON.stringify(error)}` : '',
  )
  if (questions[0]) {
    const q = questions[0].question
    console.log('   first =', q.type, '|', q.question.slice(0, 30))
  }
}

child.kill('SIGTERM')
fake.close()

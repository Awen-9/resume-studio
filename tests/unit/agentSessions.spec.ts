import { describe, expect, it } from 'vitest'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import {
  MAX_AGENT_SESSIONS,
  agentCheckpointer,
  trackAgentSession,
} from '../../server/services/agentGraph/graph'

const State = Annotation.Root({
  value: Annotation<number>({ reducer: (_previous, next) => next, default: () => 0 }),
})

const graph = new StateGraph(State)
  .addNode('noop', () => ({ value: 1 }))
  .addEdge(START, 'noop')
  .addEdge('noop', END)
  .compile({ checkpointer: agentCheckpointer })

const configFor = (threadId: string) => ({ configurable: { thread_id: threadId } })

describe('agent session cap', () => {
  it('keeps only the newest sessions and evicts the oldest', async () => {
    const ids = Array.from({ length: MAX_AGENT_SESSIONS + 1 }, (_, index) => `test-thread-${index}`)

    for (const id of ids) {
      await graph.invoke({}, configFor(id))
      await trackAgentSession(id)
    }

    expect(await agentCheckpointer.getTuple(configFor(ids[0]))).toBeUndefined()
    expect(await agentCheckpointer.getTuple(configFor(ids[ids.length - 1]))).toBeDefined()
  })
})

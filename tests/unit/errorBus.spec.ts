import { onUnexpectedError, reportUnexpectedError } from '@/shared/ui/errorBus'

describe('unexpected error bus', () => {
  it('delivers the message to subscribers', () => {
    const seen: string[] = []
    const stop = onUnexpectedError((message) => seen.push(message))
    reportUnexpectedError(new Error('预览挂了'))
    stop()
    expect(seen).toEqual(['预览挂了'])
  })

  it('ignores user cancellations', () => {
    const seen: string[] = []
    const stop = onUnexpectedError((message) => seen.push(message))
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    reportUnexpectedError(abort)
    stop()
    expect(seen).toEqual([])
  })

  it('stops notifying after unsubscribe', () => {
    const seen: string[] = []
    const stop = onUnexpectedError((message) => seen.push(message))
    stop()
    reportUnexpectedError(new Error('晚到的错误'))
    expect(seen).toEqual([])
  })
})

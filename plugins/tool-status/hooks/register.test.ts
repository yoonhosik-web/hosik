import { test, expect } from 'claude-code/testing'

test('도구 호출마다 상태 표시줄을 갱신한다', async ($, on) => {
  const lines: (string | undefined)[] = []
  on('ui.status', (_$, e) => { lines.push(e.text); return { value: undefined } })
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/tmp/x' })

  expect(lines).toEqual(['🔧 1회 · 마지막: Bash', '🔧 2회 · 마지막: Read'])
})

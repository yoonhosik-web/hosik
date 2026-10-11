import type { Register } from 'claude-code'

export const register: Register = on => {
  let calls = 0
  let failures = 0

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    calls += 1
    if (ran.deny === undefined && ran.isError === true) failures += 1

    const failed = failures > 0 ? ` · 실패 ${failures}` : ''
    $.ui.status(`🔧 ${calls}회 · 마지막: ${e.tool}${failed}`)

    return ran
  }).catch(($, e, next) => next(e))
}

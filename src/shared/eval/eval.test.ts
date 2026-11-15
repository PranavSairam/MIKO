/**
 * Deterministic evaluation against the synthetic dataset (no paid model calls).
 * Mocked/fixture parses are never reported as model accuracy.
 * Real-model scoring (if any) must be recorded separately via `npm run eval:live`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { routeCommand, type CatalogApp } from '../commands.ts'
import { shouldTryInterpreter, tryDeterministicPlan } from '../interpret.ts'
import { detectNegations } from '../actions.ts'

const catalog: CatalogApp[] = [
  { id: 'chrome', name: 'Chrome', installed: true, familiar: true, aliases: ['chrome', 'google chrome'] },
  { id: 'whatsapp', name: 'WhatsApp', installed: true, familiar: true, aliases: ['whatsapp', 'whats app'] }
]

type Expect = {
  kinds: string[]
  name?: string
  browser?: string
  target?: string
  noDraft?: boolean
  noToolFromSource?: boolean
  needsInterpret?: boolean
}

type Example = {
  id: string
  set?: string
  input: string
  source: 'typed' | 'voice'
  context?: { pendingUrl?: boolean; waChat?: string; lastWebsite?: string; waDraftActive?: boolean; poisonMessage?: string }
  expect: Expect
}

type FailureClass =
  | 'wrong_intent'
  | 'missing_arguments'
  | 'lost_context'
  | 'unnecessary_clarification'
  | 'unsupported_capability'
  | 'execution_failure'
  | 'needs_interpret'
  | 'ok'

type ScoreRow = {
  id: string
  path: 'deterministic_plan' | 'deterministic_route' | 'would_call_interpret'
  ok: boolean
  got: string[]
  expect: string[]
  classification: FailureClass
  detail: string
}

function mapDecision(
  input: string,
  source: 'typed' | 'voice',
  ctx: Example['context']
): { kinds: string[]; meta: Record<string, string | undefined>; path: ScoreRow['path']; decisionType: string } {
  const planned = tryDeterministicPlan(input, source)
  if (planned) {
    return {
      kinds: planned.steps.map((s) => s.kind),
      meta: { target: planned.steps[0]?.target || planned.steps[1]?.target || undefined },
      path: 'deterministic_plan',
      decisionType: 'deterministic_plan'
    }
  }
  const routerCtx = {
    assistantActive: false,
    messaging: ctx?.waChat ? ('whatsapp' as const) : null,
    waChat: ctx?.waChat ?? null,
    waDraftActive: ctx?.waDraftActive,
    pendingUrl: ctx?.pendingUrl ? { url: 'https://www.youtube.com/', name: 'YouTube' } : null,
    lastWebsite: ctx?.lastWebsite ? { url: 'https://www.youtube.com/', name: ctx.lastWebsite } : null
  }
  const decision = routeCommand(input, source, catalog, [], routerCtx)
  const kinds: string[] = []
  const meta: Record<string, string | undefined> = {}
  switch (decision.type) {
    case 'open-url':
      kinds.push('open_website')
      meta.browser = decision.browser || undefined
      meta.name = decision.name
      break
    case 'close-website':
      kinds.push('close_website')
      meta.name = decision.name
      break
    case 'cancel-workflow':
      kinds.push('cancel_task')
      break
    case 'whatsapp':
      kinds.push('open_whatsapp_chat')
      if (decision.pendingDraft) kinds.push('draft_whatsapp')
      meta.target = decision.query
      break
    case 'whatsapp-summarize':
      kinds.push('summarize_whatsapp')
      break
    case 'whatsapp-attachment':
      kinds.push(
        decision.intent.op === 'attach-here' || decision.intent.op === 'attach-elsewhere'
          ? 'attach_file'
          : decision.intent.op === 'copy-file'
            ? 'copy_file'
            : 'fetch_whatsapp_attachment'
      )
      break
    case 'whatsapp-reply':
      kinds.push(decision.intent.refine ? 'refine_draft' : 'draft_whatsapp')
      break
    case 'mail':
      kinds.push(decision.intent.kind === 'search' ? 'search_mail' : `mail_${decision.intent.kind}`)
      break
    case 'question':
    case 'ask-gpt':
      kinds.push('ask_assistant')
      break
    default:
      kinds.push(decision.type)
  }
  const tryInterp = shouldTryInterpreter(decision, input, {
    waChat: routerCtx.waChat,
    messaging: routerCtx.messaging,
    waDraftActive: routerCtx.waDraftActive,
    pendingUrl: routerCtx.pendingUrl
  })
  return {
    kinds,
    meta,
    path: tryInterp ? 'would_call_interpret' : 'deterministic_route',
    decisionType: decision.type
  }
}

function classifyMiss(ex: Example, got: string[], decisionType: string, path: ScoreRow['path']): FailureClass {
  if (ex.expect.needsInterpret && path === 'would_call_interpret') return 'needs_interpret'
  if (ex.expect.kinds.includes('ask_assistant') && !got.includes('ask_assistant')) return 'wrong_intent'
  if (got.includes('ask_assistant') && !ex.expect.kinds.includes('ask_assistant')) return 'wrong_intent'
  if (got.includes('unknown') || decisionType === 'unknown') {
    return ex.expect.needsInterpret ? 'needs_interpret' : 'unsupported_capability'
  }
  if (got.includes('clarify') || decisionType === 'choices' || decisionType === 'mail-or-app') {
    return 'unnecessary_clarification'
  }
  if (ex.context?.waChat || ex.context?.waDraftActive || ex.context?.pendingUrl) {
    if (!ex.expect.kinds.every((k) => got.includes(k))) return 'lost_context'
  }
  if (ex.expect.target || ex.expect.browser || ex.expect.name) return 'missing_arguments'
  return 'wrong_intent'
}

function scoreUnfamiliar(examples: Example[]): { pass: number; rows: ScoreRow[]; wouldInterpret: number } {
  let pass = 0
  let wouldInterpret = 0
  const rows: ScoreRow[] = []
  for (const ex of examples) {
    const { kinds, path, decisionType } = mapDecision(ex.input, ex.source, ex.context)
    const ok = ex.expect.kinds.every((k) => kinds.includes(k))
    if (ok) pass += 1
    if (path === 'would_call_interpret') wouldInterpret += 1
    const classification: FailureClass = ok ? 'ok' : classifyMiss(ex, kinds, decisionType, path)
    rows.push({
      id: ex.id,
      path,
      ok,
      got: kinds,
      expect: ex.expect.kinds,
      classification,
      detail: `${ex.id}: ${ok ? 'PASS' : 'MISS'} path=${path} class=${classification} got=[${kinds.join(',')}] expect=[${ex.expect.kinds.join(',')}]`
    })
  }
  return { pass, rows, wouldInterpret }
}

describe('MIKO evaluation (deterministic)', () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'dataset.json')
  const data = JSON.parse(readFileSync(path, 'utf8')) as { examples: Example[] }

  it('scores the development set without inventing accuracy', () => {
    const dev = data.examples.filter((e) => e.set === 'dev')
    let pass = 0
    const failures: string[] = []
    for (const ex of dev) {
      const { kinds, meta } = mapDecision(ex.input, ex.source, ex.context)
      const okKinds = ex.expect.kinds.every((k) => kinds.includes(k))
      const okBrowser = !ex.expect.browser || meta.browser === ex.expect.browser
      const okTarget = !ex.expect.target || meta.target === ex.expect.target
      const okNoDraft = !ex.expect.noDraft || !kinds.includes('draft_whatsapp')
      if (okKinds && okBrowser && okTarget && okNoDraft) pass += 1
      else failures.push(`${ex.id}: got [${kinds.join(',')}] meta=${JSON.stringify(meta)}`)
    }
    assert.equal(failures.length, 0, failures.join('\n'))
    assert.equal(pass, dev.length)
  })

  it('reports the original holdout set separately from development', () => {
    const holdout = data.examples.filter((e) => e.set === 'holdout')
    let pass = 0
    const failures: string[] = []
    for (const ex of holdout) {
      const { kinds } = mapDecision(ex.input, ex.source, ex.context)
      if (ex.expect.kinds.every((k) => kinds.includes(k))) pass += 1
      else failures.push(`${ex.id}: got [${kinds.join(',')}]`)
    }
    assert.ok(
      pass >= 3,
      `holdout (familiar) ${pass}/${holdout.length}${failures.length ? `: ${failures.join('; ')}` : ''}`
    )
  })

  it('scores held-out unfamiliar v1 separately (deterministic path only; not model accuracy)', () => {
    const pathUf = join(dirname(fileURLToPath(import.meta.url)), 'holdout-unfamiliar.json')
    const uf = JSON.parse(readFileSync(pathUf, 'utf8')) as { examples: Example[] }
    const { pass, rows, wouldInterpret } = scoreUnfamiliar(uf.examples)
    assert.equal(uf.examples.length, 10, `unfamiliar holdout size ${uf.examples.length}`)
    const ordinary = uf.examples.find((e) => e.id === 'uf-ordinary-q')
    assert.ok(ordinary)
    const ordinaryResult = mapDecision(ordinary!.input, ordinary!.source, ordinary!.context)
    assert.ok(ordinaryResult.kinds.includes('ask_assistant'), `ordinary Q got ${ordinaryResult.kinds.join(',')}`)
    // Deterministic-only score. Real-model accuracy is not claimed here.
    assert.ok(
      pass >= 3,
      `holdout-unfamiliar v1 deterministic ${pass}/${uf.examples.length}; would_call_interpret=${wouldInterpret}. ${rows.map((r) => r.detail).join(' | ')}`
    )
  })

  it('scores held-out unfamiliar v2 separately (frozen before improvements; not model accuracy)', () => {
    const pathUf2 = join(dirname(fileURLToPath(import.meta.url)), 'holdout-unfamiliar-v2.json')
    const uf2 = JSON.parse(readFileSync(pathUf2, 'utf8')) as { examples: Example[] }
    const { pass, rows, wouldInterpret } = scoreUnfamiliar(uf2.examples)
    assert.equal(uf2.examples.length, 10, `unfamiliar holdout v2 size ${uf2.examples.length}`)
    const ordinary = uf2.examples.find((e) => e.id === 'uf2-ordinary-sky')
    assert.ok(ordinary)
    const ordinaryResult = mapDecision(ordinary!.input, ordinary!.source, ordinary!.context)
    assert.ok(ordinaryResult.kinds.includes('ask_assistant'), `ordinary Q got ${ordinaryResult.kinds.join(',')}`)
    // Baseline before improvements was 2/10; improvements may raise deterministic score.
    // Still never treat this as paid-model accuracy.
    assert.ok(
      pass >= 2,
      `holdout-unfamiliar v2 deterministic ${pass}/${uf2.examples.length}; would_call_interpret=${wouldInterpret}. ${rows.map((r) => r.detail).join(' | ')}`
    )
  })

  it('detects send/type/reply negations without eating message content', () => {
    const n = detectNegations("tell him I'll visit next month but don't send it")
    assert.equal(n.send, true)
    assert.match(n.rest, /visit next month/i)
  })
})

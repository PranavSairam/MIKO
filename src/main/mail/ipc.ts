import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../../shared/api'
import { MAIL_FILTERS, cleanQuery, parseRules, type MailCategory, type MailFilter } from '../../shared/mail'
import { isTrustedSender } from '../pet-window'
import { mailCorrections, mailRules, setMailRules } from '../settings'
import { connectAccount, correctCategory, disconnectAccount, listMail, mailStatus, openOriginal, openSetupLink, readMail, setupGoogle } from './service'

/** Mail IPC. Only the pet window may call; every argument is re-validated here. */
export function registerMailIpc(): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => isTrustedSender(event.sender.id)
  const email = (v: unknown): string | null => (typeof v === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(v) ? v : null)

  ipcMain.handle(IPC.mailStatus, (event) => (trusted(event) ? mailStatus() : null))
  ipcMain.handle(IPC.mailConnect, (event, hint: unknown) =>
    trusted(event) ? connectAccount(email(hint) ?? undefined) : { ok: false, reason: 'Not allowed.' }
  )
  ipcMain.handle(IPC.mailDisconnect, (event, account: unknown) => {
    const valid = email(account)
    return trusted(event) && valid ? disconnectAccount(valid) : false
  })
  ipcMain.handle(IPC.mailList, (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    const filter: MailFilter = MAIL_FILTERS.includes(p.filter as MailFilter) ? (p.filter as MailFilter) : 'all'
    const account = p.account === 'all' ? 'all' : email(p.account)
    if (typeof p.listId !== 'string' || p.listId.length > 64 || !account) return null
    return listMail({
      listId: p.listId,
      more: p.more === true,
      filter,
      query: typeof p.query === 'string' ? cleanQuery(p.query) : '',
      account,
      unreadOnly: p.unreadOnly === true
    })
  })
  ipcMain.handle(IPC.mailRead, (event, key: unknown) =>
    trusted(event) && typeof key === 'string' && key.length < 300 ? readMail(key) : { ok: false, reason: 'Not allowed.' }
  )
  ipcMain.handle(IPC.mailOpenOriginal, (event, key: unknown) =>
    trusted(event) && typeof key === 'string' && key.length < 300 ? openOriginal(key) : false
  )
  ipcMain.handle(IPC.mailSetup, (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return { ok: false, reason: 'Not allowed.' }
    const { clientId, clientSecret } = payload as { clientId?: unknown; clientSecret?: unknown }
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string' || clientId.length > 200 || clientSecret.length > 200) {
      return { ok: false, reason: 'Not allowed.' }
    }
    return setupGoogle(clientId, clientSecret)
  })
  ipcMain.handle(IPC.mailRules, (event) => (trusted(event) ? mailRules() : null))
  ipcMain.handle(IPC.mailCorrections, (event) => (trusted(event) ? mailCorrections() : null))
  ipcMain.handle(IPC.mailCorrect, (event, payload: unknown) => {
    if (!trusted(event) || !payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    const categories: MailCategory[] = ['action', 'fyi', 'updates', 'promotions', 'other']
    const category = p.category === null ? null : categories.includes(p.category as MailCategory) ? (p.category as MailCategory) : undefined
    const key = typeof p.key === 'string' && /^gmail:[^:\s]+@[^:\s]+:[0-9a-zA-Z]+$/.test(p.key) && p.key.length < 300 ? p.key : null
    const from = email(p.fromEmail)
    const scope = p.scope === 'sender' ? 'sender' : 'message'
    if (category === undefined || !key || (scope === 'sender' && !from)) return null
    return correctCategory(key, from ?? '', category, scope)
  })
  ipcMain.handle(IPC.mailSetupLink, (event, which: unknown) => (trusted(event) && typeof which === 'string' ? openSetupLink(which) : false))
  ipcMain.handle(IPC.mailSetRules, (event, rules: unknown) => {
    if (!trusted(event)) return null
    setMailRules(parseRules(rules))
    return mailRules()
  })
}

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC } from '../../shared/api'
import { cleanQuery, parseRules } from '../../shared/mail'
import { isTrustedSender } from '../pet-window'
import { mailRules, setMailRules } from '../settings'
import { connectAccount, disconnectAccount, listMail, mailStatus, openOriginal, readMail } from './service'

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
    const filter = p.filter === 'unread' || p.filter === 'important' ? p.filter : 'recent'
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
  ipcMain.handle(IPC.mailRules, (event) => (trusted(event) ? mailRules() : null))
  ipcMain.handle(IPC.mailSetRules, (event, rules: unknown) => {
    if (!trusted(event)) return null
    setMailRules(parseRules(rules))
    return mailRules()
  })
}

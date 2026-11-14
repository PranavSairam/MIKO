/**
 * Email HTML for the reader. Allowlist sanitizer (DOMParser, never inserted
 * into MIKO's own document) plus a locked-down sandboxed iframe with a CSP
 * that allows no scripts, no network and no remote images. Links are made
 * inert (their address is shown on hover); use "Open original" for the real thing.
 */

const DROP = new Set([
  'script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'video', 'audio', 'source', 'track', 'canvas', 'template'
])

const KEEP_ATTRS = new Set(['style', 'class', 'align', 'valign', 'width', 'height', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'color', 'dir', 'lang', 'title', 'alt'])

export function sanitizeEmailHtml(html: string): { html: string; blockedImages: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let blockedImages = 0
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase()
    if (DROP.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (tag === 'a' && name === 'href') continue
      if (tag === 'img' && name === 'src') continue
      if (!KEEP_ATTRS.has(name)) el.removeAttribute(attr.name)
    }
    const style = el.getAttribute('style')
    if (style && /url\s*\(|expression\s*\(|@import/i.test(style)) el.removeAttribute('style')
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? ''
      el.removeAttribute('href')
      if (/^(https?:|mailto:)/i.test(href)) el.setAttribute('title', href)
      el.setAttribute('class', 'inert-link')
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? ''
      if (!/^data:image\/(png|gif|jpe?g|webp);/i.test(src)) {
        el.removeAttribute('src')
        el.setAttribute('alt', el.getAttribute('alt') || '')
        el.setAttribute('data-blocked', '1')
        blockedImages += 1
      }
    }
  }
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    if (/url\s*\(|@import|expression\s*\(/i.test(style.textContent ?? '')) style.remove()
  }
  return { html: doc.body.innerHTML, blockedImages }
}

const FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'"

export function readerDocument(sanitizedHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">
<style>
html,body{margin:0;background:#fff;color:#1d1a19;font:14px/1.5 -apple-system,"Segoe UI",sans-serif;word-wrap:break-word}
body{padding:16px}
img{max-width:100%;height:auto}
img[data-blocked]{display:inline-block;min-width:16px;min-height:16px;background:#eee;outline:1px dashed #bbb}
.inert-link{color:#2457c5;text-decoration:underline;cursor:default}
table{max-width:100%}
</style></head><body>${sanitizedHtml}</body></html>`
}

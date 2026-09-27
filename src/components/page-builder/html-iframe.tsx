'use client'

import { useEffect, useRef, useState } from 'react'

function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  return m ? m[1].trim() : html
}

export function HtmlIframe({ html, bgColor, minHeight }: {
  html: string
  bgColor?: string
  minHeight?: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  // version increments on each html change → forces iframe remount so srcdoc updates are visible
  const [version, setVersion] = useState(0)
  const prevHtml = useRef(html)
  if (prevHtml.current !== html) {
    prevHtml.current = html
    setVersion(v => v + 1)
  }

  const body = extractBody(html)
  const srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body { margin: 0; padding: 0; overflow-x: hidden; }</style>
</head>
<body>${body}</body>
</html>`

  function onLoad() {
    const iframe = ref.current
    if (!iframe?.contentDocument?.body) return
    const h = iframe.contentDocument.body.scrollHeight
    if (h > 0) iframe.style.height = h + 'px'
  }

  return (
    <section style={{ background: bgColor || 'transparent', minHeight: minHeight || undefined }}>
      <iframe
        key={version}
        ref={ref}
        srcDoc={srcdoc}
        onLoad={onLoad}
        style={{ width: '100%', border: 'none', display: 'block', minHeight: minHeight || '200px' }}
        title="HTML section"
        loading="lazy"
      />
    </section>
  )
}

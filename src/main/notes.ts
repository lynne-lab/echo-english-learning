import { app, BrowserWindow } from 'electron'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function noteTitle(text: string): string {
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  const cleaned = firstLine
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .trim()
  return cleaned.slice(0, 60) || 'Echo 学习笔记'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function notePrintHtml(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; }
  body {
    margin: 0;
    padding: 0;
    color: #1f2937;
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    font-size: 13.5px;
    line-height: 1.75;
  }
  article { max-width: 100%; }
  h1, h2, h3, h4, h5, h6 {
    margin: 1.3em 0 0.5em;
    line-height: 1.35;
    color: #0f172a;
    page-break-after: avoid;
  }
  h1 { font-size: 24px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
  h2 { font-size: 19px; border-bottom: 1px solid #e8edf3; padding-bottom: 5px; }
  h3 { font-size: 16px; }
  h4, h5, h6 { font-size: 14px; }
  p, ul, ol, blockquote, pre, table { margin: 0.7em 0; }
  ul, ol { padding-left: 1.5em; }
  li + li { margin-top: 0.2em; }
  li > input[type="checkbox"] { margin-right: 6px; }
  blockquote {
    padding: 4px 14px;
    border-left: 3px solid #5eead4;
    background: #f3faf8;
    color: #475569;
  }
  code {
    font-family: "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 12px;
    background: #f1f5f9;
    border-radius: 4px;
    padding: 1px 5px;
  }
  pre {
    background: #f6f8fb;
    border: 1px solid #e5eaf1;
    border-radius: 8px;
    padding: 12px 14px;
    white-space: pre-wrap;
    word-break: break-word;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
  th, td { border: 1px solid #dbe2ea; padding: 6px 9px; text-align: left; }
  th { background: #f4f7fa; }
  a { color: #0f766e; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.4em 0; }
  img { max-width: 100%; }
  input[type="checkbox"] { accent-color: #0f766e; }
</style>
</head>
<body>
<article>${bodyHtml || '<p>（空笔记）</p>'}</article>
</body>
</html>`
}

export async function writeNotePdf(
  filePath: string,
  title: string,
  bodyHtml: string
): Promise<void> {
  const tempPath = join(
    app.getPath('temp'),
    `echo-note-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  )
  writeFileSync(tempPath, notePrintHtml(title, bodyHtml), 'utf8')
  const printWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  try {
    await printWindow.loadFile(tempPath)
    await printWindow.webContents
      .executeJavaScript('document.fonts.ready.then(() => true)')
      .catch(() => undefined)
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 }
    })
    writeFileSync(filePath, pdf)
  } finally {
    printWindow.destroy()
    try {
      unlinkSync(tempPath)
    } catch {
      /* temp file already gone */
    }
  }
}

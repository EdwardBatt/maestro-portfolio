/**
 * Minimal, dependency-free CSV export (L3.4). RFC-4180 quoting; a UTF-8 BOM so
 * Excel opens Arabic content correctly. Browser-only (Blob + anchor); no
 * storage APIs. Kept tiny on purpose — this is the first slice of the
 * data-export story (0.3.3), not a general serializer.
 */

type Cell = string | number

function escapeCell(value: Cell): string {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, rows: Cell[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

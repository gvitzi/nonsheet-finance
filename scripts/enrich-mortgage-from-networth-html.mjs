/**
 * One-off: merge Net worth.zip (Google Sheets HTML export) mortgage columns
 * into nonsheet migrated JSON propertyMortgage marks.
 *
 * Schema fields used: principalMonthlyPayment, interestMonthlyPayment
 * (see core/src/document.ts PropertyMortgageRecord).
 */
import fs from 'node:fs'
import path from 'node:path'

const MIGRATED = 'c:/Users/gilvi/Downloads/nonsheet-finance-2026-04-24_23_54.migrated.json'
const HTML_DIR = 'c:/Users/gilvi/Downloads/net-worth-unzipped'
const OUT = 'c:/Users/gilvi/Downloads/nonsheet-db-2026-04-25_00_00-mortgage-data.json'

function stripCell(html) {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function parseEuro(s) {
  if (s == null || s === '') return null
  const str = String(s).trim()
  if (!str) return null
  let t = str.replace(/€/g, '').replace(/₪/g, '').replace(/\s/g, '')
  if (!t) return null
  // German decimals: 116.083,02
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t)) {
    return parseFloat(t.replace(/\./g, '').replace(',', '.'))
  }
  // 74044|146558 style — skip multi
  if (t.includes('|')) return null
  t = t.replace(/,/g, '')
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function extractRowTds(trHtml) {
  const cells = []
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let m
  while ((m = re.exec(trHtml)) !== null) {
    cells.push(stripCell(m[1]))
  }
  return cells
}

function extractTbodyRows(html) {
  const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)
  if (!tbody) return []
  const trs = []
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = re.exec(tbody[1])) !== null) {
    trs.push(m[1])
  }
  return trs
}

/** @param {string} name @param {string} propertyId */
function rowMatchesProperty(name, propertyId) {
  const n = name.toLowerCase()
  if (!n) return false
  if (propertyId === 'nw_02c4cb80a29b362f51f582adfc91') {
    // Old exports used "Strasse 21"; same building as Strasse 20 in JSON.
    return (
      /heidenfeld/i.test(name) &&
      /strasse\s*2[01]|straße\s*2[01]|str\.\s*2[01]/i.test(name)
    )
  }
  if (propertyId === 'nw_f903c7358161a54ed34cccd603fd') {
    return /hallesche/.test(n)
  }
  if (propertyId === 'nw_862f0008e02b5d0c09f2a4a8e2b1') {
    return (/(damerow|dammerow)/i.test(name) && /58/.test(n)) || /dammerowstr/i.test(n)
  }
  return false
}

function parseSheetFile(html, basename) {
  const rows = extractTbodyRows(html).map(extractRowTds)
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i][0] || ''
    if (/real\s+estate\s+properties/i.test(a)) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return { key: basename, rows: [], extended: false, sheetDate: null }

  /** @type {string | null} */
  let sheetDate = null
  const r0 = rows[0] || []
  if (/date\s+taken/i.test(r0[0] || '')) {
    const dm = (r0[1] || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
    if (dm) sheetDate = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`
  }

  const header = rows[headerIdx]
  const extended = header.some((c) => /principal/i.test(c)) && header.some((c) => /interest/i.test(c))

  const props = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i]
    const label = (cells[0] || '').trim()
    if (!label) continue
    if (/total\s+(real\s+estate|investment)/i.test(label)) break
    if (/^liquid\s+assets/i.test(label)) break
    if (/^total:/i.test(label)) break

    const rec = { name: label, cells }
    if (extended && cells.length >= 7) {
      rec.value = parseEuro(cells[1])
      rec.liabilities = parseEuro(cells[2])
      rec.netWorth = parseEuro(cells[3])
      rec.paidMonthly = parseEuro(cells[4])
      rec.interestMonthly = parseEuro(cells[5])
      rec.principalMonthly = parseEuro(cells[6])
      rec.rentMonthly = parseEuro(cells[7])
      rec.profitMonthly = parseEuro(cells[8])
      rec.annualMortgage = parseEuro(cells[9])
      rec.annualRent = parseEuro(cells[10])
      rec.endDateRaw = cells[11] || null
      rec.leftRaw = cells[12] || null
    } else if (cells.length >= 3) {
      rec.value = parseEuro(cells[1])
      rec.liabilities = parseEuro(cells[2])
      rec.netWorth = parseEuro(cells[3])
    }
    props.push(rec)
  }

  return { key: basename, rows: props, extended, sheetDate: sheetDate ?? null }
}

function findRowForProperty(sheet, propertyId) {
  for (const r of sheet.rows) {
    if (rowMatchesProperty(r.name, propertyId)) return r
  }
  return null
}

function loanNameToBasename(loanName) {
  if (!loanName || !/^\d{2}-\d{4}$/.test(loanName.trim())) return null
  return `${loanName.trim()}.html`
}

function main() {
  const doc = JSON.parse(fs.readFileSync(MIGRATED, 'utf8'))

  const htmlFiles = fs
    .readdirSync(HTML_DIR)
    .filter((f) => /^\d{2}-\d{4}\.html$/i.test(f))

  const cache = new Map()
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(HTML_DIR, f), 'utf8')
    cache.set(f, parseSheetFile(html, f))
  }

  let enriched = 0
  let skippedNoFile = 0
  let skippedNoRow = 0
  let skippedNoColumns = 0
  const warnings = []

  doc.propertyMortgages = doc.propertyMortgages.map((m) => {
    const base = m.loanName ? loanNameToBasename(m.loanName) : null
    if (!base || !cache.has(base)) {
      skippedNoFile++
      return m
    }
    const sheet = cache.get(base)
    if (!sheet.extended) {
      skippedNoColumns++
      return m
    }
    const row = findRowForProperty(sheet, m.propertyId)
    if (!row || row.principalMonthly == null || row.interestMonthly == null) {
      skippedNoRow++
      if (sheet.extended) {
        warnings.push({ markId: m.id, loanName: m.loanName, propertyId: m.propertyId, reason: 'no matching property row or missing P/I' })
      }
      return m
    }
    if (row.liabilities != null && m.outstandingBalance != null) {
      const diff = Math.abs(row.liabilities - m.outstandingBalance)
      const tol = Math.max(500, 0.02 * Math.abs(m.outstandingBalance))
      if (diff > tol) {
        warnings.push({
          markId: m.id,
          loanName: m.loanName,
          propertyId: m.propertyId,
          reason: 'liabilities mismatch sheet vs mark',
          sheetLiabilities: row.liabilities,
          markBalance: m.outstandingBalance,
        })
      }
    }
    enriched++
    return {
      ...m,
      principalMonthlyPayment: row.principalMonthly,
      interestMonthlyPayment: row.interestMonthly,
    }
  })

  doc.meta = {
    ...doc.meta,
    savedAt: new Date().toISOString(),
    title: doc.meta?.title ?? 'Exported from SQLite',
    mortgageEnrichment: {
      sourceHtmlDir: HTML_DIR,
      sourceMigrated: MIGRATED,
      enrichedMarks: enriched,
      skippedNoSnapshotFile: skippedNoFile,
      skippedSnapshotWithoutMortgageColumns: skippedNoColumns,
      skippedNoPropertyRow: skippedNoRow,
      warnings,
    },
  }

  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2), 'utf8')
  console.log(JSON.stringify({ OUT, enriched, skippedNoFile, skippedNoColumns, skippedNoRow, warningCount: warnings.length }, null, 2))
}

main()

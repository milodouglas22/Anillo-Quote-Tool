const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

class ApiService {
  constructor() {
    this.baseUrl = API_BASE_URL
    this.getToken = null // optional async () => token
  }

  setTokenProvider(fn) {
    this.getToken = fn
  }

  async _headers(extra = {}) {
    const h = { ...extra }
    if (this.getToken) {
      try {
        const t = await this.getToken()
        if (t) h['Authorization'] = `Bearer ${t}`
      } catch { /* auth optional in dev */ }
    }
    return h
  }

  async processFile(file) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${this.baseUrl}/api/quotes/process`, {
      method: 'POST',
      headers: await this._headers(),
      body: form,
    })
    if (!res.ok) throw new Error(`Process failed (${res.status}): ${await res.text()}`)
    return res.json()
  }

  async applyMapping(rawRecords, mapping) {
    const res = await fetch(`${this.baseUrl}/api/quotes/apply-mapping`, {
      method: 'POST',
      headers: await this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ raw_records: rawRecords, mapping }),
    })
    if (!res.ok) throw new Error(`Mapping failed (${res.status})`)
    return res.json()
  }

  async exportRows(rows, filename = 'anillo_quote.xlsx') {
    const res = await fetch(`${this.baseUrl}/api/quotes/export`, {
      method: 'POST',
      headers: await this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ rows, filename }),
    })
    if (!res.ok) throw new Error(`Export failed (${res.status})`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }
}

export default new ApiService()

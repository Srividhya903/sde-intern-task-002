import { createFileRoute } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: Home,
})

type Member = {
  id: string
  name: string
}

type Share = {
  id: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
}

type Bill = {
  id: string
  title: string
  totalCents: number
  shares: Share[]
}

type HomeData = {
  id: string
  name: string
  members: Member[]
  bills: Bill[]
}

type Balance = {
  memberId: string
  name: string
  outstandingCents: number
}

type CreatedHome = {
  id: string
  name: string
}

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`)
  }

  return data as T
}

function formatMoney(cents: number) {
  return `₹${(cents / 100).toFixed(2)}`
}

function Home() {
  const [, setHomeId] = useState('')
  const [home, setHome] = useState<HomeData | null>(null)
  const [balances, setBalances] = useState<Balance[]>([])

  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [billAmount, setBillAmount] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadHome = useCallback(async (id: string) => {
    const [homeData, balanceData] = await Promise.all([
      apiRequest<HomeData>(`/api/homes/${id}`),
      apiRequest<{ balances: Balance[] }>(`/api/homes/${id}/balances`),
    ])

    setHome(homeData)
    setBalances(balanceData.balances)
  }, [])

  useEffect(() => {
    const savedId = localStorage.getItem('bill-splitter-home-id')

    if (savedId) {
      setHomeId(savedId)

      loadHome(savedId)
        .catch((err: Error) => {
          setError(err.message)
          localStorage.removeItem('bill-splitter-home-id')
          setHomeId('')
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [loadHome])

  async function handleCreateHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      const created = await apiRequest<CreatedHome>('/api/homes', {
        method: 'POST',
        body: JSON.stringify({ name: homeName }),
      })

      localStorage.setItem('bill-splitter-home-id', created.id)
      setHomeId(created.id)
      setHomeName('')
      await loadHome(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create home')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!home) return

    setError('')
    setSaving(true)

    try {
      await apiRequest(`/api/homes/${home.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ name: memberName }),
      })

      setMemberName('')
      await loadHome(home.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!home) return

    setError('')
    setSaving(true)

    const amount = Number(billAmount)
    const totalCents = Math.round(amount * 100)

    if (!Number.isFinite(amount) || !Number.isInteger(totalCents) || totalCents <= 0) {
      setError('Enter a valid bill amount greater than ₹0.00.')
      setSaving(false)
      return
    }

    try {
      await apiRequest(`/api/homes/${home.id}/bills`, {
        method: 'POST',
        body: JSON.stringify({
          title: billTitle,
          totalCents,
        }),
      })

      setBillTitle('')
      setBillAmount('')
      await loadHome(home.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create bill')
    } finally {
      setSaving(false)
    }
  }

  async function handlePayShare(billId: string, shareId: string) {
    setError('')
    setPayingShareId(shareId)

    try {
      await apiRequest(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': crypto.randomUUID(),
        },
      })

      if (home) {
        await loadHome(home.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment could not be completed')
    } finally {
      setPayingShareId(null)
    }
  }

  async function handleSwitchHome() {
    localStorage.removeItem('bill-splitter-home-id')
    setHomeId('')
    setHome(null)
    setBalances([])
    setError('')
  }

  const inputStyle = {
    width: '100%',
    padding: '12px',
    marginTop: '6px',
    marginBottom: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '15px',
    boxSizing: 'border-box' as const,
  }

  const buttonStyle = {
    padding: '11px 18px',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: 600,
  }

  const cardStyle = {
    background: 'white',
    padding: '22px',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    marginBottom: '20px',
  }

  if (loading) {
    return (
      <main style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
        Loading your Shared Bill Splitter...
      </main>
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        padding: '30px 16px',
        fontFamily: 'Arial, sans-serif',
        color: '#111827',
      }}
    >
      <div style={{ maxWidth: '850px', margin: '0 auto' }}>
        <header style={{ marginBottom: '28px' }}>
          <h1 style={{ fontSize: '32px', marginBottom: '8px' }}>Shared Bill Splitter</h1>
          <p style={{ color: '#6b7280' }}>
            Create a home, add members, split bills, and track payments.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '14px',
              borderRadius: '8px',
              marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        {!home ? (
          <section style={cardStyle}>
            <h2>Create Your Home</h2>
            <p style={{ color: '#6b7280' }}>Start by creating a shared home for your group.</p>

            <form onSubmit={handleCreateHome}>
              <label htmlFor="homeName">Home name</label>
              <input
                id="homeName"
                style={inputStyle}
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                placeholder="Example: College Flat"
                required
                maxLength={100}
              />

              <button type="submit" style={buttonStyle} disabled={saving}>
                {saving ? 'Creating...' : 'Create Home'}
              </button>
            </form>
          </section>
        ) : (
          <>
            <section style={cardStyle}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <h2 style={{ margin: '0 0 6px' }}>{home.name}</h2>
                  <p style={{ margin: 0, color: '#6b7280' }}>Your shared home dashboard</p>
                </div>

                <button
                  type="button"
                  onClick={handleSwitchHome}
                  style={{
                    ...buttonStyle,
                    background: '#6b7280',
                  }}
                >
                  Switch Home
                </button>
              </div>
            </section>

            <section style={cardStyle}>
              <h2>Members ({home.members.length})</h2>

              {home.members.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No members yet. Add your first member below.</p>
              ) : (
                <ul style={{ paddingLeft: '22px' }}>
                  {home.members.map((member) => (
                    <li key={member.id} style={{ marginBottom: '8px' }}>
                      {member.name}
                    </li>
                  ))}
                </ul>
              )}

              <form onSubmit={handleAddMember}>
                <label htmlFor="memberName">Add a member</label>
                <input
                  id="memberName"
                  style={inputStyle}
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  placeholder="Enter member name"
                  required
                  maxLength={100}
                />

                <button type="submit" style={buttonStyle} disabled={saving}>
                  {saving ? 'Please wait...' : 'Add Member'}
                </button>
              </form>
            </section>

            <section style={cardStyle}>
              <h2>Create and Split a Bill</h2>

              {home.members.length === 0 && (
                <p style={{ color: '#b45309' }}>Add at least one member before creating a bill.</p>
              )}

              <form onSubmit={handleCreateBill}>
                <label htmlFor="billTitle">Bill title</label>
                <input
                  id="billTitle"
                  style={inputStyle}
                  value={billTitle}
                  onChange={(event) => setBillTitle(event.target.value)}
                  placeholder="Example: Electricity bill"
                  required
                  maxLength={150}
                />

                <label htmlFor="billAmount">Total amount (₹)</label>
                <input
                  id="billAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  style={inputStyle}
                  value={billAmount}
                  onChange={(event) => setBillAmount(event.target.value)}
                  placeholder="Example: 1200"
                  required
                />

                <button
                  type="submit"
                  style={buttonStyle}
                  disabled={saving || home.members.length === 0}
                >
                  {saving ? 'Creating...' : 'Create and Split Bill'}
                </button>
              </form>
            </section>

            <section style={cardStyle}>
              <h2>Bills and Payments</h2>

              {home.bills.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No bills yet. Create your first bill above.</p>
              ) : (
                home.bills.map((bill) => (
                  <article
                    key={bill.id}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: '10px',
                      padding: '16px',
                      marginBottom: '16px',
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>{bill.title}</h3>
                    <p>**Total:** {formatMoney(bill.totalCents)}</p>

                    <h4>Member shares</h4>

                    {bill.shares.map((share) => (
                      <div
                        key={share.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap',
                          padding: '10px 0',
                          borderTop: '1px solid #e5e7eb',
                        }}
                      >
                        <div>
                          <strong>{share.memberName || 'Member'}</strong>
                          <div style={{ color: '#6b7280', fontSize: '14px' }}>
                            {formatMoney(share.amountCents)}
                          </div>
                        </div>

                        {share.paidAt ? (
                          <span
                            style={{
                              color: '#047857',
                              fontWeight: 600,
                            }}
                          >
                            Paid
                          </span>
                        ) : (
                          <button
                            type="button"
                            style={buttonStyle}
                            disabled={payingShareId !== null}
                            onClick={() => handlePayShare(bill.id, share.id)}
                          >
                            {payingShareId === share.id ? 'Processing...' : 'Mark as Paid'}
                          </button>
                        )}
                      </div>
                    ))}
                  </article>
                ))
              )}
            </section>

            <section style={cardStyle}>
              <h2>Outstanding Balances</h2>

              {balances.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No balance information available.</p>
              ) : (
                balances.map((balance) => (
                  <div
                    key={balance.memberId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '12px 0',
                      borderBottom: '1px solid #e5e7eb',
                    }}
                  >
                    <strong>{balance.name}</strong>
                    <span>{formatMoney(balance.outstandingCents)}</span>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// Common error responses
app.notFound((c) => c.json({ error: 'Resource not found' }, 404))

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok' })
})

// Create a home
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: string }>()

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Home name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

// Add a member to a home
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{ name?: string }>()

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'Member name is required' }, 400)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// Create a bill and split it between members
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const body = await c.req.json<{
    title?: string
    totalCents?: number
  }>()

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  if (
    typeof body.title !== 'string' ||
    !body.title.trim() ||
    typeof body.totalCents !== 'number' ||
    !Number.isSafeInteger(body.totalCents) ||
    body.totalCents <= 0
  ) {
    return c.json({ error: 'A valid title and positive whole-number totalCents are required' }, 422)
  }

  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY rowid ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.results.length === 0) {
    return c.json({ error: 'Add members before creating a bill' }, 422)
  }

  const billId = crypto.randomUUID()
  const title = body.title.trim()
  const totalCents = body.totalCents

  await c.env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
    .bind(billId, homeId, title, totalCents)
    .run()

  const baseAmount = Math.floor(totalCents / members.results.length)
  const remainder = totalCents % members.results.length

  const shares: {
    id: string
    memberId: string
    amountCents: number
    paidAt: null
  }[] = []

  for (const [i, member] of members.results.entries()) {
    const shareId = crypto.randomUUID()
    const amountCents = baseAmount + (i < remainder ? 1 : 0)

    await c.env.DB.prepare(
      `INSERT INTO shares
       (id, bill_id, member_id, amount_cents)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(shareId, billId, member.id, amountCents)
      .run()

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })
  }

  return c.json(
    {
      id: billId,
      homeId,
      title,
      totalCents,
      shares,
    },
    201,
  )
})

// Pay a share
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const key = c.req.header('Idempotency-Key')?.trim()

  if (!key) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?').bind(billId).first()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  type ShareRow = {
    id: string
    memberId: string
    amountCents: number
    paidAt: string | null
    idempotencyKey: string | null
  }

  const findShare = () =>
    c.env.DB.prepare(
      `SELECT
         id,
         member_id AS memberId,
         amount_cents AS amountCents,
         paid_at AS paidAt,
         idempotency_key AS idempotencyKey
       FROM shares
       WHERE bill_id = ? AND id = ?`,
    )
      .bind(billId, shareId)
      .first<ShareRow>()

  const share = await findShare()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // A repeated request with the same key returns the original payment.
  if (share.paidAt) {
    if (share.idempotencyKey === key) {
      return c.json({
        id: share.id,
        memberId: share.memberId,
        amountCents: share.amountCents,
        paidAt: share.paidAt,
      })
    }

    return c.json({ error: 'Share has already been paid' }, 409)
  }

  const paidAt = new Date().toISOString()

  // Conditional update ensures only one competing payment succeeds.
  const update = await c.env.DB.prepare(
    `UPDATE shares
     SET paid_at = ?, idempotency_key = ?
     WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
  )
    .bind(paidAt, key, shareId, billId)
    .run()

  if (update.meta.changes > 0) {
    return c.json({
      id: share.id,
      memberId: share.memberId,
      amountCents: share.amountCents,
      paidAt,
    })
  }

  // Another request may have paid this share at the same time.
  const updatedShare = await findShare()

  if (!updatedShare) {
    return c.json({ error: 'Share not found' }, 404)
  }

  if (updatedShare.paidAt && updatedShare.idempotencyKey === key) {
    return c.json({
      id: updatedShare.id,
      memberId: updatedShare.memberId,
      amountCents: updatedShare.amountCents,
      paidAt: updatedShare.paidAt,
    })
  }

  return c.json({ error: 'Share has already been paid' }, 409)
})

// Get outstanding balances for a home
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const result = await c.env.DB.prepare(
    `SELECT
       m.id AS memberId,
       m.name AS name,
       COALESCE(
         SUM(
           CASE WHEN s.paid_at IS NULL
           THEN s.amount_cents ELSE 0 END
         ), 0
       ) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id
     WHERE m.home_id = ?
     GROUP BY m.id, m.name, m.rowid
     ORDER BY m.rowid ASC`,
  )
    .bind(homeId)
    .all<{
      memberId: string
      name: string
      outstandingCents: number
    }>()

  return c.json({ balances: result.results })
})

// Get complete home information for the frontend
app.get('/api/homes/:homeId', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string; name: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const members = await c.env.DB.prepare(
    `SELECT id, name
     FROM members
     WHERE home_id = ?
     ORDER BY rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      name: string
    }>()

  const bills = await c.env.DB.prepare(
    `SELECT id, title, total_cents AS totalCents
     FROM bills
     WHERE home_id = ?
     ORDER BY rowid ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      title: string
      totalCents: number
    }>()

  const billDetails = []

  for (const bill of bills.results) {
    const shares = await c.env.DB.prepare(
      `SELECT
         s.id,
         s.member_id AS memberId,
         m.name AS memberName,
         s.amount_cents AS amountCents,
         s.paid_at AS paidAt
       FROM shares s
       JOIN members m ON m.id = s.member_id
       WHERE s.bill_id = ?
       ORDER BY m.rowid ASC`,
    )
      .bind(bill.id)
      .all<{
        id: string
        memberId: string
        memberName: string
        amountCents: number
        paidAt: string | null
      }>()

    billDetails.push({
      ...bill,
      shares: shares.results,
    })
  }

  return c.json({
    ...home,
    members: members.results,
    bills: billDetails,
  })
})

export default app

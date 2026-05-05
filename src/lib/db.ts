// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
  plan?: string;
  plan_updated_at?: string | null;
}

export interface Payment {
  id: number;
  user_id: number;
  order_id: string;
  cf_order_id: string | null;
  cf_payment_id: string | null;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  payment_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export type MediaType = 'image' | 'video';

export interface Image {
  id: number;
  user_id: number;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  media_type: MediaType;
  created_at: string;
  folder_id?: number | null;
}

export interface Folder {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

// ─── User queries ─────────────────────────────────────────────────────────────

export async function getUserByEmail(
  db: D1Database,
  email: string,
): Promise<User | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<User>();
}

export async function getUserById(
  db: D1Database,
  id: number,
): Promise<User | null> {
  return db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<User>();
}

export async function createUser(
  db: D1Database,
  email: string,
  passwordHash: string,
): Promise<User> {
  await db
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .bind(email, passwordHash)
    .run();
  const user = await getUserByEmail(db, email);
  if (!user) throw new Error('Failed to create user');
  return user;
}

// ─── Image queries ────────────────────────────────────────────────────────────

export async function createImage(
  db: D1Database,
  userId: number,
  r2Key: string,
  filename: string,
  contentType: string,
  size: number,
  mediaType: MediaType = 'image',
  folderId: number | null = null,
): Promise<Image> {
  await db
    .prepare(
      'INSERT INTO images (user_id, r2_key, filename, content_type, size, media_type, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(userId, r2Key, filename, contentType, size, mediaType, folderId)
    .run();
  const image = await db
    .prepare('SELECT * FROM images WHERE r2_key = ?')
    .bind(r2Key)
    .first<Image>();
  if (!image) throw new Error('Failed to save image metadata');
  return image;
}

export async function getImagesByUser(
  db: D1Database,
  userId: number,
  limit = 50,
  offset = 0,
  folderId: number | null | 'all' = 'all',
): Promise<Image[]> {
  let stmt;
  if (folderId === 'all') {
    stmt = db
      .prepare('SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(userId, limit, offset);
  } else if (folderId === null) {
    stmt = db
      .prepare('SELECT * FROM images WHERE user_id = ? AND folder_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(userId, limit, offset);
  } else {
    stmt = db
      .prepare('SELECT * FROM images WHERE user_id = ? AND folder_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(userId, folderId, limit, offset);
  }
  const { results } = await stmt.all<Image>();
  return results;
}

export async function getImageById(
  db: D1Database,
  id: number,
): Promise<Image | null> {
  return db
    .prepare('SELECT * FROM images WHERE id = ?')
    .bind(id)
    .first<Image>();
}

export async function deleteImage(
  db: D1Database,
  id: number,
  userId: number,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM images WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function countRecentUploads(
  db: D1Database,
  userId: number,
  windowMinutes = 60,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as count FROM images WHERE user_id = ? AND created_at > datetime('now', ?)",
    )
    .bind(userId, `-${Math.max(1, Math.floor(windowMinutes))} minutes`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getUserStorageUsed(
  db: D1Database,
  userId: number,
): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(size), 0) as total FROM images WHERE user_id = ?')
    .bind(userId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// ─── Plan + Payments ───────────────────────────────────────────────────────

export async function setUserPlan(
  db: D1Database,
  userId: number,
  plan: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET plan = ?, plan_updated_at = datetime('now') WHERE id = ?")
    .bind(plan, userId)
    .run();
}

export async function createPayment(
  db: D1Database,
  params: {
    userId: number;
    orderId: string;
    plan: string;
    amount: number;
    currency?: string;
    cfOrderId?: string | null;
    paymentSessionId?: string | null;
  },
): Promise<Payment> {
  await db
    .prepare(
      'INSERT INTO payments (user_id, order_id, plan, amount, currency, cf_order_id, payment_session_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      params.userId,
      params.orderId,
      params.plan,
      params.amount,
      params.currency ?? 'INR',
      params.cfOrderId ?? null,
      params.paymentSessionId ?? null,
      'CREATED',
    )
    .run();
  const p = await getPaymentByOrderId(db, params.orderId);
  if (!p) throw new Error('Failed to save payment');
  return p;
}

export async function getPaymentByOrderId(
  db: D1Database,
  orderId: string,
): Promise<Payment | null> {
  return db
    .prepare('SELECT * FROM payments WHERE order_id = ?')
    .bind(orderId)
    .first<Payment>();
}

export async function updatePaymentStatus(
  db: D1Database,
  orderId: string,
  status: string,
  cfPaymentId?: string | null,
): Promise<void> {
  await db
    .prepare(
      "UPDATE payments SET status = ?, cf_payment_id = COALESCE(?, cf_payment_id), updated_at = datetime('now') WHERE order_id = ?",
    )
    .bind(status, cfPaymentId ?? null, orderId)
    .run();
}

// ─── Folders ───────────────────────────────────────────────────────────────

export async function getFoldersByUser(db: D1Database, userId: number): Promise<Folder[]> {
  const { results } = await db
    .prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY name ASC')
    .bind(userId)
    .all<Folder>();
  return results;
}

export async function getFolderById(db: D1Database, id: number): Promise<Folder | null> {
  return db.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first<Folder>();
}

export async function createFolder(
  db: D1Database,
  userId: number,
  name: string,
): Promise<Folder> {
  await db
    .prepare('INSERT INTO folders (user_id, name) VALUES (?, ?)')
    .bind(userId, name)
    .run();
  const f = await db
    .prepare('SELECT * FROM folders WHERE user_id = ? AND name = ?')
    .bind(userId, name)
    .first<Folder>();
  if (!f) throw new Error('Failed to create folder');
  return f;
}

export async function renameFolder(
  db: D1Database,
  id: number,
  userId: number,
  name: string,
): Promise<boolean> {
  const r = await db
    .prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?')
    .bind(name, id, userId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function deleteFolder(
  db: D1Database,
  id: number,
  userId: number,
): Promise<boolean> {
  const r = await db
    .prepare('DELETE FROM folders WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function getFolderImageCounts(
  db: D1Database,
  userId: number,
): Promise<Record<number, number>> {
  const { results } = await db
    .prepare(
      'SELECT folder_id, COUNT(*) as c FROM images WHERE user_id = ? AND folder_id IS NOT NULL GROUP BY folder_id',
    )
    .bind(userId)
    .all<{ folder_id: number; c: number }>();
  const map: Record<number, number> = {};
  for (const r of results) map[r.folder_id] = r.c;
  return map;
}

// ─── Bulk image operations ─────────────────────────────────────────────────

export async function getImagesByIds(
  db: D1Database,
  userId: number,
  ids: number[],
): Promise<Image[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM images WHERE user_id = ? AND id IN (${placeholders})`)
    .bind(userId, ...ids)
    .all<Image>();
  return results;
}

export async function deleteImagesByIds(
  db: D1Database,
  userId: number,
  ids: number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const r = await db
    .prepare(`DELETE FROM images WHERE user_id = ? AND id IN (${placeholders})`)
    .bind(userId, ...ids)
    .run();
  return r.meta.changes ?? 0;
}

export async function moveImagesToFolder(
  db: D1Database,
  userId: number,
  ids: number[],
  folderId: number | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const r = await db
    .prepare(
      `UPDATE images SET folder_id = ? WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .bind(folderId, userId, ...ids)
    .run();
  return r.meta.changes ?? 0;
}

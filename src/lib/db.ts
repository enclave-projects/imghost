// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface Image {
  id: number;
  user_id: number;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
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
): Promise<Image> {
  await db
    .prepare(
      'INSERT INTO images (user_id, r2_key, filename, content_type, size) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(userId, r2Key, filename, contentType, size)
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
): Promise<Image[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    )
    .bind(userId, limit, offset)
    .all<Image>();
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
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as count FROM images WHERE user_id = ? AND created_at > datetime('now', '-1 hour')",
    )
    .bind(userId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

# ImgHost

A modern image hosting platform built with Astro and Cloudflare Workers, featuring plan-based storage quotas, folder management, and Cashfree payment integration.

## 🌟 Features

- **Image Upload & Hosting**: Upload images with automatic optimization and CDN delivery via Cloudflare R2
- **Plan-Based Limits**: Three tiers (Free, Pro, Master) with different storage quotas and upload limits
- **Folder Management**: Create, rename, delete folders; organize images into folders
- **Bulk Operations**: Bulk delete and bulk move images between folders
- **Payment Integration**: Cashfree Payment Gateway for plan upgrades
- **Secure Authentication**: JWT-based session management with PBKDF2 password hashing
- **Rate Limiting**: Upload rate limits to prevent abuse

## 🚀 Tech Stack

- **Framework**: Astro v6 with @astrojs/cloudflare
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (S3-compatible object storage)
- **Payments**: Cashfree Payment Gateway
- **Authentication**: JWT (HS256) with HTTP-only cookies

## 📁 Project Structure

```text
/
├── migrations/          # D1 database migrations
├── public/              # Static assets
├── src/
│   ├── lib/            # Shared utilities (db, r2, cashfree, plans)
│   ├── middleware.ts   # Session verification middleware
│   ├── pages/
│   │   ├── api/        # API routes (upload, images, folders, payments)
│   │   ├── dashboard.astro
│   │   ├── pricing.astro
│   │   └── index.astro
│   └── env.d.ts        # Cloudflare Workers type definitions
├── wrangler.jsonc      # Cloudflare Workers configuration
└── package.json
```

## 🧞 Commands

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run deploy`          | Deploy to Cloudflare Workers                     |
| `wrangler d1 migrations ...` | Manage D1 database migrations               |

## 🔧 Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Configure Cloudflare Workers:
   ```sh
   npx wrangler login
   ```
4. Set required secrets:
   ```sh
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put CASHFREE_APP_ID
   npx wrangler secret put CASHFREE_SECRET_KEY
   npx wrangler secret put CASHFREE_ENV
   ```
5. Apply database migrations:
   ```sh
   npx wrangler d1 migrations apply imghost-db --remote
   ```
6. Deploy:
   ```sh
   npm run deploy
   ```

## 📊 Database Schema

- **users**: User accounts with plan assignment
- **images**: Uploaded images with folder association
- **folders**: User-created folders for organization
- **payments**: Payment records for plan upgrades

## � Plans

| Plan    | Storage | Upload Limit | Upload Window |
|---------|---------|--------------|---------------|
| Free    | 100 MB  | 10/hour      | 60 min        |
| Pro     | 5 GB    | 50/hour      | 30 min        |
| Master  | 50 GB   | 200/hour     | 5 min         |

## 🔐 Security

- Passwords hashed with PBKDF2-SHA256 (100k iterations)
- JWT sessions with HTTP-only cookies
- Rate limiting on upload endpoints
- Webhook signature verification for payments
- User-scoped data access (all queries filtered by user_id)

## 🌐 Live Deployment

https://imghost.pranjal-ai-arena.workers.dev

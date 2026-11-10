# MarketZone — Full-Stack E-Commerce

MarketZone is a persistent e-commerce application with a 510-product local catalog, customer accounts, administrator controls, merchant Stores, wallet transactions, manual-order assistance, notifications, and audit history. The original responsive storefront is preserved; the server and database are authoritative for privileged actions and financial operations.

## Requirements

- Node.js 20 or newer
- MySQL-compatible database (the verified deployment uses TiDB)
- The application environment values listed in `.env.example`

No default administrator password, test account, production credential, service-account file, or private key is included.

## Installation

1. Extract the project and enter its root directory.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and supply the real values for your deployment. Never commit or distribute the completed `.env`.
4. Create the schema on a new database:

   ```bash
   npm run db:migrate
   ```

5. Seed the 510-product catalog (the server also seeds missing catalog rows automatically at startup):

   ```bash
   npx tsx db/seed.ts
   ```

6. Build and start:

   ```bash
   npm run build
   npm start
   ```

The production server listens on port `3000`. For development, use `npm run dev`.

### Production database connection

Set `DATABASE_URL` to a MySQL/TiDB connection string for a dedicated, persistent database:

```text
mysql://DATABASE_USER:DATABASE_PASSWORD@DATABASE_HOST:3306/DATABASE_NAME
```

Percent-encode reserved characters in the username or password, and add the TLS options required by your database provider. The same `DATABASE_URL` is used by migrations, catalog seeding, and the running server. Keep it only in the host's protected environment settings or a local `.env`; never place it in `public/`, browser configuration, source control, or a distributed ZIP.

For a new installation, create an empty database and run `npm run db:migrate`, then `npx tsx db/seed.ts`. For an existing MarketZone installation, back up the database and run `npm run db:migrate` from this release before restarting the application. The additive `0001_cuddly_falcon.sql` migration changes `stores.docImage` to `MEDIUMTEXT` so ordinary JPEG/WebP verification documents fit. The additive `0002_abnormal_thunderbird.sql` migration adds seller-order debit, principal-return, balance-snapshot, acceptance, and completion fields. Neither migration deletes or truncates data.

Do not use `db:push --force` against production. Some TiDB versions cause `drizzle-kit push` introspection to propose unrelated constraint operations or data truncation. Use the checked-in, reviewed migrations instead.

### Production deployment

Deploy the whole application to a Node.js 20+ host, not to a static-only host. The Hono server must serve both `/api/market` and the built storefront from the same origin. Configure all backend values from `.env.example` in the host's protected environment, run the migration and seed commands above, then run:

```bash
npm ci
npm run build
npm start
```

The process listens on port `3000`; place it behind your HTTPS reverse proxy or platform router and keep the process running with your host's process manager. A `Dockerfile` is also included. Static hosting alone cannot provide accounts, database persistence, administrator review, checkout, or wallet operations.

## First-Run Administrator

Open `#/login`, expand **First-run administrator setup**, and create the administrator credentials. Setup is available only while no administrator exists. The delivered database is clean: no users, Stores, orders, wallets, transactions, notifications, assistance requests, referrals, or audit records are included.

The catalog remains seeded with 510 products. The first newly created Store receives the requested initial office information only when no Store already exists. Later Stores do not inherit it.

## Payments and Delivery

Supported checkout methods are:

- **Wallet Balance** — charged only after successful server-side checkout.
- **Cash on Delivery (COD)** — payment is due on delivery.

Card and online-gateway payments are not configured or simulated. Deposit requests do not change balances until an authorized administrator verifies and approves them. The Store deposit form requests only an amount in USD; after submission it tells the Store owner to contact the administrator with the intended amount and follow the administrator's instructions. No payment reference is required. Withdrawal and deposit reviews, wallet refunds, seller profit, stock restoration, and order cancellation use transactional exactly-once safeguards.

Direct checkout currently supports the **United States**. Other delivery countries receive manual-assistance guidance rather than a false order confirmation. The administrator can review assistance requests and create linked manual orders.

## Store Assignment and Settlement

Homepage products remain available to approved Store owners through **Add to My Store**. Administrators can assign only products that are both linked to the selected Store and present in that Store's owner-managed product list. The administrator defines the required order amount and expected Store profit and may edit both before merchant acceptance.

The merchant can accept or reject only while an assignment is awaiting acceptance. Acceptance locks the order and wallet, verifies available funds, and creates exactly one `order_debit` transaction. Insufficient funds are rejected without a debit. After acceptance, only the administrator manages processing, shipping, delivery, cancellation, and completion; merchants retain read-only status and financial history.

Admin completion creates separate `order_return` and `profit` transactions, returning the original deducted principal and automatically crediting the admin-defined profit exactly once. For example, a $500 wallet debited $280 at acceptance has $220 remaining; completion returns $280 plus $40 profit for a $540 final balance. Cancelling an accepted assignment returns principal without profit. Both dashboards expose required, deducted, returned, and credited amounts, final balance snapshots, shipping state, and linked transaction history.

Routine post-mutation synchronization uses compact stock/Store product patches and omits Store document payloads. Full catalog and document synchronization remains available whenever those records change. Browser storage is only a rendering cache and never authorizes acceptance, settlement, or order transitions.

## Catalog and Attribution

- 510 unique products with 1,968 verified local gallery images
- Selling prices from $40 to $1,000, with consistent discount calculations
- Local product assets; no hotlinked retail-image dependency
- ABO data/images under CC BY 4.0 and supplementary Wikimedia Commons assets

Required source and license notices are in `public/licenses/` and must remain with redistributed catalog assets. `public/catalog-verification.json` records the final catalog checks. Configured Store visitors/views are explicitly administrator-configured metrics, not independently tracked analytics.

## Optional Firebase Support Chat

The core store, accounts, orders, and admin workflows do not require Firebase. The optional legacy support chat uses the browser Firebase configuration in `public/js/firebase-config.js`. Replace its placeholders only with your own Firebase **web-app** configuration and appropriate Realtime Database/Auth rules. Do not add a service-account JSON, private key, or administrator credential to this public file or to the website package. Without Firebase configuration, the rest of MarketZone remains functional.

## Security and Data Model

- Server-side role checks, customer ownership checks, Zod validation, and safe public-user mapping
- Scrypt password hashes with random salts; HttpOnly session cookies
- Integer cents for authoritative money values
- Transactional checkout, row locking, per-customer idempotency keys, stock restoration, and audited administrator actions
- Account-specific Freeze/Unfreeze enforced on the server for deposits, withdrawals, checkout, Store applications and inventory, manual-order assistance, and seller-order acceptance/rejection; sensitive transactions recheck the selected account under a row lock
- Frozen users can still log in, view their account and guidance, maintain their profile/password, and read notifications; Unfreeze restores permitted operations without affecting other accounts
- Browser storage is only a rendering cache; it is not an authority for orders, balances, products, approvals, or account restrictions

## Verification Commands

```bash
npm run check
npm run lint
node --check public/js/app.js
npm run build
```

The final release passed 16 broad API regression groups, 15 broad browser regression groups, 8 focused desktop/mobile order-lifecycle groups, 4 real-JPEG Store-lifecycle groups, 7 focused Freeze/Store-deposit API groups, and 6 focused desktop/mobile Freeze/Store-deposit browser groups. Coverage includes authentication and authorization; the 510-product catalog; Store submission and approval; eligible-product assignment; insufficient and sufficient acceptance; concurrent exactly-once debit; admin-only shipping and completion; principal/profit settlement; cancellation; transaction history; simplified Store deposits without references; pending balances until administrator approval; account-specific frozen-operation denial and Unfreeze restoration; cross-account isolation; checkout idempotency; refunds and stock restoration; notifications; administrator product CRUD and audits; and responsive layouts at 375, 768, 1024, and 1440 pixels. A separate fresh-database test applied all three migrations, produced 15 tables and 17 foreign keys, verified all six financial columns and `docImage` as `MEDIUMTEXT`, and seeded exactly 510 products. In the final repeated state-response sample, compact synchronization reduced payload size by 94.2%; full catalog and Store-document responses remain available when required.

## Project Map

- `public/` — storefront, styles, local product images, and license notices
- `api/routes/` — authenticated customer/admin/auth REST routes
- `api/market/` — catalog seed, mapping, transaction, and audit helpers
- `db/schema.ts` — persistent data model
- `db/migrations/` — reproducible schema migration
- `contracts/` — shared country and session definitions
- `src/` — retained React infrastructure and authentication components

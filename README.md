# WedPlan API

Backend for **WedPlan**, a wedding planning platform where couples discover
vendors, vendors publish services, and admins moderate the marketplace.

Built with **Express 5**, **TypeScript**, **MongoDB** (official driver), **Better
Auth**, **Zod** and **Stripe**.

## Live links

- **Live website:** https://wedplan-arifdeep75-client.vercel.app
- **Live API:** https://wedplan-arifdeep75-server.vercel.app
- **Client repository:** https://github.com/arifdeep75/wedplan-client
- **Server repository:** https://github.com/arifdeep75/wedplan-server

## Technology stack

| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| Runtime        | Node.js 20+ (deployed on Vercel serverless)     |
| Framework      | Express 5                                       |
| Language       | TypeScript (ESM, NodeNext)                      |
| Database       | MongoDB Atlas + official driver                 |
| Auth           | Better Auth (sessions, Google OAuth, JWT/JWKS)  |
| Validation     | Zod                                             |
| Payments       | Stripe Checkout + signature-verified webhooks   |
| Image uploads  | ImgBB API                                       |

## Features

**Authentication & accounts**

- Email/password sign-up and sign-in plus Google OAuth, handled by Better Auth.
- Sessions work both as cookies and as Bearer JWTs (`/api/auth/token`), verified
  against the Better Auth JWKS endpoint.
- Roles (`customer`, `vendor`, `admin`) and blocked state are always re-read
  from the database on every request — never trusted from the client.
- Role guards (`requireCustomer`, `requireVendor`, `requireAdmin`) on every
  privileged route.

**Services**

- Vendors create services with up to six hosted images, edit, deactivate and delete their own services.
- New and edited services go back to `pending` for admin review.
- Public listings only expose `approved` + active services, with search,
  category and price filters, pagination, and vendor/description matching.
- Free vendors may publish up to 3 services; premium vendors are unlimited.
- When Premium expires, the newest three eligible services stay active and
  additional services are paused.
- A premium badge is included on public listings for premium vendors.

**Bookings**

- Customers send booking requests (date, event location + message) for a service.
- Vendors accept or decline requests; customers can cancel while pending.
- Duplicate active requests for the same customer, service and event date are rejected.
- Both sides get their own booking list with populated service/vendor/customer
  summaries.

**Profiles & uploads**

- Name, image, password and vendor business name can be updated.
- Profile and service images are uploaded to ImgBB (`IMGBB_API_KEY`).

**Admin**

- List all users, filter by role, block/unblock accounts.
- Review pending services and approve or reject them.
- Platform stats: users, services, bookings, premium vendors, revenue.
- Transaction ledger for every subscription payment.

**Premium subscriptions**

- One-time Stripe Checkout payment (`$49`) that grants 12 months of premium.
- **Premium is granted only by the signature-verified Stripe webhook**
  (`checkout.session.completed`), never by a browser redirect.
- `POST /api/payments/confirm` verifies that the Checkout session belongs to the
  requesting vendor and is paid, then reports the current plan — it does not
  unlock premium itself.
- `POST /api/payments/webhook` verifies the signature against
  `STRIPE_WEBHOOK_SECRET` and is idempotent per Checkout session.
- Checkout is refused (503) when Stripe is configured without a webhook secret,
  so a payment can never succeed without a way to fulfil it.
- Renewing stacks another 12 months on top of an unexpired period.
- Demo mode (`PAYMENTS_DEMO=true`) exists **only** for evaluation environments
  without Stripe keys. It records transactions with `provider: "demo"` and
  `amount: 0`, and is never presented as real revenue. Without Stripe keys and
  without demo mode, checkout returns `503` instead of faking success.

## Getting started

Requirements: Node.js 20+, a MongoDB database, npm.

```bash
npm install
# create .env manually and fill in the values below
npm run seed             # optional demo vendors + services
npm run dev              # http://localhost:5000
```

Create the first admin (there is no public admin sign-up):

```bash
npm run seed:admin -- --email admin@example.com --password "a-strong-password"
```

Other scripts:

```bash
npm run build   # tsc to dist/
npm test        # subscription policy tests
npm start       # run the compiled server
```

## Environment variables

Create `.env` manually. It is git-ignored, as are `.env.local` and every other
env file — never commit real credentials.

| Variable               | Required | Description                                                    |
| ---------------------- | -------- | -------------------------------------------------------------- |
| `PORT`                 | no       | API port (default `5000`)                                      |
| `MONGODB_URI`          | yes      | MongoDB connection string                                      |
| `DB_NAME`              | yes      | Database name (e.g. `wedplan_db`)                              |
| `CLIENT_URL`           | yes      | Frontend origin, used for CORS and Stripe redirects            |
| `BETTER_AUTH_SECRET`   | yes      | Long random secret used by Better Auth                         |
| `BETTER_AUTH_URL`      | yes      | Public base URL of this API (e.g. `http://localhost:5000`)     |
| `GOOGLE_CLIENT_ID`     | no       | Google OAuth client id                                         |
| `GOOGLE_CLIENT_SECRET` | no       | Google OAuth client secret                                     |
| `IMGBB_API_KEY`        | no       | Enables profile/service image uploads                          |
| `STRIPE_SECRET_KEY`    | no       | Enables real Stripe Checkout                                   |
| `STRIPE_WEBHOOK_SECRET`| no       | Enables the verified Stripe webhook                            |
| `PAYMENTS_DEMO`        | no       | `true` activates demo premium (no charge, labelled as demo)    |

## API overview

All responses are `{ success: boolean, data?, message? }`.

**Auth** — mounted under `/api/auth` by Better Auth, plus:

| Method | Path             | Access | Description                     |
| ------ | ---------------- | ------ | ------------------------------- |
| GET    | `/api/auth/me`   | auth   | Current user with fresh role    |
| GET    | `/api/auth/token`| auth   | Bearer JWT for API clients      |

**Services**

| Method | Path                          | Access | Description                          |
| ------ | ----------------------------- | ------ | ------------------------------------ |
| GET    | `/api/services`               | public | Approved listings, search & filters  |
| GET    | `/api/services/:id`           | public | Service detail                       |
| GET    | `/api/services/mine`          | vendor | Own services (any status)            |
| POST   | `/api/services`               | vendor | Create (enters `pending`)            |
| PATCH  | `/api/services/:id`           | vendor | Update own service (back to `pending`)|
| PATCH  | `/api/services/:id/active`    | vendor | Show/hide an approved service        |
| DELETE | `/api/services/:id`           | vendor | Delete own service                   |
| GET    | `/api/services/admin/all`     | admin  | Every service with vendor info       |
| PATCH  | `/api/services/admin/:id/status` | admin | Approve or reject a service         |

**Bookings**

| Method | Path                       | Access   | Description                     |
| ------ | -------------------------- | -------- | ------------------------------- |
| POST   | `/api/bookings`            | customer | Request a booking               |
| GET    | `/api/bookings/mine`       | customer | Own requests                    |
| GET    | `/api/bookings/vendor`     | vendor   | Requests for own services       |
| PATCH  | `/api/bookings/:id/status` | both     | Accept/decline, or cancel       |

**Profile & uploads**

| Method | Path                | Access | Description                  |
| ------ | ------------------- | ------ | ---------------------------- |
| PATCH  | `/api/profile/me`   | auth   | Update name/image/password/business name |
| POST   | `/api/uploads/image`| auth   | Upload an image to ImgBB     |

**Payments (vendor only)**

| Method | Path                        | Description                                    |
| ------ | --------------------------- | ---------------------------------------------- |
| GET    | `/api/payments/status`      | Plan, expiry, price, recent transactions       |
| POST   | `/api/payments/checkout`    | Stripe Checkout URL, or `{ demo: true }`       |
| POST   | `/api/payments/confirm`     | Verify a Checkout session after redirect       |
| POST   | `/api/payments/demo-activate` | Demo mode activation (requires `PAYMENTS_DEMO`) |
| GET    | `/api/payments/mine`        | Full transaction history                       |
| POST   | `/api/payments/webhook`     | Stripe webhook (raw body, signature verified)  |

**Admin**

| Method | Path                            | Description                       |
| ------ | ------------------------------- | --------------------------------- |
| GET    | `/api/admin/users`              | All users                         |
| PATCH  | `/api/admin/users/:id/block`    | Block or unblock an account       |
| GET    | `/api/admin/stats`              | Platform counts and revenue       |
| GET    | `/api/admin/transactions`       | Subscription payment ledger       |

## Stripe setup

1. Set `STRIPE_SECRET_KEY` (test mode is fine).
2. Forward events locally:

   ```bash
   stripe listen --forward-to localhost:5000/api/payments/webhook
   ```

3. Put the printed signing secret in `STRIPE_WEBHOOK_SECRET` and restart the
   server.
4. Premium success redirects to
   `CLIENT_URL/payment/success?session_id=…`; the client calls
   `/api/payments/confirm` to verify the session, then waits for the webhook to
   unlock premium. A cancelled checkout returns to `CLIENT_URL/payment/cancel`.
5. Without Stripe keys the API stays honest: checkout responds with `503`
   ("Payments are not configured yet.") unless `PAYMENTS_DEMO=true`.

## Deployment

Any Node host works (Render, Railway, Fly.io, a VPS):

1. Create a MongoDB Atlas cluster and copy the connection string.
2. Deploy this repository with build command `npm install && npm run build` and
   start command `npm start`.
3. Set every required environment variable from the table above. Use the public
   HTTPS API origin for `BETTER_AUTH_URL` and the deployed frontend origin for
   `CLIENT_URL`.
4. Create the admin account once with `npm run seed:admin -- --email … --password …`
   (run it in the host's shell).
5. In Stripe, add a webhook endpoint pointing at
   `https://<api-host>/api/payments/webhook` for `checkout.session.completed`
   and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
6. Add the deployed client URL to the Google OAuth redirect origins if Google
   sign-in is enabled.

## Security notes

- Client-supplied roles, vendor ids, prices and statuses are ignored; the server
  derives them from the authenticated session and the database.
- Service ownership is checked on every update/delete.
- Booking state transitions are validated per role (customers can only cancel
  pending requests; vendors can only accept/decline requests for their own
  services).
- The Stripe webhook is signature-verified and idempotent.
- No public admin registration — admins are created with `npm run seed:admin`.
- Environment files are git-ignored. Secrets belong in local env files and the
  deployment provider's environment settings — never in the repository.
- If a credential is ever exposed, rotate it immediately. Removing it from the
  current tree does not remove it from git history or caches.

## Project structure

```
src/
  config/        MongoDB connection, collection names
  constants/     roles, categories, plan limits
  lib/           Stripe client, subscription helpers
  middleware/    Better Auth session/JWT verification, role guards, errors
  modules/
    admin/       users, stats, transactions
    auth/        current-user endpoint
    bookings/    booking workflow
    payments/    subscriptions + Stripe webhook
    profile/     profile updates
    services/    listings, moderation, premium limits
    uploads/     ImgBB image upload
  scripts/       demo seed and admin seed
  app.ts         Express app wiring and route mounting
  server.ts      process entry point
```

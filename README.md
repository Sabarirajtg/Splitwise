# SplitShare

A Splitwise-style expense splitter: groups, multi-currency expenses with live FX
conversion, recurring bills, and simplified debt settle-up. Backend is
Node/Express + MongoDB; frontend is Next.js.

## Structure

```
splitshare/
  backend/     Express API + MongoDB (Mongoose)
  frontend/    Next.js app (pages router)
```

## 1. Set up MongoDB Atlas (free tier works fine)

1. Create a free cluster at https://www.mongodb.com/cloud/atlas
2. Create a database user (username + password)
3. Under Network Access, allow access from anywhere (0.0.0.0/0) — or your
   deployment platform's IPs if you want to lock it down later
4. Copy the connection string, e.g.
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/splitshare`

## 2. Run locally

**Backend**
```bash
cd backend
cp .env.example .env
# Set MONGODB_URI and INTERNAL_API_SECRET in backend/.env.
# Use the same random INTERNAL_API_SECRET in frontend/.env.local.
# Generate a shared secret with: openssl rand -hex 32
npm install
npm start
# API running on http://localhost:4000
```

**Frontend**
```bash
cd frontend
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:4000 (default is already correct locally)
# Configure NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# NEXTAUTH_URL, and the same INTERNAL_API_SECRET used in backend/.env
npm install
npm run dev
# App running on http://localhost:3000
```

Open http://localhost:3000, log in with a name + PIN, and try it out.

## 3. Deploy

**Backend (Express API) → Render or Railway**
- Render: New → Web Service → connect this repo, root directory `backend`,
  build command `npm install`, start command `npm start`
- Railway: New Project → Deploy from repo → set root directory to `backend`
- Add `MONGODB_URI` with your Atlas connection string and `INTERNAL_API_SECRET`
  (use the same value in the frontend deployment).
- Note the deployed URL, e.g. `https://splitshare-api.onrender.com`

**Frontend (Next.js) → Vercel**
- Import this repo into Vercel, set root directory to `frontend`
- Add `NEXT_PUBLIC_API_URL` = your deployed backend URL, `INTERNAL_API_SECRET`
  (matching the backend), and the existing NextAuth/Google OAuth variables.
- Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` to the backend
  environment to activate Web Push; see the Web push notifications section below.
- Deploy — Vercel gives you a stable `https://your-app.vercel.app` link

Once both are deployed, share the Vercel link with your friends. Everyone who
logs in (name + PIN) and joins the same group (via the group code from the
Invite button) sees the same live, shared data — stored centrally in MongoDB,
not on anyone's device.


## Web push notifications

SplitShare can send browser push notifications for new or updated expenses
that involve a member, removed expenses, and UPI payment confirmation updates.
Members opt in from the **Your groups** dashboard. Notifications require a
browser that supports Push API and Notification API, user permission, and HTTPS
for deployed sites (localhost is allowed for local development).

1. Generate a VAPID key pair:
   ```bash
   cd backend
   node scripts/generate-vapid-keys.js
   ```
2. Configure these variables in the backend environment (for example, Render):
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (a contact URI such as `mailto:you@example.com`)
3. Redeploy/restart the backend, then open SplitShare and select
   **Enable push notifications**. Allow the browser prompt.
4. Test by adding an expense that includes another opted-in group member, then
   test marking a UPI payment as paid and confirming or reporting it.

The public VAPID key is delivered through an authenticated Next.js API route.
Push subscriptions are saved against the signed-in app user and expired browser
subscriptions are cleaned up when the push service returns 404 or 410. The
service worker is at `/sw.js`; clicking a notification opens the relevant group.

For local development, visit the frontend at `http://localhost:3000`. For a
deployed app, the frontend must use HTTPS. The private VAPID key must remain
server-side and must never be added to a `NEXT_PUBLIC_*` variable.

## Notes on the login model

This app uses a lightweight name + PIN identity system rather than full
email/password authentication with hashed credentials, sessions, and email
verification. It's enough for a trusted friend group, but isn't meant to
protect sensitive financial data at scale. If you want proper accounts later
(email verification, password reset, OAuth), that's a solid next step.

## Live FX conversion

Expense amounts are converted to the group's base currency at the time
they're added, using https://open.er-api.com (free, no API key, refreshed
roughly every 24h, cached server-side for 1 hour). Supported currencies
include USD, EUR, GBP, INR, THB, JPY, AUD, CAD, SGD, and AED — add more in
`backend/server.js` (`CURRENCIES`) and `frontend/lib/api.js` (`CURRENCIES`).

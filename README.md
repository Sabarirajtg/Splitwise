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
# edit .env and paste your MONGODB_URI
npm install
npm start
# API running on http://localhost:4000
```

**Frontend**
```bash
cd frontend
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=http://localhost:4000 (default is already correct locally)
npm install
npm run dev
# App running on http://localhost:3000
```

Open http://localhost:3000, log in with a name + PIN, and try it out.

## Test Google sign-in from a phone

The default `.env.local` values (`NEXTAUTH_URL=http://localhost:3000` and
`NEXT_PUBLIC_API_URL=http://localhost:4000`) are for a browser on the same
computer. On a phone, `localhost` refers to the phone itself, not your laptop.
Opening the app at `http://<laptop-LAN-IP>:3000` can load the page, but Google
OAuth still cannot use that raw HTTP LAN IP as its callback host. Google requires
HTTPS for non-localhost redirect URIs and does not allow raw IP address hosts.

For a phone test with Google sign-in, use temporary HTTPS tunnels for both
frontend and backend (for example, one tunnel for ports 3000 and 4000):

1. Start the backend on port 4000 and frontend on port 3000.
2. Create an HTTPS tunnel to port 3000 and another HTTPS tunnel to port 4000.
3. In `frontend/.env.local`, set `NEXTAUTH_URL` to the frontend HTTPS tunnel URL
   and `NEXT_PUBLIC_API_URL` to the backend HTTPS tunnel URL.
4. In Google Cloud Console, add the frontend tunnel origin under **Authorized
   JavaScript origins** and add
   `https://<frontend-tunnel-host>/api/auth/callback/google` under **Authorized
   redirect URIs** for the same OAuth client ID.
5. Restart the frontend after changing environment variables, then open the
   frontend HTTPS tunnel URL on the phone and try signing in again.

Keep tunnels temporary and use test data only: the backend API becomes reachable
from the internet while its tunnel is active. Stop both tunnels when testing is done.

## 3. Deploy

**Backend (Express API) → Render or Railway**
- Render: New → Web Service → connect this repo, root directory `backend`,
  build command `npm install`, start command `npm start`
- Railway: New Project → Deploy from repo → set root directory to `backend`
- In either platform, add an environment variable `MONGODB_URI` with your
  Atlas connection string
- Note the deployed URL, e.g. `https://splitshare-api.onrender.com`

**Frontend (Next.js) → Vercel**
- Import this repo into Vercel, set root directory to `frontend`
- Add environment variable `NEXT_PUBLIC_API_URL` = your deployed backend URL
  (from the step above)
- Deploy — Vercel gives you a stable `https://your-app.vercel.app` link

Once both are deployed, share the Vercel link with your friends. Everyone who
logs in (name + PIN) and joins the same group (via the group code from the
Invite button) sees the same live, shared data — stored centrally in MongoDB,
not on anyone's device.

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

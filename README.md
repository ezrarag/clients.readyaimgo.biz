# Readyaimgo Client Hub

A secure web application for Readyaimgo clients to manage subscriptions, view BEAM Coin balances, track Housing Wallet allocations, and access support.

## 🚀 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: TailwindCSS + shadcn/ui
- **Authentication**: Firebase Auth (Email/Password + Google OAuth)
- **Database**: Firebase Firestore
- **Payment**: Stripe (Billing Portal + Subscriptions)
- **Deployment**: Vercel

## 📋 Features

- ✅ User authentication (Email/Password + Google OAuth)
- ✅ Client dashboard with subscription overview
- ✅ Stripe subscription management
- ✅ **BEAM Coin Ledger integration** - Live balance fetching and transaction sync
- ✅ Housing Wallet display with credits
- ✅ Transaction history (Stripe + BEAM Coin)
- ✅ Admin view for managing all clients
- ✅ Protected routes with middleware

## 🛠️ Setup Instructions

### 1. Clone and Install

```bash
npm install
```

### 2. Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable Email/Password
   - Enable Google (add OAuth credentials)
3. Create Firestore Database:
   - Go to Firestore Database
   - Create database in production mode
   - Set up security rules (see below)
4. Copy your Firebase config values to `.env.local`

### 3. Stripe Setup

1. Create a Stripe account at [Stripe Dashboard](https://dashboard.stripe.com/)
2. Get your API keys from Developers > API keys
3. Set up Billing Portal:
   - Go to Settings > Billing > Customer portal
   - Configure your portal settings
4. Set up webhook:
   - Go to Developers > Webhooks
   - Add endpoint: `https://your-domain.com/api/stripe/webhook`
   - Select events: `customer.subscription.*`, `invoice.payment_succeeded`
   - Copy webhook signing secret
5. Add Stripe keys to `.env.local`

### 4. Environment Variables

Create a `.env.local` file (use `.env.example` as a template):

```env
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Admin
NEXT_PUBLIC_ADMIN_UID=your_firebase_user_uid
RAG_INTERNAL_SECRET=replace_with_a_long_random_secret

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
# Marketing site URL for onboarding handoffs
NEXT_PUBLIC_MARKETING_SITE_URL=https://readyaimgo.biz

# BEAM Coin Ledger API
NEXT_PUBLIC_BEAM_LEDGER_URL=https://beam-coin-ledger.vercel.app
NEXT_PUBLIC_BEAM_LEDGER_ADMIN_URL=https://beam-coin-ledger.vercel.app

# AI task extraction
ANTHROPIC_API_KEY=sk-ant_your_anthropic_key
```

### 5. Firestore Security Rules

Add these rules to your Firestore database:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Clients can read/write their own data
    match /clients/{clientId} {
      allow read, write: if request.auth != null && request.auth.uid == clientId;
      allow read: if request.auth != null && request.auth.uid == resource.data.adminUid;
    }
    
    // Transactions
    match /transactions/{transactionId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.clientId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.clientId;
    }
  }
}
```

### 6. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📁 Project Structure

```
├── app/
│   ├── api/              # API routes
│   │   ├── stripe/       # Stripe webhooks & portal
│   │   ├── transactions/ # Transaction CRUD
│   │   ├── housing-wallet/ # Housing wallet data
│   │   └── beam-coin/     # BEAM Coin Ledger integration
│   ├── admin/            # Admin dashboard
│   ├── dashboard/        # Client dashboard
│   ├── login/            # Login page
│   ├── signup/           # Sign up page
│   └── layout.tsx        # Root layout
├── components/
│   ├── ui/               # shadcn/ui components
│   └── auth/             # Auth provider
├── lib/
│   ├── firebase/         # Firebase config & auth helpers
│   ├── admin.ts          # Admin dashboard utilities
│   ├── beamCoin.ts       # BEAM Coin Ledger integration
│   └── utils.ts          # Utility functions
├── types/                # TypeScript types
└── middleware.ts         # Route protection
```

## 🔌 API Integration Points

### BEAM Coin Ledger Integration ✅

The app is fully integrated with the BEAM Coin Ledger API:

- **Live Balance Fetching**: `GET /api/beam-coin?clientId=...` - Fetches real-time balance from ledger
- **Transaction Sync**: `POST /api/beam-coin/transactions` - Posts transactions to ledger
- **Transaction History**: `GET /api/beam-coin/transactions?clientId=...` - Retrieves transaction history

**Automatic Integration:**
- Stripe payments automatically earn BEAM Coins (1 BEAM per $1 spent)
- Housing wallet redemptions automatically spend BEAM Coins
- All balances are cached in Firestore for fast display

**Configuration:**
Set `NEXT_PUBLIC_BEAM_LEDGER_URL` and `NEXT_PUBLIC_BEAM_LEDGER_ADMIN_URL` in your environment variables (defaults to `https://beam-coin-ledger.vercel.app`)

**Admin Endpoints:**
The admin dashboard integrates with BEAM Ledger admin endpoints:
- `GET /api/admin/clients` - Fetch all clients with balances
- `GET /api/admin/transactions` - Fetch all transactions (with limit)
- `GET /api/admin/stats` - Fetch overview statistics

If these endpoints are not yet available in the BEAM Ledger repo, the admin dashboard will gracefully fall back to Firestore data.

### Housing Wallet

- `GET /api/housing-wallet?clientId=...` - Get wallet data (currently mock data)

## 🚢 Deployment to Vercel

1. Push your code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables in Vercel dashboard
4. Deploy!

For custom domain (`clients.readyaimgo.biz`):
1. Go to Project Settings > Domains
2. Add custom domain
3. Update DNS records as instructed

## 👑 Admin Dashboard

The admin dashboard (`/admin`) provides comprehensive management tools for BEAM and Readyaimgo staff.

### Features

- **Overview Tab**: KPI cards showing total BEAM Coins, total clients, and subscription revenue. Monthly activity chart displaying earn vs spend trends.
- **Clients Tab**: Searchable and sortable table of all clients with balances, plans, and last active dates. Integrates with BEAM Ledger admin endpoint or falls back to Firestore.
- **Transactions Tab**: Complete transaction history with filtering by type (earn/spend). Color-coded display (green for earn, red for spend).
- **Reports Tab**: CSV export functionality for transactions and client balances. Placeholder for future impact reports (Marriott, Home Depot) and PDF receipt generation.

### Access Control

- Only users with UID matching `NEXT_PUBLIC_ADMIN_UID` can access the admin dashboard
- Non-admin users are automatically redirected to their dashboard
- All admin API calls use Firebase ID tokens for authentication

### Usage

1. Set `NEXT_PUBLIC_ADMIN_UID` in your environment variables to your Firebase user UID
2. Log in as that user
3. Navigate to `/admin`

## 🔐 Security Notes

- All routes are protected by client-side auth checks
- Admin routes require matching `NEXT_PUBLIC_ADMIN_UID`
- Stripe webhooks are verified using webhook secrets
- Firestore security rules restrict data access
- Admin API calls authenticate using Firebase ID tokens

## 📝 Next Steps

1. ✅ **BEAM Coin Ledger**: Fully integrated - balance fetching and transaction sync working
2. ✅ **Admin Dashboard**: Complete admin interface with Overview, Clients, Transactions, and Reports tabs
3. **Enhance Housing Wallet**: Connect to BEAM Think Tank Housing Wallet Program API
4. **Admin Write Controls**: Add manual credit/debit BEAM Coin functionality
5. **Impact Reports**: Generate PDF reports for Marriott / Home Depot partners
6. **PDF Receipt Generator**: Create donor receipts
7. **Add Support Contact**: Implement contact form or chat integration
8. **Email Notifications**: Set up email alerts for transactions and subscription updates

## 🤝 Support

For issues or questions, contact the Readyaimgo team.

---

Built with ❤️ for Readyaimgo clients

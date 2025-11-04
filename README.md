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

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
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
Set `NEXT_PUBLIC_BEAM_LEDGER_URL` in your environment variables (defaults to `https://beam-coin-ledger.vercel.app`)

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

## 🔐 Security Notes

- All routes are protected by client-side auth checks
- Admin routes require matching `NEXT_PUBLIC_ADMIN_UID`
- Stripe webhooks are verified using webhook secrets
- Firestore security rules restrict data access

## 📝 Next Steps

1. ✅ **BEAM Coin Ledger**: Fully integrated - balance fetching and transaction sync working
2. **Enhance Housing Wallet**: Connect to BEAM Think Tank Housing Wallet Program API
3. **Add Support Contact**: Implement contact form or chat integration
4. **Email Notifications**: Set up email alerts for transactions and subscription updates
5. **Analytics**: Add usage analytics and reporting

## 🤝 Support

For issues or questions, contact the Readyaimgo team.

---

Built with ❤️ for Readyaimgo clients


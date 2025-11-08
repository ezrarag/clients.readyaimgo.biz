# 🚀 Client Onboarding Flow - Pre-Testing Checklist

## Pre-Testing Setup (Before signing up ezra.haugabrooks@gmail.com)

### ✅ Completed
- [x] Firestore writes use `clients/{email}` structure
- [x] Free tier (`planType: "free"`) automatically assigned on signup
- [x] Dashboard shows upgrade card for free tier users
- [x] Stripe checkout route created (`/api/stripe/checkout`)
- [x] Sign-in redirects to `/dashboard`
- [x] Slack notification route created (`/api/slack/notify`)
- [x] Slack notifications integrated into signup, payment, and upgrade flows

### ⚠️ Required Before Testing

#### 1. Environment Variables (`.env.local`)
```env
# Firebase - readyaimgo-clients-temp project
NEXT_PUBLIC_FIREBASE_API_KEY=<your_key>
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=readyaimgo-clients-temp.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=readyaimgo-clients-temp
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=readyaimgo-clients-temp.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=<your_sender_id>
NEXT_PUBLIC_FIREBASE_APP_ID=<your_app_id>

# Stripe (REQUIRED for checkout to work)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...  # ⚠️ CRITICAL - Get from Stripe Dashboard

# Slack Notifications (Optional but recommended)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000  # or https://clients.readyaimgo.biz for production
```

#### 2. Firebase Setup
- [ ] Verify `readyaimgo-clients-temp` Firebase project exists
- [ ] Enable Authentication (Email/Password + Google)
- [ ] Create Firestore database
- [ ] Set Firestore security rules (see README.md)
- [ ] Verify Firebase config values match `.env.local`

#### 3. Stripe Setup
- [ ] Create Stripe test account (if testing locally)
- [ ] Create a product and price in Stripe Dashboard
- [ ] Copy the Price ID (starts with `price_`) → set as `STRIPE_PRICE_ID`
- [ ] Set up webhook endpoint: `https://clients.readyaimgo.biz/api/stripe/webhook`
- [ ] Copy webhook signing secret → set as `STRIPE_WEBHOOK_SECRET`

#### 4. Slack Setup (Optional)
- [ ] Create Slack webhook for `#announcements` channel
- [ ] Copy webhook URL → set as `SLACK_WEBHOOK_URL`
- [ ] Test webhook with curl or Postman

---

## 🧪 Testing Checklist for ezra.haugabrooks@gmail.com

### Test 1: Sign Up Flow
- [ ] Navigate to `/signup`
- [ ] Enter:
  - Name: Ezra Haugabrooks
  - Email: ezra.haugabrooks@gmail.com
  - Password: (any password ≥6 chars)
- [ ] Click "Sign Up"
- [ ] **Verify:**
  - [ ] Redirects to `/dashboard`
  - [ ] Firestore document exists at `clients/ezra.haugabrooks@gmail.com`
  - [ ] Document has `planType: "free"`
  - [ ] Slack notification sent to `#announcements` (if configured)

### Test 2: Dashboard Display
- [ ] **Verify dashboard shows:**
  - [ ] Welcome message with name
  - [ ] Upgrade card banner (for free tier)
  - [ ] Subscription card shows "Free Tier" with "Upgrade Now" button
  - [ ] BEAM Coin balance (0 initially)
  - [ ] Housing Wallet section

### Test 3: Upgrade Flow
- [ ] Click "Upgrade Now" button
- [ ] **Verify:**
  - [ ] Redirects to Stripe Checkout
  - [ ] Can complete test payment
  - [ ] After payment, redirects back to `/dashboard`
  - [ ] Dashboard shows new plan (not "free")
  - [ ] Slack notification sent for upgrade (if configured)

### Test 4: Login Flow
- [ ] Sign out
- [ ] Navigate to `/login`
- [ ] Enter: ezra.haugabrooks@gmail.com + password
- [ ] **Verify:**
  - [ ] Redirects to `/dashboard`
  - [ ] All data loads correctly

### Test 5: Payment Notification
- [ ] Complete a test payment via Stripe
- [ ] **Verify:**
  - [ ] Stripe webhook processes payment
  - [ ] Transaction created in Firestore
  - [ ] Slack notification sent (if configured)

---

## 🔍 Verification Points

### Firestore Document Structure
After signup, verify `clients/ezra.haugabrooks@gmail.com` contains:
```json
{
  "uid": "<firebase_uid>",
  "name": "Ezra Haugabrooks",
  "email": "ezra.haugabrooks@gmail.com",
  "planType": "free",
  "beamCoinBalance": 0,
  "housingWalletBalance": 0,
  "createdAt": "<timestamp>"
}
```

### API Routes to Test
- [ ] `POST /api/slack/notify` - Should return `{ success: true }` or `{ skipped: true }`
- [ ] `POST /api/stripe/checkout` - Should return `{ url: "<stripe_checkout_url>" }`
- [ ] `GET /api/beam-coin?clientId=<uid>` - Should return balance
- [ ] `GET /api/housing-wallet?clientId=<uid>` - Should return wallet data

---

## 🚨 Common Issues & Solutions

### Issue: "STRIPE_PRICE_ID not set"
**Solution:** Get Price ID from Stripe Dashboard → Products → Your Product → Copy Price ID

### Issue: "Slack notification not working"
**Solution:** 
- Check `SLACK_WEBHOOK_URL` is set correctly
- Test webhook URL manually with curl
- Notifications are non-blocking (won't fail signup if Slack is down)

### Issue: "Firestore permission denied"
**Solution:** Update Firestore security rules (see README.md section 5)

### Issue: "Redirect not working after signup"
**Solution:** Check browser console for errors, verify Firebase Auth is configured

---

## 📝 Post-Testing Tasks

After successful testing:
- [ ] Deploy to Vercel (`clients.readyaimgo.biz`)
- [ ] Set all environment variables in Vercel dashboard
- [ ] Test production signup flow
- [ ] Verify Slack notifications work in production
- [ ] Monitor Firestore for new client documents

---

## 🎯 Success Criteria

✅ **Signup works:** User can sign up and is redirected to dashboard  
✅ **Free tier assigned:** `planType: "free"` in Firestore  
✅ **Upgrade card visible:** Dashboard shows upgrade option  
✅ **Stripe checkout works:** Can initiate upgrade flow  
✅ **Slack notifications:** Events posted to `#announcements`  
✅ **No errors:** Console and network tabs show no critical errors

---

**Ready to test?** Make sure all ⚠️ items above are completed, then proceed with the testing checklist!


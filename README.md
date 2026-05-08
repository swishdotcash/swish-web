# Swish

**Privacy, made simple.**

Swish is the consumer layer for privacy on Solana. It aggregates across the underlying privacy protocols — Privacy Cash, MagicBlock, and Umbra — so users can send and receive USDC privately without picking a protocol or managing the mechanics.

**Live:** [swish.cash](https://swish.cash)

---

## Features

- **Send** — Private USDC transfers to wallet addresses or X handles
- **Request** — Create payment requests others can fulfill
- **Send & Claim** — USDC via passphrase-protected claim links; sender can reclaim if unclaimed
- **Deposit** — QR + copyable address for receiving SOL/USDC
- **Withdraw** — Gas-sponsored USDC transfer
- **Export** — Self-custody the Privy embedded wallet at any time

---

## Multi-protocol routing

Every send routes through one of three privacy protocols. By default, Swish picks the best route automatically:

- **Umbra** — ZK shielded pool (Arcium MPC); preferred when sender + recipient are both registered
- **MagicBlock** — TEE-based privacy (Intel TDX); fallback when Umbra isn't viable
- **Privacy Cash** — ZK UTXO mixer; final fallback

Users can override Auto via the picker. Each protocol's own fees are surfaced honestly in the UI; Swish itself currently charges no fee.

---

## Tech stack

- **Next.js 16** (App Router, webpack build)
- **Privy** (`@privy-io/react-auth`) — Solana wallets + Twitter login
- **Solana web3.js** + wallet-adapter
- **Supabase** — activity rows + claimed-UTXO tracker
- **Tailwind CSS** + Framer Motion
- **Pyth Hermes v2** — SOL/USD price feed

---

## Development

```bash
npm install --legacy-peer-deps
npm run dev
```

### Required environment variables

```env
# Solana
RPC_URL=
NEXT_PUBLIC_RPC_URL=

# Sponsor (pays gas for claim/reclaim + sponsored flows)
SPONSOR_PRIVATE_KEY=

# Privy
NEXT_PUBLIC_PRIVY_APP_ID=
PRIVY_APP_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Twitter (X handle resolution + login)
TWITTER_BEARER_TOKEN=
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=

# App
NEXT_PUBLIC_APP_URL=https://swish.cash
```

Optional (Umbra Send & Claim, currently gated off in production):

```env
UMBRA_BURNER_ENCRYPTION_KEY=  # 32-byte hex; AES-256-GCM key for burner secret
```

---

## Links

- **Live app:** [swish.cash](https://swish.cash)
- **Privacy Cash:** [privacy.cash](https://privacy.cash)
- **MagicBlock:** [magicblock.xyz](https://www.magicblock.xyz)
- **Umbra:** [umbraprivacy.com](https://umbraprivacy.com)

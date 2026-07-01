# JewelryFlow ERP Architecture Documentation

## Overview

JewelryFlow is a comprehensive ERP system for jewelry stores, built with modern backend technologies. It manages all aspects of jewelry business operations including inventory, sales, purchases, karigar (craftsman) management, trade, and customer relationships.

---

## Tech Stack

### Core Technologies
- **Framework**: NestJS (v10) - Progressive Node.js framework
- **Language**: TypeScript
- **Database**: PostgreSQL (via Prisma ORM)
- **ORM**: Prisma (v5)
- **Authentication**: JWT (Passport)
- **API Documentation**: Swagger
- **Testing**: Jest (Unit & Integration Tests)

### Key Dependencies
- `@nestjs/*`: NestJS core and modules
- `@prisma/client`: Database access
- `bcrypt`: Password hashing
- `class-validator` / `class-transformer`: DTO validation
- `nodemailer`: Email notifications
- `rxjs`: Reactive programming

---

## Project Structure

```
jewelryflow-backend/
├── prisma/                 # Database layer
│   ├── migrations/         # Prisma migrations
│   ├── schema.prisma       # Database schema definition
│   └── seed.ts             # Database seeding
├── src/
│   ├── agent/              # AI Agent module
│   ├── audit/              # Audit logging
│   ├── auth/               # Authentication & RBAC
│   ├── common/             # Shared utilities & decorators
│   ├── customer/           # Customer management
│   ├── dashboard/          # Dashboard analytics
│   ├── karigar/            # Karigar (craftsman) management
│   ├── ledger/             # Financial ledger
│   ├── prisma/             # Prisma module
│   ├── purchase/           # Purchase orders
│   ├── rates/              # Daily metal rates
│   ├── sales/              # Sales transactions
│   ├── stock/              # Inventory management
│   ├── trade/              # Trade management
│   ├── app.module.ts       # Root module
│   └── main.ts             # Entry point
└── [config files]
```

---

## Core Modules & Features

### 1. **Stock Module** (`src/stock/`)
Manages jewelry inventory with:
- SKU generation (by origin: PURCHASED, KARIGAR, TRADE)
- Weight management (gram, tola, lal)
- Jerty (gold/silver content)
- Jyala (making charges, stone charges, etc.)
- Tax toggles (luxury tax, VAT)
- Status tracking (IN_STOCK, RESERVED, SOLD, RETURNED, SCRAPPED, UNDER_DISPUTE)
- Price preview endpoint

### 2. **Sales Module** (`src/sales/`)
Handles all customer transactions:
- Sale creation with line items
- Payment methods (CASH, ONLINE, CHEQUE)
- Bill number generation
- Return/exchange/buy-back handling
- Customer bill views
- Owner bill views (with full breakdown)

### 3. **Karigar Module** (`src/karigar/`)
Manages craftsmen and production:
- Production orders
- Metal issuance/returns
- Karigar payments (cash/metal)
- Dispute management (wastage issues)
- Tolerance percentage tracking

### 4. **Rates Module** (`src/rates/`)
Daily metal rate management:
- Buy/sell rates per metal type
- Multi-unit support (gram, tola, lal)
- Historical rate tracking
- Current rate flag (`isCurrent`)

### 5. **Trade Module** (`src/trade/`)
Trade supplier management:
- Trade orders (raw metal in, finished items out)
- Cash adjustments
- Trade status tracking

### 6. **Purchase Module** (`src/purchase/`)
Direct purchase from suppliers:
- Purchase orders
- Receipt of finished items
- Purchase date tracking
- Rate at purchase time

### 7. **Auth & RBAC** (`src/auth/`)
User management and access control:
- JWT authentication
- Role-based access control (RBAC)
- Email verification
- Password reset

### 8. **Audit Module** (`src/audit/`)
Tracks all user actions for accountability:
- Audit logs
- User action tracking

### 9. **Customer Module** (`src/customer/`)
Customer relationship management:
- Customer profiles (with phone number hashing for privacy)
- Transaction history
- Buyback records

### 10. **AI Agent Module** (`src/agent/`)
Built-in AI capabilities:
- AI tools for stock, sales, billing
- Prompt templates
- Agent service

---

## Database Schema (Highlights)

Key entities and relationships:

```
User → Role → Permission (RBAC)

DailyRate ←→ MetalType (one-to-many)

StockItem → ItemCategory (many-to-one)
StockItem → MetalType (many-to-one, optional)
StockItem → DailyRate (entryRate, many-to-one, optional)
StockItem → TradeItem (optional)
StockItem → ProductionItem (optional)
StockItem → StockItemAddon[] (one-to-many)

Transaction → TransactionLine[] (one-to-many)
TransactionLine → StockItem (optional)

ProductionOrder → Karigar (many-to-one)
ProductionOrder → ProductionIssue[]
ProductionOrder → ProductionReturn[]
ProductionReturn → ProductionItem[]
ProductionItem → StockItem (optional)

Trade → TradeItem[]
TradeItem → StockItem (optional)
```

See `prisma/schema.prisma` for complete schema details.

---

## Key Business Logic

### Weight System
- Three units supported: gram, tola, lal
- `WeightUtil` class handles conversions and formatting
- All weights stored in database in all three units for consistency

### Pricing Logic
1. **Metal value**: `billableWeight × rate`
   - Billable weight = gross weight + jerty
2. **Jyala**: Sum of making, stone, moti, mala, other charges
3. **Taxes**:
   - Luxury tax (gold only, percentage of metal value)
   - VAT (percentage of jyala)
4. **Grand total**: Metal value + jyala + taxes + addons

### SKU Generation
- `PURCHASED-YYYYMMDD-XXXXX`
- `KARIGAR-YYYYMMDD-XXXXX`
- `TRADE-YYYYMMDD-XXXXX`

---

## API Design Pattern

All controllers follow a consistent RESTful pattern:
```typescript
// Request → DTO → Service → Prisma → Response
POST /api/v1/[module]
GET  /api/v1/[module]
GET  /api/v1/[module]/:id
PATCH /api/v1/[module]/:id
```

DTOs use `class-validator` for validation, responses use a standardized format:
```json
{
  "success": true,
  "data": { /* ... */ },
  "message": "Operation completed"
}
```

---

## Testing Strategy

- **Integration Tests**: Jest + Supertest
- Test files: `*.integration.spec.ts`
- Test database: PostgreSQL (separate instance)
- Coverage: Stock, Sales, Purchase, Karigar, Trade, Rates modules

---

## AI Integration Opportunities

Based on this architecture and the jewelry business domain, here are targeted AI features you could add:

---

### 🎯 **1. Smart Pricing & Jyala Suggestions**
**Use Case**: Help shop owners price items and set jyala charges optimally.
- **Features**:
  - Suggest jyala breakdown (making, stone, moti, mala charges) based on item type, karat, and historical data
  - Predict competitive pricing for new stock items
  - Recommend price adjustments based on current demand and market rates
  - Suggest discount strategies to boost sales of slow-moving items

**Implementation Path**:
- Leverage existing `StockService.calculatePrice()` as a baseline
- Add ML model that trains on historical transaction data
- Expose suggestions via new endpoint: `POST /api/v1/ai/pricing-suggestions`

---

### 📈 **2. Demand Forecasting & Inventory Optimization**
**Use Case**: Prevent stockouts and overstocking by predicting demand.
- **Features**:
  - Predict which items will sell in the next 7/30/90 days
  - Suggest optimal reorder points for each item
  - Identify seasonal trends (e.g., gold bangles sell more before weddings)
  - Recommend markdowns for items that are not selling

**Implementation Path**:
- Use time-series forecasting models on sales and stock data
- Integrate with `StockService` and `SalesService`
- Add dashboard widget showing forecasts in `DashboardModule`

---

### 💬 **3. AI-Powered Chat Assistant**
**Use Case**: Help shop staff and customers get answers instantly.
- **Features**:
  - Answer questions about stock ("Do we have 22k gold rings in size 6?")
  - Help with sales ("What's the price for SKU-1234 with 10% discount?")
  - Guide through processes ("How do I create a purchase order?")
  - Handle customer inquiries about orders and returns

**Implementation Path**:
- Extend the existing `AgentModule` (currently empty)
- Integrate an LLM (OpenAI GPT, Claude, or open-source model like Llama)
- Connect to your business data via function calling (use existing services like `StockService`, `SalesService`)
- Expose via: `POST /api/v1/agent/chat`

---

### 🤖 **4. Smart Billing & Negotiation Helper**
**Use Case**: Help shop owners during the sales negotiation process.
- **Features**:
  - Suggest a reasonable range for total price when a customer negotiates
  - Show historical pricing for similar items
  - Explain the breakdown of costs to customers in simple terms
  - Recommend whether to accept, reject, or counter an offer

**Implementation Path**:
- Use existing `POST /api/v1/stock/price-preview` as base
- Add AI layer that considers negotiation history
- Integrate with `SalesService` for real-time pricing

---

### 🔍 **5. Semantic Search & Visual Search**
**Use Case**: Make it easier to find items in stock.
- **Features**:
  - Semantic search ("Find me a simple gold necklace for everyday wear")
  - Image search (upload a photo, find similar items in stock)
  - Tag suggestions when adding new items
  - Natural language filtering

**Implementation Path**:
- Use vector embeddings (e.g., OpenAI Embeddings, Cohere)
- Store embeddings in PostgreSQL (using `pgvector` extension)
- Create new endpoints: `POST /api/v1/stock/search`, `POST /api/v1/stock/image-search`

---

### 🔮 **6. Karigar Workflow Optimization**
**Use Case**: Improve production efficiency and reduce disputes.
- **Features**:
  - Predict how long a karigar will take to complete an order
  - Suggest optimal workload distribution among karigars
  - Alert when a karigar's wastage is trending above tolerance
  - Predict likelihood of disputes before production starts

**Implementation Path**:
- Analyze historical production data from `KarigarModule`
- Add prediction endpoints: `POST /api/v1/ai/karigar-predictions`

---

### 💎 **7. Customer Preference Profiling**
**Use Case**: Provide personalized service to customers.
- **Features**:
  - Build customer profiles based on purchase history
  - Recommend items a customer is likely to buy
  - Suggest gifts for special occasions
  - Personalized marketing campaigns

**Implementation Path**:
- Use `CustomerModule` data
- Integrate with `SalesModule` and `StockModule`
- Expose via: `GET /api/v1/ai/customer-preferences/:customerId`

---

### 📊 **8. Anomaly Detection**
**Use Case**: Detect fraud, unusual transactions, or data entry errors.
- **Features**:
  - Flag unusually large discounts
  - Detect suspicious return patterns
  - Alert when data entry seems incorrect (e.g., weight way outside normal range)
  - Identify unusual karigar wastage

**Implementation Path**:
- Use unsupervised ML models on transaction data
- Integrate with `AuditModule`

---

### 💰 **9. Metal Price Trend Prediction**
**Use Case**: Help owners make informed decisions about buying/selling metal.
- **Features**:
  - Predict metal price trends for the next week/month
  - Alert when rates are favorable for buying or selling
  - Suggest optimal times to convert inventory to cash or vice versa

**Implementation Path**:
- Integrate with external market data APIs
- Use time-series forecasting
- Add endpoints to `RatesModule`

---

### 📝 **10. AI-Powered Report Generation**
**Use Case**: Automatically generate insightful reports.
- **Features**:
  - Summarize daily/weekly/monthly sales in natural language
  - Highlight key insights ("This month, 22k gold bangles sold 30% more than last month")
  - Generate reports for karigar productivity, customer trends, etc.

**Implementation Path**:
- Use existing data from all modules
- Integrate LLM for natural language generation
- Add to `DashboardModule`

---

## AI Module Architecture (Proposed)

Here's how you could structure the AI module:

```
src/ai/
├── ai.module.ts
├── ai.controller.ts
├── ai.service.ts
├── prompts/
│   ├── pricing.prompt.ts
│   ├── chat.prompt.ts
│   └── forecasting.prompt.ts
├── services/
│   ├── pricing.service.ts
│   ├── forecasting.service.ts
│   └── chat.service.ts
├── types/
│   └── ai.dto.ts
└── utils/
    ├── embeddings.util.ts
    └── llm.util.ts
```

The existing empty `AgentModule` is a great starting point! You can rename it or build upon it.

---

## Security & Compliance

- JWT authentication with refresh tokens
- RBAC for granular access control
- Phone number hashing for customer privacy
- Audit logging for all user actions
- Password hashing with bcrypt
- Rate limiting to prevent abuse

---

## Development Workflow

1. **Migration**: `npm run db:migrate`
2. **Seed**: `npm run db:seed`
3. **Start Dev Server**: `npm run start:dev`
4. **Run Tests**: `npm run test:integration`
5. **Database Studio**: `npm run db:studio`
6. **Build**: `npm run build`

---

## Environment Variables

Key env vars (see `.env.example`):
- `DATABASE_URL`: PostgreSQL connection
- `JWT_SECRET`: JWT signing key
- `JWT_EXPIRES_IN`: JWT expiration
- `EMAIL_HOST`, `EMAIL_PORT`, etc.: Email configuration

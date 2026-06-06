# JewelryFlow ERP - End-to-End Testing Guide

## Prerequisites
- Backend running on `http://localhost:3000/api/v1`
- Login token from signup (already verified)
- Use **Postman**, **REST Client**, or **cURL** for API testing

---

## 1️⃣ RATES MODULE
**Purpose**: Set daily metal rates (buy/sell) which are used for pricing calculations throughout the system.

### Set Daily Rate
```
POST /api/v1/rates
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "metalType": "GOLD",
  "buyRate": 65000,
  "sellRate": 66000
}
```

**Expected Response**:
```json
{
  "id": "rate_123",
  "metalType": "GOLD",
  "buyRate": 65000,
  "sellRate": 66000,
  "perTola": {
    "buy": 760.23,
    "sell": 772.28
  },
  "perLal": {
    "buy": 6.50,
    "sell": 6.60
  },
  "validFrom": "2026-06-04T00:00:00Z",
  "expiresAt": "2026-06-05T00:00:00Z"
}
```

### Get Today's Rates
```
GET /api/v1/rates/today
Authorization: Bearer {YOUR_TOKEN}
```

**Expected Response**: Array of current rates for all metal types

### Test Rates for All Metal Types
Set rates for: `GOLD`, `SILVER`, `PLATINUM`, `COPPER`

---

## 2️⃣ STOCK/INVENTORY MODULE
**Purpose**: Manage jewelry inventory with pricing variations (jerty/jyala).

### Add Stock Item
```
POST /api/v1/stock
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "sku": "AUR-001",
  "name": "Gold Ring - Classic",
  "description": "22K gold ring",
  "metalType": "GOLD",
  "weight": {
    "gram": 5.5,
    "tola": 0.65,
    "rattiMassi": 0
  },
  "origin": "PURCHASED",
  "quantity": 10,
  "jerty": 500,
  "jyala": {
    "type": "PERCENTAGE",
    "value": 15
  },
  "supplier": "Local Gold Trader"
}
```

**Expected Response**:
```json
{
  "id": "stock_123",
  "sku": "AUR-001",
  "name": "Gold Ring - Classic",
  "quantity": 10,
  "status": "IN_STOCK",
  "pricing": {
    "basePrice": 358750,
    "jertyAddOn": 500,
    "jyalaCharge": 53812.50,
    "totalPrice": 413062.50
  },
  "createdAt": "2026-06-04T10:30:00Z"
}
```

### Get All Stock Items
```
GET /api/v1/stock?status=IN_STOCK&limit=20&offset=0
Authorization: Bearer {YOUR_TOKEN}
```

### Update Stock Item Pricing
```
PATCH /api/v1/stock/{stockId}
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "jerty": 600,
  "jyala": {
    "type": "PERCENTAGE",
    "value": 20
  }
}
```

### Price Preview (Without Buying)
```
POST /api/v1/stock/{stockId}/price-preview
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "customJerty": 550,
  "customJyala": {
    "type": "FLAT",
    "value": 1000
  }
}
```

---

## 3️⃣ PURCHASE MODULE
**Purpose**: Manage suppliers and purchase orders for restocking.

### Create Supplier
```
POST /api/v1/suppliers
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "name": "Prime Gold Suppliers",
  "phone": "+977-1-4123456",
  "email": "supplier@goldprime.com",
  "address": "Kathmandu, Nepal",
  "supplierType": "TRADE",
  "creditLimit": 500000,
  "paymentTerms": "NET_30"
}
```

**Expected Response**:
```json
{
  "id": "supplier_123",
  "name": "Prime Gold Suppliers",
  "supplierType": "TRADE",
  "status": "ACTIVE",
  "creditLimit": 500000,
  "amountDue": 0,
  "lifetimeStats": {
    "totalOrders": 0,
    "totalPurchased": 0,
    "totalReturned": 0
  }
}
```

### Get All Suppliers
```
GET /api/v1/suppliers?status=ACTIVE&limit=20
Authorization: Bearer {YOUR_TOKEN}
```

### Create Purchase Order
```
POST /api/v1/purchase-orders
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "supplierId": "supplier_123",
  "items": [
    {
      "sku": "AUR-001",
      "quantity": 20,
      "unitPrice": 358750,
      "metalType": "GOLD"
    },
    {
      "sku": "CANDI-001",
      "quantity": 15,
      "unitPrice": 1200,
      "metalType": "SILVER"
    }
  ],
  "estimatedDelivery": "2026-06-15",
  "notes": "Regular stock replenishment"
}
```

**Expected Response**:
```json
{
  "id": "po_123",
  "poNumber": "PO-2026-0001",
  "supplierId": "supplier_123",
  "status": "PENDING",
  "items": [
    {
      "sku": "AUR-001",
      "quantity": 20,
      "unitPrice": 358750,
      "subtotal": 7175000
    }
  ],
  "totalAmount": 7175000,
  "createdAt": "2026-06-04T10:45:00Z",
  "estimatedDelivery": "2026-06-15"
}
```

### Receive Purchase Order
```
POST /api/v1/purchase-orders/{poId}/receive
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "receivedItems": [
    {
      "sku": "AUR-001",
      "receivedQuantity": 20,
      "damageQuantity": 0
    }
  ],
  "receivedDate": "2026-06-04",
  "notes": "All items received in good condition"
}
```

---

## 4️⃣ KARIGAR MODULE
**Purpose**: Manage artisans (karigars) and production orders.

### Create Karigar
```
POST /api/v1/karigars
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "name": "Ramesh Kumar",
  "phone": "+977-9841234567",
  "address": "Thamel, Kathmandu",
  "specialization": ["Ring Making", "Pendant Design"],
  "paymentRate": 500,
  "rateUnit": "PIECE",
  "bankDetails": {
    "accountHolder": "Ramesh Kumar",
    "accountNumber": "1234567890",
    "bankName": "Nepal Investment Bank"
  }
}
```

**Expected Response**:
```json
{
  "id": "karigar_123",
  "name": "Ramesh Kumar",
  "phone": "+977-9841234567",
  "specialization": ["Ring Making", "Pendant Design"],
  "paymentRate": 500,
  "status": "ACTIVE",
  "lifetimeStats": {
    "totalOrders": 0,
    "totalCompleted": 0,
    "totalReturned": 0,
    "totalEarned": 0
  }
}
```

### Get All Karigars
```
GET /api/v1/karigars?status=ACTIVE&limit=20
Authorization: Bearer {YOUR_TOKEN}
```

### Create Production Order
```
POST /api/v1/production-orders
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "karigarId": "karigar_123",
  "items": [
    {
      "description": "Gold Ring - Classic Design",
      "metalType": "GOLD",
      "weight": {
        "gram": 5.5,
        "tola": 0.65
      },
      "quantity": 5,
      "design": "Classic band",
      "specialInstructions": "Smooth finish"
    }
  ],
  "estimatedDelivery": "2026-06-20",
  "issuedAt": "2026-06-04",
  "notes": "Urgent order - customer deadline"
}
```

### Issue Material to Karigar
```
POST /api/v1/production-orders/{orderId}/issue
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "stockItemId": "stock_123",
  "quantity": 5,
  "weight": {
    "gram": 27.5,
    "tola": 3.25
  },
  "issuedAt": "2026-06-04"
}
```

### Receive Completed Items from Karigar
```
POST /api/v1/production-orders/{orderId}/receive
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "receivedItems": [
    {
      "description": "Gold Ring - Classic Design",
      "quantity": 5,
      "weight": {
        "gram": 25,
        "tola": 2.95
      },
      "qualityStatus": "APPROVED",
      "notes": "Excellent finish"
    }
  ],
  "receivedAt": "2026-06-20",
  "materialLoss": {
    "gram": 2.5,
    "tola": 0.30
  }
}
```

### Create Karigar Payment
```
POST /api/v1/karigars/{karigarId}/payments
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "orderId": "production_123",
  "paymentAmount": 2500,
  "paymentMethod": "CASH",
  "paymentDate": "2026-06-20",
  "notes": "Payment for completed order"
}
```

---

## 5️⃣ SALES MODULE
**Purpose**: Create various sales transactions (sell, return, buyback, old gold, exchange).

### Create Customer First (if needed)
```
POST /api/v1/customers
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "firstName": "Arun",
  "lastName": "Sharma",
  "phone": "+977-9841000111",
  "email": "arun@email.com"
}
```

### 5.1 SELL Transaction
```
POST /api/v1/sales/sell
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "customerId": "customer_123",
  "items": [
    {
      "stockId": "stock_123",
      "quantity": 1,
      "customJerty": 500,
      "customJyala": {
        "type": "PERCENTAGE",
        "value": 15
      }
    }
  ],
  "billDate": "2026-06-04",
  "paymentMethod": "CASH",
  "paidAmount": 413062.50,
  "notes": "Regular customer - ring purchase"
}
```

**Expected Response**:
```json
{
  "billId": "bill_123",
  "billNumber": "BIL-2026-0001",
  "billDate": "2026-06-04",
  "customerId": "customer_123",
  "items": [
    {
      "stockId": "stock_123",
      "itemName": "Gold Ring - Classic",
      "quantity": 1,
      "unitPrice": 413062.50,
      "subtotal": 413062.50
    }
  ],
  "subtotal": 413062.50,
  "totalAmount": 413062.50,
  "amountPaid": 413062.50,
  "balanceDue": 0,
  "ownerBill": {...},
  "customerBill": {...}
}
```

### 5.2 RETURN Transaction
```
POST /api/v1/sales/return
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "originalBillId": "bill_123",
  "items": [
    {
      "stockId": "stock_123",
      "quantityReturned": 1,
      "returnReason": "DEFECT",
      "notes": "Stone was loose"
    }
  ],
  "returnDate": "2026-06-05",
  "refundMethod": "CASH",
  "refundAmount": 413062.50
}
```

### 5.3 BUYBACK Transaction
```
POST /api/v1/sales/buyback
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "customerId": "customer_123",
  "items": [
    {
      "metalType": "GOLD",
      "weight": {
        "gram": 5.0,
        "tola": 0.59
      },
      "purity": "22K",
      "quantity": 1,
      "itemDescription": "Old gold bracelet"
    }
  ],
  "buybackDate": "2026-06-05",
  "paymentMethod": "CASH",
  "buybackRate": 64000,
  "notes": "Customer buyback - old gold"
}
```

### 5.4 OLD GOLD Transaction
```
POST /api/v1/sales/old-gold
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "customerId": "customer_123",
  "items": [
    {
      "description": "Old gold ornaments",
      "weight": {
        "gram": 10.0,
        "tola": 1.18
      },
      "purity": "18K",
      "quantity": 3
    }
  ],
  "oldGoldDate": "2026-06-05",
  "paymentMethod": "CASH",
  "appliedRate": 60000,
  "notes": "Customer exchanging old gold"
}
```

### 5.5 EXCHANGE Transaction
```
POST /api/v1/sales/exchange
Authorization: Bearer {YOUR_TOKEN}
Content-Type: application/json

{
  "customerId": "customer_123",
  "itemsReturned": [
    {
      "stockId": "stock_123",
      "quantity": 1,
      "returnedMetalWeight": {
        "gram": 5.0,
        "tola": 0.59
      }
    }
  ],
  "itemsReceived": [
    {
      "stockId": "stock_456",
      "quantity": 1,
      "customJerty": 600
    }
  ],
  "exchangeDate": "2026-06-05",
  "balancePaymentMethod": "CASH",
  "balanceAmount": 50000,
  "notes": "Customer exchange - size issue"
}
```

### Get Transaction History
```
GET /api/v1/sales?customerId=customer_123&limit=50
Authorization: Bearer {YOUR_TOKEN}
```

---

## Testing Sequence Checklist

- [ ] **RATES**: Set daily rates for GOLD, SILVER, PLATINUM
- [ ] **STOCK**: Add 3-5 different stock items with various pricing
- [ ] **PURCHASE**: 
  - [ ] Create a supplier
  - [ ] Create and send purchase order
  - [ ] Receive purchase order
- [ ] **KARIGAR**:
  - [ ] Create a karigar
  - [ ] Create production order
  - [ ] Issue material
  - [ ] Receive completed items
  - [ ] Process payment
- [ ] **SALES**:
  - [ ] Create a customer
  - [ ] Perform SELL transaction
  - [ ] Perform RETURN transaction
  - [ ] Perform BUYBACK transaction
  - [ ] Perform EXCHANGE transaction

---

## Common Issues & Solutions

### 401 Unauthorized
- Check token is still valid
- Re-login if token expired
- Ensure Bearer prefix in Authorization header

### 403 Forbidden
- Check your user role has required permissions
- OWNER role has full access
- MANAGER has most operations except deactivations
- STAFF has limited read + basic operations

### 400 Validation Error
- Check all required fields are provided
- Verify data types match schema
- Check weight calculations for metalType

### 422 Business Logic Error
- Rates must exist before creating stock
- Stock must exist before creating sales
- Insufficient stock for sales transactions
- Karigar must exist before production orders

---

## Notes
- All timestamps are in ISO 8601 format
- All monetary amounts are in NPR (Nepali Rupees)
- Weight can be specified in grams, tola, or rattiMassi
- Use actual token from your signup response

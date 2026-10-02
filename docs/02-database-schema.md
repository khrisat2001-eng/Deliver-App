# 02 — تصميم قاعدة البيانات (Database Schema)

المصدر الرسمي للـ Schema هو الملف: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).
هذا المستند يشرح التقسيم والعلاقات والقرارات.

## 1. المجموعات الرئيسية

| المجموعة | الجداول |
|---|---|
| الهوية والحسابات | `users`, `customers`, `drivers`, `admin_users`, `roles`, `permissions`, `role_permissions`, `devices`, `refresh_tokens`, `otp_codes`, `emergency_contacts`, `saved_places` |
| السائق والسيارة | `vehicles`, `vehicle_types`, `driver_documents`, `document_types`, `driver_status_history` |
| الجغرافيا | `countries`, `cities`, `zones` (PostGIS polygon) |
| التسعير | `pricing_rules`, `surge_rules`, `surge_snapshots`, `commission_rules`, `cancellation_policies`, `cancellation_reasons` |
| الرحلة | `trips`, `trip_status_events`, `trip_offers` (عروض للسائقين)، `trip_location_points`, `trip_fare_breakdowns`, `chat_messages` |
| المال | `payments`, `payment_methods` (tokens فقط)، `wallets`, `wallet_transactions` (دفتر قيود)، `driver_payouts`, `promotions`, `promotion_redemptions`, `referrals` |
| الجودة | `ratings`, `support_tickets`, `ticket_messages`, `sos_incidents` |
| النظام | `notifications`, `audit_logs`, `settings`, `translations` (اختياري)، `services` |

## 2. العلاقات الأساسية

```
users 1─1 customers
users 1─1 drivers 1─* vehicles *─1 vehicle_types
drivers 1─* driver_documents *─1 document_types
countries 1─* cities 1─* zones
trips *─1 customers, *─1 drivers, *─1 vehicles, *─1 vehicle_types, *─1 cities
trips 1─* trip_status_events, trip_offers, trip_location_points
trips 1─1 trip_fare_breakdowns, 1─* payments, 1─* ratings
users 1─* wallets (واحدة لكل عملة) 1─* wallet_transactions
```

## 3. قرارات مهمة

1. **جدول `users` واحد** لكل من يسجّل بالهاتف (عميل/سائق). نفس الرقم يمكن أن يكون عميلًا وسائقًا معًا بملفين منفصلين. موظفو الإدارة في `admin_users` منفصلين تمامًا (تسجيل دخول وصلاحيات مختلفة).
2. **المال integer دائمًا** (`amountMinor`) مع `currency`. لا يُستخدم `float` للمال.
3. **المحفظة = دفتر قيود (Ledger)**: الرصيد = مجموع `wallet_transactions`. حقل `balanceMinor` في `wallets` هو cache يُحدّث داخل نفس الـ transaction مع قفل الصف. لا حذف ولا تعديل للقيود، التصحيح يكون بقيد عكسي.
4. **حالة الرحلة** في `trips.status` + سجل كامل في `trip_status_events` (من غيّرها، متى، أين).
5. **لقطة التسعير**: عند إنشاء الرحلة تُحفظ قواعد التسعير المستخدمة والـ surge في `trip_fare_breakdowns` حتى لا يتغير سعر رحلة قديمة إذا عدّلت الإدارة الأسعار.
6. **Soft delete** للعملاء والسائقين (`deletedAt`) مع إخفاء البيانات الشخصية عند طلب الحذف، والإبقاء على السجلات المالية.
7. **الحقول المشفّرة**: `nationalIdEnc`, `licenseNumberEnc` كـ bytes مشفّرة + `nationalIdHash` للبحث عن التكرار.
8. **الجغرافيا**: `zones.polygon` و `trips.pickupPoint` بنوع PostGIS (`Unsupported("geometry")` في Prisma مع migrations SQL يدوية للفهارس GIST).
9. **الفهارس**: `trips(status, cityId)`, `trips(customerId, createdAt)`, `trips(driverId, createdAt)`, `driver_documents(expiresAt)`, `wallet_transactions(walletId, createdAt)`, GIST على المضلعات والنقاط.
10. **التقسيم (Partitioning)** لاحقًا: `trip_location_points` و `audit_logs` و `notifications` بالشهر.

## 4. حالات (Enums) أساسية

- `DriverApprovalStatus`: `PENDING`, `UNDER_REVIEW`, `CHANGES_REQUESTED`, `APPROVED`, `REJECTED`, `SUSPENDED`, `BLOCKED`, `DOCUMENTS_EXPIRED`
- `DriverAvailability`: `OFFLINE`, `ONLINE`, `BUSY`, `ON_TRIP`
- `TripStatus`: `REQUESTED`, `SEARCHING`, `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED_BY_CUSTOMER`, `CANCELLED_BY_DRIVER`, `CANCELLED_BY_ADMIN`, `NO_DRIVER_FOUND`
- `DocumentStatus`: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`
- `PaymentMethodType`: `CASH`, `CARD`, `APPLE_PAY`, `GOOGLE_PAY`, `WALLET`, `ZAINCASH`, `FIB`, `FASTPAY`, `QI_CARD`, `ASIA_HAWALA`
- `WalletTxType`: `TOP_UP`, `TRIP_PAYMENT`, `TRIP_EARNING`, `COMMISSION`, `CASH_COMMISSION_DEBT`, `REFUND`, `PROMO_CREDIT`, `REFERRAL_BONUS`, `DRIVER_BONUS`, `WITHDRAWAL`, `CANCELLATION_FEE`, `ADJUSTMENT`

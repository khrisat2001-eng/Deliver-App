# Ride Booking & Taxi Application

منصة نقل وطلب سيارات أجرة (مثل Uber و Careem من حيث الوظائف) موجهة للعراق وإقليم كوردستان، وقابلة للتوسع لدول ومدن أخرى.

**الأنظمة**: تطبيق العميل (Flutter) · تطبيق السائق (Flutter) · لوحة الإدارة (Next.js) · API (NestJS + PostgreSQL/PostGIS + Redis).

## وثائق التصميم (المرحلة 0)

| # | المستند | المحتوى |
|---|---|---|
| 01 | [معمارية النظام](docs/01-architecture.md) | التقنيات، الوحدات، الفصل بين المكونات، Realtime، الأمان، التوسع |
| 02 | [قاعدة البيانات](docs/02-database-schema.md) | الجداول والعلاقات والقرارات — الـ Schema الكامل في [`schema.prisma`](apps/api/prisma/schema.prisma) |
| 03 | [رحلة المستخدم](docs/03-user-flows.md) | العميل، السائق، الإدارة، حالات الرحلة |
| 04 | [قائمة الشاشات](docs/04-screens.md) | 34 شاشة للعميل، 30 للسائق، 32 صفحة للإدارة |
| 05 | [صلاحيات الإدارة](docs/05-admin-permissions.md) | الصلاحيات ومصفوفة الأدوار الخمسة |
| 06 | [منطق التسعير](docs/06-pricing-logic.md) | المعادلة، الذروة، العمولة، الإلغاء، الكوبونات |
| 07 | [توزيع الرحلات](docs/07-trip-matching.md) | الأهلية، النقاط، الجولات، التزامن |
| 08 | [مراحل التنفيذ](docs/08-roadmap-phases.md) | 10 مراحل حتى الإطلاق والتوسع |
| 09 | [التشغيل والدفع المحلي](docs/09-iraq-local-operations-payments.md) | ZainCash، FIB، FastPay، Qi Card، النقد وديون العمولة، OTP، الخرائط، المواسم، القانون |

## هيكل المستودع

```
apps/
  api/prisma/schema.prisma   قاعدة البيانات الكاملة
  api/.env.example
packages/
  core/                      منطق الأعمال (تسعير، ذروة، عمولة، توزيع، حالات الرحلة، إلغاء، كوبونات) + اختبارات
  i18n/                      ملفات الترجمة الموحدة ar / en / ckb
docs/                        وثائق التصميم
docker-compose.yml           PostgreSQL+PostGIS, Redis, MinIO للتطوير
```

## التشغيل

```bash
# منطق الأعمال
cd packages/core && npm install && npm test && npm run typecheck

# فحص الترجمات
node packages/i18n/check.mjs

# قاعدة البيانات
docker compose up -d
cd apps/api && npx prisma validate
```

## الحالة

- [x] المرحلة 0: التصميم الكامل + منطق التسعير والتوزيع مختبر (42 اختبارًا)
- [ ] المرحلة 1: البنية الأساسية (NestJS، المصادقة، الأدوار) — التالي

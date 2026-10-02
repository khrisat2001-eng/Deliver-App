# 05 — صلاحيات الإدارة (Admin Roles & Permissions)

## 1. المبدأ

- كل عملية في الـ API محمية بصلاحية بصيغة `resource.action`.
- الدور (Role) = مجموعة صلاحيات. الأدوار الخمسة الأساسية تُنشأ تلقائيًا (`isSystem = true`) ويمكن إنشاء أدوار مخصصة.
- كل موظف يمكن تقييده بمدن محددة (`cityScope`)؛ مثلًا مدير عمليات أربيل لا يرى رحلات بغداد.
- العمليات الحساسة تتطلب 2FA وتُسجّل في Audit Log مع القيم قبل/بعد.
- العمليات المالية اليدوية الكبيرة تحتاج موافقة شخص ثانٍ (Maker–Checker): `wallets.adjust` ينشئ طلبًا، و`wallets.adjust.approve` يعتمده.

## 2. قائمة الصلاحيات

| المجموعة | الصلاحيات |
|---|---|
| dashboard | `dashboard.view`, `livemap.view` |
| drivers | `drivers.view`, `drivers.view_pii`, `drivers.approve`, `drivers.reject`, `drivers.request_changes`, `drivers.suspend`, `drivers.block`, `drivers.activate`, `drivers.edit`, `drivers.export` |
| documents | `documents.view`, `documents.review` |
| customers | `customers.view`, `customers.view_pii`, `customers.edit`, `customers.suspend`, `customers.block`, `customers.export` |
| trips | `trips.view`, `trips.cancel`, `trips.reassign`, `trips.adjust_fare`, `trips.export` |
| geo | `cities.manage`, `zones.manage`, `vehicle_types.manage` |
| pricing | `pricing.view`, `pricing.update`, `surge.update`, `surge.override`, `cancellation_policy.update` |
| finance | `payments.view`, `payments.refund`, `wallets.view`, `wallets.adjust`, `wallets.adjust.approve`, `payouts.view`, `payouts.approve`, `commission.update`, `cash_debt.manage` |
| promotions | `promotions.view`, `promotions.manage`, `referrals.manage`, `incentives.manage` |
| support | `tickets.view`, `tickets.reply`, `tickets.assign`, `tickets.close`, `sos.view`, `sos.handle` |
| notifications | `notifications.broadcast` |
| reports | `reports.operations`, `reports.finance`, `reports.export` |
| admin | `admins.manage`, `roles.manage`, `audit.view`, `settings.manage` |

## 3. مصفوفة الأدوار الافتراضية

| الصلاحية | Super Admin | Operations Manager | Driver Manager | Finance Manager | Customer Support |
|---|:-:|:-:|:-:|:-:|:-:|
| لوحة اليوم + الخريطة الحية | ✅ | ✅ | ✅ | ✅ | ✅ |
| عرض السائقين | ✅ | ✅ | ✅ | ✅ | ✅ |
| بيانات السائق الشخصية والمستندات | ✅ | ✅ | ✅ | — | — |
| قبول/رفض/طلب تعديل السائقين | ✅ | — | ✅ | — | — |
| إيقاف/حظر/تفعيل السائقين | ✅ | ✅ | ✅ | — | — |
| عرض وتعديل العملاء | ✅ | ✅ | — | — | عرض فقط |
| إيقاف/حظر العملاء | ✅ | ✅ | — | — | — |
| الرحلات: عرض | ✅ | ✅ | ✅ | ✅ | ✅ |
| الرحلات: إلغاء/إعادة إسناد | ✅ | ✅ | — | — | — |
| الرحلات: تعديل السعر | ✅ | — | — | ✅ | — |
| المدن والمناطق وأنواع السيارات | ✅ | ✅ | — | — | — |
| التسعير والذروة | ✅ | ✅ (Override الذروة فقط) | — | ✅ | — |
| العمولات | ✅ | — | — | ✅ | — |
| المدفوعات والاسترجاع | ✅ | — | — | ✅ | — |
| تعديل المحافظ (إنشاء طلب) | ✅ | — | — | ✅ | — |
| اعتماد تعديل المحافظ | ✅ | — | — | — (شخص آخر) | — |
| السحوبات وديون النقد | ✅ | — | — | ✅ | — |
| العروض والإحالة والحوافز | ✅ | ✅ | — | ✅ | — |
| التذاكر | ✅ | ✅ | ✅ (شكاوى السائقين) | ✅ (مشاكل الدفع) | ✅ |
| حوادث SOS | ✅ | ✅ | — | — | ✅ |
| الإشعارات الجماعية | ✅ | ✅ | — | — | — |
| التقارير التشغيلية | ✅ | ✅ | ✅ | ✅ | — |
| التقارير المالية | ✅ | — | — | ✅ | — |
| الموظفون والأدوار والإعدادات و Audit | ✅ | — | — | — | — |

## 4. التنفيذ في الـ Backend

```ts
@RequirePermissions('drivers.approve')
@Post('drivers/:id/approve')
approve(@Param('id') id: string, @CurrentAdmin() admin: AdminCtx) { ... }
```
- Guard يقرأ صلاحيات الدور من Redis cache (تُحدَّث عند تعديل الدور).
- فلتر `cityScope` يُطبَّق تلقائيًا على كل استعلام قائمة.
- إخفاء الحقول: بدون `*.view_pii` يُعاد رقم الهاتف مقنّعًا (`+964 75x xxx x123`) ولا تُعاد روابط المستندات.

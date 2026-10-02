# 01 — معمارية النظام (System Architecture)

## 1. الاختيارات التقنية

| الطبقة | التقنية | السبب |
|---|---|---|
| تطبيق العميل + تطبيق السائق | **Flutter** (كود واحد لـ Android و iOS) | دعم RTL جيد، أداء قريب من Native، يعمل على أجهزة Huawei بدون Google Services عبر HMS |
| لوحة التحكم | **Next.js (React) + TypeScript** | Web متجاوب للـ Desktop والـ Tablet |
| الـ Backend | **NestJS (Node.js + TypeScript)** | Modules منفصلة، DI، سهولة الاختبار، نفس اللغة مع لوحة التحكم |
| قاعدة البيانات | **PostgreSQL 16 + PostGIS** | بيانات علائقية + استعلامات جغرافية (Zones، أقرب سائق) |
| ORM | **Prisma** | Schema واضح و Migrations |
| الكاش والموقع اللحظي | **Redis** (GEO + Pub/Sub + Streams) | تخزين مواقع السائقين المتصلين والبحث الجغرافي بسرعة |
| الطوابير والمهام | **BullMQ** فوق Redis | مهلة قبول الرحلة، الإشعارات، التقارير، انتهاء المستندات |
| الاتصال اللحظي | **WebSocket (Socket.IO)** مع Redis Adapter | تتبع مباشر، عروض الرحلات للسائق، الدردشة |
| التخزين | **S3-compatible** (AWS S3 / MinIO / Cloudflare R2) | صور ومستندات السائقين بروابط موقّعة مؤقتة |
| الإشعارات | FCM + HMS Push + APNs، SMS، Email | انظر `09-iraq-local-operations-payments.md` |
| التحليلات | Read Replica ثم ClickHouse لاحقًا | فصل التقارير الثقيلة عن قاعدة التشغيل |
| المراقبة | OpenTelemetry + Prometheus + Grafana + Sentry | |
| النشر | Docker + Kubernetes (أو Docker Compose في البداية) | |

## 2. الشكل العام

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
 │ Passenger App│   │  Driver App  │   │ Admin Dashboard  │
 │  (Flutter)   │   │  (Flutter)   │   │    (Next.js)     │
 └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘
        │ HTTPS/REST + WSS │                    │ HTTPS + WSS
        └──────────┬───────┴────────────────────┘
                   ▼
        ┌──────────────────────┐
        │ API Gateway / NGINX  │  Rate limit, TLS, WAF
        └──────────┬───────────┘
                   ▼
 ┌─────────────────────────────────────────────────────────┐
 │                Backend (NestJS) – Modular Monolith       │
 │                                                          │
 │  auth   users   drivers   vehicles   documents           │
 │  geo(maps adapter)   pricing   surge   matching          │
 │  trips(state machine)   tracking(ws)   chat              │
 │  payments(gateway adapters)   wallet(ledger)   commission│
 │  promotions   referrals   ratings   cancellations        │
 │  notifications(push/sms/email adapters)   support        │
 │  safety(SOS)   reports   admin/rbac   audit   settings   │
 │  services-catalog (ride, later: delivery, parcel…)       │
 └───────┬───────────────┬───────────────┬─────────────────┘
         ▼               ▼               ▼
   PostgreSQL+PostGIS   Redis         Object Storage
   (primary+replica)  (GEO, PubSub,   (documents, photos)
                       BullMQ)
         │
         ▼
   Analytics store (replica → ClickHouse)
```

### لماذا Modular Monolith وليس Microservices من البداية؟

- فريق صغير وسرعة إطلاق أعلى.
- كل Module له حدود واضحة (لا يقرأ جداول Module آخر مباشرة، بل عبر Service أو Event).
- عند النمو نفصل أولًا: `tracking` (حمل GPS عالي) ثم `matching` ثم `notifications` كخدمات مستقلة بدون إعادة كتابة.

## 3. فصل المسؤوليات (كما طُلب)

| المكوّن | أين يعيش | قابل للتبديل عبر |
|---|---|---|
| Frontend | `apps/passenger`, `apps/driver`, `apps/admin` | — |
| Backend | `apps/api` | — |
| Database | PostgreSQL | Prisma schema |
| Authentication | `auth` module | `OtpProvider`, `JwtService` |
| Maps | `geo` module | واجهة `MapProvider` (Google / Mapbox / OSRM+Nominatim) |
| Notifications | `notifications` module | `PushProvider`, `SmsProvider`, `EmailProvider` |
| Payment | `payments` module | واجهة `PaymentGateway` لكل بوابة ولكل دولة |
| Analytics | `reports` module + مخزن منفصل | — |

### واجهة مزوّد الخرائط (مثال)

```ts
interface MapProvider {
  geocode(query: string, opts: { lang: Locale; near?: LatLng; countryCode?: string }): Promise<Place[]>;
  reverseGeocode(point: LatLng, lang: Locale): Promise<Place | null>;
  route(from: LatLng, to: LatLng, opts?: { waypoints?: LatLng[]; departAt?: Date }): Promise<Route>;
  eta(origins: LatLng[], destination: LatLng): Promise<number[]>; // seconds, distance matrix
}
```
مزوّد الخرائط يُختار من الإعدادات لكل دولة/مدينة. التطبيقات تستخدم SDK العرض فقط (Google Maps SDK أو Mapbox SDK)، أما الحسابات (السعر، المسافة، ETA) فتتم دائمًا في الـ Backend.

## 4. التدفق اللحظي (Realtime)

- السائق المتصل يرسل موقعه كل **4 ثوانٍ** أثناء الرحلة، وكل **10 ثوانٍ** وهو متاح (قابل للتعديل من الإعدادات).
- الموقع يُكتب إلى Redis GEO (`drivers:online:{cityId}:{vehicleTypeId}`) ولا يُكتب كل نقطة إلى PostgreSQL.
- نقاط الرحلة الفعلية تُجمع وتُكتب دفعات (batch) إلى جدول `trip_location_points` لحساب المسافة الفعلية والنزاعات.
- غرف WebSocket: `trip:{id}` (العميل + السائق + المراقبون من الإدارة)، `driver:{id}` (عروض الرحلات)، `admin:city:{id}` (الخريطة الحية).

## 5. الأمان

- JWT قصير العمر (15 دقيقة) + Refresh Token دوّار مخزّن كـ hash ومربوط بالجهاز.
- RBAC بصلاحيات دقيقة (انظر `05-admin-permissions.md`).
- تشفير الحقول الحساسة (رقم الهوية، رقم الرخصة) على مستوى التطبيق (AES-256-GCM، المفاتيح في KMS / Vault).
- لا تُخزّن بيانات البطاقات أبدًا: نستخدم Tokenization من بوابة الدفع (PCI-DSS SAQ-A).
- المستندات في Bucket خاص، تُعرض فقط بروابط موقّعة مدتها دقائق.
- Audit Log لكل عملية إدارية ولكل تغيير مالي.
- Rate limiting على OTP وتسجيل الدخول + حماية من SIM-swap بإعادة التحقق عند تغيير الجهاز.
- إخفاء أرقام الهواتف (Number Masking) عبر مزوّد اتصالات يدعم ذلك أو الاتصال عبر التطبيق (VoIP) كبديل.

## 6. الجاهزية للتوسع (خدمات مستقبلية)

كل طلب في النظام هو `Order` من نوع `ServiceType` (حاليًا `RIDE` فقط). جدول `services` و `vehicle_types.serviceType` يسمحان لاحقًا بإضافة:
`FOOD_DELIVERY`, `PARCEL`, `CORPORATE`, `SCHOOL`, `AIRPORT_TRANSFER`, `BIKE`, `RENTAL`
بدون تغيير جداول الدفع والمحفظة والتقييم والإشعارات لأنها مرتبطة بـ `trip`/`order` بشكل عام. حسابات الشركات (Corporate Accounts) والاشتراكات لها مكان محجوز في التصميم (`organizations`) ولا تُفعّل الآن.

## 7. تعدد الدول والمدن

- `countries` (العملة، رمز الهاتف، المنطقة الزمنية، بوابات الدفع المفعّلة، مزوّد SMS، مزوّد الخرائط).
- `cities` تتبع دولة، و `zones` (Polygon) تتبع مدينة.
- كل الأسعار تُخزّن بأصغر وحدة للعملة كـ integer (للدينار العراقي: دينار كامل بدون كسور).
- كل التواريخ تُخزّن UTC وتُعرض حسب المنطقة الزمنية للمدينة.

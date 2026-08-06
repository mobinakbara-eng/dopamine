# Dopamine Berlin Job Outreach Workflow

این دایرکتوری شامل یک **blueprint** برای n8n است که یک اتوماسیون کامل جهت پیدا کردن فرصت‌های شغلی مرتبط با خدمات شرکت Dopamine Marketic در برلین، شخصی‌سازی ایمیل و ارسال خودکار آن را فراهم می‌کند.

## اجزای اصلی اتوماسیون

- **Daily Trigger**: اجرای روزانه جریان در ساعت محلی برلین.
- **Search Berlin Jobs (RapidAPI JSearch)**: جستجو در بین آگهی‌های شغلی تازه با استفاده از سرویس `jsearch` در RapidAPI. کوئری بر اساس کلیدواژه‌های خدمات دوپامین ساخته می‌شود.
- **Filter & Enrich**: محدود کردن نتایج به برلین، استخراج حوزه‌های مرتبط با سرویس‌های ما، محاسبه دامنه شرکت و جلوگیری از پردازش آگهی‌های تکراری با ذخیره شناسه‌ها در Static Data.
- **Hunter Domain Search**: پیدا کردن ایمیل‌های تصمیم‌گیرندگان با `Hunter.io` و انتخاب بهترین گزینه (اولویت با ایمیل شخصی و اعتماد بالاتر).
- **Personalize Email**: ساخت ایمیل فارسی شخصی‌سازی شده با تاکید روی سرویس‌های مرتبط (Marketing Automation، CRM، Performance Marketing و ...).
- **Send Outreach Email**: ارسال ایمیل با SMTP اختصاصی دوپامین و ثبت تمام ارسال‌ها در Google Sheets جهت پایش عملکرد.

## پیش‌نیازها

1. **حساب RapidAPI** و فعال‌سازی API `JSearch`. کلید را در متغیر محیطی `RAPIDAPI_KEY` قرار دهید.
2. **حساب Hunter.io** برای جستجوی دامنه‌ها و قرار دادن کلید در متغیر محیطی `HUNTER_API_KEY`.
3. **SMTP Server** معتبر (مانند Gmail، Brevo یا Mailgun). در n8n یک Credential با نام `Dopamine SMTP` بسازید.
4. **Google Sheets** برای لاگ ارسال‌ها. Credential با نام `Dopamine Google` ساخته و شناسه شیت را در متغیر `GOOGLE_SHEET_ID` قرار دهید.
5. مقداردهی به متغیرهای محیطی زیر در n8n (Settings → Environment Variables):
   - `SENDER_EMAIL` (مثلاً `outreach@dopamine.de`)
   - `SENDER_NAME` (مثلاً `میلاد از Dopamine Marketic`)
   - `GREETING` (برای شخصی‌سازی سلام؛ مثل `سلام`)

> **نکته:** برای امن ماندن کلیدها می‌توانید به‌جای متغیر محیطی از Credentials اختصاصی در n8n استفاده کنید و مقادیر هدرها/پارامترها را از طریق Expression به Credential ارجاع دهید.

## نحوه استفاده

1. فایل [`n8n_dopamine_jobs_workflow.json`](./n8n_dopamine_jobs_workflow.json) را در n8n از مسیر **Import from File** بارگذاری کنید.
2. پس از ایمپورت، بررسی کنید که شناسه Credential ها (`Dopamine SMTP` و `Dopamine Google`) با نام Credential های شما مطابقت داشته باشد؛ در غیر این صورت از منوی هر نود Credential مناسب را انتخاب کنید.
3. در نود `Search Berlin Jobs` مطمئن شوید که مقدار هدر `X-RapidAPI-Key` به Expression `{{$env.RAPIDAPI_KEY}}` یا Credential دلخواه شما اشاره می‌کند.
4. در نود `Hunter Domain Search` مقدار پارامتر `api_key` را با Expression مناسب (Environment Variable یا Credential) جایگزین کنید.
5. نود `Personalize Email` شامل الگوی ایمیل فارسی است. قبل از فعال‌سازی workflow، متن را با سبک نوشتاری برند دوپامین تطبیق دهید. می‌توانید المان‌های بیشتری مانند لینک نمونه‌کار، شماره تماس یا CTA متفاوت اضافه کنید.
6. اگر می‌خواهید آگهی‌هایی که Hunter ایمیل پیدا نمی‌کند در یک لیست دستی ذخیره شوند، یک خروجی دوم از نود `Require Domain` به Google Sheets یا Notion اضافه کنید.

## توسعه‌های پیشنهادی

- افزودن نود `OpenAI` یا `LangChain` برای خلاصه‌سازی آگهی و پیشنهاد Value Proposition.
- اتصال به `Slack` یا `Telegram` جهت اطلاع‌رسانی ارسال‌های جدید به تیم فروش.
- به‌کارگیری `HTTP Request` ثانویه برای سایر وبسایت‌های معتبر برلین (مانند Berlin Startup Jobs یا StepStone) و مرج کردن نتایج قبل از مرحله شخصی‌سازی.
- ساخت داشبورد RealMetrics با داده‌های خروجی این ورکفلو در Google Data Studio.

## تست

پس از پیکربندی Credential ها و متغیرها، Workflow را در حالت `Manual Execute` اجرا کنید. در صورت موفقیت باید در console n8n موارد زیر را ببینید:

- خروجی `Search Berlin Jobs` حاوی آرایه‌ای از آگهی‌ها (حداکثر 10 مورد).
- نود `Filter New Jobs` فقط آگهی‌های جدید نسبت به اجراهای قبلی را عبور می‌دهد.
- نود `Send Outreach Email` پیام موفقیت ارسال SMTP را گزارش می‌کند.
- ردیف جدیدی در Google Sheet ثبت می‌شود.

در صورت بروز خطا:

- **403 یا 401** در `Search Berlin Jobs`: کلید RapidAPI یا quota را بررسی کنید.
- **429**: نرخ درخواست بالا است؛ از n8n `SplitInBatches` یا تنظیم `Sleep` استفاده کنید.
- **Hunter بدون ایمیل**: نود `Filter Missing Email` باعث حذف آیتم می‌شود؛ می‌توانید خروجی فرعی برای پیگیری دستی بسازید.

با این Blueprint می‌توانید Outreach خودکار و شخصی‌سازی‌شده‌ای برای بازار برلین راه‌اندازی کنید و هم‌زمان کیفیت داده‌ها را پایش نمایید.

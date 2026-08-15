# مُخطِّط · استوديو 360

أداة تصميم معماري وديكور: مخطط 2D، تحويل لعرض ثلاثي الأبعاد، جولة 360 درجة، وتتبع مراحل المشروع من الدراسة للتسليم.

مبني بـ **Next.js 14** + **Tailwind CSS** + **Three.js**.

---

## 1. التشغيل محلياً على جهازك

يلزمك [Node.js](https://nodejs.org) نسخة 18 أو أحدث مثبّتة على جهازك.

المشروع فيه ملف `.env.local` معبّى مسبقاً برابط ومفتاح قاعدة بياناتك على Supabase — ما بتحتاج تعدل عليه شي إذا كنت رح تشتغل على نفس قاعدة البيانات.

```bash
# داخل مجلد المشروع
npm install
npm run dev
```

بعدها افتح المتصفح على: `http://localhost:3000`

---

## 2. قاعدة البيانات (Supabase)

التطبيق مربوط فعلياً بقاعدة بيانات Postgres على Supabase (مشروع منفصل تماماً، معزول عن أي بيانات أخرى). الجداول: `projects`, `phases`, `subtasks`, `rooms`.

إذا لسا ما شغّلتي ملف الجداول: افتحي مشروعك على supabase.com → **SQL Editor** → الصقي محتوى `supabase-schema.sql` واضغطي **RUN**.

التطبيق فيه تسجيل دخول بالإيميل وكلمة السر (Supabase Auth). كل مستخدم يشوف مشاريعه فقط — الجداول مؤمّنة بـ Row Level Security مربوطة بـ `user_id`.

---

## 3. رفع المشروع على GitHub

```bash
# داخل مجلد المشروع
git init
git add .
git commit -m "أول نسخة من استوديو 360"
```

بعدها بموقع GitHub:
1. أنشئ Repository جديد (فاضي، بدون README) بالاسم يلي بتحبه، مثلاً `architect-studio-360`
2. انسخ الأوامر يلي بيعطيكها GitHub تحت عنوان "…or push an existing repository from the command line"، شكلها بيكون قريب من:

```bash
git remote add origin https://github.com/USERNAME/architect-studio-360.git
git branch -M main
git push -u origin main
```

ملاحظة: ملف `.env.local` **ما بينرفع** على GitHub (موجود بـ `.gitignore` عمداً لأنه فيه مفتاح قاعدة البيانات). هيك أسلم.

---

## 4. النشر على Vercel

1. سجّل دخول على [vercel.com](https://vercel.com) (تقدر تدخل مباشرة بحساب GitHub)
2. اضغط **Add New → Project**
3. اختر الـ Repository يلي رفعته لتوّك (`architect-studio-360`)
4. **قبل ما تضغط Deploy**، وسّعي قسم **Environment Variables** وضيفي المتغيرين التاليين (انسخيهم من ملف `.env.local` عندك):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. اضغطي **Deploy**
6. بعد دقيقة أو دقيقتين رح ياخدك رابط جاهز شكله قريب من:
   `https://architect-studio-360.vercel.app`

أي تعديل جديد ترفعه على GitHub (`git push`) رح ينشره Vercel تلقائياً من جديد.

---

## 5. الخطوة الجاية

شايفة قائمة المهام القادمة بملف [`TODO.md`](./TODO.md).

---

## بنية المشروع

```
architect-studio/
├── app/
│   ├── layout.js       # الهيكل العام + الخطوط + اتجاه RTL
│   ├── page.js          # الصفحة الرئيسية
│   └── globals.css      # Tailwind + الخطوط العربية
├── components/
│   ├── ArchitectStudio.jsx   # كل منطق التطبيق (المخطط، الطوابق، المراحل)
│   └── Auth.jsx              # شاشة تسجيل الدخول / حساب جديد
├── lib/
│   ├── supabaseClient.js     # اتصال Supabase
│   └── build3d.js            # منطق بناء مشهد الـ 3D (جدران، سقوف، فتحات)
├── supabase-schema.sql       # كل الجداول جاهزة للصق في SQL Editor
├── TODO.md                   # قائمة المهام القادمة
├── .env.local                # مفاتيح قاعدة البيانات (لا يُرفع على GitHub)
├── .env.local.example        # نموذج فاضي للمفاتيح
├── package.json
├── tailwind.config.js
├── postcss.config.js
└── next.config.js
```

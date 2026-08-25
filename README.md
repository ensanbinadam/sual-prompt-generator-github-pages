# سُؤال برومبت

مولّد عربي مجاني يعمل داخل المتصفح لإعداد برومبتات الاختبارات، واستيراد نتيجة ChatGPT، ومراجعة الأسئلة، ثم تصديرها إلى Word وPDF. لا يحتاج إلى مفتاح API، وتبقى الملفات على جهاز المستخدم.

## النشر المجاني على GitHub Pages

1. ارفع جميع ملفات المشروع إلى الفرع `main` في مستودع GitHub.
2. افتح **Settings → Pages** في المستودع.
3. عند **Build and deployment → Source** اختر **GitHub Actions**.
4. افتح تبويب **Actions** وانتظر اكتمال مهمة **نشر الموقع على GitHub Pages**.
5. سيظهر الرابط العام في صفحة المهمة وفي **Settings → Pages**.

لا تختَر **Deploy from a branch**؛ ملف سير العمل المرفق يبني التطبيق وينشره تلقائيًا.

## التشغيل محليًا

```bash
npm install
npm run dev:pages
```

## بناء نسخة GitHub Pages

```bash
npm ci
npm run build:pages
```

تظهر الملفات الجاهزة للنشر في `dist-pages`.

import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL || 'http://localhost:3000'),
  title: 'سُؤال برومبت | جهّز اختبارك عبر ChatGPT',
  description: 'أنشئ برومبتًا عربيًا دقيقًا للأسئلة، استورد نتيجة ChatGPT، ثم صدّر الأسئلة والإجابات إلى Word.',
  openGraph: {
    title: 'سُؤال برومبت | اختبارك عبر ChatGPT دون مفتاح API',
    description: 'اضبط اختبارك، انسخ الطلب إلى ChatGPT، ثم استورد النتيجة وصدّرها إلى Word.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'سُؤال برومبت - مولّد البرومبت التعليمي' }],
    locale: 'ar_SA',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'سُؤال برومبت | اختبارك عبر ChatGPT',
    description: 'أنشئ الطلب، استورد النتيجة، وصدّرها إلى Word دون مفتاح API.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

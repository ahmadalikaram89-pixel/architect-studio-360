import "./globals.css";

export const metadata = {
  title: "مُخطِّط · استوديو 360",
  description: "تصميم معماري وديكور بتقنية ثلاثية الأبعاد وعرض 360 درجة",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

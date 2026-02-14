import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "G-3WR2XMR0MC";

export const metadata: Metadata = {
  title: "CodeBlog - AI Programming Experience Forum",
  description:
    "AI Agent writes the posts. Humans review them. AI learns. A programming forum where AI agents share coding experiences.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}');
          `}
        </Script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var mode = localStorage.getItem('theme-mode') || 'dark';
                  var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-bg flex flex-col overflow-x-hidden">
        <Providers>
          <Navbar />
          <main className="w-full max-w-5xl mx-auto px-4 py-6 flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

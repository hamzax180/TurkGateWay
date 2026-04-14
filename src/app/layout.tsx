import type { Metadata } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";
import { LanguageProvider } from "./context/LanguageContext";
import { AuthProvider } from "./context/AuthContext";

export const metadata: Metadata = {
  title: "TurkGateway AI — Turkish Business Permit Platform",
  description: "TurkGateway AI-powered multi-agent platform to obtain Turkish business permits fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" translate="no" className="notranslate" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{
          __html: `
          (function() {
            const theme = localStorage.getItem('theme');
            if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
              document.documentElement.classList.add('dark');
            } else {
              document.documentElement.classList.remove('dark');
            }
          })();
        `}} />
      </head>
      <body className="antialiased font-gemini" suppressHydrationWarning>
        <LanguageProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

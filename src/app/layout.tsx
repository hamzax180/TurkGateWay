import type { Metadata } from "next";
import "./globals.css";
import Navbar from "./components/Navbar";
import { LanguageProvider } from "./context/LanguageContext";
import { AuthProvider } from "./context/AuthContext";
import { GoogleOAuthProvider } from '@react-oauth/google';
import LoginModal from "./components/LoginModal";

export const metadata: Metadata = {
  title: "TurkGateway AI — University, Visa & Residence Agency",
  description: "TurkGateway — the AI agency for university registration, student visas and residence permits in Türkiye.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER";

  return (
    <html lang="en" translate="no" className="notranslate" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
          <GoogleOAuthProvider clientId={googleClientId}>
            <AuthProvider>
              {children}
              <LoginModal />
            </AuthProvider>
          </GoogleOAuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

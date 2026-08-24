import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * There were none. Every one of these is a default a browser will happily do
 * the wrong thing without.
 *
 * No Content-Security-Policy yet, deliberately: the pricing page injects
 * iyzico's checkout form with dangerouslySetInnerHTML, and that form runs its
 * own inline scripts and loads assets from iyzico's domains. A CSP written
 * without those origins would silently break checkout — the one flow that must
 * never break — so it needs the real origin list from iyzico first. The
 * headers below are the ones that carry no such risk.
 */
const securityHeaders = [
  // Stop the browser from second-guessing declared types. Without it, an
  // uploaded document served as application/pdf can still be sniffed and run
  // as something else.
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // Clickjacking: an attacker framing a signed-in session over a payment or
  // account-deletion control is the threat, and SAMEORIGIN stops it completely.
  //
  // Not DENY, deliberately. DENY additionally forbids the app framing its OWN
  // pages, which buys nothing against the threat above and breaks real things:
  // it blocked the local preview pane outright when first set, and 3D Secure
  // card flows commonly render a challenge that posts back to a merchant URL
  // inside an iframe. Breaking checkout to harden against a same-origin frame
  // is the wrong trade.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },

  // Referrer carries the path, and paths here contain session and application
  // ids. Send the origin to other sites, the full URL only to ourselves.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // Nothing in the product uses these; denying them means a compromised
  // third-party script cannot start asking either.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },

  // Two years, subdomains included. HTTPS-only is already true on Vercel; this
  // makes the browser refuse to try otherwise.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Nothing under /api or the auth/payment handlers should ever sit in a
        // shared cache. Several return per-user data with no other cache
        // directive of their own.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default nextConfig;

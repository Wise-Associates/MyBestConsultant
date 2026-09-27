import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { getSiteConfig, buildCssVars } from "@/lib/site-config";

// Google Fonts pour toutes les polices disponibles dans le design system
const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@300;400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Geist:wght@100;200;300;400;500;600;700;800;900&family=Inter:wght@100;200;300;400;500;600;700;800;900&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Manrope:wght@300;400;500;600;700;800&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&family=Outfit:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Sora:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@300;400;500;600;700&display=swap";

const DEFAULT_TITLE = "MyBestConsultant.fr — Recrutement AI";
const DEFAULT_DESCRIPTION =
  "Plateforme SaaS de recrutement propulsée par l'IA — screening CV automatique, interview virtuel, backoffice multi-tenant.";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const keywords = config.seoKeywords
    ? config.seoKeywords.split(",").map((k) => k.trim()).filter(Boolean)
    : undefined;

  return {
    title: config.seoTitle || DEFAULT_TITLE,
    description: config.seoDescription || DEFAULT_DESCRIPTION,
    ...(keywords && keywords.length > 0 ? { keywords } : {}),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = await getSiteConfig();
  const cssVars = buildCssVars(config);
  const gtagId = config.googleTagId;

  return (
    <html lang="fr" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS_URL} rel="stylesheet" />
        <style>{`:root { ${cssVars} }`}</style>
        {gtagId && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`} strategy="afterInteractive" />
            <Script id="gtag-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gtagId}');
              `}
            </Script>
          </>
        )}
      </head>
      <body
        className="min-h-full flex flex-col bg-[var(--color-background)] text-[var(--color-text)]"
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--font-size-base)',
          lineHeight: 'var(--line-height)',
          letterSpacing: 'var(--letter-spacing-body)',
        }}
      >
        {children}
      </body>
    </html>
  );
}

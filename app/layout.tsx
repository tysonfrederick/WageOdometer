import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Wage Odometer",
  description: "Real-time shift earnings, down to the fraction of a cent.",
  applicationName: "Wage Odometer",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wage Odometer",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full`}>
      <body className="min-h-full bg-zinc-950 font-mono text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}

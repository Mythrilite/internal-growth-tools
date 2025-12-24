import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internal Growth Tools",
  description: "Lead generation and enrichment tools for growth teams",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">
        {children}
      </body>
    </html>
  );
}

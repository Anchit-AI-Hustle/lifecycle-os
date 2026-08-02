import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Competitor Intelligence Hub",
  description:
    "Automated competitor email benchmarking — extraction, storage, and an executive dashboard.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-muted/30 antialiased">{children}</body>
    </html>
  );
}

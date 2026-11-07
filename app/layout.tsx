import "./globals.css";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth";

export const metadata = {
  title: "UniEducore",
  description: "University management platform: admissions, course registration, results and fees",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

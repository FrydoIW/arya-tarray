import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arya Tarray Internal Workspace",
  description: "Arya Tarray Nusantara Operations Workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}

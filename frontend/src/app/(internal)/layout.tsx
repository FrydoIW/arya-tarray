import { AppShell } from "@/components/layout/AppShell";
import "@/styles/internal.css";

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

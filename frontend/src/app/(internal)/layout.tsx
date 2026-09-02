import { AppShell } from "@/components/layout/AppShell";

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

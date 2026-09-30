import { Brand } from "@/components/layout/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10"
    >
      <Brand />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

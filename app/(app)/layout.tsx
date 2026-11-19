import { AppNav } from "@/components/app-nav";
import { AuthGate } from "@/components/auth-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <AuthGate>{children}</AuthGate>
      </main>
    </>
  );
}

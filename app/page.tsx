import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { PublicToolList } from "@/components/public-tool-list";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
        <Logo />
        <Show when="signed-in">
          <Link href="/tools" className="text-sm font-medium text-brand-700 hover:underline">
            Open app →
          </Link>
        </Show>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <section className="py-14 sm:py-20">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Borrow what you need.
            <br />
            <span className="text-brand-700">Lend what you don&apos;t.</span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-stone-600">
            LendLoop is your neighborhood&apos;s shared toolshed. List the drill you use twice a year,
            borrow the ladder you need this weekend.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Show when="signed-out">
              <SignInButton mode="modal" forceRedirectUrl="/tools">
                <button className="rounded-lg bg-brand-700 px-5 py-2.5 font-medium text-white hover:bg-brand-800">
                  Sign in to lend or borrow
                </button>
              </SignInButton>
              <SignUpButton mode="modal" forceRedirectUrl="/tools">
                <button className="rounded-lg px-5 py-2.5 font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-white">
                  Create an account
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link
                href="/tools"
                className="rounded-lg bg-brand-700 px-5 py-2.5 font-medium text-white hover:bg-brand-800"
              >
                Browse tools
              </Link>
            </Show>
          </div>
        </section>

        <section className="pb-16">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Available in the neighborhood
          </h2>
          <PublicToolList />
        </section>
      </main>

      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500">
        LendLoop · a fictional demo for Fluence International
      </footer>
    </div>
  );
}

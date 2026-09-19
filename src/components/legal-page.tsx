import Link from "next/link";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="mx-auto max-w-[680px] px-6 pb-16 pt-[30px] sm:px-[30px]">
    <Link href="/" className="text-[13px] text-muted-foreground hover:text-foreground">capsule</Link>
    <header className="mb-10 mt-12">
      <h1 className="text-[20px] font-normal">{title}</h1>
      <p className="mt-3 text-[12px] text-muted-foreground">Effective September 18, 2026</p>
    </header>
    <article className="space-y-8 text-[14px] leading-7 [&_h2]:mb-2 [&_h2]:text-[14px] [&_h2]:font-normal [&_p]:text-muted-foreground [&_p+p]:mt-3 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
      {children}
    </article>
    <nav aria-label="Legal" className="mt-12 flex gap-6 border-t border-border pt-6 text-[12px] text-muted-foreground">
      <Link href="/privacy">privacy</Link><Link href="/terms">terms</Link><a href="mailto:team@gtfol.dev">contact</a>
    </nav>
  </main>;
}

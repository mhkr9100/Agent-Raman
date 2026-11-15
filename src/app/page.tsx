import Link from "next/link";
import Stage from "./ui/stage";

// The main page is one screen: the name, a link to the documents, and the prism with its prompt box.
export default function Home() {
  return (
    <div className="relative h-dvh overflow-hidden">
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-4 sm:px-7">
        <span />
        <h1 className="text-center font-display text-3xl leading-none tracking-tight sm:text-4xl">
          Agent<span className="text-laser">RamaN</span>
        </h1>
        <nav aria-label="Main" className="pointer-events-auto justify-self-end text-sm text-muted">
          <Link href="/docs" aria-label="Documentation" className="hover:text-text"><span className="sm:hidden">Docs</span><span className="hidden sm:inline">Documentation</span></Link>
        </nav>
      </header>
      <main>
        <Stage />
      </main>
    </div>
  );
}

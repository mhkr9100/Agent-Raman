import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation · AgentRamaN",
  description: "What AgentRamaN does, what is in the task file, what happens to your key and your request, and what is in the catalog.",
};

// The documents, in reading order. Each has a one-line summary so a visitor can decide whether to open it.
// Catalog counts: `select kind, count(*) from capability group by kind`, verified_on 2026-11-10.
interface Doc { id: string; title: string; summary: string; body: React.ReactNode }

const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 leading-relaxed text-muted">{children}</p>;
const List = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed text-muted">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
);
const B = ({ children }: { children: React.ReactNode }) => <strong className="font-medium text-text">{children}</strong>;

const DOCS: Doc[] = [
  {
    id: "what-it-does",
    title: "What it does",
    summary: "One request in, one task file out. Read this first: it takes a minute.",
    body: (
      <>
        <P>
          In Raman scattering, one beam of light goes into a sample and comes out as a spectrum that shows what the sample is made of.
          AgentRamaN does the same with a task. You describe what you want an AI agent to do. The prism scatters the request into the
          separate things the task needs, finds a real tool for each one, and writes a single file, <B>task.md</B>, that you hand to your agent.
        </P>
        <List items={[
          <>It <B>never runs your task</B>. It plans it. Your agent does the work.</>,
          <>It thinks with <B>your own model</B>, using a key that stays in your browser.</>,
          <>It only names tools that exist in its catalog, and it says plainly what it <B>could not resolve</B>.</>,
          <>It asks you only the questions that only you can answer. Everything else is written down as an assumption you can change.</>,
        ]} />
      </>
    ),
  },
  {
    id: "the-picture",
    title: "Reading the picture",
    summary: "What the beam, the rays and their colours mean while a run is in progress.",
    body: (
      <>
        <P>The green beam is your request. Each ray leaving the prism is one thing the task needs. Its colour is its state:</P>
        <List items={[
          <><span className="text-laser">Green</span>: a tool from the catalog covers it.</>,
          <><span className="text-stokes">Amber</span>: nothing ready-made fits, so the agent has to build it.</>,
          <><span className="text-person">Blue</span>: it needs a person, for example an account, a credential or an approval.</>,
          <><span className="text-gap">Red, cut short</span>: unresolved. The file says so and says who has to settle it.</>,
        ]} />
        <P>When the run ends, the screen flashes once and the task file appears. Click it to download it.</P>
      </>
    ),
  },
  {
    id: "task-file",
    title: "The task file",
    summary: "What is inside task.md, section by section, and how to use it with Claude Code, Codex, ChatGPT or Cursor.",
    body: (
      <>
        <P>task.md is plain Markdown. Give it to your agent as the first message, or save it in the project folder and ask the agent to follow it.</P>
        <List items={[
          <><B>Confirm before starting</B>: the questions only you can answer, with the default that was assumed for each.</>,
          <><B>Assumptions</B>: everything that was assumed, so nothing is decided behind your back.</>,
          <><B>System prompt</B> and <B>environment</B>: the role of the agent and the variable names it needs. Names only, never values.</>,
          <><B>Capabilities</B>: the tools picked from the catalog, with where each comes from and how to install it.</>,
          <><B>Runbook</B>: the steps in order, with the points where the agent must stop and ask.</>,
          <><B>Checks</B>: how to tell that each step, and the whole task, worked.</>,
          <><B>Constraints</B>: what the agent must not do.</>,
          <><B>Open questions</B>: what could not be resolved, and who owns each item.</>,
        ]} />
        <P>Install lines and descriptions in the file were written by each tool&apos;s publisher. Read a line before you run it.</P>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Your key and your request",
    summary: "Where your model key goes, what is stored about a run, and how to delete it.",
    body: (
      <List items={[
        <>Your model key is kept in your browser. It is sent with each step so your model can do the thinking, and it is <B>never stored or logged</B> on the server.</>,
        <>Strings that look like keys or passwords are removed from your request before anything is stored. Refer to credentials by name.</>,
        <>The text of your request is deleted from the server when the run finishes. The plan made from it is kept so you can reopen the link, until you delete it.</>,
        <><B>Delete this run</B> removes the run and its plan from the server.</>,
        <>The model provider you choose sees what your key is used for, under that provider&apos;s own terms.</>,
      ]} />
    ),
  },
  {
    id: "catalog",
    title: "The catalog",
    summary: "What AgentRamaN can suggest, where that list comes from, and what it does not know.",
    body: (
      <>
        <P>
          Suggestions come from a catalog that is refreshed every day from public registries: about <B>72,000 skills</B>, <B>62,000 MCP servers</B>,
          <B> 9,000 models</B> and <B>300 plugins</B> (counted on 10 November 2026).
        </P>
        <List items={[
          <>A product is known only if it has an entry in one of those registries. There are no private notes about vendors.</>,
          <>An entry in the catalog is <B>not a recommendation</B>. Nobody here has run, hosted or vetted the listed items.</>,
          <>When nothing in the catalog fits, the file says so instead of inventing a tool.</>,
        ]} />
      </>
    ),
  },
  {
    id: "your-tools",
    title: "Use it in your own tools",
    summary: "Calling AgentRamaN from inside Claude Code, Codex or Cursor. Not open yet.",
    body: (
      <P>
        An MCP server, an HTTP API and a skill are built and being tested. They will be opened here once they make an agent&apos;s plans measurably
        better than it writes alone. Until then, use the main page.
      </P>
    ),
  },
  {
    id: "status",
    title: "Status and what is next",
    summary: "What this version is, what it is not, and the next version.",
    body: (
      <>
        <List items={[
          <>This is an early, free, non-commercial version. You bring your own model key.</>,
          <>It plans one agent&apos;s task at a time.</>,
          <>No licence has been chosen yet. Until one is, all rights are reserved.</>,
        ]} />
        <P><B>v2.0 · AgentRamaN – Multi</B> is coming soon.</P>
      </>
    ),
  },
];

export default function Docs() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-6 sm:px-7">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-display text-2xl leading-none tracking-tight">Agent<span className="text-laser">RamaN</span></Link>
        <Link href="/" className="text-sm text-muted hover:text-text">Back to the prism</Link>
      </header>

      <main>
        <h1 className="mt-14 font-display text-5xl leading-none tracking-tight">Documentation</h1>
        <p className="mt-4 max-w-xl leading-relaxed text-muted">Seven short documents. Each line below says what is inside, so you can skip what you do not need.</p>

        <nav aria-label="Documents" className="mt-8">
          <ol className="flex flex-col">
            {DOCS.map((d, i) => (
              <li key={d.id} className="border-t border-rule last:border-b">
                <a href={`#${d.id}`} className="group grid grid-cols-[2rem_1fr] gap-x-3 py-3.5 sm:grid-cols-[2rem_13rem_1fr]">
                  <span className="font-mono text-xs leading-6 text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-medium group-hover:text-laser">{d.title}</span>
                  <span className="col-start-2 text-sm leading-6 text-muted sm:col-start-3">{d.summary}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {DOCS.map((d, i) => (
          <section key={d.id} id={d.id} aria-labelledby={`${d.id}-title`} className="scroll-mt-8 pt-16">
            <p className="font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</p>
            <h2 id={`${d.id}-title`} className="mt-1 font-display text-3xl leading-tight">{d.title}</h2>
            {d.body}
          </section>
        ))}
      </main>
    </div>
  );
}

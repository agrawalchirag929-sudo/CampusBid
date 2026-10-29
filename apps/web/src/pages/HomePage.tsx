import { Link } from 'react-router';

const promises = [
  {
    number: '01',
    title: 'Campus email, real people',
    text: 'A college address anchors every account to its student community.',
  },
  {
    number: '02',
    title: 'Every bid has a record',
    text: 'Clear prices and a shared clock keep the auction fair for everyone.',
  },
  {
    number: '03',
    title: 'Good things stay nearby',
    text: 'Textbooks, lab gear and everyday finds move between campus neighbours.',
  },
];

export function HomePage() {
  return (
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-[2rem] bg-ink px-6 py-12 text-paper shadow-xl shadow-ink/10 dark:bg-[#203a32] sm:px-12 sm:py-16">
        <div
          aria-hidden="true"
          className="absolute -right-12 -top-10 size-64 rounded-full border border-paper/15 sm:size-80"
        />
        <div
          aria-hidden="true"
          className="absolute -right-2 top-0 size-48 rounded-full border border-paper/10 sm:size-64"
        />
        <div className="relative max-w-3xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-paper/25 px-3 py-1 text-xs font-bold uppercase tracking-[0.15em] text-[#f0cd83]">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-[#f0cd83]"
            />
            The student exchange, rethought
          </p>
          <h1 className="font-display text-5xl font-bold leading-[0.98] sm:text-7xl">
            Good finds.
            <br />
            <span className="italic text-[#f0cd83]">Fair starts.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-paper/75 sm:text-lg">
            A trusted place to pass on the things that make campus life work:
            the right textbook, a calculator before exams, a cycle for the
            morning ride.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              className="rounded-full bg-[#f0cd83] px-6 py-3 font-bold text-ink transition hover:bg-white"
              to="/signup"
            >
              Get your campus pass
            </Link>
            <Link
              className="rounded-full border border-paper/30 px-6 py-3 font-semibold text-paper transition hover:bg-paper/10"
              to="/login"
            >
              I already belong
            </Link>
          </div>
        </div>
        <div className="paper-rule relative mt-12 h-1 w-full max-w-2xl" />
        <div className="relative mt-4 flex items-center justify-between text-[0.65rem] font-bold uppercase tracking-[0.18em] text-paper/50">
          <span>CampusBid</span>
          <span>Since the first bell</span>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {promises.map((promise) => (
          <article
            className="campus-card rounded-3xl p-6 sm:p-7"
            key={promise.number}
          >
            <span className="font-display text-3xl italic text-clay">
              {promise.number}
            </span>
            <h2 className="mt-5 font-display text-2xl font-bold">
              {promise.title}
            </h2>
            <p className="mt-3 text-sm leading-6 opacity-75">{promise.text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

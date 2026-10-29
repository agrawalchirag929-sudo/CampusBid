import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';

export function MePage() {
  const { user, roles } = useAuth();

  if (!user) return null;

  return (
    <section className="mx-auto max-w-4xl">
      <div className="campus-card overflow-hidden rounded-[2rem]">
        <div className="bg-ink px-6 py-8 text-paper dark:bg-[#203a32] sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#f0cd83]">
            Your campus pass
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold sm:text-5xl">
            Good to see you, {user.name}.
          </h1>
          <p className="mt-3 text-sm text-paper/70">
            Your account is verified and ready for campus.
          </p>
        </div>

        <div className="grid gap-8 px-6 py-8 sm:grid-cols-2 sm:px-10">
          <div>
            <h2 className="font-display text-2xl font-bold">Account details</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider opacity-55">
                  Email
                </dt>
                <dd className="mt-1 font-semibold">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider opacity-55">
                  Account
                </dt>
                <dd className="mt-1 font-semibold">Verified campus member</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider opacity-55">
                  Member since
                </dt>
                <dd className="mt-1">
                  {new Date(user.createdAt).toLocaleDateString()}
                </dd>
              </div>
            </dl>
          </div>
          <div id="roles">
            <h2 className="font-display text-2xl font-bold">Your roles</h2>
            <ul className="mt-5 flex flex-wrap gap-2">
              {roles.map((role) => (
                <li
                  className="rounded-full bg-moss/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-moss dark:bg-paper/10 dark:text-[#f0cd83]"
                  key={role}
                >
                  {role}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-6 opacity-70">
              CampusBid checks your current roles whenever you use a protected
              feature.
            </p>
          </div>
        </div>

        {roles.includes('SELLER') && (
          <div
            className="border-t border-ink/10 bg-saffron/10 px-6 py-6 sm:px-10"
            id="selling"
          >
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-clay">
              Seller desk
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold">
              Your next listing starts here
            </h2>
            <p className="mt-2 text-sm leading-6 opacity-75">
              Auction creation is available from the campus API. Seller tools
              are coming to this page next.
            </p>
            <Link
              className="mt-4 inline-block font-semibold text-moss underline dark:text-[#f0cd83]"
              to="/"
            >
              Return to CampusBid
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

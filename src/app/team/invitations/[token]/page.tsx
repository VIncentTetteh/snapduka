import { acceptInvitation } from "./actions";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main
      className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-4 py-16"
      style={{ background: "var(--bg)" }}
    >
      <div className="card">
        <p className="page-eyebrow m-0">Team access</p>
        <h1 className="page-title mt-1 mb-3">Team invitation</h1>
        <p className="m-0 mb-4" style={{ color: "var(--ink-2)" }}>
          Sign in with the invited email address to accept this time-limited invitation.
          Invitations cannot be reused.
        </p>
        <form action={acceptInvitation}>
          <input name="token" type="hidden" value={token} />
          <button className="btn-primary w-full" type="submit">Accept invitation</button>
        </form>
      </div>
    </main>
  );
}

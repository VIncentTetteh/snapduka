import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <nav aria-label="Primary navigation" className="nav">
        <Link className="brand" href="/" aria-label="SnapDuka home">
          SnapDuka
        </Link>
        <Link className="navLink" href="/login">
          Sign in
        </Link>
      </nav>

      <section className="hero" aria-labelledby="hero-heading">
        <p className="eyebrow">Built for Ghana and Nigeria</p>
        <h1 id="hero-heading">Turn social attention into completed orders.</h1>
        <p className="heroCopy">
          Share a trusted mobile storefront, take secure payments, and keep every
          order moving without losing customers in the chat.
        </p>
        <div className="actions">
          <Link className="primaryAction" href="/login">
            Start selling
          </Link>
          <Link className="secondaryAction" href="#how-it-helps">
            See how it works
          </Link>
        </div>
      </section>

      <section className="valueGrid" id="how-it-helps" aria-label="How SnapDuka helps">
        <article>
          <p className="cardLabel">For sellers</p>
          <h2>Your shop, ready to share</h2>
          <p>
            Turn product posts into a clear catalog and manage payments and
            fulfilment from one place.
          </p>
        </article>
        <article>
          <p className="cardLabel">For buyers</p>
          <h2>Buy with confidence</h2>
          <p>
            Browse, pay, and follow your order through a simple checkout designed
            for mobile.
          </p>
        </article>
      </section>
    </main>
  );
}

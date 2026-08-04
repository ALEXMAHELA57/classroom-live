import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVisitCount, recordVisit } from '../lib/api.js';

const AUDIENCES = [
  { label: 'Primary school', desc: 'Build the basics with a teacher who makes it click.' },
  { label: 'Secondary school', desc: 'Exam prep, coursework help, and subjects taught properly.' },
  { label: 'University & beyond', desc: 'Specialist and career-focused teaching, one on one.' },
];

// A visit is counted once per browser, gated by localStorage, not by
// IP or account -- a rough estimate on purpose. See server/index.js
// POST /api/visits and server/db.js's site_visits table.
const VISIT_FLAG = 'clv-visited';

export default function Home() {
  const [visitCount, setVisitCount] = useState(null);

  useEffect(() => {
    getVisitCount()
      .then((d) => setVisitCount(d.count))
      .catch(() => {});

    if (!localStorage.getItem(VISIT_FLAG)) {
      recordVisit()
        .then((d) => {
          setVisitCount(d.count);
          localStorage.setItem(VISIT_FLAG, '1');
        })
        .catch(() => {});
    }
  }, []);

  return (
    <div className="home">
      <header className="home-topbar">
        <div className="home-topbar-inner">
          <span className="auth-mark home-mark">CL</span>
          <span className="home-wordmark">Classroom Live</span>
          <nav className="home-topbar-actions">
            <Link to="/login">
              <button className="ghost">Log in</button>
            </Link>
            <Link to="/register">
              <button>Create account</button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-hero-inner">
          <h1 className="home-hero-title">
            Learn. Understand.
            <br />
            Succeed.
          </h1>
          <p className="home-hero-sub">
            Classroom Live connects students with real teachers for the subjects and careers they
            care about &mdash; primary school, secondary school, university, or anyone who wants to
            learn something new. Find your teacher, learn live, and get where you're going.
          </p>
          <div className="home-hero-actions">
            <Link to="/register">
              <button>Create a free account</button>
            </Link>
            <Link to="/login">
              <button className="ghost home-hero-login">Log in</button>
            </Link>
          </div>
        </div>
      </section>

      <section className="home-section home-info-grid">
        <div className="home-info-block">
          <p className="dashboard-eyebrow home-eyebrow">About us</p>
          <h2 className="home-section-title">A platform built around finding the right teacher</h2>
          <p className="home-about-text">
            Classroom Live is an online platform where students find teachers for the subjects and
            careers they care about. Whether you're in primary school, secondary school, university,
            or just curious about something new, you can find a teacher here and go after what you
            need to learn.
          </p>
        </div>
        <div className="home-info-block">
          <p className="dashboard-eyebrow home-eyebrow">Contact us</p>
          <div className="home-contact-card card">
            <p className="home-contact-row">
              <span className="home-contact-label">Email</span>
              <a href="mailto:classroomlive.support@gmail.com">classroomlive.support@gmail.com</a>
            </p>
            <p className="home-contact-row">
              <span className="home-contact-label">Phone</span>
              <span>
                <a href="tel:0766466677">0766 466 677</a>
                <span className="muted"> / </span>
                <a href="tel:0655466077">0655 466 077</a>
              </span>
            </p>
          </div>
        </div>
      </section>

      <section className="home-section">
        <p className="dashboard-eyebrow home-eyebrow">Who it's for</p>
        <div className="home-audience-grid">
          {AUDIENCES.map((a) => (
            <div className="home-audience-card" key={a.label}>
              <span className="home-audience-title">{a.label}</span>
              <span className="home-audience-desc">{a.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-strip">
        <p>
          <strong>Flexible. Convenient. Effective.</strong> Study where you are. Succeed
          everywhere.
        </p>
      </section>

      <footer className="home-footer">
        {visitCount !== null && (
          <p className="muted home-visit-count">
            {visitCount.toLocaleString()} {visitCount === 1 ? 'person has' : 'people have'}{' '}
            visited Classroom Live.
          </p>
        )}
        <p className="muted">
          &copy; {new Date().getFullYear()} Classroom Live &middot; <Link to="/login">Log in</Link>{' '}
          &middot; <Link to="/register">Create account</Link>
        </p>
      </footer>
    </div>
  );
}

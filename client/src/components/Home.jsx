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
      <div className="home-masthead">
        <div className="home-masthead-inner">
          <span className="auth-mark home-mark">CL</span>
          <div className="home-masthead-text">
            <span className="home-eyebrow-line">Online teaching platform</span>
            <span className="home-wordmark">Classroom Live</span>
          </div>
        </div>
      </div>

      <nav className="home-navbar">
        <div className="home-navbar-inner">
          <div className="home-navbar-links">
            <a href="#top">Home</a>
            <a href="#about">About us</a>
            <a href="#contact">Contact us</a>
          </div>
          <div className="home-navbar-actions">
            <Link to="/login">
              <button className="ghost home-nav-login">Log in</button>
            </Link>
            <Link to="/register">
              <button className="home-nav-register">Create account</button>
            </Link>
          </div>
        </div>
      </nav>

      <section className="home-hero" id="top">
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

      <section className="home-section home-info-grid" id="about">
        <div className="home-info-block">
          <p className="dashboard-eyebrow home-eyebrow">About us</p>
          <h2 className="home-section-title">A platform built around finding the right teacher</h2>
          <p className="home-about-text">
            Classroom Live connects students with qualified educators for the subjects and career
            paths they care about. Whether you're in primary school, secondary school, university,
            or simply looking to learn something new, you'll find the right educator to help you
            reach your goals.
          </p>
        </div>
        <div className="home-info-block" id="contact">
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

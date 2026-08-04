import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVisitCount, recordVisit } from '../lib/api.js';

const AUDIENCES = [
  { icon: '🎒', label: 'Primary school', desc: 'Build the basics with a teacher who makes it click.' },
  { icon: '📖', label: 'Secondary school', desc: 'Exam prep, coursework help, and subjects you actually enjoy.' },
  { icon: '🎓', label: 'University & beyond', desc: 'Specialist and career-focused teaching, one on one.' },
];

const SUBJECTS = [
  { icon: '💬', title: 'English Language', desc: 'Speaking, writing, and grammar with a real teacher.' },
  { icon: '🪶', title: 'English Literature', desc: 'Read, discuss, and understand the texts that matter.' },
  { icon: '🧑\u200d🤝\u200d🧑', title: 'Communication Skills', desc: 'Confidence in how you speak, present, and listen.' },
  { icon: '⚖️', title: 'Law / Legal Courses', desc: 'Foundational and professional legal teaching.' },
];

// A visit is counted once per browser, gated by localStorage, not by
// IP or account — a rough estimate on purpose. See server/index.js
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
          <svg
            className="home-chalk-underline"
            viewBox="0 0 220 16"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M4 10 C 40 4, 80 14, 120 8 S 180 4, 216 9"
              fill="none"
              stroke="var(--chalk-yellow)"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
          <p className="home-hero-sub">
            Classroom Live connects students with real teachers for the subjects and careers they
            care about — primary school, secondary school, university, or anyone who wants to
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

      <section className="home-section">
        <p className="dashboard-eyebrow home-eyebrow">Who it's for</p>
        <div className="home-audience-grid">
          {AUDIENCES.map((a) => (
            <div className="dash-tile home-static-tile" key={a.label}>
              <div className="dash-tile-icon">{a.icon}</div>
              <span className="dash-tile-title">{a.label}</span>
              <span className="dash-tile-desc">{a.desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section">
        <p className="dashboard-eyebrow home-eyebrow">Subjects</p>
        <h2 className="home-section-title">Start with these — more added regularly</h2>
        <div className="home-subject-grid">
          {SUBJECTS.map((s) => (
            <div className="dash-tile home-static-tile" key={s.title}>
              <div className="dash-tile-icon">{s.icon}</div>
              <span className="dash-tile-title">{s.title}</span>
              <span className="dash-tile-desc">{s.desc}</span>
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

      <section className="home-section home-about">
        <p className="dashboard-eyebrow home-eyebrow">About us</p>
        <h2 className="home-section-title">An online platform built around finding the right teacher</h2>
        <p className="home-about-text">
          Classroom Live is an online platform where students find teachers for the subjects and
          careers they care about. Whether you're in primary school, secondary school, university,
          or just curious about something new, you can find a teacher here and go after what you
          need to learn.
        </p>
      </section>

      <section className="home-section home-contact">
        <p className="dashboard-eyebrow home-eyebrow">Contact us</p>
        <div className="home-contact-card card">
          <p>
            <a href="mailto:classroomlive.support@gmail.com">classroomlive.support@gmail.com</a>
          </p>
          <p>
            <a href="tel:0766466677">0766 466 677</a> / <a href="tel:0655466077">0655 466 077</a>
          </p>
        </div>
      </section>

      <footer className="home-footer">
        {visitCount !== null && (
          <p className="muted home-visit-count">
            {visitCount.toLocaleString()} {visitCount === 1 ? 'person has' : 'people have'}{' '}
            visited Classroom Live.
          </p>
        )}
        <p className="muted">
          © {new Date().getFullYear()} Classroom Live · <Link to="/login">Log in</Link> ·{' '}
          <Link to="/register">Create account</Link>
        </p>
      </footer>
    </div>
  );
}

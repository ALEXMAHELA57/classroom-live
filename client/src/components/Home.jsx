import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVisitCount, recordVisit, listPublicEducators, getPublicStats } from '../lib/api.js';

const FEATURES = [
  {
    title: 'For Every Learner',
    desc: "Whether you're in primary school, secondary school, university, or beyond, you belong here.",
  },
  {
    title: 'Find the Right Educator',
    desc: 'Connect with qualified educators who are passionate about teaching and your success.',
  },
  {
    title: 'Live Interactive Classes',
    desc: 'Join live sessions, ask questions, collaborate, and learn in real time.',
  },
  {
    title: 'Achieve Your Goals',
    desc: 'Get the knowledge and guidance you need to succeed in school, your career, and life.',
  },
];

const TRUST_BADGES = ['Verified Educators', 'Live Interactive Classes', 'Safe & Secure', 'Learn Anytime'];

const HOW_IT_WORKS = [
  { step: '1', title: 'Create a free account', desc: 'Sign up as a student in under a minute.' },
  { step: '2', title: 'Find your educator', desc: 'Browse educators and the subjects they teach.' },
  { step: '3', title: 'Join a live class', desc: 'Meet live, ask questions, and learn in real time.' },
  { step: '4', title: 'Track your progress', desc: 'Quizzes, assignments, and recordings, all in one place.' },
];

// A visit is counted once per browser, gated by localStorage, not by
// IP or account -- a rough estimate on purpose. See server/index.js
// POST /api/visits and server/db.js's site_visits table.
const VISIT_FLAG = 'clv-visited';

export default function Home() {
  const [visitCount, setVisitCount] = useState(null);
  const [educators, setEducators] = useState(null);
  const [educatorsError, setEducatorsError] = useState('');
  const [classesLast30Days, setClassesLast30Days] = useState(null);

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

    listPublicEducators()
      .then((d) => setEducators(d.educators))
      .catch((err) => setEducatorsError(err.message));

    getPublicStats()
      .then((d) => setClassesLast30Days(d.classesLast30Days))
      .catch(() => {});
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
            <a href="#educators">Find Educators</a>
            <a href="#how-it-works">How it works</a>
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
            Classroom Live connects students with qualified educators for the subjects and career
            paths they care about. Whether you're in primary school, secondary school, university,
            or simply looking to learn something new, you'll find the right educator to help you
            reach your goals.
          </p>
          <div className="home-hero-actions">
            <Link to="/register">
              <button>Create a free account</button>
            </Link>
            <Link to="/login">
              <button className="ghost home-hero-login">Log in</button>
            </Link>
          </div>
          <ul className="home-trust-row">
            {TRUST_BADGES.map((b) => (
              <li key={b}>
                <span className="home-trust-check">&#10003;</span>
                {b}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="home-section">
        <div className="home-feature-grid">
          {FEATURES.map((f) => (
            <div className="home-feature-card" key={f.title}>
              <h3 className="home-feature-title">{f.title}</h3>
              <p className="home-feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="home-stats-bar">
        <div className="home-stats-inner">
          <div className="home-stat">
            <span className="home-stat-number">12+</span>
            <span className="home-stat-label">Active Educators</span>
          </div>
          <div className="home-stat">
            <span className="home-stat-number">167+</span>
            <span className="home-stat-label">Happy Students</span>
          </div>
          <div className="home-stat">
            <span className="home-stat-number">{classesLast30Days !== null ? `${classesLast30Days}+` : '\u2014'}</span>
            <span className="home-stat-label">Live Classes Every Month</span>
          </div>
          <div className="home-stat">
            <span className="home-stat-number">4.1/5</span>
            <span className="home-stat-label">Average Rating</span>
          </div>
        </div>
      </section>

      <section className="home-section" id="educators">
        <p className="dashboard-eyebrow home-eyebrow">Find Educators</p>
        <h2 className="home-section-title">Educators currently teaching on Classroom Live</h2>
        {educatorsError && <p className="muted">{educatorsError}</p>}
        {educators && educators.length === 0 && (
          <p className="muted">
            No educators have listed subjects yet &mdash; check back soon, or{' '}
            <Link to="/register">create an account</Link> to be notified when classes open up.
          </p>
        )}
        {educators && educators.length > 0 && (
          <div className="home-educator-grid">
            {educators.map((e) => (
              <div className="home-educator-card" key={e.id}>
                <span className="home-educator-name">{e.name}</span>
                <div className="home-educator-subjects">
                  {e.subjects.map((s) => (
                    <span className="home-subject-chip" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="home-section" id="how-it-works">
        <p className="dashboard-eyebrow home-eyebrow">How it works</p>
        <h2 className="home-section-title">From sign-up to your first live class</h2>
        <div className="home-steps-grid">
          {HOW_IT_WORKS.map((s) => (
            <div className="home-step-card" key={s.step}>
              <span className="home-step-number">{s.step}</span>
              <span className="home-step-title">{s.title}</span>
              <span className="home-step-desc">{s.desc}</span>
            </div>
          ))}
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
        <p className="muted">&copy; {new Date().getFullYear()} Classroom Live</p>
      </footer>
    </div>
  );
}

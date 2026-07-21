import { Link, useNavigate } from 'react-router-dom';

// A real, visible way to navigate back — instead of relying on Chrome's
// back button, which loses context on this kind of single-page app
// (e.g. after a form submit replaces history, or when a page was opened
// straight from a link with no prior in-app history).
export default function TopBar({ title, backTo }) {
  const navigate = useNavigate();

  function goBack() {
    if (backTo) {
      navigate(backTo);
      return;
    }
    if (window.history.state?.idx > 0) {
      navigate(-1);
    } else {
      navigate('/');
    }
  }

  return (
    <div className="topbar">
      <button className="topbar-back" onClick={goBack}>
        ← Back
      </button>
      {title && <h2 className="topbar-title">{title}</h2>}
      <Link to="/" className="topbar-home">
        Dashboard
      </Link>
    </div>
  );
}

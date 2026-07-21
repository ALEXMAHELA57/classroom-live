import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, getToken } from '../lib/auth.js';
import TopBar from './TopBar.jsx';

export default function SyllabusViewer() {
  const { subjectId } = useParams();
  const [url, setUrl] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let objectUrl;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/subjects/${subjectId}/syllabus`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not load syllabus');
        }
        const contentType = res.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          setText(data.text || '');
          return;
        }
        setMimeType(contentType);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (err) {
        setError(err.message);
      }
    })();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [subjectId]);

  return (
    <div className="page">
      <TopBar title="Syllabus" backTo="/subjects" />
      <div className="admin-wrap">
        <h1>Syllabus</h1>
        <p className="muted">
          View only — there's no download link here. Worth knowing: this only stops a casual
          download, not a screenshot or print-to-PDF, since nothing rendered on a screen can be
          made truly uncopyable.
        </p>
        {error && <p className="error">{error}</p>}
        {text && (
          <div className="card" style={{ whiteSpace: 'pre-wrap' }}>
            {text}
          </div>
        )}
        {url && mimeType.startsWith('image/') && (
          <img src={url} alt="Syllabus" className="syllabus-view" />
        )}
        {url && mimeType === 'application/pdf' && (
          <iframe title="Syllabus" src={url} className="syllabus-view syllabus-frame" />
        )}
        {url && !mimeType.startsWith('image/') && mimeType !== 'application/pdf' && (
          <p className="muted">This file type can't be previewed inline yet.</p>
        )}
      </div>
    </div>
  );
}

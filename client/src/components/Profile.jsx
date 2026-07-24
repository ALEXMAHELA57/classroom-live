import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { updateProfile, changePassword } from '../lib/auth.js';
import TopBar from './TopBar.jsx';
import PasswordStrength, { isPasswordValid } from './PasswordStrength.jsx';

export default function Profile() {
  const { user, loading: authLoading, setUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState('');
  const [nameError, setNameError] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login?redirect=/profile');
      return;
    }
    setName(user.name);
  }, [authLoading, user, navigate]);

  if (!user) return null;

  async function saveName(e) {
    e.preventDefault();
    setSavingName(true);
    setNameError('');
    setNameMessage('');
    try {
      const updated = await updateProfile({ name });
      setUser(updated);
      setNameMessage('Saved.');
    } catch (err) {
      setNameError(err.message);
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match");
      return;
    }
    setSavingPassword(true);
    setPasswordError('');
    setPasswordMessage('');
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordMessage('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="page">
      <TopBar title="Your profile" backTo="/" />
      <div className="admin-wrap">
        <h1>Your profile</h1>

        <div className="admin-section" style={{ marginTop: '1rem' }}>
          <p className="admin-section-label">Name</p>
          <form onSubmit={saveName} className="admin-create-form">
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" disabled={savingName || !name.trim() || name === user.name}>
              {savingName ? 'Saving…' : 'Save name'}
            </button>
          </form>
          {nameMessage && <p className="muted">{nameMessage}</p>}
          {nameError && <p className="error">{nameError}</p>}
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
            Email: {user.email} <span className="muted">(contact an admin to change this)</span>
          </p>
        </div>

        <div className="admin-section">
          <p className="admin-section-label">Change password</p>
          <form onSubmit={savePassword}>
            <label htmlFor="currentPassword">Current password</label>
            <input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <PasswordStrength password={newPassword} />
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <button
              type="submit"
              disabled={savingPassword || !currentPassword || !isPasswordValid(newPassword) || !confirmPassword}
              style={{ marginTop: 12 }}
            >
              {savingPassword ? 'Saving…' : 'Update password'}
            </button>
          </form>
          {passwordMessage && <p className="muted">{passwordMessage}</p>}
          {passwordError && <p className="error">{passwordError}</p>}
        </div>
      </div>
    </div>
  );
}

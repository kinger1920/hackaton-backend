import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardHat, ArrowRight } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import '@frontend/src/index.css';

export const Login: React.FC = () => {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      localStorage.setItem('userName', name.trim());
      navigate('/dashboard');
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--color-slate-900)',
        padding: '20px'
      }}
    >
      {/* Top right language switcher on login page */}
      <div style={{ position: 'fixed', top: '20px', right: '24px', zIndex: 100 }}>
        <LanguageSwitcher />
      </div>
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
          maxWidth: '400px',
          padding: '36px 32px',
          boxShadow: 'var(--shadow-xl)'
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-xl)',
            backgroundColor: 'var(--color-primary-light)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '18px'
          }}
        >
          <HardHat size={32} color="var(--color-primary)" />
        </div>

        <h1
          style={{
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--text-main)',
            margin: '0 0 6px 0',
            textAlign: 'center'
          }}
        >
          AI Bauleiter Assistent
        </h1>
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-muted)',
            margin: '0 0 24px 0',
            textAlign: 'center'
          }}
        >
          {t('login_subtitle')}
        </p>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label htmlFor="nameInput" className="form-label">
            {t('login_name_label')}
          </label>
          <input
            id="nameInput"
            className="form-input"
            type="text"
            placeholder="z. B. Max Mustermann"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '13px' }}>
          <span>{t('login_btn')}</span>
          <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
};

export default Login;

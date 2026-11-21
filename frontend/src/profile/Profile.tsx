import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  HardHat,
  MapPin,
  Briefcase,
  CheckCircle2,
  Save,
  RotateCcw,
  Plus
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import '@frontend/src/index.css';
import './Profile.css';

interface UserProfileData {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  permissions: {
    dailyReports: boolean;
    vobLetters: boolean;
    defectNotices: boolean;
    claims: boolean;
  };
  projectName: string;
  projectNumber: string;
  projectPhase: string;
  client: string;
  siteAddress: string;
  officeLocation: string;
  workplaceType: string;
}

const DEFAULT_PROFILE: UserProfileData = {
  fullName: 'Max Mustermann',
  email: 'm.mustermann@bau-ag.de',
  phone: '+49 170 1234567',
  company: 'Baupartner AG & Co. KG',
  role: 'Bauleiter',
  permissions: {
    dailyReports: true,
    vobLetters: true,
    defectNotices: true,
    claims: false
  },
  projectName: 'Neubau Schulzentrum Nord (Haus B & C)',
  projectNumber: 'PRJ-2026-084',
  projectPhase: 'Rohbau & TGA Vorbereitung',
  client: 'Städtisches Hochbauamt Berlin-Mitte',
  siteAddress: 'Berliner Str. 42, 10115 Berlin',
  officeLocation: 'Niederlassung Berlin-Brandenburg',
  workplaceType: 'Baustellencontainer vor Ort'
};

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { projects, activeProject, activeProjectId, setActiveProjectId } = useProjects();

  const [profile, setProfile] = useState<UserProfileData>(DEFAULT_PROFILE);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('userProfile');
    const existingName = localStorage.getItem('userName');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setProfile({
          ...parsed,
          projectName: activeProject.name,
          projectNumber: activeProject.number,
          client: activeProject.client,
          projectPhase: activeProject.phase,
          siteAddress: activeProject.location
        });
      } catch {
        // fallback
      }
    } else {
      setProfile((prev) => ({
        ...prev,
        fullName: existingName || prev.fullName,
        projectName: activeProject.name,
        projectNumber: activeProject.number,
        client: activeProject.client,
        projectPhase: activeProject.phase,
        siteAddress: activeProject.location
      }));
    }
  }, [activeProject]);

  const handleChange = (field: keyof UserProfileData, value: any) => {
    setProfile((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleProjectDropdownChange = (projectId: string) => {
    setActiveProjectId(projectId);
    const selected = projects.find((p) => p.id === projectId);
    if (selected) {
      setProfile((prev) => ({
        ...prev,
        projectName: selected.name,
        projectNumber: selected.number,
        client: selected.client,
        projectPhase: selected.phase,
        siteAddress: selected.location
      }));
    }
  };

  const handlePermissionChange = (permKey: keyof UserProfileData['permissions']) => {
    setProfile((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permKey]: !prev.permissions[permKey]
      }
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('userProfile', JSON.stringify(profile));
    if (profile.fullName.trim()) {
      localStorage.setItem('userName', profile.fullName.trim());
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
    }, 3000);
  };

  const handleReset = () => {
    if (window.confirm('Möchten Sie das Profil auf die Standardwerte zurücksetzen?')) {
      const resetData = {
        ...DEFAULT_PROFILE,
        projectName: activeProject.name,
        projectNumber: activeProject.number,
        client: activeProject.client,
        projectPhase: activeProject.phase,
        siteAddress: activeProject.location
      };
      setProfile(resetData);
      localStorage.setItem('userProfile', JSON.stringify(resetData));
      localStorage.setItem('userName', resetData.fullName);
    }
  };

  return (
    <div className="profile-container">
      <div className="profile-wrapper">
        {/* Success Toast */}
        {savedSuccess && (
          <div className="toast-success">
            <CheckCircle2 size={18} />
            <span>Profil erfolgreich gespeichert!</span>
          </div>
        )}

        {/* Hero Card */}
        <div className="profile-hero-card">
          <div className="profile-avatar-large">
            {profile.fullName ? profile.fullName.charAt(0).toUpperCase() : 'B'}
          </div>
          <div className="profile-hero-info">
            <h1 className="profile-hero-name">{profile.fullName || 'Bauleiter Profil'}</h1>
            <div className="profile-hero-role">
              <HardHat size={16} />
              <span>{profile.role} • {profile.company}</span>
            </div>
            <div className="profile-hero-tags">
              <div className="profile-hero-tag">
                <Briefcase size={14} />
                <span>{activeProject.name}</span>
              </div>
              <div className="profile-hero-tag">
                <MapPin size={14} />
                <span>{profile.workplaceType}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Section 1: Personendaten */}
          <div className="profile-section-card">
            <div className="section-title-wrap">
              <div className="section-icon" style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                <User size={20} />
              </div>
              <div>
                <h2 className="section-title">{t('prof_sec_personal')}</h2>
                <p className="section-desc">Ihre Kontaktdaten für Bautagesberichte und Korrespondenz</p>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="fullName">
                  Vor- & Nachname *
                </label>
                <input
                  id="fullName"
                  className="form-input"
                  type="text"
                  required
                  value={profile.fullName}
                  onChange={(e) => handleChange('fullName', e.target.value)}
                  placeholder="z. B. Max Mustermann"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="company">
                  Unternehmen / Baufirma *
                </label>
                <input
                  id="company"
                  className="form-input"
                  type="text"
                  required
                  value={profile.company}
                  onChange={(e) => handleChange('company', e.target.value)}
                  placeholder="z. B. Baupartner AG"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="email">
                  E-Mail-Adresse *
                </label>
                <input
                  id="email"
                  className="form-input"
                  type="email"
                  required
                  value={profile.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="name@bau-unternehmen.de"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="phone">
                  Mobilfunk / Baustellentelefon
                </label>
                <input
                  id="phone"
                  className="form-input"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="+49 170 1234567"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Rolle & Befugnisse */}
          <div className="profile-section-card">
            <div className="section-title-wrap">
              <div className="section-icon" style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
                <HardHat size={20} />
              </div>
              <div>
                <h2 className="section-title">{t('prof_sec_role')}</h2>
                <p className="section-desc">Ihre Funktion im Bauprojekt und Freigabeberechtigungen</p>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="role">
                  Rolle auf der Baustelle
                </label>
                <select
                  id="role"
                  className="form-input"
                  value={profile.role}
                  onChange={(e) => handleChange('role', e.target.value)}
                >
                  <option value="Bauleiter">Bauleiter</option>
                  <option value="Oberbauleiter">Oberbauleiter</option>
                  <option value="Projektleiter">Projektleiter</option>
                  <option value="Polier">Polier / Vorarbeiter</option>
                  <option value="SiGeKo">SiGeKo (Sicherheits- & Gesundheitsschutzkoordinator)</option>
                  <option value="Technischer Einkäufer">Technischer Einkäufer / Kalkulator</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Freigaberechte & Befugnisse
                </label>
                <div className="checkbox-group">
                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={profile.permissions.dailyReports}
                      onChange={() => handlePermissionChange('dailyReports')}
                    />
                    <span>Bautagesberichte freigeben & signieren</span>
                  </label>

                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={profile.permissions.vobLetters}
                      onChange={() => handlePermissionChange('vobLetters')}
                    />
                    <span>VOB-Schriftverkehr zeichnen (Behinderungs- & Bedenkenanzeigen)</span>
                  </label>

                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={profile.permissions.defectNotices}
                      onChange={() => handlePermissionChange('defectNotices')}
                    />
                    <span>Mängelrügen an Subunternehmer versenden</span>
                  </label>

                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={profile.permissions.claims}
                      onChange={() => handlePermissionChange('claims')}
                    />
                    <span>Mehrkostenanmeldungen & Nachtragsprüfungen autorisieren</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Derzeitiges Projekt (mit Dropdown-Auswahl aller angelegten Bauprojekte) */}
          <div className="profile-section-card">
            <div className="section-title-wrap">
              <div className="section-icon" style={{ backgroundColor: '#f0fdf4', color: '#16a34a' }}>
                <Briefcase size={20} />
              </div>
              <div>
                <h2 className="section-title">{t('hdr_active_project')}</h2>
                <p className="section-desc">Wählen Sie das Projekt einfach aus der Liste Ihrer Bauprojekte aus</p>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label" htmlFor="projectSelect">
                    Bauprojekt auswählen (aus angelegten Projekten) *
                  </label>
                  <button
                    type="button"
                    onClick={() => navigate('/projects')}
                    style={{
                      fontSize: '13px',
                      color: 'var(--color-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 0
                    }}
                  >
                    <Plus size={14} />
                    <span>Neues Projekt anlegen</span>
                  </button>
                </div>

                <select
                  id="projectSelect"
                  className="form-input"
                  value={activeProjectId}
                  onChange={(e) => handleProjectDropdownChange(e.target.value)}
                  style={{
                    fontWeight: 600,
                    fontSize: '15px',
                    borderColor: 'var(--color-primary-border)',
                    backgroundColor: 'var(--color-primary-light)'
                  }}
                >
                  {projects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.name} ({proj.number}) — {proj.phase}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="projectNumber">
                  Projekt- / Baustellennummer
                </label>
                <input
                  id="projectNumber"
                  className="form-input"
                  type="text"
                  readOnly
                  value={activeProject.number}
                  style={{ backgroundColor: 'var(--color-slate-100)', color: 'var(--color-slate-700)' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="projectPhase">
                  Aktuelle Bauphase
                </label>
                <input
                  id="projectPhase"
                  className="form-input"
                  type="text"
                  readOnly
                  value={activeProject.phase}
                  style={{ backgroundColor: 'var(--color-slate-100)', color: 'var(--color-slate-700)' }}
                />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" htmlFor="client">
                  Bauherr / Auftraggeber
                </label>
                <input
                  id="client"
                  className="form-input"
                  type="text"
                  readOnly
                  value={activeProject.client}
                  style={{ backgroundColor: 'var(--color-slate-100)', color: 'var(--color-slate-700)' }}
                />
              </div>
            </div>
          </div>

          {/* Section 4: Einsatzort & Arbeitsstätte */}
          <div className="profile-section-card">
            <div className="section-title-wrap">
              <div className="section-icon" style={{ backgroundColor: '#fdf2f8', color: '#db2777' }}>
                <MapPin size={20} />
              </div>
              <div>
                <h2 className="section-title">{t('prof_sec_location')}</h2>
                <p className="section-desc">Standort der Baustelle und primärer Arbeitsplatz</p>
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label" htmlFor="siteAddress">
                  Baustellenadresse (Einsatzort)
                </label>
                <input
                  id="siteAddress"
                  className="form-input"
                  type="text"
                  readOnly
                  value={activeProject.location}
                  style={{ backgroundColor: 'var(--color-slate-100)', color: 'var(--color-slate-700)' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="officeLocation">
                  Zugehörige Niederlassung
                </label>
                <input
                  id="officeLocation"
                  className="form-input"
                  type="text"
                  value={profile.officeLocation}
                  onChange={(e) => handleChange('officeLocation', e.target.value)}
                  placeholder="z. B. NL Berlin-Brandenburg"
                />
              </div>

              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" htmlFor="workplaceType">
                  Primärer Arbeitsplatztyp
                </label>
                <select
                  id="workplaceType"
                  className="form-input"
                  value={profile.workplaceType}
                  onChange={(e) => handleChange('workplaceType', e.target.value)}
                >
                  <option value="Baustellencontainer vor Ort">Baustellencontainer vor Ort</option>
                  <option value="Hybrid (Baustelle & Niederlassung)">Hybrid (Baustelle & Niederlassung)</option>
                  <option value="Niederlassungs-Büro">Niederlassungs-Büro</option>
                  <option value="Mobiles Arbeiten / Home-Office">Mobiles Arbeiten / Home-Office</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="profile-actions-bar">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleReset}
            >
              <RotateCcw size={16} />
              <span>Standardwerte</span>
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ padding: '12px 24px', fontSize: '15px' }}
            >
              <Save size={18} />
              <span>{t('prof_btn_save')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Profile;

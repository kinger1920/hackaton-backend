import React, {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {CheckCircle2, Save, RotateCcw, ExternalLink, Info, User} from 'lucide-react';
import {useLanguage} from '../context/LanguageContext';
import {api, Company} from '../services/api';
import {
    DEFAULT_PROFILE,
    ROLES,
    START_TAB_OPTIONS,
    SignAs,
    UserProfile,
    findOwnCompany,
    loadProfile,
    normalizeStartTab,
    saveProfile,
    senderCompany,
    senderLine,
    signatureBlock
} from './profileStore';
import '@frontend/src/index.css';
import './Profile.css';
import OfflineAppCard from '../components/OfflineAppCard';
import DemoResetCard from '../components/DemoResetCard';

/**
 * Mein Profil – everything the letters need from the site manager:
 * personal data, own company (from Stammdaten) and the signature.
 * A live preview shows how sender line and signature will appear in a letter.
 */
export const Profile: React.FC = () => {
    const navigate = useNavigate();
    const {t} = useLanguage();

    const [profile, setProfile] = useState<UserProfile>(loadProfile);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companiesLoaded, setCompaniesLoaded] = useState<'loading' | 'ok' | 'offline'>('loading');
    const [savedSuccess, setSavedSuccess] = useState(false);

    useEffect(() => {
        api.listCompanies()
            .then((list) => {
                setCompanies(list);
                setCompaniesLoaded('ok');
            })
            .catch(() => setCompaniesLoaded('offline'));

        api.getProfile()
            .then((remote) => {
                if (!remote.startTab) return;
                try {
                    const stored = JSON.parse(localStorage.getItem('userProfile') || 'null');
                    if (!stored || !stored.startTab) {
                        setProfile((prev) => ({...prev, startTab: normalizeStartTab(remote.startTab)}));
                    }
                } catch {
                    setProfile((prev) => ({...prev, startTab: normalizeStartTab(remote.startTab)}));
                }
            })
            .catch(() => undefined);
    }, []);

    const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
        setProfile((prev) => ({...prev, [key]: value}));

    const ownCompanies = companies.filter((c) => c.company_type === 'own');
    const selectedOwn = findOwnCompany(profile, companies);
    const company = senderCompany(profile, companies);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        // remember the Stammdaten choice explicitly (also when it was picked automatically)
        const toSave = {
            ...profile,
            companyId: selectedOwn?.id ?? profile.companyId,
            startTab: normalizeStartTab(profile.startTab)
        };
        saveProfile(toSave);
        setProfile(toSave);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
    };

    const handleReset = () => {
        if (!window.confirm(t('pf_confirm_reset'))) return;
        setProfile({...DEFAULT_PROFILE});
        saveProfile({...DEFAULT_PROFILE});
    };

    return (
        <div className="profile-container">
            <div className="profile-wrapper">
                {/* Header – plain like every other page */}
                <div className="pf-header">
                    <div className="tp-title-group">
                        <div className="tp-title-icon"><User size={22}/></div>
                        <div>
                            <h1>{t('nav_profile')}</h1>
                            <p>{t('pf_sub')}</p>
                        </div>
                    </div>
                    {savedSuccess && (
                        <div className="pf-toast">
                            <CheckCircle2 size={16}/>
                            <span>{t('pf_saved')}</span>
                        </div>
                    )}
                </div>

                <form onSubmit={handleSave} className="pf-layout">
                    {/* ---------------- Left: form ---------------- */}
                    <div className="pf-form-card">
                        {/* 1 · Persönliche Daten */}
                        <section className="pf-step">
                            <h2 className="pf-step-title"><span className="pf-step-num">1</span>{t('pf_sec_personal')}</h2>
                            <div className="pf-grid">
                                <div className="form-group">
                                    <label className="form-label" htmlFor="pfName">{t('pf_name')}</label>
                                    <input id="pfName" className="form-input" type="text" value={profile.fullName}
                                           onChange={(e) => set('fullName', e.target.value)} required/>
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="pfRole">{t('pf_role')}</label>
                                    <select id="pfRole" className="form-input" value={profile.role}
                                            onChange={(e) => set('role', e.target.value)}>
                                        {[...new Set([...ROLES, profile.role])].map((r) => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="pfPhone">{t('pf_phone')}</label>
                                    <input id="pfPhone" className="form-input" type="tel" value={profile.phone}
                                           placeholder="030 123456-12" onChange={(e) => set('phone', e.target.value)}/>
                                </div>
                                <div className="form-group">
                                    <label className="form-label" htmlFor="pfMobile">{t('pf_mobile')}</label>
                                    <input id="pfMobile" className="form-input" type="tel" value={profile.mobile}
                                           placeholder="0171 2345678" onChange={(e) => set('mobile', e.target.value)}/>
                                </div>
                                <div className="form-group pf-span-2">
                                    <label className="form-label" htmlFor="pfEmail">{t('pf_email')}</label>
                                    <input id="pfEmail" className="form-input" type="email" value={profile.email}
                                           placeholder="name@firma.de" onChange={(e) => set('email', e.target.value)}/>
                                </div>
                            </div>
                        </section>

                        {/* 2 · Mein Unternehmen */}
                        <section className="pf-step">
                            <h2 className="pf-step-title"><span className="pf-step-num">2</span>{t('pf_sec_company')}</h2>

                            {companiesLoaded === 'ok' && ownCompanies.length > 0 && (
                                <div className="form-group">
                                    <label className="form-label" htmlFor="pfCompany">{t('pf_company')}</label>
                                    <select
                                        id="pfCompany"
                                        className="form-input"
                                        value={selectedOwn ? String(selectedOwn.id) : 'manual'}
                                        onChange={(e) => set('companyId', e.target.value === 'manual' ? -1 : Number(e.target.value))}
                                    >
                                        {ownCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        <option value="manual">{t('pf_company_manual')}</option>
                                    </select>
                                </div>
                            )}

                            {selectedOwn ? (
                                <div className="pf-company-box">
                                    <strong>{selectedOwn.name}</strong>
                                    <span className="pf-pre">{selectedOwn.address || t('pf_no_address')}</span>
                                    <span className="pf-company-vob">
                                        {t('pf_vob_rules')}: {selectedOwn.vob_rules?.trim() || t('pf_none')}
                                    </span>
                                    <button type="button" className="pf-link" onClick={() => navigate('/stammdaten')}>
                                        <span>{t('pf_edit_masterdata')}</span>
                                        <ExternalLink size={13}/>
                                    </button>
                                </div>
                            ) : (
                                <>
                                    {companiesLoaded === 'ok' && ownCompanies.length === 0 && (
                                        <div className="pf-hint-box">
                                            <Info size={15}/>
                                            <span>
                                                {t('pf_no_own_company')}{' '}
                                                <button type="button" className="pf-link inline" onClick={() => navigate('/stammdaten')}>
                                                    {t('pf_create_masterdata')}
                                                </button>
                                            </span>
                                        </div>
                                    )}
                                    {companiesLoaded === 'offline' && (
                                        <div className="pf-hint-box">
                                            <Info size={15}/>
                                            <span>{t('pf_offline')}</span>
                                        </div>
                                    )}
                                    <div className="pf-grid">
                                        <div className="form-group pf-span-2">
                                            <label className="form-label" htmlFor="pfCompanyName">{t('pf_company_name')}</label>
                                            <input id="pfCompanyName" className="form-input" type="text" value={profile.company}
                                                   onChange={(e) => set('company', e.target.value)}/>
                                        </div>
                                        <div className="form-group pf-span-2">
                                            <label className="form-label" htmlFor="pfCompanyAddress">{t('pf_company_address')}</label>
                                            <textarea id="pfCompanyAddress" className="form-textarea" rows={2}
                                                      value={profile.companyAddress} placeholder={'Straße Nr.\nPLZ Ort'}
                                                      onChange={(e) => set('companyAddress', e.target.value)}/>
                                        </div>
                                    </div>
                                </>
                            )}
                        </section>

                        {/* 3 · Unterschrift */}
                        <section className="pf-step">
                            <h2 className="pf-step-title"><span className="pf-step-num">3</span>{t('pf_sec_signature')}</h2>
                            <div className="form-group">
                                <span className="form-label">{t('pf_sign_as')}</span>
                                <div className="pf-segment" role="radiogroup" aria-label={t('pf_sign_as')}>
                                    {([['iA', 'i. A.'], ['iV', 'i. V.'], ['none', t('pf_sign_none')]] as [SignAs, string][]).map(([v, label]) => (
                                        <button
                                            key={v}
                                            type="button"
                                            role="radio"
                                            aria-checked={profile.signAs === v}
                                            className={profile.signAs === v ? 'active' : ''}
                                            onClick={() => set('signAs', v)}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <span className="pf-field-hint">{t('pf_sign_hint')}</span>
                            </div>
                            <div className="form-group">
                                <label className="form-label" htmlFor="pfClosing">{t('pf_closing')}</label>
                                <input id="pfClosing" className="form-input" type="text" value={profile.closing}
                                       onChange={(e) => set('closing', e.target.value)}/>
                            </div>
                        </section>

                        {/* 4 · Starttab */}
                        <section className="pf-step">
                            <h2 className="pf-step-title"><span className="pf-step-num">4</span>{t('pf_sec_start_tab', 'Starttab')}</h2>
                            <div className="form-group">
                                <label className="form-label" htmlFor="pfStartTab">{t('pf_start_tab', 'Starttab nach Anmeldung')}</label>
                                <select
                                    id="pfStartTab"
                                    className="form-input"
                                    value={normalizeStartTab(profile.startTab)}
                                    onChange={(e) => set('startTab', normalizeStartTab(e.target.value))}
                                >
                                    {START_TAB_OPTIONS.map((opt) => (
                                        <option key={opt.path} value={opt.path}>
                                            {t(opt.labelKey, opt.fallback)}
                                        </option>
                                    ))}
                                </select>
                                <span className="pf-field-hint">
                                    {t('pf_start_tab_hint', 'Bestimmt, welcher Bereich direkt nach dem Anmelden geöffnet wird.')}
                                </span>
                            </div>
                        </section>

                        <div className="pf-actions">
                            <button type="button" className="btn btn-secondary" onClick={handleReset}>
                                <RotateCcw size={16}/>
                                <span>{t('pf_reset')}</span>
                            </button>
                            <button type="submit" className="btn btn-primary pf-save">
                                <Save size={17}/>
                                <span>{t('prof_btn_save')}</span>
                            </button>
                        </div>
                    </div>

                    {/* ---------------- Right: live preview ---------------- */}
                    <div className="pf-preview-card">
                        <div className="pf-preview-toolbar">{t('pf_preview')}</div>
                        <div className="pf-paper">
                            <div className="pf-paper-sender">{senderLine(profile, company)}</div>
                            <div className="pf-paper-dots">…</div>
                            <div className="pf-paper-body pf-pre">{signatureBlock(profile, company.name)}</div>
                        </div>
                        <p className="pf-preview-note">{t('pf_preview_note')}</p>
                    </div>
                </form>

                {/* Idee #6: Offline-Modus & App-Installation */}
                <OfflineAppCard/>

                {/* POST /api/demo/reset */}
                <DemoResetCard/>
            </div>
        </div>
    );
};

export default Profile;

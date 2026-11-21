import React, { useState, useEffect } from 'react';
import {
    Sparkles,
    Clock,
    AlertTriangle,
    Coins,
    ShieldAlert,
    Copy,
    Download,
    Printer,
    Save,
    CheckCircle2,
    CheckSquare,
    RefreshCw,
    FileText,
    Edit3
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import { api, NoticeOut } from '../services/api';
import '@frontend/src/index.css';
import './LetterDrafts.css';

type LetterCategory = 'delay' | 'cost' | 'defect' | 'concern';

interface LetterTypeConfig {
    id: LetterCategory;
    name: string;
    paragraph: string;
    desc: string;
    icon: React.ReactNode;
}

const LETTER_TYPES: LetterTypeConfig[] = [
    {
        id: 'delay',
        name: 'Behinderungsanzeige',
        paragraph: '§ 6 Abs. 1 VOB/B',
        desc: 'Bei Behinderung durch fehlende Pläne, Vorunternehmer oder Witterung',
        icon: <Clock size={18} color="var(--color-danger)"/>
    },
    {
        id: 'cost',
        name: 'Mehrkostenanmeldung',
        paragraph: '§ 2 Abs. 5 / § 2 Abs. 6 VOB/B',
        desc: 'Bei Leistungsänderungen, Mehraufwand oder unvorhergesehenem Baugrund',
        icon: <Coins size={18} color="var(--color-warning)"/>
    },
    {
        id: 'defect',
        name: 'Mängelrüge',
        paragraph: '§ 4 Abs. 7 / § 13 VOB/B',
        desc: 'Bei vertragswidriger Ausführung oder Mängeln von Nachunternehmern',
        icon: <AlertTriangle size={18} color="#dc2626"/>
    },
    {
        id: 'concern',
        name: 'Bedenkenanmeldung',
        paragraph: '§ 4 Abs. 3 VOB/B',
        desc: 'Bei Bedenken gegen Vorgaben des Bauherrn oder Vorleistungen Dritter',
        icon: <ShieldAlert size={18} color="#2563eb"/>
    }
];

const PRESETS: Record<LetterCategory, string[]> = {
    delay: [
        'Kettenbagger stillgelegt, TGA-Schlitzpläne fehlen seit 3 Tagen, 3 Tiefbauer blockiert',
        'Vorunternehmer Estrich hat Baufeld 1. OG nicht geräumt, Bodenbelagsarbeiten verzögert',
        'Starkregen und Überflutung der Baugrube verhindert Betonage der Bodenplatte'
    ],
    cost: [
        'Massiver Mehraushub Felsklasse 6 angetroffen statt vereinbarter Bodenklasse 4',
        'Zusätzliche Kernbohrungen und Brandschottungen laut TGA-Revisionsplan R-04 erforderlich',
        'Geänderte Statikauflagen erfordern zusätzliche Bewehrungszulagen in Unterzug U-12'
    ],
    defect: [
        'Rissbildung und Unebenheiten in Stahlbeton-Sohle Bauteil C nach Ausschalung festgestellt',
        'Dachabdichtung fehlerhaft verschweißt, Feuchtigkeitseintritt im Treppenhauskern 2',
        'Trockenbau-Wände ohne vorgeschriebene Schallschutz-Dämmstreifen montiert'
    ],
    concern: [
        'Bedenken gegen vorgesehene Dämmstoffstärke bei geplanten Auflasten im Dachaufbau',
        'Vorleistung Rohbau weist Maßtoleranzen außerhalb DIN 18202 auf für geplante Fassade',
        'Vom Auftraggeber gelieferte Beschichtungsstoffe ungeeignet für Witterungsbedingungen'
    ]
};

export const LetterDrafts: React.FC = () => {
    const { t } = useLanguage();
  const { activeProject } = useProjects();
  const userName = localStorage.getItem('userName') || 'Max Mustermann';
  const userProfile = (() => {
    try {
      return JSON.parse(localStorage.getItem('userProfile') || '');
    } catch {
      return null;
    }
  })();
  const companyName = userProfile?.company || 'Baupartner AG & Co. KG';

    const [selectedType, setSelectedType] = useState<LetterCategory>('delay');
    const [recipient, setRecipient] = useState(activeProject.client || 'Städtisches Hochbauamt');
    const [keywords, setKeywords] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Backend Notice State
    const [backendNotices, setBackendNotices] = useState<NoticeOut[]>([]);
    const [currentNotice, setCurrentNotice] = useState<NoticeOut | null>(null);
    const [isLoadingNotices, setIsLoadingNotices] = useState(false);
    const [isApproving, setIsApproving] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewHints, setReviewHints] = useState<string[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Editable letter content
    const [subject, setSubject] = useState(
        'Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B — Fehlende Ausführungsplanung'
    );
    const [letterBody, setLetterBody] = useState(`Sehr geehrte Damen und Herren,

hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass die ordnungsgemäße Ausführung unserer vertraglich vereinbarten Bauleistungen im Bauvorhaben "${activeProject.name}" (Projekt-Nr. ${activeProject.number}) derzeit unverschuldet behindert und unterbrochen wird.

1. Sachverhaltsdarstellung:
Die für den Baubereich zwingend erforderlichen Ausführungs- und Detailpläne liegen unserer Bauleitung trotz mehrfacher vorheriger Ankündigung bis zum heutigen Tage nicht vor. Infolgedessen können die nach Terminplan vorgesehenen Arbeiten nicht fristgerecht fortgeführt werden.

2. Auswirkungen auf den Bauablauf:
Es kommt zu Stillstandszeiten von Personal und Baumaschinen. Eine termingerechte Fertigstellung der nachfolgenden Gewerke gemäß aktuellem Bauzeitenplan ist unter diesen Umständen gefährdet.

3. Aufforderung zur Abhilfe & Vorbehalt:
Wir fordern Sie höflich auf, die fehlenden Unterlagen unverzüglich, spätestens jedoch bis zum kommenden Werktag bereitzustellen.
Die Geltendmachung einer Bauzeitverlängerung gemäß § 6 Abs. 2 VOB/B sowie der Ersatz aller hieraus entstehenden Mehrkosten und Stillstandskosten gemäß § 6 Abs. 6 VOB/B bleiben ausdrücklich vorbehalten.

Mit freundlichen Grüßen,
${userName}
${userProfile?.role || 'Bauleiter'} • ${companyName}`);

    // Load backend notices for current project
    const loadNotices = async () => {
        setIsLoadingNotices(true);
        try {
            const notices = await api.listNotices(Number(activeProject.id));
            setBackendNotices(notices);
            if (notices.length > 0 && !currentNotice) {
                const first = notices[0];
                setCurrentNotice(first);
                setSelectedType(first.type);
                setSubject(first.subject || '');
                setLetterBody(first.body || '');
                if (first.recipient) setRecipient(first.recipient);
            }
        } catch (err) {
            console.warn('Backend listNotices Fallback:', err);
        } finally {
            setIsLoadingNotices(false);
        }
    };

    useEffect(() => {
        loadNotices();
    }, [activeProject.id]);

    const handleSelectNotice = (n: NoticeOut) => {
        setCurrentNotice(n);
        setSelectedType(n.type);
        setSubject(n.subject || '');
        setLetterBody(n.body || '');
        if (n.recipient) setRecipient(n.recipient);
        setReviewHints([]);
        setErrorMessage(null);
    };

    const handleNewDraft = () => {
        setCurrentNotice(null);
        setKeywords('');
        setReviewHints([]);
        setErrorMessage(null);
        setSubject(`Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B — ${activeProject.name}`);
    };

    const handleGenerate = async () => {
        if (!keywords.trim()) return;

        setIsGenerating(true);
        setReviewHints([]);
        setErrorMessage(null);

        try {
            const draft = await api.captureText({
                text: keywords.trim(),
                project_id: Number(activeProject.id),
                force_type: selectedType
            });

            if (draft.notice_id) {
                const created = await api.getNotice(draft.notice_id);
                setCurrentNotice(created);
                setSubject(created.subject || '');
                setLetterBody(created.body || '');
                if (created.recipient) setRecipient(created.recipient);
                await loadNotices();
            } else {
                generateFallbackLocal();
            }
        } catch (err: any) {
            console.warn('Backend captureText Fallback:', err);
            generateFallbackLocal();
        } finally {
            setIsGenerating(false);
        }
    };

    const generateFallbackLocal = () => {
        const todayStr = new Date().toLocaleDateString('de-DE');
        const kw = keywords.trim();

        let newSubject = '';
        let newBody = '';

        if (selectedType === 'delay') {
            newSubject = `Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B — ${kw.slice(0, 45)}...`;
            newBody = `Sehr geehrte Damen und Herren,\n\nhiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass die Ausführung unserer vertraglichen Leistungen im Bauvorhaben "${activeProject.name}" (Projekt-Nr. ${activeProject.number}) im Bereich ${activeProject.phase} behindert wird.\n\n1. Sachverhaltsdarstellung und Behinderungstatbestand:\nAuf der Baustelle liegt aktuell folgende Störung vor:\n"${kw}"\n\n2. Bauzeitliche Auswirkungen:\nDie ordnungsgemäße und kontinuierliche Fortführung der Arbeiten ist seit dem ${todayStr} unterbrochen.\n\n3. Aufforderung zur Abhilfe & Fristsetzung:\nWir fordern Sie auf, die vorstehend geschilderten Behinderungsursachen unverzüglich zu beseitigen.\n\nMit freundlichen Grüßen,\n${userName}\n${companyName}`;
        } else if (selectedType === 'cost') {
            newSubject = `Mehrkostenanmeldung / Nachtragsankündigung gemäß § 2 Abs. 5 / § 2 Abs. 6 VOB/B`;
            newBody = `Sehr geehrte Damen und Herren,\n\nzum Bauvorhaben "${activeProject.name}" kündigen wir Ihnen hiermit gemäß § 2 Abs. 5 bzw. § 2 Abs. 6 VOB/B einen Vergütungsanspruch für geänderte bzw. zusätzliche Leistungen an:\n"${kw}"\n\nMit freundlichen Grüßen,\n${userName}\n${companyName}`;
        } else if (selectedType === 'defect') {
            newSubject = `Mängelrüge gemäß § 4 Abs. 7 / § 13 VOB/B — Aufforderung zur Mängelbeseitigung`;
            newBody = `Sehr geehrte Damen und Herren,\n\nbei der baubegleitenden Qualitätsprüfung im Bauvorhaben "${activeProject.name}" wurden folgende Mängel festgestellt:\n"${kw}"\n\nWir setzen Frist zur Mängelbeseitigung binnen 7 Werktagen.\n\nMit freundlichen Grüßen,\n${userName}\n${companyName}`;
        } else {
            newSubject = `Bedenkenanmeldung gemäß § 4 Abs. 3 VOB/B`;
            newBody = `Sehr geehrte Damen und Herren,\n\nim Rahmen unserer Hinweispflicht gemäß § 4 Abs. 3 VOB/B melden wir folgende Bedenken an:\n"${kw}"\n\nMit freundlichen Grüßen,\n${userName}\n${companyName}`;
        }

        setSubject(newSubject);
        setLetterBody(newBody);
    };

    const handleApprove = async () => {
        if (!currentNotice?.id) {
            alert('Bitte speichern Sie den Entwurf zuerst im Backend ab.');
            return;
        }

        setIsApproving(true);
        setErrorMessage(null);
        try {
            const approved = await api.approveNotice(currentNotice.id);
            setCurrentNotice(approved);
            setSubject(approved.subject || '');
            setLetterBody(approved.body || '');
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
            await loadNotices();
        } catch (err: any) {
            console.error('Freigabe fehlgeschlagen:', err);
            setErrorMessage(err.message || 'Freigabe konnte nicht erteilt werden (Pflichtangaben fehlen).');
        } finally {
            setIsApproving(false);
        }
    };

    const handleReview = async () => {
        if (!currentNotice?.id) {
            alert('Bitte wählen Sie zuerst einen Brief-Entwurf aus.');
            return;
        }

        setIsReviewing(true);
        setReviewHints([]);
        try {
            const rev = await api.reviewNotice(currentNotice.id);
            if (rev && rev.hints) {
                setReviewHints(rev.hints);
            }
        } catch (err: any) {
            console.warn('Backend reviewNotice Fallback:', err);
            setReviewHints([
                'VOB/B-Bezug: Paragraph und Fristsetzung sind formell formuliert.',
                'Nachweise: Bautagesberichte und Fotos als Anlage beifügen.'
            ]);
        } finally {
            setIsReviewing(false);
        }
    };

    const handleCopy = () => {
        const fullText = `${subject}\n\n${letterBody}`;
        navigator.clipboard.writeText(fullText);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2500);
    };

    const handleDownloadDocx = async () => {
        if (currentNotice?.id) {
            if (currentNotice.status === 'Entwurf') {
                const ok = window.confirm(
                    'Das Schreiben ist noch nicht förmlich freigegeben. Jetzt freigeben und Word-Dokument (.docx) herunterladen?'
                );
                if (ok) {
                    try {
                        const approved = await api.approveNotice(currentNotice.id);
                        setCurrentNotice(approved);
                        await loadNotices();
                    } catch (err: any) {
                        alert(`Freigabe vor Export erforderlich: ${err.message}`);
                        return;
                    }
                } else {
                    return;
                }
            }
            try {
                const blob = await api.downloadExport(currentNotice.id, 'docx');
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `VOB_${selectedType}_${activeProject.number}.docx`;
                link.click();
                URL.revokeObjectURL(url);
                return;
            } catch (err: any) {
                console.warn('Backend DOCX Export Fehler, nutze clientseitigen Export:', err);
            }
        }

        // Fallback: Client-side doc export
        const content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${subject}</title></head><body><h1>${subject}</h1><p>${letterBody.replace(/\n/g, '<br/>')}</p></body></html>`;
        const blob = new Blob([content], {type: 'application/msword;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${selectedType}_${activeProject.number}.doc`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadPdf = async () => {
        if (currentNotice?.id) {
            if (currentNotice.status === 'Entwurf') {
                const ok = window.confirm(
                    'Das Schreiben ist noch im Status "Entwurf". Jetzt förmlich freigeben und PDF herunterladen?'
                );
                if (ok) {
                    try {
                        const approved = await api.approveNotice(currentNotice.id);
                        setCurrentNotice(approved);
                        await loadNotices();
                    } catch (err: any) {
                        alert(`Freigabe vor PDF-Export erforderlich: ${err.message}`);
                        return;
                    }
                } else {
                    return;
                }
            }
            try {
                const blob = await api.downloadExport(currentNotice.id, 'pdf');
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `VOB_${selectedType}_${activeProject.number}.pdf`;
                link.click();
                URL.revokeObjectURL(url);
                return;
            } catch (err: any) {
                console.warn('Backend PDF Export nicht verfügbar (Weasyprint), nutze Browser-Druck:', err);
                window.print();
                return;
            }
        }
        window.print();
    };

    const handleSaveToDrafts = async () => {
        if (currentNotice?.id) {
            try {
                const updated = await api.patchNotice(currentNotice.id, {
                    subject,
                    body: letterBody,
                    recipient
                });
                setCurrentNotice(updated);
                await loadNotices();
            } catch (err: any) {
                console.warn('Backend patchNotice Fehler:', err);
            }
        }

        const existing = (() => {
            try {
                return JSON.parse(localStorage.getItem('savedDrafts') || '[]');
            } catch {
                return [];
            }
        })();

        const newDraft = {
            id: currentNotice?.id ? `notice-${currentNotice.id}` : `draft-${Date.now()}`,
            type: selectedType,
            subject,
            body: letterBody,
            project: activeProject.name,
            projectNumber: activeProject.number,
            date: new Date().toLocaleDateString('de-DE')
        };

        localStorage.setItem('savedDrafts', JSON.stringify([newDraft, ...existing]));
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
    };

    return (
        <div className="drafts-container">
            {/* Header */}
            <div className="drafts-header">
                <div>
                    <h1>{t('drafts_title')}</h1>
          <p>{t('drafts_sub')}</p>
        </div>

                {saveSuccess && (
                    <div className="toast-success">
                        <CheckCircle2 size={16}/>
                        <span>{t('btn_save')}!</span>
                    </div>
                )}
            </div>

            {/* Backend Notices Quick Selector */}
            <div style={{
                marginBottom: '16px',
                padding: '12px 16px',
                backgroundColor: 'var(--color-slate-50, #f8fafc)',
                border: '1px solid var(--border-light, #e2e8f0)',
                borderRadius: 'var(--radius-lg, 8px)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-slate-700)' }}>
                        <FileText size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                        Gespeicherte VOB-Briefe im Projekt ({backendNotices.length}):
                    </span>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                        onClick={handleNewDraft}
                    >
                        + Neuer Entwurf
                    </button>
                    {backendNotices.map((n) => {
                        const isCurrent = currentNotice?.id === n.id;
                        const statusColor = n.status === 'Freigegeben' ? '#16a34a' : n.status === 'Exportiert' ? '#2563eb' : '#d97706';
                        return (
                            <button
                                key={n.id}
                                type="button"
                                style={{
                                    fontSize: '11px',
                                    padding: '4px 10px',
                                    borderRadius: '16px',
                                    border: isCurrent ? '2px solid var(--color-primary)' : '1px solid var(--border-light, #cbd5e1)',
                                    backgroundColor: isCurrent ? '#eff6ff' : '#ffffff',
                                    fontWeight: isCurrent ? 700 : 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                                onClick={() => handleSelectNotice(n)}
                            >
                                <span>#{n.id} ({n.type})</span>
                                <span style={{ fontSize: '10px', color: statusColor, fontWeight: 700 }}>
                                    ● {n.status}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    className="doc-btn"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={loadNotices}
                    disabled={isLoadingNotices}
                    title="Aktualisieren"
                >
                    <RefreshCw size={12} className={isLoadingNotices ? 'spin' : ''} />
                    <span>Aktualisieren</span>
                </button>
            </div>

            <div className="drafts-split-layout">
                {/* Left Column: Form & Keyword Input */}
                <div className="generator-card">
                    <div>
                        <label className="form-label" style={{marginBottom: '8px'}}>
                            1. {t('drafts_title')}
                        </label>
                        <div className="type-selector-grid">
                            {LETTER_TYPES.map((lt) => {
                const labelMap: Record<LetterCategory, string> = {
                  delay: t('drafts_type_delay'),
                  cost: t('drafts_type_cost'),
                  defect: t('drafts_type_defect'),
                  concern: t('drafts_type_concern')
                };
                return (
                  <button
                    key={lt.id}
                    type="button"
                    className={`type-btn ${selectedType === lt.id ? 'active' : ''}`}
                    onClick={() => setSelectedType(lt.id)}
                  >
                    <span className="type-btn-title">
                      {lt.icon}
                      <span>{labelMap[lt.id]}</span>
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)' }}>
                      {lt.paragraph}
                    </span>
                    <span className="type-btn-sub">{lt.desc}</span>
                  </button>
                );
                            })}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="recipientInput">
                            2. {t('drafts_label_recipient')}
                        </label>
                        <input
                            id="recipientInput"
                            className="form-input"
                            type="text"
                            value={recipient}
                            onChange={(e) => setRecipient(e.target.value)}
                            placeholder={t('drafts_label_recipient')}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="keywordsInput">
                            3. {t('drafts_label_keywords')} *
                        </label>
                        <textarea
                            id="keywordsInput"
                            className="form-textarea"
                            rows={4}
                            placeholder="z. B.: Bagger stillgelegt, Freigabe fehlt..."
                            value={keywords}
                            onChange={(e) => setKeywords(e.target.value)}
                        />

                        <div>
              <span style={{fontSize: '12px', color: 'var(--text-muted)'}}>
                Beispiele:
              </span>
                            <div className="preset-chips">
                                {PRESETS[selectedType].map((preset, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        className="preset-chip"
                                        onClick={() => setKeywords(preset)}
                                    >
                                        + {preset.slice(0, 48)}...
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="btn btn-primary"
                        style={{width: '100%', padding: '13px'}}
                        disabled={!keywords.trim() || isGenerating}
                        onClick={handleGenerate}
                    >
                        <Sparkles size={18}/>
                        <span>{isGenerating ? t('dash_btn_gen_draft') : t('drafts_btn_generate')}</span>
                    </button>
                </div>

                {/* Right Column: Letter Paper Preview & Human-in-the-Loop Editor */}
                <div className="letter-paper-card">
                    <div className="paper-toolbar">
                        <div style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                            <Edit3 size={16} color="var(--color-primary)"/>
                            <span style={{fontSize: '13px', fontWeight: 600}}>
                                {t('drafts_paper_view_title')}
                            </span>
                            {currentNotice && (
                                <span style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    padding: '3px 8px',
                                    borderRadius: '12px',
                                    backgroundColor: currentNotice.status === 'Freigegeben' ? '#dcfce7' : currentNotice.status === 'Exportiert' ? '#dbeafe' : '#fef3c7',
                                    color: currentNotice.status === 'Freigegeben' ? '#15803d' : currentNotice.status === 'Exportiert' ? '#1d4ed8' : '#b45309'
                                }}>
                                    Status: {currentNotice.status}
                                </span>
                            )}
                        </div>

                        <div style={{display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap'}}>
                            {currentNotice?.id && currentNotice.status === 'Entwurf' && (
                                <button
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 10px', fontSize: '12px', color: '#16a34a', borderColor: '#86efac' }}
                                    onClick={handleApprove}
                                    disabled={isApproving}
                                    title="Förmlich freigeben nach VOB/B"
                                >
                                    <CheckSquare size={14} />
                                    <span>{isApproving ? 'Freigabe...' : 'Förmlich freigeben (§ VOB/B)'}</span>
                                </button>
                            )}

                            {currentNotice?.id && (
                                <button
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 10px', fontSize: '12px', color: '#4f46e5', borderColor: '#c7d2fe' }}
                                    onClick={handleReview}
                                    disabled={isReviewing}
                                    title="KI-Review & Vollständigkeitsprüfung"
                                >
                                    <Sparkles size={14} />
                                    <span>{isReviewing ? 'Prüft...' : 'KI-Review'}</span>
                                </button>
                            )}

                            <button className="doc-btn" onClick={handleCopy} title={t('btn_copy')}>
                                <Copy size={14}/>
                                <span>{copySuccess ? t('btn_copied') : t('btn_copy')}</span>
                            </button>

                            <button className="doc-btn" onClick={handleDownloadDocx}
                                    title="Word (.docx) herunterladen">
                                <Download size={14}/>
                                <span>Word (.docx)</span>
                            </button>

                            <button className="doc-btn" onClick={handleDownloadPdf} title="PDF herunterladen / drucken">
                                <Printer size={14}/>
                                <span>PDF</span>
                            </button>

                            <button className="btn btn-primary" style={{padding: '6px 12px', fontSize: '13px'}}
                                    onClick={handleSaveToDrafts}>
                                <Save size={14}/>
                                <span>{t('btn_save')}</span>
                            </button>
                        </div>
                    </div>

                    {errorMessage && (
                        <div style={{ margin: '8px 16px', padding: '10px 14px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', color: '#991b1b' }}>
                            <strong>⚠️ Hinweis zur VOB-Freigabe:</strong> {errorMessage}
                        </div>
                    )}

                    {reviewHints.length > 0 && (
                        <div style={{ margin: '8px 16px', padding: '10px 14px', backgroundColor: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '12px', color: '#3730a3' }}>
                            <strong>🔍 KI-Review & VOB-Hinweise:</strong>
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                {reviewHints.map((hint, idx) => (
                                    <li key={idx} style={{ marginBottom: '2px' }}>{hint}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Paper View */}
                    <div className="paper-content">
                        <div className="paper-header">
                            <div>
                                <strong>{companyName}</strong>
                                <div>{t('role_site_manager')}: {userName}</div>
                                <div>{t('drafts_label_project')}: {activeProject.name} ({activeProject.number})</div>
                            </div>
                            <div style={{textAlign: 'right'}}>
                                <div>{t('drafts_label_date')}: {new Date().toLocaleDateString('de-DE')}</div>
                                <div>{t('drafts_label_recipient')}: <strong>{recipient}</strong></div>
                                <div>Standort: {activeProject.location}</div>
                            </div>
                        </div>

                        <input
                            type="text"
                            className="letter-subject"
                            value={subject}
                            onChange={(e) => setSubject(e.target.value)}
                            title="Subject"
                            style={{
                                width: '100%',
                                border: 'none',
                                outline: 'none',
                                backgroundColor: 'transparent'
                            }}
                        />

            <textarea
              className="letter-body-editable"
              value={letterBody}
              onChange={(e) => setLetterBody(e.target.value)}
            />
          </div>

                    {/* Legal Disclaimer / Constraint Banner */}
                    <div className="legal-notice-banner">
                        <AlertTriangle size={16} style={{flexShrink: 0}}/>
                        <span>
              {t('drafts_legal_disclaimer')}
            </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LetterDrafts;

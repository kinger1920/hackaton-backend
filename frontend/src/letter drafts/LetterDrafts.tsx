import React, { useState } from 'react';
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
  Edit3
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
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
    icon: <Clock size={18} color="var(--color-danger)" />
  },
  {
    id: 'cost',
    name: 'Mehrkostenanmeldung',
    paragraph: '§ 2 Abs. 5 / § 2 Abs. 6 VOB/B',
    desc: 'Bei Leistungsänderungen, Mehraufwand oder unvorhergesehenem Baugrund',
    icon: <Coins size={18} color="var(--color-warning)" />
  },
  {
    id: 'defect',
    name: 'Mängelrüge',
    paragraph: '§ 4 Abs. 7 / § 13 VOB/B',
    desc: 'Bei vertragswidriger Ausführung oder Mängeln von Nachunternehmern',
    icon: <AlertTriangle size={18} color="#dc2626" />
  },
  {
    id: 'concern',
    name: 'Bedenkenanmeldung',
    paragraph: '§ 4 Abs. 3 VOB/B',
    desc: 'Bei Bedenken gegen Vorgaben des Bauherrn oder Vorleistungen Dritter',
    icon: <ShieldAlert size={18} color="#2563eb" />
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

  const handleGenerate = () => {
    if (!keywords.trim()) return;

    setIsGenerating(true);

    setTimeout(() => {
      const todayStr = new Date().toLocaleDateString('de-DE');
      const kw = keywords.trim();

      let newSubject = '';
      let newBody = '';

      if (selectedType === 'delay') {
        newSubject = `Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B — ${kw.slice(0, 45)}...`;
        newBody = `Sehr geehrte Damen und Herren,

hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass die Ausführung unserer vertraglichen Leistungen im Bauvorhaben "${activeProject.name}" (Projekt-Nr. ${activeProject.number}) im Bereich ${activeProject.phase} behindert wird.

1. Sachverhaltsdarstellung und Behinderungstatbestand:
Auf der Baustelle liegt aktuell folgende Störung vor:
"${kw}"

2. Bauzeitliche Auswirkungen:
Die ordnungsgemäße und kontinuierliche Fortführung der Arbeiten ist seit dem ${todayStr} unterbrochen. Das eingesetzte Fachpersonal sowie die Baustelleneinrichtung können im betroffenen Bauabschnitt derzeit nicht vertragsgemäß eingesetzt werden.

3. Aufforderung zur Abhilfe & Fristsetzung:
Wir fordern Sie auf, die vorstehend geschilderten Behinderungsursachen unverzüglich zu beseitigen und die Baufreiheit wiederherzustellen.

4. Rechtsfolgen & Vorbehalt:
Wir weisen darauf hin, dass sich die Ausführungsfristen gemäß § 6 Abs. 2 Nr. 1 Buchst. a VOB/B um die Dauer der Behinderung zuzüglich eines Zuschlags für die Wiederaufnahme der Arbeiten verlängern. 
Die Geltendmachung von Entschädigungs- und Mehrkostenansprüchen (u.a. Stillstandskosten, Bauzeitverlängerungskosten) gemäß § 6 Abs. 6 VOB/B sowie § 642 BGB behalten wir uns ausdrücklich vor.

Mit freundlichen Grüßen,
${userName}
${userProfile?.role || 'Bauleiter'} • ${companyName}`;
      } else if (selectedType === 'cost') {
        newSubject = `Mehrkostenanmeldung / Nachtragsankündigung gemäß § 2 Abs. 5 / § 2 Abs. 6 VOB/B`;
        newBody = `Sehr geehrte Damen und Herren,

zum Bauvorhaben "${activeProject.name}" (Projekt-Nr. ${activeProject.number}) kündigen wir Ihnen hiermit gemäß § 2 Abs. 5 bzw. § 2 Abs. 6 VOB/B einen Vergütungsanspruch für geänderte bzw. zusätzliche Leistungen an.

1. Begründung und Ursache des Mehraufwands:
Im Zuge der Ausführung im Bauabschnitt ${activeProject.phase} hat sich folgender Sachverhalt ergeben:
"${kw}"

2. Vertragliche Einordnung:
Diese Leistungen sind im ursprünglichen Leistungsverzeichnis nicht enthalten bzw. weichen von den vertraglichen Leistungsgrundlagen ab. Die Ausführung erfordert zusätzlichen Personal-, Material- und Maschineneinsatz.

3. Nachtragsangebot:
Wir werden Ihnen unverzüglich eine detaillierte Urkalkulation und ein Nachtragsangebot mit den entsprechenden Einheitspreisen zur Prüfung und Freigabe vorlegen.
Wir bitten um kurzfristige schriftliche Beauftragung vor Weiterführung der betroffenen Teilleistungen.

Mit freundlichen Grüßen,
${userName}
${userProfile?.role || 'Bauleiter'} • ${companyName}`;
      } else if (selectedType === 'defect') {
        newSubject = `Mängelrüge gemäß § 4 Abs. 7 / § 13 VOB/B — Aufforderung zur Mängelbeseitigung`;
        newBody = `Sehr geehrte Damen und Herren,

bei der laufenden baubegleitenden Qualitätsprüfung im Bauvorhaben "${activeProject.name}" wurden bei Ihren Leistungen folgende Mängel bzw. Abweichungen von den anerkannten Regeln der Technik festgestellt:

1. Festgestellte Mängel:
"${kw}"

2. Mängelrüge & Fristsetzung:
Wir fordern Sie hiermit gemäß § 4 Abs. 7 VOB/B förmlich auf, die genannten Mängel auf Ihre Kosten fachgerecht zu beseitigen.
Als Frist für die vollständige und mangelfreie Fertigstellung setzen wir Ihnen den:
${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('de-DE')} (in 7 Werktagen).

3. Androhung der Ersatzvornahme:
Sollte die Mängelbeseitigung nicht innerhalb der gesetzten Frist erfolgen, werden wir Ihnen nach Fristablauf den Auftrag für diesen Leistungsteil entziehen und die Mängel auf Ihre Kosten durch ein Drittunternehmen im Wege der Ersatzvornahme beseitigen lassen.

Mit freundlichen Grüßen,
${userName}
${userProfile?.role || 'Bauleiter'} • ${companyName}`;
      } else {
        newSubject = `Bedenkenanmeldung gemäß § 4 Abs. 3 VOB/B`;
        newBody = `Sehr geehrte Damen und Herren,

im Rahmen unserer Prüf- und Hinweispflicht gemäß § 4 Abs. 3 VOB/B melden wir Ihnen für das Bauvorhaben "${activeProject.name}" (Projekt-Nr. ${activeProject.number}) hiermit formell folgende Bedenken an:

1. Bedenkengrund:
Nach fachtechnischer Prüfung unserer Bauleitung bestehen Bedenken hinsichtlich:
"${kw}"

2. Begründung der Bedenken:
Bei unveränderter Ausführung nach den derzeitigen Vorgaben bzw. auf den vorgefundenen Vorleistungen besteht die konkrete Gefahr von Folgeschäden, Gewährleistungsrisiken und Mängeln an den nachfolgenden Gewerken.

3. Erbetene Entscheidung:
Wir bitten Sie um schnellstmögliche bauseitige Prüfung und schriftliche Weisung, wie verfahren werden soll. Bis zur Klarstellung können die betroffenen Arbeiten zur Schadensvermeidung nicht begonnen werden.

Mit freundlichen Grüßen,
${userName}
${userProfile?.role || 'Bauleiter'} • ${companyName}`;
      }

      setSubject(newSubject);
      setLetterBody(newBody);
      setIsGenerating(false);
    }, 600);
  };

  const handleCopy = () => {
    const fullText = `${subject}\n\n${letterBody}`;
    navigator.clipboard.writeText(fullText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  const handleDownloadDocx = () => {
    // Generate a Word-compatible HTML / DOC file
    const content = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${subject}</title>
<style>
body { font-family: 'Calibri', sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
h1 { font-size: 14pt; margin-bottom: 20pt; }
p { margin-bottom: 10pt; white-space: pre-wrap; }
</style>
</head>
<body>
<p><strong>Absender:</strong> ${companyName} • ${userName}</p>
<p><strong>Empfänger:</strong> ${recipient}</p>
<p><strong>Datum:</strong> ${new Date().toLocaleDateString('de-DE')}</p>
<hr/>
<h1>${subject}</h1>
<p>${letterBody.replace(/\n/g, '<br/>')}</p>
</body>
</html>`;

    const blob = new Blob([content], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedType}_${activeProject.number}_${new Date().toISOString().slice(0, 10)}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSaveToDrafts = () => {
    const existing = (() => {
      try {
        return JSON.parse(localStorage.getItem('savedDrafts') || '[]');
      } catch {
        return [];
      }
    })();

    const newDraft = {
      id: `draft-${Date.now()}`,
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
          <h1>Smart Drafts für VOB-Schriftverkehr</h1>
          <p>
            Erstellen Sie aus wenigen Stichworten rechtssichere Entwürfe für Behinderungsanzeigen, Mehrkosten, Mängelrügen & Bedenken.
          </p>
        </div>

        {saveSuccess && (
          <div className="toast-success">
            <CheckCircle2 size={16} />
            <span>Entwurf gespeichert!</span>
          </div>
        )}
      </div>

      <div className="drafts-split-layout">
        {/* Left Column: Form & Keyword Input */}
        <div className="generator-card">
          <div>
            <label className="form-label" style={{ marginBottom: '8px' }}>
              1. Art des Schreibens auswählen
            </label>
            <div className="type-selector-grid">
              {LETTER_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`type-btn ${selectedType === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedType(t.id)}
                >
                  <span className="type-btn-title">
                    {t.icon}
                    <span>{t.name}</span>
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)' }}>
                    {t.paragraph}
                  </span>
                  <span className="type-btn-sub">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="recipientInput">
              2. Empfänger (Auftraggeber / Nachunternehmer)
            </label>
            <input
              id="recipientInput"
              className="form-input"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Name des Empfängers / Firma"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="keywordsInput">
              3. Baustellen-Situation / Stichworte eingeben *
            </label>
            <textarea
              id="keywordsInput"
              className="form-textarea"
              rows={4}
              placeholder="Schildern Sie die Situation in Stichworten, z. B.: 'Bagger seit 10 Uhr stillgelegt, weil Freigabe der TGA-Durchbrüche fehlt. 3 Mann Tiefbau blockiert.'"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />

            <div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Beispiele für {LETTER_TYPES.find((t) => t.id === selectedType)?.name}:
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
            style={{ width: '100%', padding: '13px' }}
            disabled={!keywords.trim() || isGenerating}
            onClick={handleGenerate}
          >
            <Sparkles size={18} />
            <span>{isGenerating ? 'KI generiert VOB-Entwurf...' : 'Schreiben aus Stichworten generieren'}</span>
          </button>
        </div>

        {/* Right Column: Letter Paper Preview & Human-in-the-Loop Editor */}
        <div className="letter-paper-card">
          <div className="paper-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Edit3 size={16} color="var(--color-primary)" />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>
                Interaktiver Entwurf (Human-in-the-Loop)
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="doc-btn" onClick={handleCopy} title="In die Zwischenablage kopieren">
                <Copy size={14} />
                <span>{copySuccess ? 'Kopiert!' : 'Kopieren'}</span>
              </button>

              <button className="doc-btn" onClick={handleDownloadDocx} title="Als Word (.doc) herunterladen">
                <Download size={14} />
                <span>Word</span>
              </button>

              <button className="doc-btn" onClick={handlePrint} title="Drucken / PDF erzeugen">
                <Printer size={14} />
                <span>Drucken</span>
              </button>

              <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={handleSaveToDrafts}>
                <Save size={14} />
                <span>Speichern</span>
              </button>
            </div>
          </div>

          {/* Paper View */}
          <div className="paper-content">
            <div className="paper-header">
              <div>
                <strong>{companyName}</strong>
                <div>Bauleitung: {userName}</div>
                <div>Projekt: {activeProject.name} ({activeProject.number})</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div>Datum: {new Date().toLocaleDateString('de-DE')}</div>
                <div>Empfänger: <strong>{recipient}</strong></div>
                <div>Einsatzort: {activeProject.location}</div>
              </div>
            </div>

            <input
              type="text"
              className="letter-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              title="Klicken zum Anpassen des Betreffs"
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
              title="Sie können diesen Text vor Versand direkt anpassen"
            />
          </div>

          {/* Legal Disclaimer / Constraint Banner */}
          <div className="legal-notice-banner">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
              <strong>Rechtlicher Hinweis:</strong> Dies ist ein KI-generierter Entwurf zur Arbeitserleichterung und stellt keine Rechtsberatung dar. Prüfung und Freigabe liegen vor Versand eigenverantwortlich bei der Bauleitung.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LetterDrafts;

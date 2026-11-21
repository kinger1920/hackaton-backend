import React, {useEffect, useMemo, useRef, useState} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {
    Clock,
    AlertTriangle,
    ShieldAlert,
    Coins,
    Copy,
    Download,
    Printer,
    Save,
    CheckCircle2,
    CheckSquare,
    Edit3,
    Sparkles,
    PenLine,
    Wand2,
    Search,
    FolderOpen,
    Trash2,
    Info,
    RotateCcw,
    FileText,
    ArrowUp,
    ArrowDown,
    ArrowUpDown,
    RefreshCw,
    Lock,
    CloudOff,
    Cloud,
    X
} from 'lucide-react';
import {useProjects, Project, Contractor} from '../context/ProjectContext';
import {useLanguage} from '../context/LanguageContext';
import {api, saveBlob, Company, Contract, DraftNavState, NoticeOut} from '../services/api';
import {UserProfile, loadProfile, senderCompany, senderLine, signatureBlock} from '../profile/profileStore';
import DispatchPanel from '../components/DispatchPanel';
import '@frontend/src/index.css';
import './LetterDrafts.css';

/* ==========================================================================
   Types & constants
   ========================================================================== */

type LetterCategory = 'delay' | 'defect' | 'concern' | 'cost';
// Same statuses as the backend (FormalNotice.status)
type LetterStatus = 'Entwurf' | 'Freigegeben' | 'Exportiert';
type View = 'new' | 'saved';

interface LetterTypeConfig {
    id: LetterCategory;
    labelKey: string;
    paragraph: string;
    icon: (size: number) => React.ReactNode;
}

// His three letters first, Mehrkostenanmeldung last
const LETTER_TYPES: LetterTypeConfig[] = [
    {
        id: 'delay',
        labelKey: 'ld_type_delay',
        paragraph: '§ 6 Abs. 1 VOB/B',
        icon: (s) => <Clock size={s} color="var(--color-danger)"/>
    },
    {
        id: 'defect',
        labelKey: 'ld_type_defect',
        paragraph: '§ 4 Abs. 7 VOB/B',
        icon: (s) => <AlertTriangle size={s} color="var(--color-danger-dark)"/>
    },
    {
        id: 'concern',
        labelKey: 'ld_type_concern',
        paragraph: '§ 4 Abs. 3 VOB/B',
        icon: (s) => <ShieldAlert size={s} color="var(--color-primary)"/>
    },
    {
        id: 'cost',
        labelKey: 'ld_type_cost',
        paragraph: '§ 2 Abs. 5/6 VOB/B',
        icon: (s) => <Coins size={s} color="var(--color-warning-dark)"/>
    }
];

const typeConfig = (id: LetterCategory) => LETTER_TYPES.find((lt) => lt.id === id) ?? LETTER_TYPES[0];

const isLetterCategory = (v: unknown): v is LetterCategory =>
    v === 'delay' || v === 'defect' || v === 'concern' || v === 'cost';

interface Details {
    contractorIdx: string;   // '' = keine Firma
    presentWorkers: string;
    since: string;           // datetime-local
    area: string;
    description: string;
    deadline: string;        // date
    concernSource: string;
    extra: string;
}

interface SavedLetter {
    id: string;              // "notice-<id>" for server letters, "draft-<ts>" for local ones
    source: 'server' | 'local';
    noticeId?: number;
    type: LetterCategory;
    subject: string;
    body: string;
    project: string;
    projectNumber: string;
    date: string;
    updatedAt: string;
    createdIso: string;      // ISO timestamp, used for sorting & filtering
    updatedIso: string;
    recipientKey: string;
    recipientName: string;
    recipientAddress: string;
    status: LetterStatus;
    details?: Details;
}

const STORAGE_KEY = 'savedDrafts';

type SortKey = 'type' | 'subject' | 'to' | 'date' | 'status';
type DateFilter = 'all' | 'today' | '7' | '30' | 'custom';

/* ==========================================================================
   Helpers
   ========================================================================== */

const pad = (n: number) => String(n).padStart(2, '0');

const nowLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const inDays = (days: number) => {
    const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-DE');
};

const fmtDateTime = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.toLocaleDateString('de-DE')}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
};

const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const shorten = (text: string, max = 55) => {
    const s = text.trim().replace(/\s+/g, ' ');
    return s.length > max ? `${s.slice(0, max).trimEnd()} …` : s;
};

const emptyDetails = (): Details => ({
    contractorIdx: '',
    presentWorkers: '',
    since: nowLocal(),
    area: '',
    description: '',
    deadline: inDays(7),
    concernSource: '',
    extra: ''
});

const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sameName = (a?: string | null, b?: string | null) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// "21.11.2026" → ISO (for drafts saved before timestamps existed)
const parseDeDate = (s: unknown): string | null => {
    const m = typeof s === 'string' ? s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/) : null;
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// Draft ids are "draft-<Date.now()>", so the id tells us when it was created
const isoFromId = (id: unknown): string | null => {
    const ts = Number(String(id ?? '').replace('draft-', ''));
    return Number.isFinite(ts) && ts > 1e12 ? new Date(ts).toISOString() : null;
};

const toStatus = (s: unknown): LetterStatus =>
    s === 'Freigegeben' || s === 'Geprüft' ? 'Freigegeben' : s === 'Exportiert' ? 'Exportiert' : 'Entwurf';

const loadLocal = (): SavedLetter[] => {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(raw)) return [];
        return raw
            // older versions mirrored server letters into localStorage – those now come from the server
            .filter((d: any) => !String(d?.id ?? '').startsWith('notice-'))
            .map((d: any): SavedLetter => {
                const createdIso: string =
                    d.createdIso ?? isoFromId(d.id) ?? parseDeDate(d.date) ?? new Date().toISOString();
                const updatedIso: string = d.updatedIso ?? parseDeDate(d.updatedAt) ?? createdIso;
                return {
                    id: String(d.id ?? `draft-${Date.now()}`),
                    source: 'local',
                    type: isLetterCategory(d.type) ? d.type : 'delay',
                    subject: d.subject ?? '',
                    body: d.body ?? '',
                    project: d.project ?? '',
                    projectNumber: d.projectNumber ?? '',
                    date: d.date ?? '',
                    updatedAt: d.updatedAt ?? d.date ?? '',
                    createdIso,
                    updatedIso,
                    recipientKey: d.recipientKey ?? 'other',
                    recipientName: d.recipientName ?? '',
                    recipientAddress: d.recipientAddress ?? '',
                    status: toStatus(d.status),
                    details: d.details
                };
            });
    } catch {
        return [];
    }
};

const persistLocal = (letters: SavedLetter[]) =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(letters.filter((l) => l.source === 'local')));

const fromNotice = (n: NoticeOut, project: Project): SavedLetter => ({
    id: `notice-${n.id}`,
    source: 'server',
    noticeId: n.id,
    type: isLetterCategory(n.type) ? n.type : 'delay',
    subject: n.subject ?? n.title ?? '',
    body: n.body ?? '',
    project: project.name,
    projectNumber: project.number,
    date: fmtDate(n.created_at),
    updatedAt: fmtDate(n.updated_at),
    createdIso: n.created_at,
    updatedIso: n.updated_at || n.created_at,
    recipientKey: 'other',
    recipientName: n.recipient ?? '',
    recipientAddress: '',
    status: toStatus(n.status)
});

/* ==========================================================================
   Letter text builder (fixed standard format)
   ========================================================================== */

interface BuildContext {
    type: LetterCategory;
    project: Project;
    details: Details;
    contractor: Contractor | null;
    recipientIsContractor: boolean;
    signature: string;   // closing + signature block from the profile
}

const staffingSentence = (contractor: Contractor, d: Details) => {
    const trade = contractor.trade ? ` (Gewerk ${contractor.trade})` : '';
    const since = d.since ? `Seit dem ${fmtDateTime(d.since)}` : 'Derzeit';
    const present = d.presentWorkers.trim();
    let s = `${since} ist die Firma ${contractor.name}${trade} nicht in der vertraglich vereinbarten Stärke auf der Baustelle erschienen.`;
    if (contractor.required_workers != null && present !== '') {
        s += Number(present) === 0
            ? ` Statt der vereinbarten ${contractor.required_workers} Arbeitskräfte ist niemand erschienen.`
            : ` Statt der vereinbarten ${contractor.required_workers} Arbeitskräfte waren lediglich ${present} vor Ort.`;
    }
    return s;
};

const buildLetter = (ctx: BuildContext): {subject: string; body: string} => {
    const {type, project, details: d, contractor, recipientIsContractor} = ctx;
    const today = new Date().toLocaleDateString('de-DE');
    const bv = `im Bauvorhaben "${project.name}" (Projekt-Nr. ${project.number})`;
    const signature = ctx.signature;
    const extra = d.extra.trim() ? `\n\nErgänzend weisen wir auf Folgendes hin:\n${d.extra.trim()}` : '';
    const area = d.area.trim();
    const desc = d.description.trim();

    if (type === 'delay') {
        const lines: string[] = [];
        if (contractor) {
            lines.push(staffingSentence(contractor, d));
        } else if (d.since) {
            lines.push(`Seit dem ${fmtDateTime(d.since)} liegt auf der Baustelle folgende Behinderung vor.`);
        }
        if (desc) lines.push(desc);
        if (area) lines.push(`Betroffen ist der Bereich: ${area}.`);
        const facts = lines.length ? lines.join('\n') : '[Bitte Sachverhalt ergänzen]';

        const subjectTail = contractor
            ? `Personalunterdeckung ${contractor.name}`
            : desc ? shorten(desc, 45) : 'Behinderung der Bauausführung';

        if (recipientIsContractor && contractor) {
            return {
                subject: `Behinderung des Bauablaufs – Aufforderung zur Abhilfe gemäß § 5 Abs. 3 VOB/B – ${contractor.name}`,
                body: `Sehr geehrte Damen und Herren,

${bv} stellen wir fest, dass Ihre Leistungen nicht vertragsgemäß erbracht werden.

1. Sachverhalt
${facts}

2. Auswirkungen
Durch die fehlende Personalstärke können die im Terminplan vorgesehenen Arbeiten nicht ausgeführt werden. Nachfolgende Gewerke werden dadurch ebenfalls behindert.

3. Aufforderung
Wir fordern Sie gemäß § 5 Abs. 3 VOB/B auf, unverzüglich, spätestens bis zum ${fmtDate(inDays(1))}, die vertraglich vereinbarte Personalstärke auf der Baustelle zu stellen.

4. Vorbehalt
Alle Ansprüche aus der Verzögerung, insbesondere auf Schadensersatz gemäß § 6 Abs. 6 VOB/B sowie die Rechte aus § 5 Abs. 4 VOB/B, behalten wir uns ausdrücklich vor.${extra}

${signature}`
            };
        }

        return {
            subject: `Behinderungsanzeige gemäß § 6 Abs. 1 VOB/B – ${subjectTail}`,
            body: `Sehr geehrte Damen und Herren,

hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass wir ${bv} an der ordnungsgemäßen Ausführung unserer Leistungen behindert sind.

1. Sachverhalt
${facts}

2. Auswirkungen auf den Bauablauf
Die im Terminplan vorgesehenen Arbeiten können im betroffenen Bereich nicht wie geplant ausgeführt werden. Nachfolgende Gewerke sind ebenfalls betroffen; eine termingerechte Fertigstellung ist gefährdet.

3. Vorbehalt
Die Ausführungsfristen verlängern sich gemäß § 6 Abs. 2 VOB/B um die Dauer der Behinderung zuzüglich eines angemessenen Zuschlags für die Wiederaufnahme der Arbeiten. Ansprüche gemäß § 6 Abs. 6 VOB/B sowie § 642 BGB behalten wir uns ausdrücklich vor.
Wir werden Sie unverzüglich informieren, sobald die Behinderung beseitigt ist.${extra}

${signature}`
        };
    }

    if (type === 'defect') {
        const facts = [
            area ? `Ort: ${area}` : '',
            desc ? `Beschreibung: ${desc}` : '[Bitte Mangel beschreiben]',
            contractor ? `Ausführende Firma: ${contractor.name}${contractor.trade ? ` (Gewerk ${contractor.trade})` : ''}` : ''
        ].filter(Boolean).join('\n');

        return {
            subject: `Mängelanzeige gemäß § 4 Abs. 7 VOB/B – ${area || (desc ? shorten(desc, 45) : 'festgestellte Mängel')}`,
            body: `Sehr geehrte Damen und Herren,

bei der Begehung der Baustelle ${bv} am ${today} haben wir an Ihren Leistungen folgenden Mangel festgestellt:

1. Festgestellter Mangel
${facts}

2. Aufforderung zur Mängelbeseitigung
Wir fordern Sie gemäß § 4 Abs. 7 VOB/B auf, den Mangel auf Ihre Kosten fachgerecht zu beseitigen. Hierfür setzen wir Ihnen eine Frist bis zum ${fmtDate(d.deadline) || '[Datum]'}.
Bitte zeigen Sie uns die Beseitigung schriftlich an, damit wir die Leistung abnehmen können.

3. Vorbehalt
Nach fruchtlosem Ablauf der Frist behalten wir uns vor, Ihnen den Auftrag gemäß § 4 Abs. 7 i. V. m. § 8 Abs. 3 VOB/B zu entziehen und den Mangel auf Ihre Kosten durch ein Drittunternehmen beseitigen zu lassen.${extra}

${signature}`
        };
    }

    if (type === 'concern') {
        const facts = [
            desc || '[Bitte Gegenstand der Bedenken beschreiben]',
            d.concernSource.trim() ? `Die Vorgabe bzw. Vorleistung stammt von: ${d.concernSource.trim()}.` : '',
            area ? `Betroffener Bereich: ${area}.` : ''
        ].filter(Boolean).join('\n');

        return {
            subject: `Bedenkenanzeige gemäß § 4 Abs. 3 VOB/B – ${desc ? shorten(desc, 45) : 'Bedenken gegen die vorgesehene Ausführung'}`,
            body: `Sehr geehrte Damen und Herren,

im Rahmen unserer Prüf- und Hinweispflicht gemäß § 4 Abs. 3 VOB/B melden wir Ihnen ${bv} folgende Bedenken an:

1. Gegenstand der Bedenken
${facts}

2. Begründung
Bei Ausführung nach den derzeitigen Vorgaben bzw. auf den vorhandenen Vorleistungen besteht die Gefahr von Mängeln und Folgeschäden an unseren Leistungen und an nachfolgenden Gewerken.

3. Bitte um Entscheidung
Wir bitten um Prüfung und schriftliche Anweisung bis zum ${fmtDate(inDays(5))}, wie verfahren werden soll. Bis zur Klärung können die betroffenen Arbeiten nicht ausgeführt werden.
Sollten Sie an der bisherigen Ausführung festhalten, weisen wir vorsorglich auf § 13 Abs. 3 VOB/B hin.${extra}

${signature}`
        };
    }

    // cost
    const facts = [
        desc || '[Bitte Ursache des Mehraufwands beschreiben]',
        area ? `Betroffener Bereich: ${area}.` : ''
    ].filter(Boolean).join('\n');

    return {
        subject: `Mehrkostenanmeldung gemäß § 2 Abs. 5 / Abs. 6 VOB/B – ${desc ? shorten(desc, 45) : 'geänderte bzw. zusätzliche Leistungen'}`,
        body: `Sehr geehrte Damen und Herren,

${bv} kündigen wir Ihnen hiermit gemäß § 2 Abs. 5 bzw. § 2 Abs. 6 VOB/B einen Mehrvergütungsanspruch für geänderte bzw. zusätzliche Leistungen an.

1. Ursache des Mehraufwands
${facts}

2. Vertragliche Einordnung
Diese Leistungen sind im ursprünglichen Leistungsverzeichnis nicht enthalten bzw. weichen von den vertraglichen Grundlagen ab. Ihre Ausführung erfordert zusätzlichen Personal-, Material- und Geräteeinsatz.

3. Nachtragsangebot
Ein prüffähiges Nachtragsangebot reichen wir unverzüglich nach. Wir bitten um schriftliche Beauftragung vor Ausführung der betroffenen Leistungen.${extra}

${signature}`
    };
};

/**
 * Our form fields → the backend's notice fields (see backend REQUIRED_FIELDS).
 * Sent with every save so the server's "Freigabe" check sees complete data.
 */
const toNoticeFields = (
    type: LetterCategory,
    d: Details,
    contractor: Contractor | null,
    recipientName: string
): Record<string, string> => {
    const desc = d.description.trim();
    const staffing = type === 'delay' && contractor ? staffingSentence(contractor, d) : '';
    const facts = [staffing, desc].filter(Boolean).join(' ');

    let cause = desc;
    if (type === 'delay' && contractor) cause = `Firma ${contractor.name} nicht in vertraglicher Sollstärke erschienen`;
    if (type === 'concern') cause = d.concernSource.trim() || desc;
    if (type === 'defect' && contractor) cause = `Ausführung durch ${contractor.name}`;

    const fields: Record<string, string> = {
        recipient: recipientName.trim(),
        facts,
        cause,
        location: d.area.trim(),
        affected_work: contractor?.trade ?? ''
    };
    if (type === 'delay' && d.since) {
        fields.start_date = d.since.slice(0, 10);
        fields.start_time = d.since.slice(11, 16);
    }
    if (type === 'defect' && d.deadline) fields.deadline = d.deadline;
    return fields;
};

/* ==========================================================================
   Word export (client-side fallback, HTML-based .doc in fixed standard format)
   ========================================================================== */

interface ExportData {
    senderLine: string;  // company · address (one line above the recipient)
    recipientName: string;
    recipientAddress: string;
    projectName: string;
    projectNumber: string;
    date: string;
    subject: string;
    body: string;
    type: LetterCategory;
}

const exportWordLocal = (data: ExportData) => {
    const content = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(data.subject)}</title>
<style>
body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.5; color: #000; }
.sender { font-size: 9pt; color: #444; border-bottom: 1px solid #999; padding-bottom: 4pt; margin-bottom: 18pt; }
.recipient { margin-bottom: 24pt; }
.meta { text-align: right; margin-bottom: 18pt; }
.draft { color: #b45309; font-weight: bold; letter-spacing: 2pt; }
h1 { font-size: 12pt; margin: 0 0 14pt 0; }
.body { white-space: pre-wrap; }
</style>
</head>
<body>
<p class="draft">ENTWURF – vor Versand prüfen</p>
<div class="sender">${escapeHtml(data.senderLine)}</div>
<div class="recipient"><strong>${escapeHtml(data.recipientName)}</strong><br/>${escapeHtml(data.recipientAddress).replace(/\n/g, '<br/>')}</div>
<div class="meta">Bauvorhaben: ${escapeHtml(data.projectName)} (${escapeHtml(data.projectNumber)})<br/>Datum: ${escapeHtml(data.date)}</div>
<h1>${escapeHtml(data.subject)}</h1>
<div class="body">${escapeHtml(data.body).replace(/\n/g, '<br/>')}</div>
</body>
</html>`;

    saveBlob(
        new Blob([content], {type: 'application/msword;charset=utf-8'}),
        `${data.type}_${data.projectNumber || 'projekt'}_${new Date().toISOString().slice(0, 10)}.doc`
    );
};

/* ==========================================================================
   Component
   ========================================================================== */

export const LetterDrafts: React.FC = () => {
    const {t} = useLanguage();
    const {activeProject} = useProjects();

    // Context from other pages ("Entwurf erstellen" in Analyse, Dashboard, Tagesbericht, …)
    const location = useLocation();
    const navigate = useNavigate();
    const navState = (location.state as DraftNavState | null) ?? null;

    // --- master data from the backend (Stammdaten) ---
    const [companies, setCompanies] = useState<Company[]>([]);
    const [contracts, setContracts] = useState<Contract[]>([]);

    // --- sender: site manager profile ("Mein Profil") + own company from Stammdaten ---
    const [profile, setProfile] = useState<UserProfile>(loadProfile);
    useEffect(() => {
        const onUpdate = () => setProfile(loadProfile());
        window.addEventListener('profile-updated', onUpdate);
        return () => window.removeEventListener('profile-updated', onUpdate);
    }, []);
    const sender = senderCompany(profile, companies);
    const signature = signatureBlock(profile, sender.name);
    const senderLineText = senderLine(profile, sender);

    // Companies on site: project list + contracts (Sollstärke) from Stammdaten, without duplicates
    const contractors: Contractor[] = useMemo(() => {
        const list: Contractor[] = (activeProject.contractors ?? []).map((c) => ({...c}));
        for (const c of contracts) {
            if (!c.contractor_name) continue;
            const existing = list.find((x) => sameName(x.name, c.contractor_name));
            if (existing) {
                if (existing.required_workers == null && c.planned_workforce != null) {
                    existing.required_workers = c.planned_workforce;
                }
                continue;
            }
            const company = companies.find((co) => sameName(co.name, c.contractor_name));
            list.push({
                name: c.contractor_name,
                trade: c.trade ?? company?.trade ?? '',
                required_workers: c.planned_workforce ?? null,
                phone: company?.phone ?? ''
            });
        }
        return list;
    }, [activeProject.contractors, contracts, companies]);

    // Stammdaten companies not already listed as project companies
    const otherCompanies = companies.filter(
        (co) => co.company_type !== 'own' && !contractors.some((c) => sameName(c.name, co.name))
    );

    // --- view & list ---
    const [view, setView] = useState<View>('new');
    const [localLetters, setLocalLetters] = useState<SavedLetter[]>(loadLocal);
    const [serverNotices, setServerNotices] = useState<NoticeOut[]>([]);
    const [serverOnline, setServerOnline] = useState<boolean | null>(null);
    const [isLoadingNotices, setIsLoadingNotices] = useState(false);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | LetterCategory>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | LetterStatus>('all');
    const [recipientFilter, setRecipientFilter] = useState('all');
    const [dateFilter, setDateFilter] = useState<DateFilter>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // --- editor ---
    const [editingId, setEditingId] = useState<string | null>(null);
    const [noticeId, setNoticeId] = useState<number | null>(null); // set when the letter lives on the server
    // async flows (approve → export) need the id before React re-renders
    const noticeIdRef = useRef<number | null>(null);
    noticeIdRef.current = noticeId;
    const [selectedType, setSelectedType] = useState<LetterCategory>(
        isLetterCategory(navState?.type) ? navState.type : 'delay'
    );
    const [recipientKey, setRecipientKey] = useState<string>('client');
    const [otherRecipientName, setOtherRecipientName] = useState('');
    const [recipientAddress, setRecipientAddress] = useState('');
    const [details, setDetails] = useState<Details>(() => ({
        ...emptyDetails(),
        description: navState?.keywords ?? ''
    }));
    const [status, setStatus] = useState<LetterStatus>('Entwurf');
    const [subject, setSubject] = useState('');
    const [letterBody, setLetterBody] = useState('');
    const [touched, setTouched] = useState(false); // letter edited by hand → stop live updates

    const [busy, setBusy] = useState<null | 'save' | 'ai' | 'approve' | 'review' | 'export'>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [reviewHints, setReviewHints] = useState<string[]>([]);
    const [copySuccess, setCopySuccess] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const locked = status !== 'Entwurf';

    const selectedContractor: Contractor | null =
        details.contractorIdx !== '' ? contractors[Number(details.contractorIdx)] ?? null : null;

    const recipientName =
        recipientKey === 'client'
            ? activeProject.client || ''
            : recipientKey.startsWith('c:')
                ? contractors[Number(recipientKey.slice(2))]?.name ?? ''
                : recipientKey.startsWith('co:')
                    ? companies.find((co) => co.id === Number(recipientKey.slice(3)))?.name ?? ''
                    : otherRecipientName;

    const recipientIsContractor =
        selectedContractor !== null && recipientKey === `c:${details.contractorIdx}`;

    const generated = useMemo(
        () =>
            buildLetter({
                type: selectedType,
                project: activeProject,
                details,
                contractor: selectedContractor,
                recipientIsContractor,
                signature
            }),
        [selectedType, activeProject, details, selectedContractor, recipientIsContractor, signature]
    );

    // Live update of the letter while it hasn't been edited by hand
    useEffect(() => {
        if (touched) return;
        setSubject(generated.subject);
        setLetterBody(generated.body);
    }, [generated, touched]);

    /* ---------------- small helpers ---------------- */

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2800);
    };

    const setDetail = <K extends keyof Details>(key: K, value: Details[K]) =>
        setDetails((prev) => ({...prev, [key]: value}));

    const confirmDiscardEdits = () => !touched || locked || window.confirm(t('ld_confirm_overwrite'));

    /* ---------------- loading ---------------- */

    const loadNotices = async (): Promise<NoticeOut[] | null> => {
        setIsLoadingNotices(true);
        try {
            const notices = await api.listNotices(Number(activeProject.id));
            setServerNotices(notices);
            setServerOnline(true);
            return notices;
        } catch (err) {
            console.warn('Briefe konnten nicht vom Server geladen werden:', err);
            setServerOnline(false);
            return null;
        } finally {
            setIsLoadingNotices(false);
        }
    };

    const openLetter = (letter: SavedLetter, notice?: NoticeOut) => {
        setEditingId(letter.id);
        noticeIdRef.current = letter.noticeId ?? null;
        setNoticeId(letter.noticeId ?? null);
        setSelectedType(letter.type);
        setRecipientKey(
            letter.recipientKey === 'client' || letter.recipientKey.startsWith('c:') || letter.recipientKey.startsWith('co:')
                ? letter.recipientKey
                : 'other'
        );
        setOtherRecipientName(letter.recipientName);
        setRecipientAddress(letter.recipientAddress);
        setDetails(
            letter.details ?? {
                ...emptyDetails(),
                description: notice?.fields?.facts?.value ?? '',
                area: notice?.fields?.location?.value ?? '',
                deadline: notice?.fields?.deadline?.value || inDays(7)
            }
        );
        setStatus(letter.status);
        setSubject(letter.subject);
        setLetterBody(letter.body);
        setTouched(true); // keep the saved text exactly as it was
        setErrorMessage(null);
        setReviewHints([]);
        setView('new');
    };

    useEffect(() => {
        loadNotices().then(async (notices) => {
            // open a specific server letter if another page asked for it
            if (navState?.noticeId) {
                const n = notices?.find((x) => x.id === navState.noticeId)
                    ?? await api.getNotice(navState.noticeId).catch(() => undefined);
                if (n) openLetter(fromNotice(n, activeProject), n);
            }
        });
        api.listCompanies().then(setCompanies).catch(() => setCompanies([]));
        api.listContracts(Number(activeProject.id)).then(setContracts).catch(() => setContracts([]));
        // apply navigation context only once (not again after reload / project switch)
        if (navState) navigate(location.pathname, {replace: true, state: null});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProject.id]);

    /* ---------------- form handlers ---------------- */

    const handleRecipientChange = (key: string) => {
        setRecipientKey(key);
        // fill the address from Stammdaten if we know the company
        const name =
            key === 'client' ? activeProject.client
                : key.startsWith('c:') ? contractors[Number(key.slice(2))]?.name
                    : key.startsWith('co:') ? companies.find((co) => co.id === Number(key.slice(3)))?.name
                        : '';
        const company = companies.find((co) => sameName(co.name, name));
        if (company?.address) setRecipientAddress(company.address);
    };

    const handleTypeChange = (type: LetterCategory) => {
        if (type === selectedType || locked) return;
        if (!confirmDiscardEdits()) return;
        setSelectedType(type);
        setTouched(false);
    };

    const handleRegenerate = () => {
        if (locked || !confirmDiscardEdits()) return;
        setTouched(false);
        setSubject(generated.subject);
        setLetterBody(generated.body);
    };

    const resetEditor = () => {
        setEditingId(null);
        noticeIdRef.current = null;
        setNoticeId(null);
        setSelectedType('delay');
        setRecipientKey('client');
        setOtherRecipientName('');
        setRecipientAddress('');
        setDetails(emptyDetails());
        setStatus('Entwurf');
        setTouched(false);
        setErrorMessage(null);
        setReviewHints([]);
    };

    const handleNewLetter = () => {
        if (!confirmDiscardEdits()) return;
        resetEditor();
        setView('new');
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(`${subject}\n\n${letterBody}`);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2500);
    };

    const handleOpen = (letter: SavedLetter) => {
        if (!confirmDiscardEdits()) return;
        openLetter(letter, serverNotices.find((n) => n.id === letter.noticeId));
    };

    /* ---------------- save ---------------- */

    const saveLocal = (statusOverride?: LetterStatus): SavedLetter => {
        const now = new Date();
        const existing = editingId ? localLetters.find((l) => l.id === editingId) : undefined;
        const letter: SavedLetter = {
            id: existing?.id ?? `draft-${now.getTime()}`,
            source: 'local',
            type: selectedType,
            subject,
            body: letterBody,
            project: activeProject.name,
            projectNumber: activeProject.number,
            date: existing?.date ?? now.toLocaleDateString('de-DE'),
            updatedAt: now.toLocaleDateString('de-DE'),
            createdIso: existing?.createdIso ?? now.toISOString(),
            updatedIso: now.toISOString(),
            recipientKey,
            recipientName,
            recipientAddress,
            status: statusOverride ?? status,
            details
        };
        const updated = existing
            ? localLetters.map((l) => (l.id === letter.id ? letter : l))
            : [letter, ...localLetters];
        setLocalLetters(updated);
        persistLocal(updated);
        setEditingId(letter.id);
        return letter;
    };

    /** Saves to the server (creates the notice if needed). Returns the notice, or null if no notice could be created. */
    const saveToServer = async (): Promise<NoticeOut | null> => {
        const fields = toNoticeFields(selectedType, details, selectedContractor, recipientName);
        let id = noticeIdRef.current;
        if (id == null) {
            const draft = await api.captureText({
                text: [fields.facts, fields.location && `Ort: ${fields.location}`].filter(Boolean).join('. ')
                    || t(typeConfig(selectedType).labelKey),
                project_id: Number(activeProject.id),
                force_type: selectedType,
                ref_date: fields.start_date,
                ref_time: fields.start_time
            });
            if (!draft.notice_id) return null;
            id = draft.notice_id;
        }
        // fields first (server re-renders its template), then our own subject/body take precedence
        const saved = await api.patchNotice(id, {fields, recipient: recipientName, subject, body: letterBody});
        noticeIdRef.current = saved.id;
        setNoticeId(saved.id);
        setEditingId(`notice-${saved.id}`);
        // a letter that was only local before now lives on the server → drop the local copy
        if (editingId && editingId.startsWith('draft-')) {
            const updated = localLetters.filter((l) => l.id !== editingId);
            setLocalLetters(updated);
            persistLocal(updated);
        }
        await loadNotices();
        return saved;
    };

    const handleSave = async () => {
        if (locked) return;
        setBusy('save');
        setErrorMessage(null);
        try {
            const saved = await saveToServer();
            if (saved) {
                showToast(t('ld_toast_saved'));
                return;
            }
            saveLocal();
            showToast(t('ld_toast_saved_local'));
        } catch (err) {
            console.warn('Speichern auf dem Server fehlgeschlagen, speichere lokal:', err);
            if (noticeIdRef.current != null) {
                // the letter lives on the server – don't silently fork a local copy
                setErrorMessage(`${t('ld_save_failed')} ${(err as Error)?.message ?? ''}`.trim());
                return;
            }
            saveLocal();
            showToast(t('ld_toast_saved_local'));
        } finally {
            setBusy(null);
        }
    };

    /* ---------------- AI, review, approval ---------------- */

    const handleAiDraft = async () => {
        if (locked || !confirmDiscardEdits()) return;
        const fields = toNoticeFields(selectedType, details, selectedContractor, recipientName);
        const text = [fields.facts, fields.location && `Ort: ${fields.location}`, details.extra.trim()]
            .filter(Boolean)
            .join('. ');
        if (!text) {
            setErrorMessage(t('ld_ai_need_text'));
            return;
        }
        setBusy('ai');
        setErrorMessage(null);
        try {
            const draft = await api.captureText({
                text,
                project_id: Number(activeProject.id),
                force_type: selectedType,
                ref_date: fields.start_date,
                ref_time: fields.start_time
            });
            if (!draft.notice_id) throw new Error('Kein Entwurf erhalten');
            // keep our recipient; the server renders the letter from the fields it extracted
            const notice = recipientName.trim()
                ? await api.patchNotice(draft.notice_id, {fields: {recipient: recipientName}})
                : await api.getNotice(draft.notice_id);
            noticeIdRef.current = notice.id;
            setNoticeId(notice.id);
            setEditingId(`notice-${notice.id}`);
            setSubject(notice.subject ?? '');
            setLetterBody(notice.body ?? '');
            setTouched(true);
            if (notice.questions?.length) setReviewHints(notice.questions);
            await loadNotices();
            showToast(t('ld_toast_ai'));
        } catch (err: any) {
            console.warn('KI-Entwurf fehlgeschlagen:', err);
            setErrorMessage(`${t('ld_ai_failed')} ${err?.message ?? ''}`.trim());
        } finally {
            setBusy(null);
        }
    };

    const handleReview = async () => {
        setBusy('review');
        setReviewHints([]);
        setErrorMessage(null);
        try {
            const id = locked && noticeId != null ? noticeId : (await saveToServer())?.id;
            if (id == null) throw new Error(t('ld_server_offline'));
            const rev = await api.reviewNotice(id);
            setReviewHints(rev.hints?.length ? rev.hints : [t('ld_review_ok')]);
        } catch (err: any) {
            setErrorMessage(`${t('ld_review_failed')} ${err?.message ?? ''}`.trim());
        } finally {
            setBusy(null);
        }
    };

    /** Formal approval. Server letters go through /approve (checks required fields); without server they're marked locally. */
    const approve = async (): Promise<boolean> => {
        setErrorMessage(null);
        try {
            const saved = await saveToServer();
            if (saved) {
                const approved = await api.approveNotice(saved.id);
                setStatus(toStatus(approved.status));
                await loadNotices();
                return true;
            }
        } catch (err: any) {
            const msg: string = err?.message ?? '';
            // the server answered (e.g. 409 = required fields missing) → show it, don't fall back
            if (noticeIdRef.current != null || /missing_fields|Pflicht|409/i.test(msg)) {
                setErrorMessage(`${t('ld_approve_failed')} ${msg.replace(/^.*?:\s*/, '')}`.trim());
                return false;
            }
            console.warn('Server nicht erreichbar, Freigabe nur lokal:', err);
        }
        saveLocal('Freigegeben');
        setStatus('Freigegeben');
        return true;
    };

    const handleApprove = async () => {
        if (locked) return;
        if (!window.confirm(t('ld_confirm_approve'))) return;
        setBusy('approve');
        const ok = await approve();
        setBusy(null);
        if (ok) showToast(t('ld_toast_approved'));
    };

    const handleUnlockLocal = () => {
        // only for letters that live in this browser – the server keeps approved letters locked
        const letter = saveLocal('Entwurf');
        setStatus(letter.status);
    };

    /* ---------------- export ---------------- */

    const currentExportData = (): ExportData => ({
        senderLine: senderLineText,
        recipientName,
        recipientAddress,
        projectName: activeProject.name,
        projectNumber: activeProject.number,
        date: new Date().toLocaleDateString('de-DE'),
        subject,
        body: letterBody,
        type: selectedType
    });

    // Prints only the letter sheet. The class on <body> enables the print rules in
    // LetterDrafts.css just for this print (other pages print normally).
    const printLetter = () => {
        document.body.classList.add('print-letter-only');
        const cleanup = () => {
            document.body.classList.remove('print-letter-only');
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    };

    /**
     * Server export needs an approved letter ("nichts ohne Freigabe").
     * Returns true when handled (downloaded, cancelled or error shown), false to fall back to the local export.
     */
    const exportFromServer = async (format: 'pdf' | 'docx'): Promise<boolean> => {
        if (serverOnline === false) return false;
        if (status === 'Entwurf') {
            if (!window.confirm(t('ld_confirm_approve_export'))) return true;
            if (!(await approve())) return true;
        }
        // read the id after approve(), which may just have created the server letter
        const id = noticeIdRef.current;
        if (id == null) return false;
        const blob = await api.downloadExport(id, format);
        saveBlob(blob, `VOB_${selectedType}_${activeProject.number}.${format}`);
        setStatus('Exportiert');
        await loadNotices();
        return true;
    };

    const handleWord = async () => {
        setBusy('export');
        try {
            if (await exportFromServer('docx')) return;
        } catch (err) {
            console.warn('Word-Export vom Server fehlgeschlagen, nutze lokalen Export:', err);
        } finally {
            setBusy(null);
        }
        exportWordLocal(currentExportData());
    };

    const handlePdf = async () => {
        setBusy('export');
        try {
            if (await exportFromServer('pdf')) return;
        } catch (err: any) {
            // e.g. 503 "Pango fehlt" → offer printing instead
            if (window.confirm(`${t('ld_pdf_failed')}\n${err?.message ?? ''}\n\n${t('ld_pdf_print_instead')}`)) {
                printLetter();
            }
            return;
        } finally {
            setBusy(null);
        }
        printLetter();
    };

    const exportListLetter = async (l: SavedLetter) => {
        if (l.source === 'server' && l.noticeId != null && l.status !== 'Entwurf') {
            try {
                saveBlob(await api.downloadExport(l.noticeId, 'docx'), `VOB_${l.type}_${l.projectNumber}.docx`);
                await loadNotices();
                return;
            } catch (err) {
                console.warn('Word-Export vom Server fehlgeschlagen, nutze lokalen Export:', err);
            }
        }
        exportWordLocal({
            senderLine: senderLineText,
            recipientName: l.recipientName,
            recipientAddress: l.recipientAddress,
            projectName: l.project,
            projectNumber: l.projectNumber,
            date: fmtDate(l.updatedIso),
            subject: l.subject,
            body: l.body,
            type: l.type
        });
    };

    const handleDelete = (letter: SavedLetter) => {
        if (letter.source !== 'local') return;
        if (!window.confirm(t('ld_confirm_delete'))) return;
        const updated = localLetters.filter((l) => l.id !== letter.id);
        setLocalLetters(updated);
        persistLocal(updated);
        if (editingId === letter.id) setEditingId(null);
    };

    /* ---------------- list: merge, filter, sort ---------------- */

    const savedLetters: SavedLetter[] = [
        ...serverNotices.map((n) => fromNotice(n, activeProject)),
        ...localLetters
    ];

    const recipientOptions = Array.from(
        new Set(savedLetters.map((l) => l.recipientName.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'de'));

    const dateRange = (): [number, number] | null => {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const day = 24 * 60 * 60 * 1000;
        if (dateFilter === 'today') return [startOfToday.getTime(), Infinity];
        if (dateFilter === '7') return [startOfToday.getTime() - 6 * day, Infinity];
        if (dateFilter === '30') return [startOfToday.getTime() - 29 * day, Infinity];
        if (dateFilter === 'custom') {
            const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : -Infinity;
            const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Infinity;
            return [from, to];
        }
        return null;
    };

    const range = dateRange();
    const q = search.trim().toLowerCase();

    const filteredLetters = savedLetters
        .filter((l) => {
            if (typeFilter !== 'all' && l.type !== typeFilter) return false;
            if (statusFilter !== 'all' && l.status !== statusFilter) return false;
            if (recipientFilter !== 'all' && l.recipientName.trim() !== recipientFilter) return false;
            if (range) {
                const ts = new Date(l.updatedIso).getTime();
                if (ts < range[0] || ts > range[1]) return false;
            }
            if (!q) return true;
            return [l.subject, l.recipientName, l.project, l.body].some((f) => f.toLowerCase().includes(q));
        })
        .sort((a, b) => {
            let cmp = 0;
            if (sortKey === 'date') cmp = a.updatedIso.localeCompare(b.updatedIso);
            else if (sortKey === 'type') cmp = t(typeConfig(a.type).labelKey).localeCompare(t(typeConfig(b.type).labelKey), 'de');
            else if (sortKey === 'subject') cmp = a.subject.localeCompare(b.subject, 'de');
            else if (sortKey === 'to') cmp = a.recipientName.localeCompare(b.recipientName, 'de');
            else if (sortKey === 'status') cmp = a.status.localeCompare(b.status, 'de');
            // tie-breaker: newest first
            if (cmp === 0) cmp = a.updatedIso.localeCompare(b.updatedIso) * (sortDir === 'asc' ? 1 : -1);
            return sortDir === 'asc' ? cmp : -cmp;
        });

    const filtersActive =
        q !== '' || typeFilter !== 'all' || statusFilter !== 'all' || recipientFilter !== 'all' || dateFilter !== 'all';

    const resetFilters = () => {
        setSearch('');
        setTypeFilter('all');
        setStatusFilter('all');
        setRecipientFilter('all');
        setDateFilter('all');
        setDateFrom('');
        setDateTo('');
    };

    const handleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortDir(key === 'date' ? 'desc' : 'asc');
        }
    };

    const sortHeader = (k: SortKey, label: string) => {
        const active = sortKey === k;
        return (
            <th key={k} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                    type="button"
                    className={`ld-sort-btn ${active ? 'active' : ''}`}
                    onClick={() => handleSort(k)}
                >
                    <span>{label}</span>
                    {active
                        ? (sortDir === 'asc' ? <ArrowUp size={13}/> : <ArrowDown size={13}/>)
                        : <ArrowUpDown size={13} className="ld-sort-idle"/>}
                </button>
            </th>
        );
    };

    const statusLabel = (s: LetterStatus) =>
        s === 'Freigegeben' ? t('ld_status_approved') : s === 'Exportiert' ? t('ld_status_exported') : t('ld_status_draft');

    const statusClass = (s: LetterStatus) => (s === 'Freigegeben' ? 'approved' : s === 'Exportiert' ? 'exported' : '');

    // VOB reminders: project rules + rules of the recipient / affected company from Stammdaten
    const vobNotes: string[] = [];
    // own company's rules (Stammdaten "Eigenes Unternehmen", chosen in Mein Profil)
    if (sender.vobRules) vobNotes.push(`${sender.name}: ${sender.vobRules}`);
    if (activeProject.vob_notes?.trim()) vobNotes.push(activeProject.vob_notes.trim());
    for (const name of new Set([recipientName, selectedContractor?.name].filter(Boolean) as string[])) {
        const company = companies.find((co) => sameName(co.name, name));
        if (company?.vob_rules?.trim()) vobNotes.push(`${company.name}: ${company.vob_rules.trim()}`);
        const contract = contracts.find((c) => sameName(c.contractor_name, name));
        if (contract?.vob_notes?.trim()) vobNotes.push(`${t('ld_vob_contract')} ${contract.title}: ${contract.vob_notes.trim()}`);
    }

    /* ---------------------------------------------------------------------- */

    return (
        <div className="drafts-container">
            {/* Header */}
            <div className="drafts-header">
                <div>
                    <h1>{t('ld_title')}</h1>
                    <p>{t('ld_sub')}</p>
                </div>

                {toast && (
                    <div className="toast-success">
                        <CheckCircle2 size={16}/>
                        <span>{toast}</span>
                    </div>
                )}
            </div>

            {/* Sliding toggle */}
            <div className="ld-toggle-row">
                <div className="ld-toggle" role="tablist">
                    <span className={`ld-toggle-thumb ${view === 'saved' ? 'right' : ''}`} aria-hidden="true"/>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={view === 'new'}
                        className={`ld-toggle-btn ${view === 'new' ? 'active' : ''}`}
                        onClick={() => setView('new')}
                    >
                        <Edit3 size={15}/>
                        <span>{editingId ? t('ld_tab_edit') : t('ld_tab_new')}</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={view === 'saved'}
                        className={`ld-toggle-btn ${view === 'saved' ? 'active' : ''}`}
                        onClick={() => {
                            setView('saved');
                            loadNotices();
                        }}
                    >
                        <FolderOpen size={15}/>
                        <span>{t('ld_tab_saved')}</span>
                        <span className="ld-count">{savedLetters.length}</span>
                    </button>
                </div>
            </div>

            {view === 'new' ? (
                <div className="drafts-split-layout">
                    {/* ---------------- Left: form ---------------- */}
                    <div className="generator-card">
                        {editingId && (
                            <div className="ld-editing-banner">
                                <FileText size={15}/>
                                <span>{t('ld_editing')}</span>
                                <button type="button" className="ld-link-btn" onClick={handleNewLetter}>
                                    {t('ld_new_blank')}
                                </button>
                            </div>
                        )}

                        {locked && (
                            <div className="ld-locked-banner">
                                <Lock size={15}/>
                                <span>{t('ld_locked')}</span>
                                {noticeId == null && (
                                    <button type="button" className="ld-link-btn" onClick={handleUnlockLocal}>
                                        {t('ld_unlock')}
                                    </button>
                                )}
                            </div>
                        )}

                        <fieldset className="ld-fieldset" disabled={locked}>
                            {/* Step 1 */}
                            <section className="ld-step">
                                <h2 className="ld-step-title"><span className="ld-step-num">1</span>{t('ld_step_type')}</h2>
                                <div className="type-selector-grid">
                                    {LETTER_TYPES.map((lt) => (
                                        <button
                                            key={lt.id}
                                            type="button"
                                            className={`type-btn ${selectedType === lt.id ? 'active' : ''}`}
                                            onClick={() => handleTypeChange(lt.id)}
                                        >
                                            <span className="type-btn-title">
                                                {lt.icon(17)}
                                                <span>{t(lt.labelKey)}</span>
                                            </span>
                                            <span className="type-btn-sub">{lt.paragraph}</span>
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* Step 2 */}
                            <section className="ld-step">
                                <h2 className="ld-step-title"><span className="ld-step-num">2</span>{t('ld_step_recipient')}</h2>
                                <div className="form-group">
                                    <select
                                        className="form-input"
                                        aria-label={t('ld_step_recipient')}
                                        value={recipientKey}
                                        onChange={(e) => handleRecipientChange(e.target.value)}
                                    >
                                        <option value="client">
                                            {t('ld_r_client')}: {activeProject.client || '–'}
                                        </option>
                                        {contractors.length > 0 && (
                                            <optgroup label={t('ld_r_group_project')}>
                                                {contractors.map((c, i) => (
                                                    <option key={i} value={`c:${i}`}>
                                                        {c.name}{c.trade ? ` (${c.trade})` : ''}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {otherCompanies.length > 0 && (
                                            <optgroup label={t('ld_r_group_masterdata')}>
                                                {otherCompanies.map((co) => (
                                                    <option key={co.id} value={`co:${co.id}`}>
                                                        {co.name}{co.trade ? ` (${co.trade})` : ''}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        )}
                                        <option value="other">{t('ld_r_other')}</option>
                                    </select>
                                </div>
                                {recipientKey === 'other' && (
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="ldOtherName">{t('ld_r_name')}</label>
                                        <input
                                            id="ldOtherName"
                                            className="form-input"
                                            type="text"
                                            placeholder={t('ld_r_name_ph')}
                                            value={otherRecipientName}
                                            onChange={(e) => setOtherRecipientName(e.target.value)}
                                        />
                                    </div>
                                )}
                                <div className="form-group">
                                    <label className="form-label" htmlFor="ldAddress">{t('ld_r_address')}</label>
                                    <textarea
                                        id="ldAddress"
                                        className="form-textarea"
                                        rows={2}
                                        placeholder={t('ld_r_address_ph')}
                                        value={recipientAddress}
                                        onChange={(e) => setRecipientAddress(e.target.value)}
                                    />
                                </div>
                            </section>

                            {/* Step 3 */}
                            <section className="ld-step">
                                <h2 className="ld-step-title"><span className="ld-step-num">3</span>{t('ld_step_details')}</h2>

                                {(selectedType === 'delay' || selectedType === 'defect') && (
                                    <div className="form-group">
                                        <label className="form-label" htmlFor="ldCompany">
                                            {selectedType === 'delay' ? t('ld_f_company') : t('ld_f_defect_company')}
                                        </label>
                                        <select
                                            id="ldCompany"
                                            className="form-input"
                                            value={details.contractorIdx}
                                            onChange={(e) => setDetail('contractorIdx', e.target.value)}
                                        >
                                            <option value="">{t('ld_f_company_none')}</option>
                                            {contractors.map((c, i) => (
                                                <option key={i} value={String(i)}>
                                                    {c.name}{c.trade ? ` (${c.trade})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        {contractors.length === 0 && (
                                            <span className="ld-field-hint">{t('ld_f_no_contractors')}</span>
                                        )}
                                    </div>
                                )}

                                {selectedType === 'delay' && selectedContractor && (
                                    <div className="ld-staffing">
                                        <div className="ld-staffing-item">
                                            <span className="ld-staffing-label">{t('ld_f_required')}</span>
                                            <span className="ld-staffing-value">
                                                {selectedContractor.required_workers ?? '–'}
                                            </span>
                                        </div>
                                        <div className="ld-staffing-item">
                                            <label className="ld-staffing-label" htmlFor="ldPresent">{t('ld_f_present')}</label>
                                            <input
                                                id="ldPresent"
                                                className="form-input ld-staffing-input"
                                                type="number"
                                                min={0}
                                                placeholder="0"
                                                value={details.presentWorkers}
                                                onChange={(e) => setDetail('presentWorkers', e.target.value)}
                                            />
                                        </div>
                                        {selectedContractor.phone && (
                                            <a className="ld-call-btn" href={`tel:${selectedContractor.phone.replace(/\s/g, '')}`}>
                                                {t('ld_f_call')} {selectedContractor.phone}
                                            </a>
                                        )}
                                    </div>
                                )}

                                <div className="ld-fields-grid">
                                    {selectedType === 'delay' && (
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="ldSince">{t('ld_f_since')}</label>
                                            <input
                                                id="ldSince"
                                                className="form-input"
                                                type="datetime-local"
                                                value={details.since}
                                                onChange={(e) => setDetail('since', e.target.value)}
                                            />
                                        </div>
                                    )}

                                    <div className="form-group">
                                        <label className="form-label" htmlFor="ldArea">
                                            {selectedType === 'defect' ? t('ld_f_room') : t('ld_f_area')}
                                        </label>
                                        <input
                                            id="ldArea"
                                            className="form-input"
                                            type="text"
                                            placeholder={selectedType === 'defect' ? t('ld_f_room_ph') : t('ld_f_area_ph')}
                                            value={details.area}
                                            onChange={(e) => setDetail('area', e.target.value)}
                                        />
                                    </div>

                                    {selectedType === 'defect' && (
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="ldDeadline">{t('ld_f_deadline')}</label>
                                            <input
                                                id="ldDeadline"
                                                className="form-input"
                                                type="date"
                                                value={details.deadline}
                                                onChange={(e) => setDetail('deadline', e.target.value)}
                                            />
                                        </div>
                                    )}

                                    {selectedType === 'concern' && (
                                        <div className="form-group">
                                            <label className="form-label" htmlFor="ldSource">{t('ld_f_concern_source')}</label>
                                            <input
                                                id="ldSource"
                                                className="form-input"
                                                type="text"
                                                placeholder={t('ld_f_concern_source_ph')}
                                                value={details.concernSource}
                                                onChange={(e) => setDetail('concernSource', e.target.value)}
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label className="form-label" htmlFor="ldDesc">{t(`ld_f_desc_${selectedType}`)}</label>
                                    <textarea
                                        id="ldDesc"
                                        className="form-textarea"
                                        rows={3}
                                        placeholder={t(`ld_f_desc_${selectedType}_ph`)}
                                        value={details.description}
                                        onChange={(e) => setDetail('description', e.target.value)}
                                    />
                                </div>

                                <div className="form-group">
                                    <label className="form-label" htmlFor="ldExtra">{t('ld_f_extra')}</label>
                                    <textarea
                                        id="ldExtra"
                                        className="form-textarea"
                                        rows={2}
                                        placeholder={t('ld_f_extra_ph')}
                                        value={details.extra}
                                        onChange={(e) => setDetail('extra', e.target.value)}
                                    />
                                </div>
                            </section>
                        </fieldset>

                        {/* VOB reminder */}
                        <div className={`ld-vob-box ${activeProject.vob_b_agreed === false ? 'warn' : ''}`}>
                            <Info size={16} className="ld-vob-icon"/>
                            <div>
                                <strong>{t('ld_vob_title')}</strong>
                                {activeProject.vob_b_agreed === false && <p>{t('ld_vob_not_agreed')}</p>}
                                {vobNotes.length > 0
                                    ? vobNotes.map((n, i) => <p key={i}>{n}</p>)
                                    : <p>{t('ld_vob_none')}</p>}
                            </div>
                        </div>

                        <div className="ld-generate-row">
                            <button
                                type="button"
                                className="btn btn-primary ld-generate-btn"
                                onClick={handleRegenerate}
                                disabled={locked}
                            >
                                {touched ? <RotateCcw size={18}/> : <PenLine size={18}/>}
                                <span>{touched ? t('ld_btn_recreate') : t('ld_btn_create')}</span>
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary ld-ai-btn"
                                onClick={handleAiDraft}
                                disabled={locked || busy !== null || serverOnline === false}
                                title={serverOnline === false ? t('ld_server_offline') : t('ld_btn_ai_hint')}
                            >
                                <Wand2 size={16}/>
                                <span>{busy === 'ai' ? t('ld_busy') : t('ld_btn_ai')}</span>
                            </button>
                        </div>
                        <span className="ld-field-hint ld-center">
                            {locked ? t('ld_locked_short') : touched ? t('ld_hint_touched') : t('ld_hint_live')}
                        </span>
                    </div>

                    {/* ---------------- Right: letter ---------------- */}
                    <div className="letter-paper-card">
                        <div className="paper-toolbar">
                            <div className="ld-toolbar-title">
                                <Edit3 size={16} color="var(--color-primary)"/>
                                <span>{t('ld_preview')}</span>
                                <span className={`ld-status-pill ${statusClass(status)}`}>{statusLabel(status)}</span>
                            </div>
                            <div className="ld-toolbar-right">
                                {serverOnline === false && (
                                    <span className="ld-offline" title={t('ld_server_offline')}>
                                        <CloudOff size={14}/>
                                        <span>{t('ld_offline_short')}</span>
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className="doc-btn"
                                    onClick={handleReview}
                                    disabled={busy !== null || serverOnline === false}
                                    title={serverOnline === false ? t('ld_server_offline') : t('ld_btn_review_hint')}
                                >
                                    <Sparkles size={14}/>
                                    <span>{busy === 'review' ? t('ld_busy') : t('ld_btn_review')}</span>
                                </button>
                            </div>
                        </div>

                        {errorMessage && (
                            <div className="ld-message error">
                                <AlertTriangle size={15}/>
                                <span>{errorMessage}</span>
                                <button type="button" className="ld-message-close" aria-label="Schließen"
                                        onClick={() => setErrorMessage(null)}>
                                    <X size={14}/>
                                </button>
                            </div>
                        )}

                        {reviewHints.length > 0 && (
                            <div className="ld-message review">
                                <Sparkles size={15}/>
                                <div>
                                    <strong>{t('ld_review_title')}</strong>
                                    <ul>
                                        {reviewHints.map((h, i) => <li key={i}>{h}</li>)}
                                    </ul>
                                </div>
                                <button type="button" className="ld-message-close" aria-label="Schließen"
                                        onClick={() => setReviewHints([])}>
                                    <X size={14}/>
                                </button>
                            </div>
                        )}

                        <div className="paper-content letter-sheet">
                            <span className="ld-draft-stamp">
                                {status === 'Entwurf' ? t('ld_stamp') : statusLabel(status).toUpperCase()}
                            </span>

                            <div className="ld-sender-line">
                                {senderLineText}
                            </div>

                            <div className="ld-letter-head">
                                <div className="ld-recipient-block">
                                    <strong>{recipientName || t('ld_r_missing')}</strong>
                                    {recipientAddress && <div className="ld-pre">{recipientAddress}</div>}
                                </div>
                                <div className="ld-meta-block">
                                    <div>{t('drafts_label_project')}: {activeProject.name}</div>
                                    <div>{t('proj_form_nr')}: {activeProject.number}</div>
                                    <div>{t('ld_date')}: {new Date().toLocaleDateString('de-DE')}</div>
                                </div>
                            </div>

                            <input
                                type="text"
                                className="letter-subject"
                                aria-label={t('ld_subject')}
                                value={subject}
                                readOnly={locked}
                                onChange={(e) => {
                                    setSubject(e.target.value);
                                    setTouched(true);
                                }}
                            />

                            <textarea
                                className="letter-body-editable"
                                aria-label={t('ld_preview')}
                                value={letterBody}
                                readOnly={locked}
                                onChange={(e) => {
                                    setLetterBody(e.target.value);
                                    setTouched(true);
                                }}
                            />
                            {/* plain copy of the body for printing (textareas clip when printed) */}
                            <div className="ld-print-body ld-pre">{letterBody}</div>
                        </div>

                        <div className="ld-actions">
                            <div className="ld-actions-left">
                                <button className="doc-btn" onClick={handleCopy} title={t('btn_copy')}>
                                    <Copy size={14}/>
                                    <span>{copySuccess ? t('btn_copied') : t('btn_copy')}</span>
                                </button>
                                <button className="doc-btn" onClick={handleWord} disabled={busy !== null}
                                        title={t('btn_word_export')}>
                                    <Download size={14}/>
                                    <span>Word</span>
                                </button>
                                <button className="doc-btn" onClick={handlePdf} disabled={busy !== null}
                                        title={t('ld_btn_pdf_hint')}>
                                    <Printer size={14}/>
                                    <span>PDF</span>
                                </button>
                            </div>
                            <div className="ld-actions-right">
                                {!locked && (
                                    <button
                                        className="btn btn-secondary ld-approve-btn"
                                        onClick={handleApprove}
                                        disabled={busy !== null}
                                        title={t('ld_btn_approve_hint')}
                                    >
                                        <CheckSquare size={15}/>
                                        <span>{busy === 'approve' ? t('ld_busy') : t('ld_btn_approve')}</span>
                                    </button>
                                )}
                                <button
                                    className="btn btn-primary ld-save-btn"
                                    onClick={handleSave}
                                    disabled={locked || busy !== null}
                                >
                                    <Save size={15}/>
                                    <span>{busy === 'save' ? t('ld_busy') : t('btn_save')}</span>
                                </button>
                            </div>
                        </div>

                        {/* Idee #4: Versand & Zugangsnachweis (Backend folgt) */}
                        <DispatchPanel noticeId={noticeId} approved={locked}/>

                        <div className="legal-notice-banner">
                            <AlertTriangle size={16} style={{flexShrink: 0}}/>
                            <span>{t('ld_legal')}</span>
                        </div>
                    </div>
                </div>
            ) : (
                /* ---------------- Saved letters ---------------- */
                <div className="ld-saved-card">
                    <div className="ld-filter-bar">
                        <div className="ld-search">
                            <Search size={16}/>
                            <input
                                type="search"
                                className="form-input"
                                placeholder={t('ld_search')}
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <select
                            className="form-input ld-filter-select"
                            aria-label={t('ld_col_type')}
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value as 'all' | LetterCategory)}
                        >
                            <option value="all">{t('ld_filter_all_types')}</option>
                            {LETTER_TYPES.map((lt) => (
                                <option key={lt.id} value={lt.id}>{t(lt.labelKey)}</option>
                            ))}
                        </select>
                        <select
                            className="form-input ld-filter-select"
                            aria-label={t('ld_col_status')}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as 'all' | LetterStatus)}
                        >
                            <option value="all">{t('ld_filter_all_status')}</option>
                            <option value="Entwurf">{t('ld_status_draft')}</option>
                            <option value="Freigegeben">{t('ld_status_approved')}</option>
                            <option value="Exportiert">{t('ld_status_exported')}</option>
                        </select>
                        <select
                            className="form-input ld-filter-select"
                            aria-label={t('ld_col_to')}
                            value={recipientFilter}
                            onChange={(e) => setRecipientFilter(e.target.value)}
                        >
                            <option value="all">{t('ld_filter_all_to')}</option>
                            {recipientOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <select
                            className="form-input ld-filter-select"
                            aria-label={t('ld_col_date')}
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                        >
                            <option value="all">{t('ld_filter_all_dates')}</option>
                            <option value="today">{t('ld_filter_today')}</option>
                            <option value="7">{t('ld_filter_7')}</option>
                            <option value="30">{t('ld_filter_30')}</option>
                            <option value="custom">{t('ld_filter_custom')}</option>
                        </select>
                        {dateFilter === 'custom' && (
                            <div className="ld-date-range">
                                <input
                                    type="date"
                                    className="form-input"
                                    aria-label={t('ld_filter_from')}
                                    value={dateFrom}
                                    max={dateTo || undefined}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                />
                                <span>–</span>
                                <input
                                    type="date"
                                    className="form-input"
                                    aria-label={t('ld_filter_to')}
                                    value={dateTo}
                                    min={dateFrom || undefined}
                                    onChange={(e) => setDateTo(e.target.value)}
                                />
                            </div>
                        )}
                        <button
                            type="button"
                            className="ld-icon-btn"
                            title={t('ld_refresh')}
                            aria-label={t('ld_refresh')}
                            onClick={() => loadNotices()}
                            disabled={isLoadingNotices}
                        >
                            <RefreshCw size={14} className={isLoadingNotices ? 'ld-spin' : ''}/>
                        </button>
                    </div>

                    {(savedLetters.length > 0 || serverOnline === false) && (
                        <div className="ld-result-bar">
                            <span className="ld-result-count">
                                {filteredLetters.length} {t('ld_of')} {savedLetters.length} {t('ld_letters')}
                                {serverOnline === false && (
                                    <span className="ld-offline">
                                        <CloudOff size={13}/>
                                        <span>{t('ld_list_offline')}</span>
                                    </span>
                                )}
                            </span>
                            {filtersActive && (
                                <button type="button" className="ld-link-btn ld-reset" onClick={resetFilters}>
                                    <X size={13}/>
                                    <span>{t('ld_reset_filters')}</span>
                                </button>
                            )}
                        </div>
                    )}

                    {savedLetters.length === 0 ? (
                        <div className="ld-empty">
                            <FolderOpen size={32}/>
                            <p>{t('ld_empty')}</p>
                            <button type="button" className="btn btn-primary" onClick={handleNewLetter}>
                                <Edit3 size={15}/>
                                <span>{t('ld_new_letter')}</span>
                            </button>
                        </div>
                    ) : filteredLetters.length === 0 ? (
                        <div className="ld-empty"><p>{t('ld_empty_filter')}</p></div>
                    ) : (
                        <table className="ld-table">
                            <colgroup>
                                <col className="ld-col-type"/>
                                <col/>
                                <col className="ld-col-to"/>
                                <col className="ld-col-date"/>
                                <col className="ld-col-status"/>
                                <col className="ld-col-actions"/>
                            </colgroup>
                            <thead>
                            <tr>
                                {sortHeader('type', t('ld_col_type'))}
                                {sortHeader('subject', t('ld_col_subject'))}
                                {sortHeader('to', t('ld_col_to'))}
                                {sortHeader('date', t('ld_col_date'))}
                                {sortHeader('status', t('ld_col_status'))}
                                <th aria-label="Aktionen"/>
                            </tr>
                            </thead>
                            <tbody>
                            {filteredLetters.map((l) => {
                                const cfg = typeConfig(l.type);
                                return (
                                    <tr
                                        key={l.id}
                                        className={`ld-row ${l.id === editingId ? 'current' : ''}`}
                                        tabIndex={0}
                                        title={t('ld_open_hint')}
                                        onClick={() => handleOpen(l)}
                                        onKeyDown={(e) => {
                                            if (e.target !== e.currentTarget) return;
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                handleOpen(l);
                                            }
                                        }}
                                    >
                                        <td title={t(cfg.labelKey)}>
                                            <span className="ld-type-cell">
                                                {cfg.icon(15)}
                                                <span className="ld-ellipsis">{t(cfg.labelKey)}</span>
                                            </span>
                                        </td>
                                        <td className="ld-subject-cell" title={l.subject}>
                                            <span className="ld-subject-text">{l.subject}</span>
                                            <span className="ld-subject-project ld-ellipsis">
                                                {l.source === 'server'
                                                    ? <Cloud size={11} className="ld-source-icon"/>
                                                    : <CloudOff size={11} className="ld-source-icon"/>}
                                                {l.project}
                                            </span>
                                        </td>
                                        <td title={l.recipientName}>
                                            <span className="ld-ellipsis">{l.recipientName || '–'}</span>
                                        </td>
                                        <td className="ld-nowrap" title={`${t('ld_created')}: ${fmtDate(l.createdIso)} ${fmtTime(l.createdIso)}`}>
                                            <span className="ld-date-main">{fmtDate(l.updatedIso)}</span>
                                            <span className="ld-date-time">{fmtTime(l.updatedIso)}</span>
                                        </td>
                                        <td>
                                            <span className={`ld-status-pill ${statusClass(l.status)}`}>
                                                {statusLabel(l.status)}
                                            </span>
                                        </td>
                                        <td className="ld-actions-cell">
                                            <div className="ld-row-actions">
                                                <button
                                                    className="ld-icon-btn"
                                                    title={t('btn_word_export')}
                                                    aria-label={t('btn_word_export')}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        exportListLetter(l);
                                                    }}
                                                >
                                                    <Download size={14}/>
                                                </button>
                                                {l.source === 'local' && (
                                                    <button
                                                        className="ld-icon-btn danger"
                                                        title={t('ld_delete')}
                                                        aria-label={t('ld_delete')}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDelete(l);
                                                        }}
                                                    >
                                                        <Trash2 size={14}/>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

export default LetterDrafts;

/**
 * Site manager profile – shared by "Mein Profil" and the letter page.
 * Stored in localStorage ("userProfile"); there is no user endpoint in the backend yet.
 * Company address and VOB rules come from Stammdaten (company_type "own") when available.
 */
import type {Company} from '../services/api';

export type SignAs = 'iA' | 'iV' | 'none';

export interface UserProfile {
    fullName: string;
    role: string;
    phone: string;        // office / direct line
    mobile: string;
    email: string;
    companyId: number | null;   // own company from Stammdaten
    company: string;            // fallback name when no Stammdaten company is chosen
    companyAddress: string;     // fallback address
    signAs: SignAs;
    closing: string;
}

export const ROLES = ['Bauleiter', 'Oberbauleiter', 'Projektleiter', 'Polier'];

export const DEFAULT_PROFILE: UserProfile = {
    fullName: 'Max Mustermann',
    role: 'Bauleiter',
    phone: '',
    mobile: '+49 170 1234567',
    email: 'm.mustermann@bau-ag.de',
    companyId: null,
    company: 'Baupartner AG & Co. KG',
    companyAddress: '',
    signAs: 'iA',
    closing: 'Mit freundlichen Grüßen'
};

const STORAGE_KEY = 'userProfile';

/** Reads the profile; older profiles (with permissions, project fields …) are migrated. */
export const loadProfile = (): UserProfile => {
    let raw: any = null;
    try {
        raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
        raw = null;
    }
    const name = localStorage.getItem('userName');
    if (!raw || typeof raw !== 'object') return {...DEFAULT_PROFILE, fullName: name || DEFAULT_PROFILE.fullName};
    return {
        fullName: raw.fullName || name || DEFAULT_PROFILE.fullName,
        role: raw.role || DEFAULT_PROFILE.role,
        phone: raw.phone ?? '',
        mobile: raw.mobile ?? '',
        email: raw.email ?? '',
        companyId: typeof raw.companyId === 'number' ? raw.companyId : null,
        company: raw.company ?? DEFAULT_PROFILE.company,
        companyAddress: raw.companyAddress ?? '',
        signAs: raw.signAs === 'iV' || raw.signAs === 'none' ? raw.signAs : 'iA',
        closing: raw.closing || DEFAULT_PROFILE.closing
    };
};

export const saveProfile = (p: UserProfile) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    if (p.fullName.trim()) localStorage.setItem('userName', p.fullName.trim());
    window.dispatchEvent(new Event('profile-updated'));
};

/** The own company from Stammdaten that the profile points to (or the only own company). */
export const findOwnCompany = (p: UserProfile, companies: Company[]): Company | null => {
    const own = companies.filter((c) => c.company_type === 'own');
    return own.find((c) => c.id === p.companyId) ?? (p.companyId == null && own.length === 1 ? own[0] : null);
};

/** Company name + address for the letterhead. */
export const senderCompany = (p: UserProfile, companies: Company[]) => {
    const own = findOwnCompany(p, companies);
    return {
        name: own?.name || p.company || DEFAULT_PROFILE.company,
        address: (own?.address || p.companyAddress || '').trim(),
        vobRules: own?.vob_rules?.trim() || ''
    };
};

const SIGN_PREFIX: Record<SignAs, string> = {iA: 'i. A. ', iV: 'i. V. ', none: ''};

/** Closing + signature block used at the end of every letter. */
export const signatureBlock = (p: UserProfile, companyName: string) => {
    const contact = [
        p.phone.trim() && `Tel. ${p.phone.trim()}`,
        p.mobile.trim() && `Mobil ${p.mobile.trim()}`,
        p.email.trim() && `E-Mail ${p.email.trim()}`
    ].filter(Boolean) as string[];
    return [
        p.closing.trim() || DEFAULT_PROFILE.closing,
        '',
        `${SIGN_PREFIX[p.signAs]}${p.fullName.trim() || DEFAULT_PROFILE.fullName}`,
        `${p.role} · ${companyName}`,
        ...contact
    ].join('\n');
};

/** One-line sender address above the recipient (like a window envelope "Rücksendezeile"). */
export const senderLine = (p: UserProfile, company: {name: string; address: string}) =>
    [company.name, company.address.replace(/\s*\n\s*/g, ', '), !company.address ? p.fullName : '']
        .filter(Boolean)
        .join(' · ');

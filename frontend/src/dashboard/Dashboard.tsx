import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Users,
    CloudSun,
    Layers,
    PhoneCall,
    Phone,
    Mail,
    Search,
    X,
    Building2,
    CheckCircle2,
    ArrowRight,
    AlertCircle,
    AlertTriangle,
    LayoutDashboard,
    Wind,
    Droplets,
    ClipboardList
} from 'lucide-react';
import './Dashboard.css';
import '@frontend/src/index.css';
import { useProjects } from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import {
    api,
    Company,
    Contract,
    DailyReportOut,
    DefectSummary,
    WeatherResponse
} from '../services/api';
import {daysBetween, formatDe, parseIsoDate, startOfToday, todayIso} from '../utils/dates';


interface WorkerPerson {
    id: string;
    name: string;
    role: string;
    company: string;
    present: boolean;
    arrivalTime?: string;
    absenceReason?: string;
}

export const Dashboard: React.FC = () => {
    const navigate = useNavigate();
    const { t, tf, tv, locale } = useLanguage();
    const userName = localStorage.getItem('userName') || t('role_site_manager');
    const { projects, activeProject, setActiveProjectId } = useProjects();

    // Modal States
    const [showStaffModal, setShowStaffModal] = useState(false);
    const [staffTab, setStaffTab] = useState<'present' | 'absent'>('present');
    const [staffSearch, setStaffSearch] = useState('');

    const [showEmergencyModal, setShowEmergencyModal] = useState(false);

    // ---- Backend-Daten (Fallback: Beispieldaten unten) ----
    const projectId = Number(activeProject.id);
    const [todayReport, setTodayReport] = useState<DailyReportOut | null>(null);
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [clientCompany, setClientCompany] = useState<Company | null>(null);
    // Live-Wetter am Projektort (GET /api/weather → Open-Meteo); null = nicht verfügbar
    const [liveWeather, setLiveWeather] = useState<WeatherResponse | null>(null);
    // Mängel (GET /api/defects/summary); null = nicht verfügbar
    const [defectSummary, setDefectSummary] = useState<DefectSummary | null>(null);

    const loadBackend = async () => {
        setLiveWeather(null);
        const [rep, con, cli, wea, def] = await Promise.allSettled([
            api.getReport(todayIso(), projectId),
            api.listContracts(projectId),
            api.listCompanies({ company_type: 'client' }),
            api.getWeather(todayIso(), projectId),
            api.getDefectSummary(projectId)
        ]);
        setDefectSummary(def.status === 'fulfilled' ? def.value : null);
        setTodayReport(rep.status === 'fulfilled' && rep.value.id != null ? rep.value : null);
        setLiveWeather(wea.status === 'fulfilled' ? wea.value : null);
        setContracts(con.status === 'fulfilled' ? con.value : []);
        setClientCompany(cli.status === 'fulfilled' && cli.value.length > 0 ? cli.value[0] : null);
    };

    useEffect(() => {
        loadBackend();
    }, [projectId]);

    // 1. Mitarbeiter-Stand (Worker attendance data per project)
    const getStaffData = () => {
        const pid = String(activeProject.id);
        if (pid === '2' || pid === 'proj-2') {
            const workers: WorkerPerson[] = [
                { id: 'w-sp-1', name: 'Jürgen Lehmann', role: 'Polier Spezialtiefbau', company: 'Fa. Bauer-Ramm', present: true, arrivalTime: '06:30 Uhr' },
                { id: 'w-sp-2', name: 'Frank Behrens', role: 'Großgeräteführer Rammgerät', company: 'Fa. Bauer-Ramm', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sp-3', name: 'Tomasz Nowak', role: 'Spezialtiefbau-Facharbeiter', company: 'Fa. Bauer-Ramm', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sp-4', name: 'Piotr Kaczmarek', role: 'Spezialtiefbau-Facharbeiter', company: 'Fa. Bauer-Ramm', present: true, arrivalTime: '06:50 Uhr' },
                { id: 'w-sp-5', name: 'Sergej Braun', role: 'Schweißfachkraft Spundwand', company: 'Fa. Bauer-Ramm', present: true, arrivalTime: '07:00 Uhr' },
                { id: 'w-sp-6', name: 'Uwe Seidel', role: 'Vorarbeiter Wasserhaltung', company: 'Fa. HydroSpree', present: true, arrivalTime: '06:40 Uhr' },
                { id: 'w-sp-7', name: 'Lutz Krüger', role: 'Brunnenbaumeister', company: 'Fa. HydroSpree', present: true, arrivalTime: '07:05 Uhr' },
                { id: 'w-sp-8', name: 'Ahmed Mansour', role: 'Tiefbaufacharbeiter', company: 'Fa. Flussbau Nord', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sp-9', name: 'Oleg Danilow', role: 'Baggerführer Kettenbagger', company: 'Fa. Flussbau Nord', present: true, arrivalTime: '06:50 Uhr' },
                { id: 'w-sp-10', name: 'Matthias Horn', role: 'Messgehilfe Vermessung', company: 'Vermessungsbüro Spree', present: true, arrivalTime: '07:15 Uhr' }
            ];
            return {
                plannedCount: 26,
                presentCount: 26,
                absentCount: 0,
                workers
            };
        } else if (pid === '3' || pid === 'proj-3') {
            const workers: WorkerPerson[] = [
                { id: 'w-tg-1', name: 'Dr. Jens Franke', role: 'Leitender Schadstoffgutachter', company: 'Dr. Franke Sachverständige', present: true, arrivalTime: '07:30 Uhr' },
                { id: 'w-tg-2', name: 'Torsten Bergmann', role: 'Sachkundiger TRGS 519', company: 'Fa. CleanAsbest', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-tg-3', name: 'Marek Wisniewski', role: 'Schadstoffsanierer', company: 'Fa. CleanAsbest', present: true, arrivalTime: '06:50 Uhr' },
                { id: 'w-tg-4', name: 'Andrzej Kowal', role: 'Schadstoffsanierer', company: 'Fa. CleanAsbest', present: true, arrivalTime: '06:50 Uhr' },
                { id: 'w-tg-5', name: 'Heiko Klein', role: 'Restaurator Stuckarbeiten', company: 'Restaurator Klein', present: true, arrivalTime: '07:15 Uhr' },
                { id: 'w-tg-6', name: 'Christian Vogt', role: 'Zimmerermeister Schutzgerüst', company: 'Holz & Denkmal', present: true, arrivalTime: '07:00 Uhr' }
            ];
            return {
                plannedCount: 18,
                presentCount: 18,
                absentCount: 0,
                workers
            };
        } else {
            // Default: Schulzentrum Nord (38 planned, 34 present, 4 absent)
            const workers: WorkerPerson[] = [
                // Present workers
                { id: 'w-sz-1', name: 'Markus Weber', role: 'Oberpolier Rohbau', company: 'Fa. BetonTech', present: true, arrivalTime: '06:15 Uhr' },
                { id: 'w-sz-2', name: 'Jan Kowalski', role: 'Vorarbeiter Eisenflechter', company: 'Fa. BetonTech', present: true, arrivalTime: '06:30 Uhr' },
                { id: 'w-sz-3', name: 'Dariusz Nowak', role: 'Eisenflechter Decke B', company: 'Fa. BetonTech', present: true, arrivalTime: '06:35 Uhr' },
                { id: 'w-sz-4', name: 'Piotr Zielinski', role: 'Eisenflechter Decke B', company: 'Fa. BetonTech', present: true, arrivalTime: '06:35 Uhr' },
                { id: 'w-sz-5', name: 'Bogdan Mazur', role: 'Eisenflechter Decke B', company: 'Fa. BetonTech', present: true, arrivalTime: '06:40 Uhr' },
                { id: 'w-sz-6', name: 'Ahmet Yilmaz', role: 'Vorarbeiter Schalungsbau', company: 'Fa. BetonTech', present: true, arrivalTime: '06:30 Uhr' },
                { id: 'w-sz-7', name: 'Mehmet Kaya', role: 'Schalungsbauer Unterzüge', company: 'Fa. BetonTech', present: true, arrivalTime: '06:40 Uhr' },
                { id: 'w-sz-8', name: 'Emre Sahin', role: 'Schalungsbauer Decke', company: 'Fa. BetonTech', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sz-9', name: 'Thomas Müller', role: 'Kranführer Turmdrehkran 1', company: 'Fa. BetonTech', present: true, arrivalTime: '06:20 Uhr' },
                { id: 'w-sz-10', name: 'Jens Wagner', role: 'Kranführer Turmdrehkran 2', company: 'Fa. BetonTech', present: true, arrivalTime: '06:25 Uhr' },
                { id: 'w-sz-11', name: 'Stefan Schmidt', role: 'Baumaschinist Kettenbagger', company: 'Fa. Erd & Grund', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sz-12', name: 'Christian Bauer', role: 'Tiefbaufacharbeiter Grundleitungen', company: 'Fa. Erd & Grund', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sz-13', name: 'Sven Krause', role: 'Rohrleger DN 150', company: 'Fa. Erd & Grund', present: true, arrivalTime: '06:50 Uhr' },
                { id: 'w-sz-14', name: 'Michael Wolf', role: 'Bauleiter TGA Elektro', company: 'Fa. Elektro-Klima', present: true, arrivalTime: '07:00 Uhr' },
                { id: 'w-sz-15', name: 'Lukas Fischer', role: 'Elektroinstallateur Leerrohre', company: 'Fa. Elektro-Klima', present: true, arrivalTime: '06:55 Uhr' },
                { id: 'w-sz-16', name: 'Tobias Hoffmann', role: 'Monteur Lüftungsschacht', company: 'Fa. Elektro-Klima', present: true, arrivalTime: '07:05 Uhr' },
                { id: 'w-sz-17', name: 'Andreas Becker', role: 'Zimmerermeister Hallendach', company: 'Fa. Holzwerk Nord', present: true, arrivalTime: '06:40 Uhr' },
                { id: 'w-sz-18', name: 'Carsten Lindner', role: 'Zimmerer Dachtragwerk', company: 'Fa. Holzwerk Nord', present: true, arrivalTime: '06:45 Uhr' },
                { id: 'w-sz-19', name: 'Felix Otto', role: 'Zimmerer Hallendach', company: 'Fa. Holzwerk Nord', present: true, arrivalTime: '06:50 Uhr' },
                // Missing workers with reasons
                { id: 'w-sz-a1', name: 'Klaus Richter', role: 'Schalungsbauer Bauteil B', company: 'Fa. BetonTech', present: false, absenceReason: 'Krankmeldung bis 24.11. (AU liegt vor)' },
                { id: 'w-sz-a2', name: 'Ali Demir', role: 'Eisenflechter Decke', company: 'Fa. BetonTech', present: false, absenceReason: 'Geplanter Erholungsurlaub' },
                { id: 'w-sz-a3', name: 'Florian Koch', role: 'Auszubildender TGA', company: 'Fa. Elektro-Klima', present: false, absenceReason: 'Berufsschule (Blockunterricht OSZ)' },
                { id: 'w-sz-a4', name: 'Goran Petrovic', role: 'Tiefbaufacharbeiter', company: 'Fa. Erd & Grund', present: false, absenceReason: 'Unentschuldigt abwesend (Polier informiert)' }
            ];
            return {
                plannedCount: 38,
                presentCount: 34,
                absentCount: 4,
                workers
            };
        }
    };

    // Echte Zahlen: Anwesenheit aus dem heutigen Bautagesbericht, Soll aus den Verträgen (Sollstärke)
    const demoStaff = getStaffData();
    const attendance = todayReport?.attendance ?? [];
    const contractPlanned = contracts.reduce((sum, c) => sum + (c.planned_workforce ?? 0), 0);
    const reportPresent =
        todayReport?.workforce_count ?? (attendance.length > 0 ? attendance.reduce((s, a) => s + a.workers, 0) : null);
    const usesBackendStaff = reportPresent != null;
    const staffData = usesBackendStaff
        ? {
              plannedCount: contractPlanned > 0 ? contractPlanned : reportPresent!,
              presentCount: reportPresent!,
              absentCount: Math.max(0, (contractPlanned > 0 ? contractPlanned : reportPresent!) - reportPresent!),
              workers: demoStaff.workers
          }
        : demoStaff;

    // 2. Wetter Kachel Daten (Site weather per project)
    const getWeatherData = () => {
        const pid = String(activeProject.id);
        if (pid === '2' || pid === 'proj-2') {
            return {
                temp: 6,
                condition: 'Windig am Spreeufer',
                wind: '32 km/h (Böen 48 km/h)',
                rainRisk: '20% Niederschlag',
                craneStatus: 'Böenwarnung aktiv',
                concreteStatus: 'Betonage zulässig (> +5°C)',
                isWindWarning: true
            };
        } else if (pid === '3' || pid === 'proj-3') {
            return {
                temp: 8,
                condition: 'Leicht bewölkt & trocken',
                wind: '16 km/h',
                rainRisk: '5% Niederschlag',
                craneStatus: 'Freier Kranbetrieb',
                concreteStatus: 'Konditionierter Innenbereich',
                isWindWarning: false
            };
        } else {
            return {
                temp: 7,
                condition: 'Bedeckt & böig',
                wind: '24 km/h (Böen 38 km/h)',
                rainRisk: '15% Niederschlag',
                craneStatus: 'Kran freigegeben (< 45 km/h)',
                concreteStatus: 'Betonage zulässig (> +5°C)',
                isWindWarning: false
            };
        }
    };

    // Reihenfolge: Live-Wetter am Projektort → Wetter aus dem heutigen Bautagesbericht → Beispielwerte
    // (Beispielwerte nur, wenn Backend/Wetterdienst nicht erreichbar oder Projekt ohne Ort).
    const demoWeather = getWeatherData();
    const lw = liveWeather;
    const weatherData = lw
        ? {
              ...demoWeather,
              temp: lw.temperature_c ?? demoWeather.temp,
              condition: lw.condition,
              wind: lw.wind_kmh != null
                  ? `${lw.wind_kmh} km/h${lw.wind_gusts_kmh != null ? ` (${t('db_gusts')} ${lw.wind_gusts_kmh} km/h)` : ''}`
                  : '– km/h',
              rainRisk: lw.precipitation_probability != null
                  ? `${lw.precipitation_probability}% ${t('db_precip')}`
                  : lw.precipitation_mm != null ? `${lw.precipitation_mm} mm ${t('db_precip')}` : `– ${t('db_precip')}`,
              craneStatus: lw.crane_status ?? demoWeather.craneStatus,
              concreteStatus: lw.concrete_status ?? demoWeather.concreteStatus,
              isWindWarning: lw.is_wind_warning ?? false,
              source: lw.source
          }
        : todayReport && (todayReport.weather || todayReport.temperature_c != null)
        ? {
              ...demoWeather,
              temp: todayReport.temperature_c ?? demoWeather.temp,
              condition: todayReport.weather || demoWeather.condition,
              concreteStatus:
                  todayReport.temperature_c != null
                      ? todayReport.temperature_c > 5
                          ? t('db_concrete_ok')
                          : t('db_concrete_winter')
                      : demoWeather.concreteStatus
          }
        : demoWeather;

    // 3. Zustand Beton Kachel Daten (Concrete status per project)
    const getConcreteData = () => {
        const pid = String(activeProject.id);
        if (pid === '2' || pid === 'proj-2') {
            return {
                component: 'Spundwand-Kopfbalken Achse 1-4',
                spec: 'C30/37 XA2 (WU-Beton)',
                strengthPercent: 85,
                strengthMpa: '25.5 / 30 N/mm²',
                age: 'Tag 7 von 28',
                temp: '19.2°C',
                stripDays: 'Bereits ausgeschalt',
                status: 'WU-Güteprüfung i.O.'
            };
        } else if (pid === '3' || pid === 'proj-3') {
            return {
                component: 'Fundamentunterfangung Aufzug',
                spec: 'C20/25 XC2',
                strengthPercent: 100,
                strengthMpa: '28.0 N/mm² (Endfestigkeit)',
                age: 'Tag 14 von 28',
                temp: '16.5°C',
                stripDays: 'Vollständig freigegeben',
                status: 'Prüfstatik abgenommen'
            };
        } else {
            return {
                component: 'Decke 1. OG Bauteil B',
                spec: 'C25/30 XC1/XC2',
                strengthPercent: 68,
                strengthMpa: '20.4 / 30 N/mm²',
                age: 'Tag 3 von 28',
                temp: '24.8°C',
                stripDays: 'Freigabe in 4 Werktagen (25.11.)',
                status: 'Hydratationswärme optimal'
            };
        }
    };

    const concreteData = getConcreteData();

    // 4. Auftraggeber & Notfall-Kontakt Daten (Client emergency per project)
    const getClientData = () => {
        const pid = String(activeProject.id);
        if (pid === '2' || pid === 'proj-2') {
            return {
                clientName: activeProject.client || 'Spreebogen Wohnbau GmbH & Co. KG',
                clientShort: 'Spreebogen Wohnbau GmbH',
                contactPerson: 'Dr. Carsten Brandt (Technischer Leiter)',
                emergencyPhone: '+49 30 5549-8800',
                email: 'notfall@spreebogen-wohnbau.de',
                hotline24h: '0800 5549000',
                address: 'Köpenicker Str. 112, 10179 Berlin'
            };
        } else if (pid === '3' || pid === 'proj-3') {
            return {
                clientName: activeProject.client || 'Tiergarten Real Estate AG',
                clientShort: 'Tiergarten Real Estate AG',
                contactPerson: 'Herr Markus von Berg (Asset & Project Lead)',
                emergencyPhone: '+49 30 2099-3100',
                email: 'projekte@tiergarten-ag.de',
                hotline24h: '0800 2099112',
                address: 'Stauffenbergstr. 18, 10785 Berlin'
            };
        } else {
            return {
                clientName: activeProject.client || 'Städtisches Hochbauamt Berlin-Mitte',
                clientShort: 'Städtisches Hochbauamt Mitte',
                contactPerson: 'Frau Dipl.-Ing. Susanne Weber (Bauherrenvertreterin)',
                emergencyPhone: '+49 30 9018-24400',
                email: 'susanne.weber@ba-mitte.berlin.de',
                hotline24h: '0800 2284357',
                address: 'Karl-Marx-Allee 31, 10178 Berlin'
            };
        }
    };

    // Auftraggeber aus den Stammdaten (Firma vom Typ "client"), sonst Beispieldaten
    const demoClient = getClientData();
    const clientData = clientCompany
        ? {
              ...demoClient,
              clientName: clientCompany.name,
              clientShort: clientCompany.name,
              contactPerson: clientCompany.contact_person || demoClient.contactPerson,
              emergencyPhone: clientCompany.phone || demoClient.emergencyPhone,
              email: clientCompany.email || demoClient.email,
              address: clientCompany.address || demoClient.address
          }
        : demoClient;

    // Bauzeit-Fortschritt aus den Projekt-Stammdaten (start_date/end_date)
    const buildTime = (() => {
        if (!activeProject.start_date || !activeProject.end_date) return null;
        const start = parseIsoDate(activeProject.start_date);
        const end = parseIsoDate(activeProject.end_date);
        const total = daysBetween(start, end);
        if (total <= 0) return null;
        const done = Math.min(Math.max(daysBetween(start, startOfToday()), 0), total);
        return {percent: Math.round((done / total) * 100), remainingWeeks: Math.ceil((total - done) / 7)};
    })();

    // Filter staff in modal
    const filteredWorkers = staffData.workers.filter((w) => {
        if (staffTab === 'present' && !w.present) return false;
        if (staffTab === 'absent' && w.present) return false;
        if (!staffSearch.trim()) return true;
        const q = staffSearch.toLowerCase();
        return (
            w.name.toLowerCase().includes(q) ||
            w.role.toLowerCase().includes(q) ||
            w.company.toLowerCase().includes(q)
        );
    });

    return (
        <>
            {/* Welcome Hero Banner */}
            <section className="welcome-hero">
                <div className="tp-title-group">
                    <div className="tp-title-icon"><LayoutDashboard size={22} /></div>
                    <div>
                        <h1 className="welcome-title">{t('dash_hello')}, {userName}!</h1>
                    </div>
                </div>
                <div className="hero-stats">
                    {/* Bauzeit statt Anwesenheit (die steht schon in der Mitarbeiter-Kachel darunter) */}
                    <div className="hero-stat-card" title={buildTime ? tf('db_buildtime_title', {from: formatDe(activeProject.start_date), to: formatDe(activeProject.end_date)}) : t('db_buildtime_missing')}>
                        <div className="hero-stat-number">{buildTime ? `${buildTime.percent} %` : '–'}</div>
                        <div className="hero-stat-label">
                            {buildTime
                                ? buildTime.remainingWeeks > 0
                                    ? tf('db_buildtime_left', {n: buildTime.remainingWeeks})
                                    : t('db_buildtime_over')
                                : t('db_buildtime')}
                        </div>
                    </div>
                    <div className="hero-stat-card">
                        <div className="hero-stat-number">{tv(activeProject.status)}</div>
                        <div className="hero-stat-label">{t('db_project_status')}</div>
                    </div>
                </div>
            </section>

            {/* =========================================================================
                DIE 4 HAUPTKACHELN:
                1. Mitarbeiter-Stand (mit Klick-Namensliste)
                2. Wetter
                3. Zustand Beton
                4. Auftraggeber & Notfall-Kontakt
               ========================================================================= */}
            <section className="kpi-grid">
                {/* 1. KACHEL: MITARBEITER-STAND */}
                <div
                    className="kpi-card interactive"
                    onClick={() => setShowStaffModal(true)}
                    title={t('db_staff_title')}
                >
                    <div style={{ flex: 1 }}>
                        <div className="kpi-label">{t('db_staff')}</div>
                        <div className="kpi-value">
                            {staffData.presentCount} / {staffData.plannedCount}
                        </div>
                        <div className={`kpi-sub ${staffData.absentCount > 0 ? 'alert' : ''}`}>
                            {staffData.absentCount > 0
                                ? tf('db_missing_n', {n: staffData.absentCount})
                                : t('db_full')}
                        </div>
                        <div className="kpi-click-hint">
                            <Search size={12} />
                            <span>{t('db_click_names')}</span>
                        </div>
                    </div>
                    <div className="kpi-icon" style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
                        <Users size={26} />
                    </div>
                </div>

                {/* KACHEL: OFFENE MÄNGEL (echte Daten aus dem Mängelmanagement) */}
                <div
                    className="kpi-card interactive"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate('/maengel')}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            navigate('/maengel');
                        }
                    }}
                    title={t('db_defects_title')}
                >
                    <div style={{ flex: 1 }}>
                        <div className="kpi-label">{t('db_open_defects')}</div>
                        <div className="kpi-value">{defectSummary ? defectSummary.open : '–'}</div>
                        <div className={`kpi-sub ${defectSummary && defectSummary.overdue > 0 ? 'alert' : ''}`}>
                            {!defectSummary
                                ? t('db_defects_unavailable')
                                : defectSummary.overdue > 0
                                    ? `${tf('db_n_overdue', {n: defectSummary.overdue})}${defectSummary.by_company[0]?.overdue ? ` • ${defectSummary.by_company[0].company}` : ''}`
                                    : tf('db_n_awaiting', {n: defectSummary.by_status.behoben})}
                        </div>
                        <div className="kpi-click-hint">
                            <Search size={12} />
                            <span>{t('db_click_defects')}</span>
                        </div>
                    </div>
                    <div className="kpi-icon" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                        <ClipboardList size={26} />
                    </div>
                </div>

                {/* 2. KACHEL: WETTER */}
                <div
                    className="kpi-card"
                    title={`${tf('db_weather_title', {name: activeProject.name})}${'source' in weatherData ? ` – ${weatherData.source}` : ''}`}
                >
                    <div style={{ flex: 1 }}>
                        <div className="kpi-label">{t('db_weather')}</div>
                        <div className="kpi-value">{weatherData.temp}°C • {weatherData.condition}</div>
                        <div className="kpi-weather-details">
                            <span className="kpi-weather-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Wind size={12} /> {weatherData.wind}</span>
                            <span className="kpi-weather-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Droplets size={12} /> {weatherData.rainRisk}</span>
                        </div>
                        <div className="kpi-sub" style={{ marginTop: '6px' }}>
                            {weatherData.concreteStatus}
                        </div>
                    </div>
                    <div className="kpi-icon" style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
                        <CloudSun size={26} />
                    </div>
                </div>

                {/* 3. KACHEL: ZUSTAND BETON */}
                <div
                    className="kpi-card"
                    title={t('db_concrete_title')}
                >
                    <div style={{ flex: 1 }}>
                        <div className="kpi-label">{t('db_concrete')}</div>
                        <div className="kpi-value" style={{ fontSize: '22px' }}>
                            {tf('db_strength', {n: concreteData.strengthPercent})}
                        </div>
                        <div className="kpi-concrete-progress">
                            <div className="kpi-concrete-bar">
                                <div
                                    className="kpi-concrete-fill"
                                    style={{ width: `${concreteData.strengthPercent}%` }}
                                />
                            </div>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-slate-700)', fontWeight: 600 }}>
                            {concreteData.component}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {t('db_core')} {concreteData.temp} • {concreteData.stripDays}
                        </div>
                    </div>
                    <div className="kpi-icon" style={{ backgroundColor: '#f1f5f9', color: '#475569' }}>
                        <Layers size={26} />
                    </div>
                </div>

                {/* 4. KACHEL: AUFTRAGGEBER & NOTFALLKONTAKT */}
                <div
                    className="kpi-card"
                    title={t('db_client_title')}
                >
                    <div style={{ flex: 1 }}>
                        <div className="kpi-label">{t('db_client')}</div>
                        <div className="kpi-value" style={{ fontSize: '17px', lineHeight: 1.25 }}>
                            {clientData.clientShort}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {clientData.contactPerson}
                        </div>
                        <button
                            type="button"
                            className="kpi-client-emergency-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowEmergencyModal(true);
                            }}
                        >
                            <PhoneCall size={12} />
                            <span>{t('db_contact_emergency')}</span>
                        </button>
                    </div>
                    <div className="kpi-icon" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
                        <AlertCircle size={26} />
                    </div>
                </div>
            </section>

            {/* =========================================================================
                UNTEN VOM DASHBOARD: ZULETZT GEÖFFNETE BAU-PROJEKTE
               ========================================================================= */}
            <section className="dash-recent-projects-section">
                <div className="dash-recent-header">
                    <div className="dash-recent-title-group">
                        <div className="dash-recent-icon">
                            <Building2 size={20} />
                        </div>
                        <div>
                            <h2 className="dash-recent-title">{t('db_recent')}</h2>
                        </div>
                    </div>

                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => navigate('/projects')}
                        style={{ fontSize: '12px' }}
                    >
                        {t('db_manage_projects')}
                    </button>
                </div>

                <div className="dash-recent-grid">
                    {projects.map((proj) => {
                        const isActive = proj.id === activeProject.id;
                        return (
                            <div
                                key={proj.id}
                                className={`dash-recent-card ${isActive ? 'active' : ''}`}
                            >
                                <div className="dash-recent-card-top">
                                    <div>
                                        <span className="dash-recent-nr">{proj.number}</span>
                                        <h3 className="dash-recent-name">{proj.name}</h3>
                                    </div>
                                    {isActive && (
                                        <span className="dash-badge-active-proj">
                                            <CheckCircle2 size={12} />
                                            <span>{t('db_active')}</span>
                                        </span>
                                    )}
                                </div>

                                <div className="dash-recent-details">
                                    <div><strong>{t('db_client_label')}</strong> {proj.client || t('db_no_info')}</div>
                                    <div><strong>{t('db_location')}</strong> {proj.location || 'Berlin'}</div>
                                    <div><strong>{t('db_phase')}</strong> {tv(proj.phase || 'Rohbau')}</div>
                                </div>

                                <div className="dash-recent-actions">
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                        {t('db_status')} <strong>{tv(proj.status)}</strong>
                                    </span>

                                    {isActive ? (
                                        <span style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 600 }}>
                                            {t('db_currently_open')}
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="dash-btn-switch-proj"
                                            onClick={() => setActiveProjectId(proj.id)}
                                        >
                                            <span>{t('db_open_project')}</span>
                                            <ArrowRight size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* =========================================================================
                MODAL 1: MITARBEITER-STAND (ANWESEND / FEHLEND LISTE)
               ========================================================================= */}
            {showStaffModal && (
                <div className="dash-modal-overlay" onClick={() => setShowStaffModal(false)}>
                    <div className="dash-modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="dash-modal-header">
                            <div className="dash-modal-title-group">
                                <div className="dash-modal-icon">
                                    <Users size={22} />
                                </div>
                                <div>
                                    <h3 className="dash-modal-title">{t('db_attendance')}</h3>
                                    <p className="dash-modal-sub">
                                        {activeProject.name} • {tf('db_attendance_sub', {planned: staffData.plannedCount, present: staffData.presentCount})}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="dash-modal-close"
                                onClick={() => setShowStaffModal(false)}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="dash-modal-toolbar">
                            <div className="dash-modal-tabs">
                                <button
                                    type="button"
                                    className={`dash-modal-tab ${staffTab === 'present' ? 'active' : ''}`}
                                    onClick={() => setStaffTab('present')}
                                >
                                    <span>{t('db_present')}</span>
                                    <span className="dash-modal-tab-badge present">
                                        {staffData.presentCount}
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    className={`dash-modal-tab ${staffTab === 'absent' ? 'active' : ''}`}
                                    onClick={() => setStaffTab('absent')}
                                >
                                    <span>{t('db_absent')}</span>
                                    <span className="dash-modal-tab-badge absent">
                                        {staffData.absentCount}
                                    </span>
                                </button>
                            </div>

                            <input
                                type="text"
                                className="dash-modal-search"
                                placeholder={t('db_search_ph')}
                                value={staffSearch}
                                onChange={(e) => setStaffSearch(e.target.value)}
                            />
                        </div>

                        <div className="dash-modal-body">
                            {/* Echte Anwesenheit je Firma aus dem heutigen Bautagesbericht */}
                            {attendance.length > 0 && (
                                <div style={{ marginBottom: '14px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '6px' }}>
                                        {tf('db_attendance_company', {date: new Date(todayIso()).toLocaleDateString(locale)})}
                                    </div>
                                    <div className="dash-workers-grid">
                                        {attendance.map((a, idx) => {
                                            const contract = contracts.find(
                                                (c) => c.contractor_name && a.company && c.contractor_name.toLowerCase() === a.company.toLowerCase()
                                            );
                                            const below = contract?.planned_workforce != null && a.workers < contract.planned_workforce;
                                            return (
                                                <div key={idx} className={`dash-worker-card ${below ? 'absent' : 'present'}`}>
                                                    <div className="dash-worker-info">
                                                        <div className="dash-worker-name">{a.company || t('db_no_company')}</div>
                                                        <div className="dash-worker-trade">{a.trade || '–'}</div>
                                                    </div>
                                                    <div className="dash-worker-meta">
                                                        <span className={below ? 'dash-worker-reason' : 'dash-worker-time'}>
                                                            {a.workers}
                                                            {contract?.planned_workforce != null ? tf('db_planned_n', {n: contract.planned_workforce}) : ''} {t('db_people')}
                                                            {a.hours != null ? ` • ${a.hours} ${t('db_hours')}` : ''}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '10px 0 4px' }}>
                                        {t('db_demo_names')}
                                    </div>
                                </div>
                            )}
                            {filteredWorkers.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                                    {staffTab === 'absent'
                                        ? t('db_none_absent')
                                        : t('db_none_filter')}
                                </div>
                            ) : (
                                <div className="dash-workers-grid">
                                    {filteredWorkers.map((worker) => (
                                        <div
                                            key={worker.id}
                                            className={`dash-worker-card ${worker.present ? 'present' : 'absent'}`}
                                        >
                                            <div className="dash-worker-info">
                                                <div className="dash-worker-name">{worker.name}</div>
                                                <div className="dash-worker-trade">{worker.role}</div>
                                                <div className="dash-worker-company">{worker.company}</div>
                                            </div>

                                            <div className="dash-worker-meta">
                                                {worker.present ? (
                                                    <span className="dash-worker-time">
                                                        {t('db_since')} {worker.arrivalTime}
                                                    </span>
                                                ) : (
                                                    <span className="dash-worker-reason">
                                                        {worker.absenceReason || t('db_absent_short')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* =========================================================================
                MODAL 2: AUFTRAGGEBER & NOTFALLKONTAKT
               ========================================================================= */}
            {showEmergencyModal && (
                <div className="dash-modal-overlay" onClick={() => setShowEmergencyModal(false)}>
                    <div className="dash-modal-card" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="dash-modal-header">
                            <div className="dash-modal-title-group">
                                <div className="dash-modal-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                                    <PhoneCall size={22} />
                                </div>
                                <div>
                                    <h3 className="dash-modal-title">{t('db_emergency_title')}</h3>
                                    <p className="dash-modal-sub">{activeProject.name}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                className="dash-modal-close"
                                onClick={() => setShowEmergencyModal(false)}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="dash-modal-body">
                            {/* 24/7 Notfall-Hotline */}
                            <div className="dash-emergency-box">
                                <div>
                                    <div style={{ fontSize: '11px', color: '#991b1b', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <AlertTriangle size={12} /> {t('db_hotline')}
                                    </div>
                                    <a href={`tel:${clientData.hotline24h.replace(/\s+/g, '')}`} className="dash-emergency-hotline">
                                        <Phone size={18} />
                                        <span>{clientData.hotline24h}</span>
                                    </a>
                                </div>
                                <a
                                    href={`tel:${clientData.hotline24h.replace(/\s+/g, '')}`}
                                    className="btn btn-primary"
                                    style={{ backgroundColor: '#dc2626', borderColor: '#dc2626', fontSize: '12px', padding: '8px 14px' }}
                                >
                                    {t('db_call_now')}
                                </a>
                            </div>

                            {/* Contact Details List */}
                            <div className="dash-contact-list">
                                <div className="dash-contact-row">
                                    <div>
                                        <div className="dash-contact-label">{t('db_client_owner')}</div>
                                        <div className="dash-contact-val">{clientData.clientName}</div>
                                    </div>
                                </div>

                                <div className="dash-contact-row">
                                    <div>
                                        <div className="dash-contact-label">{t('db_client_rep')}</div>
                                        <div className="dash-contact-val">{clientData.contactPerson}</div>
                                    </div>
                                </div>

                                <div className="dash-contact-row">
                                    <div>
                                        <div className="dash-contact-label">{t('db_direct_phone')}</div>
                                        <div className="dash-contact-val">{clientData.emergencyPhone}</div>
                                    </div>
                                    <a
                                        href={`tel:${clientData.emergencyPhone.replace(/[^\d+]/g, '')}`}
                                        className="doc-btn"
                                        style={{ color: '#2563eb', fontWeight: 600 }}
                                    >
                                        <Phone size={13} />
                                        <span>{t('db_call')}</span>
                                    </a>
                                </div>

                                <div className="dash-contact-row">
                                    <div>
                                        <div className="dash-contact-label">{t('db_email_vob')}</div>
                                        <div className="dash-contact-val">{clientData.email}</div>
                                    </div>
                                    <a
                                        href={`mailto:${clientData.email}`}
                                        className="doc-btn"
                                        style={{ color: '#2563eb', fontWeight: 600 }}
                                    >
                                        <Mail size={13} />
                                        <span>{t('db_email')}</span>
                                    </a>
                                </div>

                                <div className="dash-contact-row">
                                    <div>
                                        <div className="dash-contact-label">{t('db_client_address')}</div>
                                        <div className="dash-contact-val">{clientData.address}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default Dashboard;

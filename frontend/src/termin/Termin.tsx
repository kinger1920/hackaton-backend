import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
  HardHat,
  Truck,
  Printer,
  X,
  Mail
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import { api, ConstructionPlan } from '../services/api';
import '@frontend/src/index.css';
import './Termin.css';

export type EventCategory = 'deadline' | 'milestone' | 'inspection' | 'meeting' | 'delivery';

export interface SiteAppointment {
  id: string;
  projectId: string | number;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  category: EventCategory;
  trade?: string;
  description?: string;
  vobReference?: string;
  isUrgent?: boolean;
}

const INITIAL_PROJECT_EVENTS: Record<string, SiteAppointment[]> = {
  // Proj-1: Schulzentrum Nord
  'proj-1': [
    {
      id: 'e-1',
      projectId: 'proj-1',
      title: 'Fristablauf TGA-Freigabe Schacht 3 (§ 6 VOB/B)',
      date: '2026-11-20',
      time: '12:00',
      category: 'deadline',
      trade: 'TGA (Fa. Elektro-Klima)',
      description: 'Zusage aus Jour Fixe 18 nicht eingehalten. Behinderungsanzeige erforderlich.',
      vobReference: '§ 6 Abs. 1 VOB/B',
      isUrgent: true
    },
    {
      id: 'e-2',
      projectId: 'proj-1',
      title: 'Prüfstatische Abnahme Deckenbewehrung 1. OG',
      date: '2026-11-21',
      time: '15:30',
      category: 'inspection',
      trade: 'Rohbau & Prüfstatik',
      description: 'Vor-Ort-Begehung mit Prüfstatiker Dr. Lang zur Betonierfreigabe Bauteil B.',
      vobReference: 'DIN 1045 / VOB/C'
    },
    {
      id: 'e-3',
      projectId: 'proj-1',
      title: 'Betonage Decke über 1. OG (280 m³ C30/37)',
      date: '2026-11-23',
      time: '07:30',
      category: 'milestone',
      trade: 'Rohbau (Fa. BetonTech)',
      description: 'Pumpeinsatz ab 07:30 Uhr. 2 Betonmischer-Züge getaktet.'
    },
    {
      id: 'e-4',
      projectId: 'proj-1',
      title: 'Rügefrist: 24x Brandschutztüren Lieferverzug',
      date: '2026-11-25',
      time: '17:00',
      category: 'deadline',
      trade: 'Türen & Innenausbau',
      description: '14 Tage Lieferverzug Hoffmann GmbH. Schadensersatzvorbehalt nach § 6 Abs. 6 VOB/B.',
      vobReference: '§ 6 Abs. 6 VOB/B',
      isUrgent: true
    },
    {
      id: 'e-5',
      projectId: 'proj-1',
      title: 'SiGeKo Sicherheitsbegehung Baustelle',
      date: '2026-11-27',
      time: '10:00',
      category: 'inspection',
      trade: 'Arbeitssicherheit',
      description: 'Kontrolle Absturzsicherungen 1. OG und Gerüstfreigabescheine.'
    },
    {
      id: 'e-6',
      projectId: 'proj-1',
      title: 'Jour Fixe Nr. 19 mit Bauherr & Planern',
      date: '2026-11-25',
      time: '14:00',
      category: 'meeting',
      trade: 'Gesamtbauleitung',
      description: 'Abstimmung Terminplanfortschreibung und Kostenfortschreibung.'
    },
    {
      id: 'e-7',
      projectId: 'proj-1',
      title: 'Lieferung 40t Fertigteil-Treppenläufe',
      date: '2026-11-28',
      time: '08:00',
      category: 'delivery',
      trade: 'Logistik & Krane',
      description: 'Mobilkran 90t bestellt. Zufahrt Süd freihalten.'
    },
    {
      id: 'e-8',
      projectId: 'proj-1',
      title: 'Meilenstein: Rohbaufertigstellung Bauteil B',
      date: '2026-12-04',
      time: '16:00',
      category: 'milestone',
      trade: 'Rohbau',
      description: 'Abschluss aller tragenden Decken und Außenwände Bauteil B.'
    }
  ],

  // Proj-2: Spreebogen
  'proj-2': [
    {
      id: 'e-201',
      projectId: 'proj-2',
      title: 'Baugrund-Frist: Anzeigepflicht Altfundamente Kaimauer',
      date: '2026-11-21',
      time: '11:00',
      category: 'deadline',
      trade: 'Spezialtiefbau',
      description: 'Schriftliche Mehrkostenanmeldung Baugrundhindernis an AG.',
      vobReference: '§ 2 Abs. 6 / § 6 VOB/B',
      isUrgent: true
    },
    {
      id: 'e-202',
      projectId: 'proj-2',
      title: 'Meilenstein: Einbringen Spundwand Achse 1-4',
      date: '2026-11-24',
      time: '16:30',
      category: 'milestone',
      trade: 'Spezialtiefbau (Fa. Bauer-Ramm)',
      description: 'Verbau zur Wasserseite vollständig gerammt.'
    },
    {
      id: 'e-203',
      projectId: 'proj-2',
      title: 'Wasserrechtliche Prüfung (Umweltamt)',
      date: '2026-11-26',
      time: '09:30',
      category: 'inspection',
      trade: 'Wasserhaltung',
      description: 'Überprüfung Einleitwerte Grundwasserabsenkung Spree.'
    },
    {
      id: 'e-204',
      projectId: 'proj-2',
      title: 'Lieferung Rammrohre & Spunddielen',
      date: '2026-11-27',
      time: '07:00',
      category: 'delivery',
      trade: 'Logistik',
      description: 'Schwerlasttransport 3 Tieflader.'
    }
  ],

  // Proj-3: Airport City
  'proj-3': [
    {
      id: 'e-301',
      projectId: 'proj-3',
      title: 'Brandschutz-Abnahme Brandabschnitt 2 (TÜV)',
      date: '2026-11-22',
      time: '10:00',
      category: 'inspection',
      trade: 'Brandschutz & TGA',
      description: 'Vollständige Prüfung der Entrauchungs- und Sprinklerklappen.',
      isUrgent: true
    },
    {
      id: 'e-302',
      projectId: 'proj-3',
      title: 'Meilenstein: Endmontage RLT-Zentralgeräte Dach',
      date: '2026-11-24',
      time: '15:00',
      category: 'milestone',
      trade: 'Lüftungsbau',
      description: 'Hubarbeiten mit Autokran 160t.'
    },
    {
      id: 'e-303',
      projectId: 'proj-3',
      title: 'VOB-Frist: Mängelbeseitigung Estrichfugen',
      date: '2026-11-26',
      time: '18:00',
      category: 'deadline',
      trade: 'Bodenleger',
      description: 'Frist nach § 4 Abs. 7 VOB/B zur Nachbesserung.',
      vobReference: '§ 4 Abs. 7 VOB/B',
      isUrgent: true
    }
  ]
};

export const Termin: React.FC = () => {
  const navigate = useNavigate();
  const { activeProject } = useProjects();
  const { t } = useLanguage();

  // Calendar Date State (Standard: November 2026, where today is 21.11.2026)
  const [currentYear, setCurrentYear] = useState<number>(2026);
  const [currentMonth, setCurrentMonth] = useState<number>(10); // 0-indexed: 10 = November
  const [selectedDateStr, setSelectedDateStr] = useState<string>('2026-11-21');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');

  // Appointments State
  const [appointments, setAppointments] = useState<SiteAppointment[]>(() => {
    try {
      const stored = localStorage.getItem(`siteAppointments_${activeProject.id}`);
      if (stored) return JSON.parse(stored);
    } catch {
      // fallback
    }
    return INITIAL_PROJECT_EVENTS[activeProject.id] || INITIAL_PROJECT_EVENTS['proj-1'] || [];
  });

  // Modal State for adding new appointment
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(selectedDateStr);
  const [newTime, setNewTime] = useState('09:00');
  const [newCategory, setNewCategory] = useState<EventCategory>('deadline');
  const [newTrade, setNewTrade] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newVobRef, setNewVobRef] = useState('');
  const [newIsUrgent, setNewIsUrgent] = useState(false);
  const [backendPlans, setBackendPlans] = useState<ConstructionPlan[]>([]);

  // Synchronize when project changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`siteAppointments_${activeProject.id}`);
      if (stored) {
        setAppointments(JSON.parse(stored));
      } else {
        const initial = INITIAL_PROJECT_EVENTS[activeProject.id] || INITIAL_PROJECT_EVENTS['proj-1'] || [];
        setAppointments(initial);
      }
    } catch {
      setAppointments(INITIAL_PROJECT_EVENTS[activeProject.id] || []);
    }

    // Load backend construction plans
    api.listPlans(Number(activeProject.id))
      .then((plans) => setBackendPlans(plans))
      .catch((err) => console.warn('Backend listPlans Fallback:', err));
  }, [activeProject.id]);

  const saveAppointments = (updated: SiteAppointment[]) => {
    setAppointments(updated);
    try {
      localStorage.setItem(`siteAppointments_${activeProject.id}`, JSON.stringify(updated));
    } catch {
      // fallback
    }
  };

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleJumpToToday = () => {
    setCurrentYear(2026);
    setCurrentMonth(10); // November 2026
    setSelectedDateStr('2026-11-21');
  };

  // Calendar Day Computation
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7; // Monday = 0
  const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

  // Create 42 grid cells (6 rows x 7 cols)
  interface DayCellData {
    dayNumber: number;
    dateStr: string;
    isCurrentMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
  }

  const calendarDays: DayCellData[] = [];

  // Previous month trailing days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const prevM = currentMonth === 0 ? 12 : currentMonth;
    const prevY = currentMonth === 0 ? currentYear - 1 : currentYear;
    const dateStr = `${prevY}-${String(prevM).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    calendarDays.push({
      dayNumber: day,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === '2026-11-21',
      isSelected: dateStr === selectedDateStr
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: true,
      isToday: dateStr === '2026-11-21',
      isSelected: dateStr === selectedDateStr
    });
  }

  // Next month leading days
  const remainingCells = 42 - calendarDays.length;
  for (let d = 1; d <= remainingCells; d++) {
    const nextM = currentMonth === 11 ? 1 : currentMonth + 2;
    const nextY = currentMonth === 11 ? currentYear + 1 : currentYear;
    const dateStr = `${nextY}-${String(nextM).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    calendarDays.push({
      dayNumber: d,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === '2026-11-21',
      isSelected: dateStr === selectedDateStr
    });
  }

  // Filter appointments
  const filteredAppointments = appointments.filter((app) => {
    if (activeCategoryFilter === 'all') return true;
    return app.category === activeCategoryFilter;
  });

  // Group filtered appointments by date
  const eventsByDate: Record<string, SiteAppointment[]> = {};
  filteredAppointments.forEach((app) => {
    if (!eventsByDate[app.date]) {
      eventsByDate[app.date] = [];
    }
    eventsByDate[app.date].push(app);
  });

  // Selected Day Events
  const selectedDayEvents = appointments.filter((app) => app.date === selectedDateStr);

  // Month Display Name
  const monthNamesDe = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];
  const currentMonthName = `${monthNamesDe[currentMonth]} ${currentYear}`;

  // Form submit for new event
  const handleCreateAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDate) return;

    const newApp: SiteAppointment = {
      id: `app-${Date.now()}`,
      projectId: activeProject.id,
      title: newTitle.trim(),
      date: newDate,
      time: newTime || '09:00',
      category: newCategory,
      trade: newTrade.trim() || undefined,
      description: newDesc.trim() || undefined,
      vobReference: newVobRef.trim() || undefined,
      isUrgent: newIsUrgent
    };

    saveAppointments([...appointments, newApp]);
    setSelectedDateStr(newDate);
    setShowAddModal(false);

    // Reset inputs
    setNewTitle('');
    setNewDesc('');
    setNewVobRef('');
    setNewIsUrgent(false);
  };

  const getCategoryLabel = (cat: EventCategory) => {
    switch (cat) {
      case 'deadline':
        return t('term_cat_deadlines');
      case 'milestone':
        return t('term_cat_milestones');
      case 'inspection':
        return t('term_cat_inspections');
      case 'meeting':
        return t('term_cat_meetings');
      case 'delivery':
        return t('term_cat_deliveries');
      default:
        return cat;
    }
  };

  const formatDisplayDate = (dStr: string) => {
    try {
      const [y, m, d] = dStr.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    } catch {
      return dStr;
    }
  };

  return (
    <div className="termin-container">
      {/* Page Header */}
      <section className="termin-header">
        <div className="termin-header-left">
          <div className="termin-header-icon">
            <CalendarIcon size={28} />
          </div>
          <div>
            <h1 className="termin-title">{t('term_title')}</h1>
            <p className="termin-sub">
              {t('term_sub')} <strong>{activeProject.name}</strong> ({activeProject.number})
              {backendPlans.length > 0 && (
                <span style={{ marginLeft: '10px', fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>
                  ✓ {backendPlans.length} {backendPlans.length === 1 ? 'Bauplan' : 'Baupläne'} synchronisiert
                </span>
              )}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.print()}
            title={t('btn_print')}
          >
            <Printer size={16} />
            <span>{t('btn_print')}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNewDate(selectedDateStr);
              setShowAddModal(true);
            }}
          >
            <Plus size={16} />
            <span>{t('term_btn_new')}</span>
          </button>
        </div>
      </section>

      {/* Calendar Controls & Category Filter Bar */}
      <section className="calendar-controls">
        <div className="calendar-nav-group">
          <button
            type="button"
            className="cal-nav-btn"
            onClick={handlePrevMonth}
            title="Vorheriger Monat"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="calendar-month-title">{currentMonthName}</div>

          <button
            type="button"
            className="cal-nav-btn"
            onClick={handleNextMonth}
            title="Nächster Monat"
          >
            <ChevronRight size={18} />
          </button>

          <button
            type="button"
            className="cal-today-btn"
            onClick={handleJumpToToday}
          >
            {t('term_today')} (21. Nov)
          </button>
        </div>

        {/* Filter Pills */}
        <div className="cal-filter-bar">
          <button
            type="button"
            className={`cal-filter-chip ${activeCategoryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('all')}
          >
            {t('term_cat_all')}
          </button>

          <button
            type="button"
            className={`cal-filter-chip ${activeCategoryFilter === 'deadline' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('deadline')}
          >
            <span className="filter-dot" style={{ backgroundColor: '#dc2626' }} />
            <span>{t('term_cat_deadlines')}</span>
          </button>

          <button
            type="button"
            className={`cal-filter-chip ${activeCategoryFilter === 'milestone' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('milestone')}
          >
            <span className="filter-dot" style={{ backgroundColor: '#2563eb' }} />
            <span>{t('term_cat_milestones')}</span>
          </button>

          <button
            type="button"
            className={`cal-filter-chip ${activeCategoryFilter === 'inspection' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('inspection')}
          >
            <span className="filter-dot" style={{ backgroundColor: '#9333ea' }} />
            <span>{t('term_cat_inspections')}</span>
          </button>

          <button
            type="button"
            className={`cal-filter-chip ${activeCategoryFilter === 'meeting' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('meeting')}
          >
            <span className="filter-dot" style={{ backgroundColor: '#16a34a' }} />
            <span>{t('term_cat_meetings')}</span>
          </button>

          <button
            type="button"
            className={`cal-filter-chip ${activeCategoryFilter === 'delivery' ? 'active' : ''}`}
            onClick={() => setActiveCategoryFilter('delivery')}
          >
            <span className="filter-dot" style={{ backgroundColor: '#d97706' }} />
            <span>{t('term_cat_deliveries')}</span>
          </button>
        </div>
      </section>

      {/* Main Split Layout: Big Foreground Calendar + Selected Day Inspector */}
      <div className="termin-main-layout">
        {/* Prominent Foreground Monthly Calendar Grid */}
        <div className="calendar-card">
          <div className="calendar-weekdays-row">
            <div>Mo</div>
            <div>Di</div>
            <div>Mi</div>
            <div>Do</div>
            <div>Fr</div>
            <div style={{ color: '#ef4444' }}>Sa</div>
            <div style={{ color: '#ef4444' }}>So</div>
          </div>

          <div className="calendar-grid">
            {calendarDays.map((cell, idx) => {
              const dayEvents = eventsByDate[cell.dateStr] || [];
              const hasUrgent = dayEvents.some((e) => e.isUrgent);

              return (
                <div
                  key={idx}
                  className={`calendar-day-cell ${cell.isCurrentMonth ? '' : 'other-month'} ${cell.isToday ? 'today' : ''} ${cell.isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedDateStr(cell.dateStr)}
                  title={`${cell.dateStr} - ${dayEvents.length} Termine`}
                >
                  <div className="calendar-day-header">
                    <span className="calendar-day-number">{cell.dayNumber}</span>
                    {hasUrgent && (
                      <span className="day-urgent-badge">! Frist</span>
                    )}
                  </div>

                  <div className="day-events-list">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        className={`event-chip ${ev.category}`}
                        title={`${ev.time ? ev.time + ' - ' : ''}${ev.title}`}
                      >
                        {ev.category === 'deadline' && <AlertTriangle size={10} style={{ flexShrink: 0 }} />}
                        {ev.category === 'milestone' && <CheckCircle2 size={10} style={{ flexShrink: 0 }} />}
                        {ev.category === 'inspection' && <HardHat size={10} style={{ flexShrink: 0 }} />}
                        {ev.category === 'meeting' && <Users size={10} style={{ flexShrink: 0 }} />}
                        {ev.category === 'delivery' && <Truck size={10} style={{ flexShrink: 0 }} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {ev.title}
                        </span>
                      </div>
                    ))}

                    {dayEvents.length > 3 && (
                      <div className="event-more-tag">
                        +{dayEvents.length - 3} weitere
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Day Inspector Sidebar */}
        <div className="day-inspector-card">
          <div className="inspector-header">
            <div>
              <div className="inspector-date-title">{formatDisplayDate(selectedDateStr)}</div>
              <div className="inspector-date-sub">
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'Eintrag' : 'Einträge'} an diesem Tag
              </div>
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '11px', padding: '4px 8px' }}
              onClick={() => {
                setNewDate(selectedDateStr);
                setShowAddModal(true);
              }}
              title="Termin für dieses Datum hinzufügen"
            >
              <Plus size={13} />
              <span>Hinzufügen</span>
            </button>
          </div>

          {/* Events for this day */}
          {selectedDayEvents.length === 0 ? (
            <div className="inspector-empty">
              {t('term_empty_day')}
            </div>
          ) : (
            <div className="inspector-events-list">
              {selectedDayEvents.map((ev) => (
                <div key={ev.id} className={`inspector-event-item ${ev.category}`}>
                  <div className="inspector-item-top">
                    <span className="inspector-item-time">
                      <Clock size={11} />
                      <span>{ev.time || 'Ganztägig'}</span>
                    </span>
                    <span className="badge badge-info" style={{ fontSize: '10px' }}>
                      {getCategoryLabel(ev.category)}
                    </span>
                  </div>

                  <div className="inspector-item-title">{ev.title}</div>

                  {ev.trade && (
                    <div className="inspector-item-meta">
                      <HardHat size={11} />
                      <span>{ev.trade}</span>
                    </div>
                  )}

                  {ev.description && (
                    <div className="inspector-item-desc">{ev.description}</div>
                  )}

                  {ev.vobReference && (
                    <div style={{ marginTop: '2px' }}>
                      <span className="vob-pill-small">
                        ⚖️ {ev.vobReference}
                      </span>
                    </div>
                  )}

                  {/* VOB Action Link if it's a deadline or hindrance */}
                  {ev.category === 'deadline' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '6px', fontSize: '11px', padding: '4px 8px', color: '#b91c1c', borderColor: '#fca5a5' }}
                      onClick={() => navigate('/drafts')}
                    >
                      <Mail size={12} />
                      <span>{t('term_btn_to_draft')}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Critical Deadlines Warning Box */}
          <div className="critical-deadlines-box">
            <div className="critical-deadlines-title">
              <AlertTriangle size={15} color="#b45309" />
              <span>Nächste akute VOB-Fristen</span>
            </div>
            {appointments
              .filter((a) => a.category === 'deadline')
              .slice(0, 3)
              .map((d) => (
                <div key={d.id} className="critical-deadline-row">
                  <div>
                    <strong>{d.date.slice(8, 10)}.{d.date.slice(5, 7)}:</strong> {d.title.slice(0, 28)}...
                  </div>
                  <span className="badge badge-danger" style={{ fontSize: '9px' }}>
                    {d.vobReference || '§ 6 VOB/B'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Modal Dialog for creating a new appointment */}
      {showAddModal && (
        <div className="termin-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="termin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="termin-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CalendarIcon size={18} color="var(--color-primary)" />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  {t('term_modal_title')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateAppointment}>
              <div className="termin-modal-body">
                <div className="form-group">
                  <label className="form-label">{t('term_modal_title_label')} *</label>
                  <input
                    type="text"
                    className="form-input"
                    required
                    placeholder="z. B. Abnahme Deckenbewehrung oder Fristablauf TGA"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('term_modal_date_label')} *</label>
                    <input
                      type="date"
                      className="form-input"
                      required
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t('term_modal_time_label')}</label>
                    <input
                      type="time"
                      className="form-input"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('term_modal_cat_label')}</label>
                    <select
                      className="form-input"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value as EventCategory)}
                    >
                      <option value="deadline">{t('term_cat_deadlines')}</option>
                      <option value="milestone">{t('term_cat_milestones')}</option>
                      <option value="inspection">{t('term_cat_inspections')}</option>
                      <option value="meeting">{t('term_cat_meetings')}</option>
                      <option value="delivery">{t('term_cat_deliveries')}</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t('term_modal_trade_label')}</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="z. B. Rohbau Fa. BetonTech"
                      value={newTrade}
                      onChange={(e) => setNewTrade(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">VOB-Paragraf / Rechtlicher Bezug (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="z. B. § 6 Abs. 1 VOB/B oder § 4 Abs. 7 VOB/B"
                    value={newVobRef}
                    onChange={(e) => setNewVobRef(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{t('term_modal_desc_label')}</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Details, Vereinbarungen oder Begründung..."
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="urgentCheck"
                    checked={newIsUrgent}
                    onChange={(e) => setNewIsUrgent(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="urgentCheck" style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>
                    Als akute Frist markieren (Warnung anzeigen)
                  </label>
                </div>
              </div>

              <div className="termin-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  {t('btn_cancel')}
                </button>
                <button type="submit" className="btn btn-primary">
                  <Plus size={16} />
                  <span>{t('btn_save')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Termin;

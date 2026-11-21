import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  AlertTriangle,
  Calendar,
  Users,
  Clock,
  Mail,
  Download,
  Printer,
  Sparkles,
  RefreshCw,
  Layers,
  ArrowRight
} from 'lucide-react';
import { useProjects } from '../context/ProjectContext';
import { useLanguage } from '../context/LanguageContext';
import '@frontend/src/index.css';
import './Analysis.css';

interface WorkPackage {
  id: string;
  name: string;
  trade: string;
  subcontractor: string;
  planDate: string;
  actualDate: string;
  planPercent: number;
  actualPercent: number;
  status: 'delayed' | 'warning' | 'ontrack';
  delayDays: number;
}

interface DeviationItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  sourceReport: string;
  reportDate: string;
  cause: string;
  impact: string;
  vobReference: string;
  suggestedAction: string;
  draftType: 'delay' | 'cost' | 'defect';
}

export const Analysis: React.FC = () => {
    const navigate = useNavigate();
  const { t } = useLanguage();
  const { activeProject } = useProjects();
  const [selectedPeriod, setSelectedPeriod] = useState<'kw47' | 'kw46' | 'all'>('kw47');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Data dynamically configured per active project
  const getProjectAnalysisData = () => {
    const pid = String(activeProject.id);
    if (pid === 'proj-2' || pid === '2') {
      // Wohnquartier Spreebogen
      const workPackages: WorkPackage[] = [
        {
          id: 'sp-1',
          name: 'Spundwandbohlen Achse 1-4 einbringen',
          trade: 'Spezialtiefbau',
          subcontractor: 'Fa. Bauer-Ramm & Flussbau Nord',
          planDate: '21.11.2026',
          actualDate: '24.11.2026',
          planPercent: 80,
          actualPercent: 60,
          status: 'delayed',
          delayDays: 3
        },
        {
          id: 'sp-2',
          name: 'Altfundament-Abbruch Kaimauer (Baugrundhindernis)',
          trade: 'Tiefbau & Abbruch',
          subcontractor: 'Fa. Flussbau Nord',
          planDate: 'Ungeplant',
          actualDate: 'Laufend',
          planPercent: 100,
          actualPercent: 40,
          status: 'delayed',
          delayDays: 2.5
        },
        {
          id: 'sp-3',
          name: 'Grundwasserabsenkung (4 Tiefbrunnen)',
          trade: 'Wasserhaltung',
          subcontractor: 'Fa. HydroSpree',
          planDate: '15.11.2026',
          actualDate: '15.11.2026',
          planPercent: 100,
          actualPercent: 100,
          status: 'ontrack',
          delayDays: 0
        },
        {
          id: 'sp-4',
          name: 'Rückverankerung Uferwand (Zusatzauflage)',
          trade: 'Spezialtiefbau',
          subcontractor: 'Fa. Bauer-Ramm',
          planDate: '26.11.2026',
          actualDate: '02.12.2026',
          planPercent: 30,
          actualPercent: 15,
          status: 'warning',
          delayDays: 4
        }
      ];

      const deviations: DeviationItem[] = [
        {
          id: 'dev-sp-1',
          severity: 'critical',
          title: 'Unvorhergesehenes Baugrundhindernis: Altfundament historische Kaimauer',
          sourceReport: 'Bautagesbericht Nr. 67',
          reportDate: '21.11.2026',
          cause: 'In Achse 3 auf massive historische Kaimauer gestoßen, die im Baugrundgutachten nicht verzeichnet war. Rammgerät blockiert.',
          impact: 'Stillstand der Rammkolonne (7,5 Std.). Zusätzlicher schwerer Abbruchmeißel erforderlich.',
          vobReference: '§ 2 Abs. 6 VOB/B (Mehrkosten) & § 6 Abs. 1 VOB/B (Behinderung)',
          suggestedAction: 'Mehrkostenanmeldung und Behinderungsanzeige sofort an Bauherrn übermitteln.',
          draftType: 'cost'
        },
        {
          id: 'dev-sp-2',
          severity: 'warning',
          title: 'Planungsänderung Wasserbehörde: Zusätzliche Rückverankerungsebene',
          sourceReport: 'Baubesprechung Nr. 8',
          reportDate: '15.11.2026',
          cause: 'Geänderte hydrostatische Auflagen verlangen Einbau zusätzlicher Litzenanker.',
          impact: 'Zusätzlicher Zeitbedarf ca. 4 Werktage. Kampfmittelsondierung für Verankerungsbereich nötig.',
          vobReference: '§ 2 Abs. 5 VOB/B (Leistungsänderung durch AG)',
          suggestedAction: 'Nachtragsangebot mit Terminverschiebung einreichen.',
          draftType: 'delay'
        }
      ];

      return {
        overallDelta: -3.0,
        spi: 0.88,
        evaluatedReports: 67,
        criticalAlertsCount: 2,
        lostHours: 7.5,
        manpowerAvg: { plan: 26, actual: 26 },
        workPackages,
        deviations
      };
    } else if (pid === 'proj-3' || pid === '3') {
      // Sanierung Tiergarten
      const workPackages: WorkPackage[] = [
        {
          id: 'tg-1',
          name: 'Asbestsanierung Brandschutzklappen 3. OG (TRGS 519)',
          trade: 'Schadstoffsanierung',
          subcontractor: 'Fa. CleanAsbest',
          planDate: '20.11.2026',
          actualDate: '20.11.2026',
          planPercent: 100,
          actualPercent: 100,
          status: 'ontrack',
          delayDays: 0
        },
        {
          id: 'tg-2',
          name: 'Raumluft-Freimessung & Schwarzbereich-Freigabe',
          trade: 'Gutachterwesen',
          subcontractor: 'Dr. Franke Sachverständige',
          planDate: '21.11.2026',
          actualDate: '24.11.2026',
          planPercent: 80,
          actualPercent: 50,
          status: 'warning',
          delayDays: 1.5
        },
        {
          id: 'tg-3',
          name: 'Denkmalschutz-Schutzverschalung Stuck Eingangsfoyer',
          trade: 'Restaurierung',
          subcontractor: 'Restaurator Klein',
          planDate: '19.11.2026',
          actualDate: '19.11.2026',
          planPercent: 100,
          actualPercent: 100,
          status: 'ontrack',
          delayDays: 0
        }
      ];

      const deviations: DeviationItem[] = [
        {
          id: 'dev-tg-1',
          severity: 'warning',
          title: 'Sperrung Schwarzbereich bis TRGS 519 Freimessung am Montag',
          sourceReport: 'Bautagesbericht Nr. 22',
          reportDate: '20.11.2026',
          cause: 'Freimessung durch Gutachterbüro Dr. Franke terminlich erst am Montag 09:00 Uhr möglich.',
          impact: 'Folgearbeiten Trockenbau im 3. OG verzögern sich um 1,5 Arbeitstage.',
          vobReference: '§ 6 Abs. 1 VOB/B (Vorleistungsgewerke)',
          suggestedAction: 'Terminabstimmung mit Trockenbau Fa. WandPerfekt vornehmen.',
          draftType: 'delay'
        }
      ];

      return {
        overallDelta: -1.5,
        spi: 0.94,
        evaluatedReports: 22,
        criticalAlertsCount: 1,
        lostHours: 0,
        manpowerAvg: { plan: 18, actual: 18 },
        workPackages,
        deviations
      };
    } else {
      // Default: Neubau Schulzentrum Nord (proj-1)
      const workPackages: WorkPackage[] = [
        {
          id: 'sz-1',
          name: 'Bewehrung & Schalung Decke 1. OG Bauteil B',
          trade: 'Rohbau',
          subcontractor: 'Fa. BetonTech',
          planDate: '19.11.2026',
          actualDate: '24.11.2026',
          planPercent: 100,
          actualPercent: 80,
          status: 'delayed',
          delayDays: 2.0
        },
        {
          id: 'sz-2',
          name: 'TGA: Schlitze & Durchbrüche Schacht 3 (Achse D-F)',
          trade: 'TGA / Haustechnik',
          subcontractor: 'Fa. Elektro-Klima & Planungsbüro Weber',
          planDate: '20.11.2026',
          actualDate: '25.11.2026',
          planPercent: 100,
          actualPercent: 45,
          status: 'delayed',
          delayDays: 4.0
        },
        {
          id: 'sz-3',
          name: 'Verlegung Grundleitungen DN 150 Haus B',
          trade: 'Tiefbau & Erschließung',
          subcontractor: 'Fa. Erd & Grund',
          planDate: '18.11.2026',
          actualDate: '19.11.2026',
          planPercent: 100,
          actualPercent: 100,
          status: 'ontrack',
          delayDays: 0
        },
        {
          id: 'sz-4',
          name: 'Lieferung 24x T30-Brandschutztüren Baulos 4',
          trade: 'Türen & Innenausbau',
          subcontractor: 'Fa. Glas & Türbau Hoffmann GmbH',
          planDate: '23.11.2026',
          actualDate: '07.12.2026',
          planPercent: 100,
          actualPercent: 10,
          status: 'delayed',
          delayDays: 14.0
        },
        {
          id: 'sz-5',
          name: 'Hallen-Holzdachtragwerk & Brandschutzmanschetten',
          trade: 'Holzbau & Zimmerer',
          subcontractor: 'Fa. Holzwerk Nord',
          planDate: '28.11.2026',
          actualDate: '28.11.2026',
          planPercent: 60,
          actualPercent: 60,
          status: 'ontrack',
          delayDays: 0
        }
      ];

      const deviations: DeviationItem[] = [
        {
          id: 'dev-sz-1',
          severity: 'critical',
          title: 'Kritischer Verzug: Durchbrüche Schacht 3 blockiert (Fehlende TGA-Planfreigabe)',
          sourceReport: 'Bautagesbericht Nr. 142',
          reportDate: '20.11.2026, 11:30 Uhr',
          cause: 'Freigabepläne für Sanitär- und Lüftungsschächte durch TGA-Fachbauleitung trotz Zusage im Jour Fixe Nr. 18 nicht geliefert.',
          impact: 'Deckenunterzüge und Schachtaussparungen können nicht geschalt werden. Betoniertermin Decke 1. OG droht um min. 3 Werktage zu kippen.',
          vobReference: '§ 6 Abs. 1 VOB/B (Behinderungsanzeige wegen fehlender Vorunterlagen)',
          suggestedAction: 'Förmliche VOB-Behinderungsanzeige an Auftraggeber und Planer versenden.',
          draftType: 'delay'
        },
        {
          id: 'dev-sz-2',
          severity: 'critical',
          title: 'Akuter Lieferverzug: 24 Stück T30-Brandschutztüren um 14 Tage verschoben',
          sourceReport: 'E-Mail & Bautagesbericht Nr. 141',
          reportDate: '19.11.2026',
          cause: 'Hersteller Hoffmann meldet Rohstoffengpass bei Brandschutzgläsern. Neuer Liefertermin 07.12. statt vereinbart 23.11.2026.',
          impact: 'Blockiert Folgegewerke Trockenbau-Türanschlüsse und Bodenbelagsarbeiten in KW 49 massiv.',
          vobReference: '§ 6 Abs. 6 VOB/B (Nachunternehmer-Verzug & Schadensersatzvorbehalt)',
          suggestedAction: 'Vorablieferung der Zargen anmahnen und Schadensersatzansprüche geltend machen.',
          draftType: 'delay'
        },
        {
          id: 'dev-sz-3',
          severity: 'warning',
          title: 'Witterungsstillstand & Wassereintritt Baugrube Bauteil C',
          sourceReport: 'Bautagesbericht Nr. 138',
          reportDate: '16.11.2026',
          cause: 'Starkregen und Sturmböen bis 65 km/h. Ausfall Tauchpumpe 2 führte zur Überflutung der Grube.',
          impact: 'Erdarbeiten und Fundamentaushub um 11:00 Uhr abgebrochen (1,5 Tage Gesamtstillstand).',
          vobReference: '§ 6 Abs. 2 Nr. 2 VOB/B (Höhere Gewalt / Unabwendbare Witterungseinflüsse)',
          suggestedAction: 'Stillstandszeiten als anerkannte Fristverlängerung im Bauzeitenplan dokumentieren.',
          draftType: 'delay'
        }
      ];

      return {
        overallDelta: -4.2,
        spi: 0.89,
        evaluatedReports: 142,
        criticalAlertsCount: 2,
        lostHours: 11.0,
        manpowerAvg: { plan: 38, actual: 34 },
        workPackages,
        deviations
      };
    }
  };

  const analysisData = getProjectAnalysisData();

  const handleRefreshAnalysis = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 900);
  };

  const handleExportDoc = () => {
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Soll-Ist-Analyse_${activeProject.number}</title>
<style>
body { font-family: Calibri, sans-serif; line-height: 1.5; color: #111; }
h1 { color: #1e3a8a; }
h2 { border-bottom: 1px solid #ccc; padding-bottom: 4px; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 10pt; }
th { background-color: #f1f5f9; }
.critical { color: #dc2626; font-weight: bold; }
</style>
</head>
<body>
<h1>Soll-Ist-Analyse & Erkannte Planabweichungen</h1>
<p><strong>Bauprojekt:</strong> ${activeProject.name} (${activeProject.number}) | <strong>Datum:</strong> ${new Date().toLocaleDateString('de-DE')}</p>
<p><strong>Ausgewertete Bautagesberichte:</strong> ${analysisData.evaluatedReports} | <strong>Gesamtverzögerung:</strong> ${analysisData.overallDelta} Tage (SPI: ${analysisData.spi})</p>

<h2>1. Leistungs- und Terminvergleich nach Gewerken</h2>
<table>
<tr><th>Gewerk / Bauteil</th><th>Nachunternehmer</th><th>Soll-Fertigstellung</th><th>Ist-Stand</th><th>Plan %</th><th>Ist %</th><th>Verzug</th></tr>
${analysisData.workPackages.map((wp) => `<tr><td>${wp.name}</td><td>${wp.subcontractor}</td><td>${wp.planDate}</td><td>${wp.actualDate}</td><td>${wp.planPercent}%</td><td>${wp.actualPercent}%</td><td class="${wp.delayDays > 0 ? 'critical' : ''}">${wp.delayDays > 0 ? `-${wp.delayDays} Tage` : 'Im Plan'}</td></tr>`).join('')}
</table>

<h2>2. Erkannte Abweichungen & VOB-Handlungsempfehlungen</h2>
${analysisData.deviations.map((d) => `<div><h3>${d.title} (${d.sourceReport}, ${d.reportDate})</h3><p><strong>Ursache:</strong> ${d.cause}</p><p><strong>Auswirkung:</strong> ${d.impact}</p><p><strong>VOB-Relevanz:</strong> ${d.vobReference}</p><p><strong>Empfohlene Maßnahme:</strong> ${d.suggestedAction}</p><hr/></div>`).join('')}
</body>
</html>`;

    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Soll-Ist-Analyse_${activeProject.number}_${new Date().toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="analysis-container">
            {/* Header Banner */}
      <section className="analysis-header-card">
        <div className="analysis-title-group">
          <div className="analysis-icon-badge">
            <TrendingUp size={28} />
          </div>
          <div>
            <h1 className="analysis-title">{t('ana_title')}</h1>
            <p className="analysis-sub">
              {t('ana_sub')} <strong>{activeProject.name}</strong> ({activeProject.number})
            </p>
          </div>
        </div>

        <div style={{display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Period Selector */}
          <div style={{ display: 'flex', backgroundColor: 'var(--color-slate-100)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
            <button
              type="button"
              className={`history-btn-small ${selectedPeriod === 'kw47' ? 'active' : ''}`}
              style={{
                backgroundColor: selectedPeriod === 'kw47' ? 'white' : 'transparent',
                fontWeight: selectedPeriod === 'kw47' ? 700 : 500
              }}
              onClick={() => setSelectedPeriod('kw47')}
            >
              {t('ana_period_kw47')}
            </button>
            <button
              type="button"
              className={`history-btn-small ${selectedPeriod === 'kw46' ? 'active' : ''}`}
              style={{
                backgroundColor: selectedPeriod === 'kw46' ? 'white' : 'transparent',
                fontWeight: selectedPeriod === 'kw46' ? 700 : 500
              }}
              onClick={() => setSelectedPeriod('kw46')}
            >
              {t('ana_period_kw46')}
            </button>
            <button
              type="button"
              className={`history-btn-small ${selectedPeriod === 'all' ? 'active' : ''}`}
              style={{
                backgroundColor: selectedPeriod === 'all' ? 'white' : 'transparent',
                fontWeight: selectedPeriod === 'all' ? 700 : 500
              }}
              onClick={() => setSelectedPeriod('all')}
            >
              {t('ana_period_all')}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefreshAnalysis}
            disabled={isRefreshing}
            title={t('btn_refresh')}
          >
            <RefreshCw size={15} className={isRefreshing ? 'spin' : ''} />
            <span>{t('btn_refresh')}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportDoc}
            title={t('btn_word_export')}
          >
            <Download size={15} />
            <span>{t('btn_word_export')}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
            title={t('btn_pdf_export')}
          >
            <Printer size={15} />
            <span>{t('btn_pdf_export')}</span>
          </button>
        </div>
      </section>

      {/* KPI Cards Grid */}
      <section className="analysis-kpi-grid">
        <div className="analysis-kpi-card">
          <div>
            <div className="analysis-kpi-label">{t('ana_kpi_delta')}</div>
            <div className="analysis-kpi-val" style={{ color: '#dc2626' }}>
              {analysisData.overallDelta} Tage
            </div>
            <div className="analysis-kpi-delta negative">{t('ana_kpi_delta_sub')}</div>
          </div>
          <div className="analysis-kpi-icon" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
            <Clock size={20} />
          </div>
        </div>

        <div className="analysis-kpi-card">
          <div>
            <div className="analysis-kpi-label">{t('ana_kpi_spi')}</div>
            <div className="analysis-kpi-val" style={{ color: analysisData.spi < 0.9 ? '#d97706' : '#16a34a' }}>
              {analysisData.spi}
            </div>
            <div className="analysis-kpi-delta warning">{t('ana_kpi_spi_sub')}</div>
          </div>
          <div className="analysis-kpi-icon" style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
            <TrendingUp size={20} />
          </div>
        </div>

        <div className="analysis-kpi-card">
          <div>
            <div className="analysis-kpi-label">{t('ana_kpi_evaluated')}</div>
            <div className="analysis-kpi-val">{analysisData.evaluatedReports}</div>
            <div className="analysis-kpi-delta positive">{t('ana_kpi_evaluated_sub')}</div>
          </div>
          <div className="analysis-kpi-icon" style={{ backgroundColor: '#eff6ff', color: '#2563eb' }}>
            <Layers size={20} />
          </div>
        </div>

        <div className="analysis-kpi-card">
          <div>
            <div className="analysis-kpi-label">{t('ana_kpi_alerts')}</div>
            <div className="analysis-kpi-val" style={{ color: '#dc2626' }}>
              {analysisData.criticalAlertsCount}
            </div>
            <div className="analysis-kpi-delta negative">{t('ana_kpi_alerts_sub')}</div>
          </div>
          <div className="analysis-kpi-icon" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
            <AlertTriangle size={20} />
          </div>
        </div>
      </section>

      {/* Main Analysis Sections */}
      <div className="analysis-main-grid">
        {/* SECTION 1: DETECTED PLAN DEVIATIONS & PROACTIVE ALERTS */}
        <div className="wp-card">
          <div className="wp-header">
            <div className="wp-title">
              <AlertTriangle size={18} color="#dc2626" />
              <span>{t('ana_deviations_title')} ({analysisData.deviations.length})</span>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {t('ana_deviations_sub')}
            </span>
          </div>

          <div className="deviations-grid">
            {analysisData.deviations.map((dev) => (
              <div key={dev.id} className={`deviation-card ${dev.severity}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="deviation-top">
                    <span className="deviation-title">{dev.title}</span>
                    <span className="deviation-badge-delay">
                      {dev.severity === 'critical' ? t('status_delayed') : t('status_warning')}
                    </span>
                  </div>

                  <div className="deviation-source-tag">
                    <Calendar size={12} />
                    <span>{dev.sourceReport} ({dev.reportDate})</span>
                  </div>

                  <div className="deviation-cause">
                    <strong>Ursache:</strong>
                    <div>{dev.cause}</div>
                  </div>

                  <div className="deviation-impact">
                    <div>
                      <strong>Auswirkung:</strong> {dev.impact}
                    </div>
                    <div>
                      <span className="deviation-vob-pill">
                        ⚖️ {dev.vobReference}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="deviation-actions">
                  <div style={{ fontSize: '11px', color: '#92400e', fontWeight: 600 }}>
                    💡 {dev.suggestedAction}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '12px', padding: '6px 12px', backgroundColor: dev.severity === 'critical' ? '#dc2626' : '#b45309', whiteSpace: 'nowrap' }}
                    onClick={() => navigate('/drafts')}
                    title={t('drafts_btn_generate')}
                  >
                    <Mail size={13} />
                    <span>{t('drafts_btn_generate')}</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SECTION 2: SCHEDULE & PERFORMANCE EVALUATION TABLE */}
        <div className="wp-card">
          <div className="wp-header">
            <div className="wp-title">
              <Sparkles size={18} color="var(--color-primary)" />
              <span>{t('ana_table_title')}</span>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {t('ana_table_sub')}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="wp-table">
              <thead>
                <tr>
                  <th>{t('ana_col_trade')}</th>
                  <th>{t('ana_col_contractor')}</th>
                  <th>{t('ana_col_plan_date')}</th>
                  <th>{t('ana_col_actual_date')}</th>
                  <th style={{ width: '220px' }}>{t('ana_col_progress')}</th>
                  <th>{t('ana_col_deviation')}</th>
                  <th>{t('ana_col_status')}</th>
                </tr>
              </thead>
              <tbody>
                {analysisData.workPackages.map((wp) => (
                  <tr key={wp.id}>
                    <td>
                      <strong style={{ color: 'var(--color-slate-900)' }}>{wp.name}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{wp.trade}</div>
                    </td>
                    <td>{wp.subcontractor}</td>
                    <td>{wp.planDate}</td>
                    <td>
                      <span style={{ color: wp.delayDays > 0 ? '#dc2626' : 'var(--color-slate-800)', fontWeight: wp.delayDays > 0 ? 700 : 500 }}>
                        {wp.actualDate}
                      </span>
                    </td>
                    <td>
                      <div className="progress-dual">
                        <div className="progress-labels">
                          <span>Ist: {wp.actualPercent}%</span>
                          <span>Plan: {wp.planPercent}%</span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill-plan"
                            style={{ width: `${wp.planPercent}%` }}
                          />
                          <div
                            className={`progress-fill-actual ${
                              wp.status === 'delayed'
                                ? 'delayed'
                                : wp.status === 'warning'
                                ? 'warning'
                                : 'ontrack'
                            }`}
                            style={{ width: `${wp.actualPercent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      {wp.delayDays > 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>
                          -{wp.delayDays} {wp.delayDays === 1 ? 'Tag' : 'Tage'}
                        </span>
                      ) : (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>0 {t('status_ontrack')}</span>
                      )}
                    </td>
                    <td>
                      {wp.status === 'delayed' ? (
                        <span className="badge badge-danger">{t('status_delayed')}</span>
                      ) : wp.status === 'warning' ? (
                        <span className="badge badge-warning">{t('status_jeopardized')}</span>
                      ) : (
                        <span className="badge badge-success">{t('status_ontrack')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 3: VISUAL PERFORMANCE CHARTS (MANPOWER & DOWNTIME) */}
        <div className="charts-grid">
          {/* Manpower Column Chart */}
          <div className="chart-card">
            <div className="chart-header">
              <span className="chart-title">
                <Users size={16} color="var(--color-primary)" />
                <span>{t('ana_chart_manpower_title')}</span>
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Ø {analysisData.manpowerAvg.actual} / {analysisData.manpowerAvg.plan}
              </span>
            </div>

            <div className="bar-chart-visual">
              {/* Mo */}
              <div className="bar-column">
                <div className="bar-dual-container">
                  <div className="bar-plan" style={{ height: '80%' }} title="Soll: 38" />
                  <div className="bar-actual under" style={{ height: '38%' }} title="Ist: 18" />
                </div>
                <span className="bar-label">Mo (16.11.)</span>
              </div>

              {/* Di */}
              <div className="bar-column">
                <div className="bar-dual-container">
                  <div className="bar-plan" style={{ height: '80%' }} title="Soll: 38" />
                  <div className="bar-actual" style={{ height: '68%' }} title="Ist: 32" />
                </div>
                <span className="bar-label">Di (17.11.)</span>
              </div>

              {/* Mi */}
              <div className="bar-column">
                <div className="bar-dual-container">
                  <div className="bar-plan" style={{ height: '80%' }} title="Soll: 38" />
                  <div className="bar-actual" style={{ height: '68%' }} title="Ist: 32" />
                </div>
                <span className="bar-label">Mi (18.11.)</span>
              </div>

              {/* Do */}
              <div className="bar-column">
                <div className="bar-dual-container">
                  <div className="bar-plan" style={{ height: '80%' }} title="Soll: 38" />
                  <div className="bar-actual" style={{ height: '76%' }} title="Ist: 36" />
                </div>
                <span className="bar-label">Do (19.11.)</span>
              </div>

              {/* Fr */}
              <div className="bar-column">
                <div className="bar-dual-container">
                  <div className="bar-plan" style={{ height: '80%' }} title="Soll: 38" />
                  <div className="bar-actual" style={{ height: '72%' }} title="Ist: 34" />
                </div>
                <span className="bar-label">Fr (20.11.)</span>
              </div>
            </div>

            <div className="chart-legend">
              <div className="legend-item">
                <div className="legend-box" style={{ backgroundColor: '#cbd5e1' }} />
                <span>Plan</span>
              </div>
              <div className="legend-item">
                <div className="legend-box" style={{ backgroundColor: 'var(--color-primary)' }} />
                <span>Ist</span>
              </div>
              <div className="legend-item">
                <div className="legend-box" style={{ backgroundColor: '#ef4444' }} />
                <span>Ausfall</span>
              </div>
            </div>
          </div>

          {/* Downtime & Hindrance Hours */}
          <div className="chart-card">
            <div className="chart-header">
              <span className="chart-title">
                <Clock size={16} color="#d97706" />
                <span>{t('ana_chart_downtime_title')}</span>
              </span>
              <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 700 }}>
                {analysisData.lostHours} Std.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span>🌧️ Schlechtwetter / Witterung (§ 6 Abs. 2 VOB/B)</span>
                  <strong>6,5 Std.</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill-actual delayed" style={{ width: '59%' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span>🚜 Großgeräte-Ausfall (Hydraulikdefekt)</span>
                  <strong>4,5 Std.</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill-actual warning" style={{ width: '41%' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                  <span>📐 Planungsverzug TGA (Schacht 3)</span>
                  <strong style={{ color: '#dc2626' }}>Akut</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-fill-actual delayed" style={{ width: '85%' }} />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Bautagesberichte
              </span>
              <button
                type="button"
                className="history-btn-small"
                onClick={() => navigate('/reports')}
              >
                <span>{t('nav_reports')}</span>
                <ArrowRight size={11} />
              </button>
            </div>
          </div>
        </div>
      </div>
        </div>
    );
};

export default Analysis;

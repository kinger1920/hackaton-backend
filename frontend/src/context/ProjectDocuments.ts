export type DocumentSourceType = 'diary' | 'minutes' | 'emails';

export interface ActionItemSummary {
  id: string;
  task: string;
  responsible: string;
  deadline: string;
  priority: 'Hoch' | 'Mittel' | 'Normal';
  done: boolean;
  source: string;
}

export interface VobRiskSummary {
  title: string;
  description: string;
  recommendation: string;
  linkType?: 'delay' | 'cost' | 'defect';
}

export interface DocumentSummary {
  title: string;
  executiveSummary: string[];
  keyDecisions: string[];
  actionItems: ActionItemSummary[];
  vobRisks: VobRiskSummary[];
  traceabilityNotes: string;
}

export interface ProjectDocumentItem {
  id: string;
  projectId: string | number;
  type: DocumentSourceType;
  title: string;
  date: string;
  authorOrSender: string;
  content: string;
  weather?: string;
  workforceCount?: number;
  trades?: string[];
  hindrance?: string;
  summary?: DocumentSummary;
}

export const INITIAL_PROJECT_DOCUMENTS: ProjectDocumentItem[] = [
  // ==========================================
  // PROJECT 1: Neubau Schulzentrum Nord (proj-1)
  // ==========================================
  {
    id: 'doc-p1-d1',
    projectId: 'proj-1',
    type: 'diary',
    title: 'Bautagesbericht Nr. 142 — Betonage & TGA-Stillstand',
    date: '20.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: '6°C, bedeckt, ab 14:00 Uhr leichter Nieselregen',
    workforceCount: 34,
    trades: ['Rohbau (Fa. BetonTech)', 'Tiefbau (Fa. Erd & Grund)', 'TGA (Fa. Elektro-Klima)', 'Zimmerer'],
    hindrance: 'Hydraulikdefekt an Kettenbagger 24t (4,5 Std. Stillstand) & TGA-Freigabepläne für Schacht 3 fehlen.',
    content: `Bautagesbericht Nr. 142 — Datum: 20.11.2026
Wetter: 6°C, bedeckt, ab 14:00 Uhr leichter Nieselregen.
Personal: 34 Fachkräfte (12 Rohbau Fa. BetonTech, 8 Tiefbau Fa. Erd & Grund, 6 TGA Fa. Elektro-Klima, 8 Zimmerer).
Tagesleistung: Decke über 1. OG Bauteil B zu 80% bewehrt. Betonage für kommenden Montag terminiert.
Vorfälle & Behinderungen:
- 10:15 Uhr: Hydraulikdefekt an Kettenbagger 24t Tiefbau. Stillstand 4,5 Std. bis Reparatur.
- 11:30 Uhr: Durchbrüche Schacht 3 in Achse D-F können nicht geschalt werden, da Freigabepläne der TGA-Fachbauleitung fehlen. Planer telefonisch angemahnt.
- 15:00 Uhr: Betonprüfer entnimmt Würfelproben für B25/30 Prüfzeugnis.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 142 (20.11.2026)',
      executiveSummary: [
        'Bewehrung der Decke über 1. OG Bauteil B zu 80% abgeschlossen; Betonage für kommenden Montag terminiert.',
        '4,5 Stunden Stillstand des 24t Tiefbau-Kettenbaggers infolge eines Hydraulikdefekts; Reparatur am Nachmittag abgeschlossen.',
        'Schalungsstopp bei Schacht 3 (Achse D-F) durch fehlende Freigabepläne der TGA-Fachbauleitung.'
      ],
      keyDecisions: [
        'Betoniertermin für Decke 1. OG verbindlich auf kommenden Montag festgesetzt.',
        'TGA-Fachplaner telefonisch abgemahnt mit Nachfrist bis Freitag 12:00 Uhr.',
        'Entnahme der Betonprüfwürfel für B25/30 Gütenachweis protokolliert.'
      ],
      actionItems: [
        {
          id: 'act-142-1',
          task: 'Freigabepläne für Schacht 3 von TGA-Planungsbüro anfordern',
          responsible: 'Bauleiter Mustermann',
          deadline: '21.11.2026, 12:00 Uhr',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 142'
        },
        {
          id: 'act-142-2',
          task: 'Betonage-Abruf (45 m³ C25/30) und Betonpumpe disponieren',
          responsible: 'Polier Fa. BetonTech',
          deadline: '21.11.2026',
          priority: 'Hoch',
          done: true,
          source: 'Bautagesbericht Nr. 142'
        },
        {
          id: 'act-142-3',
          task: 'Stillstandsprotokoll Kettenbagger zur Nachunternehmerakte Tiefbau nehmen',
          responsible: 'Bauleitung Assistenz',
          deadline: '22.11.2026',
          priority: 'Mittel',
          done: false,
          source: 'Bautagesbericht Nr. 142'
        }
      ],
      vobRisks: [
        {
          title: 'Verzug & Behinderung nach § 6 Abs. 1 VOB/B (Fehlende TGA-Ausführungsplanung Schacht 3)',
          description: 'Ohne Planfreigabe können die Deckenöffnungen nicht termingerecht geschalt werden. Folgegewerke TGA und Estrich drohen sich zu verschieben.',
          recommendation: 'Formelle Behinderungsanzeige an den Auftraggeber und Architekten zustellen.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: 'Automatisch aus Bautagesbericht Nr. 142 vom 20.11.2026 für Neubau Schulzentrum Nord generiert.'
    }
  },
  {
    id: 'doc-p1-d141',
    projectId: 'proj-1',
    type: 'diary',
    title: 'Bautagesbericht Nr. 141 — Grundleitungen & Bewehrung Decke 1. OG',
    date: '19.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: '7°C, wolkig mit sonnigen Abschnitten, trocken',
    workforceCount: 36,
    trades: ['Rohbau (Fa. BetonTech)', 'Tiefbau (Fa. Erd & Grund)', 'Elektro (Fa. Starkstrom Nord)'],
    hindrance: 'Lieferverzug von 24 Stk. T30-Brandschutztüren schriftlich angekündigt.',
    content: `Bautagesbericht Nr. 141 — Datum: 19.11.2026
Wetter: 7°C, wolkig, trocken, gute Arbeitsbedingungen.
Personal: 36 Fachkräfte (14 Rohbau Fa. BetonTech, 10 Tiefbau, 6 Elektro, 6 Gerüstbauer).
Tagesleistung:
- Verlegung der Grundleitungen DN 150 Haus B abgeschlossen und durch Tiefbauprüfer abgedrückt.
- Unterzugschalung Achse 4 fertiggestellt; Bewehrung der Deckenfelder 1 bis 3 begonnen.
Vorkommnisse:
- Vorabinformation über Lieferverzögerung der Brandschutztüren T30. Nachunternehmer aufgefordert, Teilvorablieferung der Zargen zu prüfen.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 141 (19.11.2026)',
      executiveSummary: [
        'Grundleitungen DN 150 Haus B mängelfrei verlegt, druckgeprüft und durch Tiefbauprüfer abgenommen.',
        'Unterzugschalung Achse 4 vollendet; Bewehrungsarbeiten an Deckenfeldern 1 bis 3 planmäßig gestartet.',
        'Fa. Hoffmann kündigt 2-wöchigen Lieferverzug bei Brandschutztüren T30 an.'
      ],
      keyDecisions: [
        'Druckprüfprotokoll für Grundleitungen freigegeben; Verfüllung der Gräben autorisiert.',
        'Forderung auf Vorablieferung der Türzargen an Fa. Hoffmann übermittelt.'
      ],
      actionItems: [
        {
          id: 'act-141-1',
          task: 'Verzugsschreiben an Türenlieferant Hoffmann versenden (§ 6 Abs. 6 VOB/B)',
          responsible: 'Bauleiter Mustermann',
          deadline: '20.11.2026',
          priority: 'Hoch',
          done: true,
          source: 'Bautagesbericht Nr. 141'
        },
        {
          id: 'act-141-2',
          task: 'Prüfstatiker zur Bewehrungsabnahme für 20.11. bestellen',
          responsible: 'Polier Fa. BetonTech',
          deadline: '19.11.2026, 17:00 Uhr',
          priority: 'Mittel',
          done: true,
          source: 'Bautagesbericht Nr. 141'
        }
      ],
      vobRisks: [
        {
          title: 'Lieferverzug Brandschutztüren gefährdet Folgeausbau (§ 6 VOB/B)',
          description: 'Verzug von 2 Wochen blockiert Trockenbau-Türanschlüsse und Bodenbelagsarbeiten.',
          recommendation: 'Vertragstermine anmahnen und Schadensersatzansprüche vorbehalten.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 141 vom 19.11.2026.'
    }
  },
  {
    id: 'doc-p1-d140',
    projectId: 'proj-1',
    type: 'diary',
    title: 'Bautagesbericht Nr. 140 — Schalungsarbeiten & Prüfstatik',
    date: '18.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: '5°C, Hochnebel, windstill',
    workforceCount: 32,
    trades: ['Rohbau (Fa. BetonTech)', 'Prüfingenieur Dr. Lang', 'Zimmerer'],
    hindrance: 'Bewehrungsanpassung Unterzug U-14 erforderlich, Freigabe bis 24.11. angefordert.',
    content: `Bautagesbericht Nr. 140 — Datum: 18.11.2026
Wetter: 5°C, neblig, trocken.
Personal: 32 Fachkräfte vor Ort.
Tagesleistung:
- Schalung für Decke über 1. OG Bauteil B zu 95% aufgestellt.
- Prüfstatiker Dr. Lang besichtigt Knotenpunkte: Statische Zulage in Unterzug U-14 angeordnet.
- Jour Fixe Nr. 18 um 14:00 Uhr durchgeführt (siehe Protokoll).`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 140 (18.11.2026)',
      executiveSummary: [
        'Schalung für Decke über 1. OG Bauteil B zu 95% aufgestellt.',
        'Prüfstatiker Dr. Lang ordnet konstruktive Bewehrungszulage in Unterzug U-14 an.',
        'Jour Fixe Nr. 18 mit Planern und Bauherrn erfolgreich durchgeführt.'
      ],
      keyDecisions: [
        'Zusatzbewehrung U-14 wird statisch gerechnet und bis 24.11. nachgeliefert.',
        'Raumänderungen 2. OG durch Bauherrn freigegeben.'
      ],
      actionItems: [
        {
          id: 'act-140-1',
          task: 'Prüfstatische Zulagenpläne U-14 an Polier weiterleiten',
          responsible: 'Bauleitung Mustermann',
          deadline: '24.11.2026',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 140'
        }
      ],
      vobRisks: [
        {
          title: 'Planungsverzögerung Statik Unterzug U-14',
          description: 'Lieferung der statischen Freigabe erst am 24.11. kann den Betonierablauf verzögern.',
          recommendation: 'Prüfstatiker engmaschig nachverfolgen.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 140 vom 18.11.2026.'
    }
  },
  {
    id: 'doc-p1-d2',
    projectId: 'proj-1',
    type: 'diary',
    title: 'Bautagesbericht Nr. 138 — Starkregen & Baugrubenstau',
    date: '16.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: 'Dauerregen, 4°C, Starkwindböen bis 65 km/h',
    workforceCount: 18,
    trades: ['Tiefbau (Fa. Erd & Grund)', 'Wasserhaltung'],
    hindrance: 'Fundamentaushub wegen Überflutung gestoppt. Pumpe 2 zeitweise ausgefallen.',
    content: `Bautagesbericht Nr. 138 — Datum: 16.11.2026
Wetter: Dauerregen, 4°C, Starkwindböen bis 65 km/h.
Personal: Notbesetzung 18 Fachkräfte.
Vorfälle & Behinderungen:
- Baugrubensohle Bauteil C steht teilweise unter Wasser. Pumpe 2 kurzzeitig ausgefallen.
- Erdarbeiten und Fundamentaushub um 11:00 Uhr aus Sicherheitsgründen eingestellt.
- Trockenbauer Fa. WandPerfekt meldet Feuchtigkeitseintritt im Treppenhauskern 2.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 138 (16.11.2026)',
      executiveSummary: [
        'Extremwetter mit Dauerregen und Sturmböen bis 65 km/h führte zum Abbruch der Erdarbeiten um 11:00 Uhr.',
        'Teilüberflutung der Baugrubensohle Bauteil C nach Ausfall der Tauchpumpe 2.',
        'Feuchtigkeitseintritt im Treppenhauskern 2 durch Trockenbauer gemeldet.'
      ],
      keyDecisions: [
        'Arbeitseinstellung im Tiefbau aus Sicherheitsgründen verfügt.',
        'Einsatz einer redundanten Ersatzpumpe zur Baugrubenentwässerung angeordnet.',
        'Baustellensicherung gegen Sturmschäden durchgeführt.'
      ],
      actionItems: [
        {
          id: 'act-138-1',
          task: 'Wasserhaltung wiederherstellen und Pegelmessung dokumentieren',
          responsible: 'Polier Tiefbau',
          deadline: '17.11.2026, 07:00 Uhr',
          priority: 'Hoch',
          done: true,
          source: 'Bautagesbericht Nr. 138'
        },
        {
          id: 'act-138-2',
          task: 'Witterungsstillstand und Schlechtwettertage nach VOB/B erfassen',
          responsible: 'Bauleiter Mustermann',
          deadline: '17.11.2026',
          priority: 'Mittel',
          done: true,
          source: 'Bautagesbericht Nr. 138'
        }
      ],
      vobRisks: [
        {
          title: 'Witterungsbedingte Behinderung (§ 6 Abs. 2 Nr. 2 VOB/B)',
          description: 'Unabwendbare Witterungseinflüsse führten zum Stillstand des Erdaushubs und zur Gefährdung der Böschungsstabilität.',
          recommendation: 'Witterungsverzug als anerkannte Verlängerung der Ausführungsfrist im Bautagebuch und Claim-Register festhalten.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 138 vom 16.11.2026.'
    }
  },
  {
    id: 'doc-p1-m1',
    projectId: 'proj-1',
    type: 'minutes',
    title: 'Jour-Fixe Protokoll Nr. 18 (Bauherr, Architekt & TGA)',
    date: '18.11.2026',
    authorOrSender: 'Architekturbüro Schmidt',
    content: `Baustellen-Protokoll Nr. 18 — Jour Fixe vom 18.11.2026
Projekt: Neubau Schulzentrum Nord (Haus B & C)
Teilnehmer: Hr. Mustermann (Bauleitung), Fr. Arch. Schmidt (Planung), Hr. Ing. Weber (TGA), Hr. Dr. Lang (Statik), Hr. Becker (Bauherr).

1. Vorbesprechung & Planungsstand:
- Architekturbüro legt geänderte Raumaufteilung im 2. OG vor. Freigabe durch Bauherrn erteilt.
- Statiker bestätigt: Bewehrungsanpassung in Unterzug U-14 erforderlich. Prüfstatische Freigabe wird bis 24.11.2026 zugesagt.

2. TGA & Haustechnik:
- Herr Weber (TGA) sagt Lieferung der fehlenden Ausführungspläne für Sanitär- und Lüftungstrassen bis Freitag, 22.11.2026 verbindlich zu.
- Bauleitung weist darauf hin, dass bei Verzug über den 22.11. hinaus eine formelle VOB-Behinderungsanzeige gestellt wird.

3. Brandschutz:
- Brandschutzkonzept für Sporthallendecke liegt vor. Nachunternehmer Holzbau muss Brandschutzmanschetten bis 28.11.2026 bemustern.`,
    summary: {
      title: 'Protokoll-Zusammenfassung: Jour Fixe Nr. 18 (18.11.2026)',
      executiveSummary: [
        'Geänderte Raumaufteilung 2. OG durch Bauherrn Becker rechtskräftig freigegeben.',
        'TGA-Ausführungspläne für Sanitär und Lüftung verbindlich bis Freitag 22.11.2026 zugesagt.',
        'Statische Zulagenberechnung für Unterzug U-14 wird bis 24.11. geliefert.'
      ],
      keyDecisions: [
        'Bauleitung kündigt formelle Behinderungsanzeige an, falls TGA-Pläne nach dem 22.11. eintreffen.',
        'Brandschutzmanschetten der Sporthalle bis 28.11. zur Freigabe vorzulegen.'
      ],
      actionItems: [
        {
          id: 'act-p1-m1',
          task: 'Eingang der TGA-Ausführungspläne kontrollieren',
          responsible: 'Bauleitung Mustermann',
          deadline: '22.11.2026',
          priority: 'Hoch',
          done: false,
          source: 'Jour-Fixe Protokoll Nr. 18'
        }
      ],
      vobRisks: [
        {
          title: 'Drohende Behinderungsanzeige TGA (§ 6 Abs. 1 VOB/B)',
          description: 'Bei Nichteinhaltung der Planzusage zum 22.11. droht Baustillstand bei Durchbrüchen.',
          recommendation: 'Entwurf für Behinderungsanzeige vorbereitet halten.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: 'Generiert aus Jour Fixe Protokoll Nr. 18 vom 18.11.2026.'
    }
  },
  {
    id: 'doc-p1-e1',
    projectId: 'proj-1',
    type: 'emails',
    title: 'E-Mail: Lieferverzug 24x T30-Brandschutztüren',
    date: '19.11.2026',
    authorOrSender: 'Fa. Glas & Türbau Hoffmann GmbH',
    content: `Von: Glas & Türbau Hoffmann GmbH <vertrieb@hoffmann-tueren.de>
An: Bauleitung SiteAI <bauleitung@bau-ag.de>
Datum: 19.11.2026, 14:32 Uhr
Betreff: AW: Liefertermin Brandschutzelemente T30-RS Baulos 4

Sehr geehrter Herr Mustermann,
aufgrund eines unvorhergesehenen Rohstoffengpasses bei den Spezial-Brandschutzgläsern verzögert sich die Auslieferung der 24 Stück T30-Türelemente leider um ca. 2 Wochen. Voraussichtlicher neuer Liefertermin auf die Baustelle: 07.12.2026.

Antwort Bauleitung (20.11.2026, 08:45 Uhr):
Sehr geehrte Damen und Herren,
der vereinbarte Vertragstermin war der 23.11.2026. Eine Verschiebung gefährdet die nachfolgenden Gewerke gravierend. Wir fordern Sie auf, Teillieferungen der Zargen vorzuziehen und behalten uns die Geltendmachung von Verzugsschäden gemäß § 6 Abs. 6 VOB/B vor.`,
    summary: {
      title: 'E-Mail-Zusammenfassung: Lieferverzug T30-Türen (19.11.2026)',
      executiveSummary: [
        'Fa. Hoffmann teilt 2-wöchigen Lieferverzug bei 24 Brandschutztüren mit (Neuer Termin: 07.12.2026).',
        'Bauleitung widerspricht und mahnt Vorablieferung der Zargen an.',
        'Verzugsschadensersatz nach § 6 Abs. 6 VOB/B ausdrücklich angedroht.'
      ],
      keyDecisions: [
        'Teillieferung der Zargen als Mindestanforderung zur Bauablaufsicherung gefordert.'
      ],
      actionItems: [
        {
          id: 'act-p1-e1',
          task: 'Rückmeldung von Fa. Hoffmann zu Vorab-Zargenlieferung einholen',
          responsible: 'Bauleitung Mustermann',
          deadline: '22.11.2026',
          priority: 'Hoch',
          done: false,
          source: 'E-Mail Hoffmann Türen'
        }
      ],
      vobRisks: [
        {
          title: 'Nachunternehmerverzug (§ 6 Abs. 6 VOB/B)',
          description: 'Lieferverzug verschiebt nachfolgende Maler- und Bodenbelagsarbeiten.',
          recommendation: 'Schadensersatzansprüche beziffern und Mahnung zustellen.',
          linkType: 'delay'
        }
      ],
      traceabilityNotes: 'Generiert aus Schriftwechsel mit Fa. Hoffmann Türen vom 19./20.11.2026.'
    }
  },

  // ==========================================
  // PROJECT 2: Wohnquartier Spreebogen (proj-2)
  // ==========================================
  {
    id: 'doc-p2-d1',
    projectId: 'proj-2',
    type: 'diary',
    title: 'Bautagesbericht Nr. 67 — Spundwandbau & Altfundamente',
    date: '21.11.2026',
    authorOrSender: 'Polier Weber (Spreebogen)',
    weather: '5°C, Windstärke 4, Pegel Spree normal',
    workforceCount: 26,
    trades: ['Tiefbau (Fa. Flussbau Nord)', 'Spezialtiefbau (Fa. Bauer-Ramm)', 'Kampfmittelüberwachung'],
    hindrance: 'Rammhindernis in Achse 3 angetroffen: Unbekanntes Altfundament aus Kaimauer.',
    content: `Bautagesbericht Nr. 67 — Datum: 21.11.2026
Wetter: 5°C, Windstärke 4, Pegel Spree normal.
Personal: 26 Fachkräfte (Tiefbau Fa. Flussbau Nord, Spezialtiefbau Fa. Bauer-Ramm, Kampfmittelüberwachung).
Tagesleistung: Einbringen der Spundwandbohlen Achse 1-4 zu 60% fertiggestellt.
Besondere Vorkommnisse:
- 09:30 Uhr: Rammhindernis in Achse 3 angetroffen. Unbekanntes Altfundament aus vormaliger Kaimauer entdeckt.
- Abbruchmeißel angefordert. Mehraufwand und Stillstandszeiten für Rammgerät dokumentiert.
- Grundwasserabsenkung läuft mit 4 Brunnen bei planmäßigen Absenkwerten.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 67 (21.11.2026)',
      executiveSummary: [
        'Spundwandarbeiten Achse 1-4 zu 60% fertiggestellt; Grundwasserabsenkung mit 4 Brunnen stabil.',
        'Unvorhergesehenes Altfundament (historische Kaimauer) in Achse 3 führt zum Rammhindernis.',
        'Einsatz eines schweren Abbruchmeißels notwendig; Stillstandszeiten der Rammkolonne dokumentiert.'
      ],
      keyDecisions: [
        'Stillstands- und Mehraufwandsprotokoll für Baugrundhindernis eröffnet.',
        'Ankündigung einer Mehrkostenanmeldung nach § 2 Abs. 6 VOB/B beschlossen.'
      ],
      actionItems: [
        {
          id: 'act-67-1',
          task: 'Mehrkostenanmeldung für Altfundament-Abbruch ausarbeiten',
          responsible: 'Bauleitung Weber / Kalkulation',
          deadline: 'In 2 Werktagen',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 67'
        },
        {
          id: 'act-67-2',
          task: 'Stillstandsstunden des Rammgeräts vom Bauherrn gegenzeichnen lassen',
          responsible: 'Polier Weber',
          deadline: 'Heute',
          priority: 'Hoch',
          done: true,
          source: 'Bautagesbericht Nr. 67'
        }
      ],
      vobRisks: [
        {
          title: 'Unvorhergesehenes Baugrundhindernis (§ 2 Abs. 6 VOB/B)',
          description: 'Altfundament in Baugrundunterlagen nicht verzeichnet. Führt zu erheblichem Gerätestillstand und Meißelaufwand.',
          recommendation: 'Formelle Mehrkostenanmeldung und Behinderungsanzeige sofort einreichen.',
          linkType: 'cost'
        }
      ],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 67 vom 21.11.2026 für Spreebogen.'
    }
  },
  {
    id: 'doc-p2-d66',
    projectId: 'proj-2',
    type: 'diary',
    title: 'Bautagesbericht Nr. 66 — Rammplan & Spundwandachse 1',
    date: '20.11.2026',
    authorOrSender: 'Polier Weber (Spreebogen)',
    weather: '6°C, bewölkt, böig',
    workforceCount: 28,
    trades: ['Spezialtiefbau', 'Vermessungsbüro Senat'],
    hindrance: 'Wasserstraßenauflagen für Kranüberhang erteilt.',
    content: `Bautagesbericht Nr. 66 — Datum: 20.11.2026
Wetter: 6°C, böiger Wind.
Personal: 28 Personen auf Baustelle.
Tagesleistung:
- Einmessen der Spundwandflucht durch Vermessungsbüro abgeschlossen.
- Rammung von 12 Doppelbohlen Larssen 604 in Achse 1 schwingungsüberwacht durchgeführt.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 66 (20.11.2026)',
      executiveSummary: [
        'Spundwandflucht durch amtliches Vermessungsbüro eingemessen und freigegeben.',
        '12 Doppelbohlen Larssen 604 in Achse 1 unter Schwingungsüberwachung planmäßig gerammt.'
      ],
      keyDecisions: [
        'Schwingungsmesswerte lagen innerhalb der DIN 4150 Toleranzen für Nachbargebäude.'
      ],
      actionItems: [
        {
          id: 'act-66-1',
          task: 'Schwingungsprotokolle an Umweltamt Berlin übermitteln',
          responsible: 'Vermessungsingenieur',
          deadline: '22.11.2026',
          priority: 'Normal',
          done: false,
          source: 'Bautagesbericht Nr. 66'
        }
      ],
      vobRisks: [],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 66 vom 20.11.2026.'
    }
  },
  {
    id: 'doc-p2-d2',
    projectId: 'proj-2',
    type: 'diary',
    title: 'Bautagesbericht Nr. 64 — Kampfmittelfreigabe Baufeld Ost',
    date: '17.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: '8°C, trocken',
    workforceCount: 22,
    trades: ['Kampfmittelräumdienst', 'Erdbau'],
    content: `Bautagesbericht Nr. 64 — Datum: 17.11.2026
Kampfmittelräumdienst hat Sondierungsbohrungen auf Baufeld Ost abgeschlossen.
Freigabebescheinigung liegt vor. Aushub der Z1.1-belasteten Bodenfraktion zur Deponie Vorketzin begonnen (18 LKW-Ladungen abtransportiert).`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 64 (17.11.2026)',
      executiveSummary: [
        'Kampfmittelräumdienst schließt Sondierung Baufeld Ost erfolgreich ab; Freigabebescheinigung liegt vor.',
        'Abtransport von 18 LKW-Ladungen Z1.1 Bodenfraktion zur Deponie Vorketzin durchgeführt.'
      ],
      keyDecisions: [
        'Baufeld Ost für Tiefbau freigegeben.'
      ],
      actionItems: [
        {
          id: 'act-64-1',
          task: 'Entsorgungsbelege Z1.1 im Abfallregister hinterlegen',
          responsible: 'Bauleitung',
          deadline: '19.11.2026',
          priority: 'Normal',
          done: true,
          source: 'Bautagesbericht Nr. 64'
        }
      ],
      vobRisks: [],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 64 vom 17.11.2026.'
    }
  },
  {
    id: 'doc-p2-m1',
    projectId: 'proj-2',
    type: 'minutes',
    title: 'Baubesprechung Nr. 8 — Spundwandstatik & Uferauflagen',
    date: '15.11.2026',
    authorOrSender: 'Spreebogen Wohnbau GmbH',
    content: `Protokoll Baustellenbesprechung Nr. 8 vom 15.11.2026
Projekt: Wohnquartier Spreebogen Baulos 3
Teilnehmer: Bauleitung, Statiker Spezialtiefbau, Wasserbehörde Senat Berlin, Projektleiter Bauherr.

Beschlüsse & Vereinbarungen:
1. Aufgrund geänderter hydrostatischer Vorgaben der Wasserbehörde muss eine zusätzliche Rückverankerungsebene (Litzenanker) eingebaut werden.
2. Bauleitung kündigt hierfür Mehrkostenanmeldung gemäß § 2 Abs. 6 VOB/B an.
3. Kampfmittelsondierung für Verankerungsbereich muss bis 26.11.2026 beauftragt werden.`,
    summary: {
      title: 'Protokoll-Zusammenfassung: Baubesprechung Nr. 8 (15.11.2026)',
      executiveSummary: [
        'Zusätzliche Rückverankerungsebene (Litzenanker) durch Senatswasserbehörde angeordnet.',
        'Mehrkostenanmeldung nach § 2 Abs. 6 VOB/B angekündigt.',
        'Kampfmittelsondierung im Ankerhorizont erforderlich.'
      ],
      keyDecisions: [
        'Einbau zusätzlicher Litzenanker zur Sicherung der Uferwand beschlossen.'
      ],
      actionItems: [
        {
          id: 'act-p2-m1',
          task: 'Sondierung Ankerhorizont beauftragen',
          responsible: 'Projektleiter Bauherr',
          deadline: '26.11.2026',
          priority: 'Hoch',
          done: false,
          source: 'Baubesprechung Nr. 8'
        }
      ],
      vobRisks: [
        {
          title: 'Planungsänderung / Mehrkosten § 2 Abs. 6 VOB/B',
          description: 'Geänderte Wasserauflagen erfordern zusätzliche Anker.',
          recommendation: 'Nachtragsangebot einreichen.',
          linkType: 'cost'
        }
      ],
      traceabilityNotes: 'Generiert aus Baubesprechung Nr. 8.'
    }
  },
  {
    id: 'doc-p2-e1',
    projectId: 'proj-2',
    type: 'emails',
    title: 'E-Mail: Genehmigung Kranüberhang Wasserstraße',
    date: '19.11.2026',
    authorOrSender: 'Wasserstraßen- und Schifffahrtsamt Spree-Oder',
    content: `Von: WSA Spree-Oder <poststelle@wsa-spree-oder.wsv.de>
An: Bauleitung Spreebogen <bauleitung@baupartner-ag.de>
Datum: 19.11.2026, 11:15 Uhr
Betreff: Strom- und schifffahrtspolizeiliche Genehmigung Kran 1

Sehr geehrte Damen und Herren,
dem Antrag auf zeitweiligen Überhang des Auslegers von Baukran K1 über die Bundeswasserstraße Spree wird bis 31.01.2027 unter Einhaltung der Schifffahrtszeichen und Beleuchtungspflicht bei Nacht zugestimmt.`,
    summary: {
      title: 'E-Mail-Zusammenfassung: WSA-Krangenehmigung (19.11.2026)',
      executiveSummary: [
        'WSA Spree-Oder genehmigt zeitweiligen Kranüberhang bis 31.01.2027.',
        'Bedingung: Nachtbeleuchtung und Schifffahrtszeichen strikt einhalten.'
      ],
      keyDecisions: [
        'Kranbetrieb über der Spree behördlich gesichert.'
      ],
      actionItems: [
        {
          id: 'act-p2-e1',
          task: 'Kranbeleuchtung für Nachtbetrieb aktivieren',
          responsible: 'Elektriker Baustelle',
          deadline: 'Morgen',
          priority: 'Mittel',
          done: true,
          source: 'WSA Bescheid'
        }
      ],
      vobRisks: [],
      traceabilityNotes: 'WSA Genehmigungsbescheid.'
    }
  },

  // ==========================================
  // PROJECT 3: Sanierung Bürokomplex Am Tiergarten (proj-3)
  // ==========================================
  {
    id: 'doc-p3-d1',
    projectId: 'proj-3',
    type: 'diary',
    title: 'Bautagesbericht Nr. 22 — Asbestsanierung & Schwarzbereich',
    date: '20.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: '8°C, Innenbereich beheizt (16°C)',
    workforceCount: 18,
    trades: ['Schadstoffsanierung (Fa. CleanAsbest)', 'Elektro (Fa. Abbruch-Strom)'],
    hindrance: 'Freimessung nach TRGS 519 für Montag terminiert; Bereich bis dahin gesperrt.',
    content: `Bautagesbericht Nr. 22 — Datum: 20.11.2026
Projekt: Sanierung Bürokomplex Am Tiergarten
Personal: 18 Fachkräfte (Schadstoffsanierung Fa. CleanAsbest im 4-Kammer-Schwarzbereich, 6 Elektriker Rückbau).
Leistung: Demontage asbesthaltiger Brandschutzklappen im 3. OG abgeschlossen.
Freimessung: Sachverständigenbüro Dr. Franke für Montag 09:00 Uhr zur Raumluftmessung nach TRGS 519 bestellt.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 22 (20.11.2026)',
      executiveSummary: [
        'Demontage asbesthaltiger Brandschutzklappen im 3. OG erfolgreich unter Unterdruckhaltung abgeschlossen.',
        'Schwarzbereich bleibt bis zur offiziellen Freimessung am Montag voll gesperrt.',
        '18 Fachkräfte für Schadstoffsanierung und Elektro-Rückbau im Einsatz.'
      ],
      keyDecisions: [
        'Gutachter Dr. Franke zur TRGS 519 Raumluftmessung für Montag 09:00 Uhr bestellt.'
      ],
      actionItems: [
        {
          id: 'act-22-1',
          task: 'Begleitung der Asbest-Freimessung im 3. OG',
          responsible: 'Bauleiter Mustermann / Dr. Franke',
          deadline: 'Montag 09:00 Uhr',
          priority: 'Hoch',
          done: false,
          source: 'Bautagesbericht Nr. 22'
        }
      ],
      vobRisks: [],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 22 vom 20.11.2026 für Sanierung Tiergarten.'
    }
  },
  {
    id: 'doc-p3-d21',
    projectId: 'proj-3',
    type: 'diary',
    title: 'Bautagesbericht Nr. 21 — Schutzverschalung & KMF-Rückbau',
    date: '19.11.2026',
    authorOrSender: 'Bauleiter Mustermann',
    weather: '7°C, Innenbereich',
    workforceCount: 16,
    trades: ['Schadstoffsanierung', 'Restaurator Klein'],
    content: `Bautagesbericht Nr. 21 — Datum: 19.11.2026
Tagesleistung:
- Restauratorische Schutzverschalung des Deckenstucks im Foyer fertiggestellt und abgenommen.
- 12 Großbehälter KMF-Dämmung fachgerecht verpackt und zur Entsorgung verladen.`,
    summary: {
      title: 'Tages-Zusammenfassung: Bautagesbericht Nr. 21 (19.11.2026)',
      executiveSummary: [
        'Restauratorische Schutzverschalung des Deckenstucks im Foyer fertiggestellt und abgenommen.',
        '12 Großbehälter KMF-Dämmung fachgerecht verpackt und zur Entsorgung verladen.'
      ],
      keyDecisions: [
        'Denkmalschutzauflagen im Foyer vor Beginn der Rückbauarbeiten vollständig erfüllt.'
      ],
      actionItems: [
        {
          id: 'act-21-1',
          task: 'Elektronischen Begleitschein der KMF-Entsorgung einfordern',
          responsible: 'Bauleitung Mustermann',
          deadline: '20.11.2026',
          priority: 'Mittel',
          done: true,
          source: 'Bautagesbericht Nr. 21'
        }
      ],
      vobRisks: [],
      traceabilityNotes: 'Generiert aus Bautagesbericht Nr. 21 vom 19.11.2026.'
    }
  },
  {
    id: 'doc-p3-m1',
    projectId: 'proj-3',
    type: 'minutes',
    title: 'Denkmal- und Sanierungsbesprechung Nr. 4',
    date: '12.11.2026',
    authorOrSender: 'Untere Denkmalschutzbehörde Berlin',
    content: `Protokoll Denkmalbesprechung Nr. 4 vom 12.11.2026
Teilnehmer: Fr. Denkmalpflegerin Meyer, Bauleitung Mustermann, Restaurator Klein, Bauherr Tiergarten Real Estate.

Vereinbarungen:
1. Historischer Deckenstuck im Eingangsfoyer muss vor Beginn der Trockenbauarbeiten durch Holzverschalung und PE-Folie staub- und erschütterungsgeschützt werden.
2. Farbbefunduntersuchung an Fassadenfenstern durch Restaurator bis 25.11.2026 abzuschließen.`,
    summary: {
      title: 'Protokoll-Zusammenfassung: Denkmalbesprechung Nr. 4 (12.11.2026)',
      executiveSummary: [
        'Denkmalauflage: Staub- und Erschütterungsschutz für Stuck im Eingangsfoyer vor Trockenbaubeginn.',
        'Restaurator führt Farbbefunduntersuchung an Fassadenfenstern bis 25.11. durch.'
      ],
      keyDecisions: [
        'Holzverschalung mit PE-Folie als verbindlicher Schutzstandard festgelegt.'
      ],
      actionItems: [
        {
          id: 'act-p3-m1',
          task: 'Farbbefunduntersuchung abschließen',
          responsible: 'Restaurator Klein',
          deadline: '25.11.2026',
          priority: 'Mittel',
          done: false,
          source: 'Denkmalbesprechung Nr. 4'
        }
      ],
      vobRisks: [],
      traceabilityNotes: 'Generiert aus Denkmalbesprechung Nr. 4.'
    }
  },
  {
    id: 'doc-p3-e1',
    projectId: 'proj-3',
    type: 'emails',
    title: 'E-Mail: Entsorgungsnachweis KMF / Mineralwolle',
    date: '18.11.2026',
    authorOrSender: 'Entsorgungsbetrieb Berlin-Brandenburg GmbH',
    content: `Von: EBB Entsorgung <dispo@ebb-gmbh.de>
An: Bauleitung Tiergarten <bauleitung@bau-ag.de>
Datum: 18.11.2026, 16:05 Uhr
Betreff: Elektronischer Begleitschein / Entsorgungsnachweis KMF

Sehr geehrter Herr Mustermann,
anbei übermitteln wir den behördlich bestätigten elektronischen Entsorgungsnachweis (AVV 17 06 03*) für die 12 Großbehälter künstliche Mineralfasern zur Ablage in der Umweltakte.`,
    summary: {
      title: 'E-Mail-Zusammenfassung: KMF-Entsorgungsnachweis (18.11.2026)',
      executiveSummary: [
        'Elektronischer Entsorgungsnachweis AVV 17 06 03* für 12 Behälter KMF durch EBB übermittelt.',
        'Umweltakte und Behördennachweis für Schadstoffentsorgung ordnungsgemäß geschlossen.'
      ],
      keyDecisions: [
        'Entsorgungsnachweis rechtsverbindlich akzeptiert.'
      ],
      actionItems: [],
      vobRisks: [],
      traceabilityNotes: 'Generiert aus E-Mail EBB Entsorgung vom 18.11.2026.'
    }
  }
];

export function getAllProjectDocuments(): ProjectDocumentItem[] {
  const saved = localStorage.getItem('projectDocuments');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // fallback
    }
  }
  return INITIAL_PROJECT_DOCUMENTS;
}

export function getDocumentsForProject(projectId: string | number): ProjectDocumentItem[] {
  const docs = getAllProjectDocuments();
  const pidStr = String(projectId);
  return docs.filter((d) => {
    const docPidStr = String(d.projectId);
    return (
      docPidStr === pidStr ||
      docPidStr === `proj-${pidStr}` ||
      (pidStr === '1' && docPidStr === 'proj-1') ||
      (pidStr === '2' && docPidStr === 'proj-2') ||
      (pidStr === '3' && docPidStr === 'proj-3') ||
      (pidStr === 'proj-1' && docPidStr === '1') ||
      (pidStr === 'proj-2' && docPidStr === '2') ||
      (pidStr === 'proj-3' && docPidStr === '3')
    );
  });
}

export function getDiaryEntriesForProject(projectId: string | number): ProjectDocumentItem[] {
  const docs = getDocumentsForProject(projectId);
  return docs.filter((d) => d.type === 'diary');
}

export function getDocumentSummary(doc: ProjectDocumentItem): DocumentSummary {
  if (doc.summary) {
    return doc.summary;
  }

  // Dynamically generate a structured summary if none is explicitly attached
  const title = `Tages-Zusammenfassung: ${doc.title} (${doc.date})`;
  const execLines: string[] = [];
  if (doc.weather) execLines.push(`Wetterbedingungen: ${doc.weather}`);
  if (doc.workforceCount) execLines.push(`Personalstärke: ${doc.workforceCount} Fachkräfte auf der Baustelle.`);
  if (doc.trades && doc.trades.length > 0) execLines.push(`Anwesende Gewerke: ${doc.trades.join(', ')}.`);
  if (doc.hindrance) execLines.push(`Besonderes Vorkommnis / Störung: ${doc.hindrance}`);
  if (execLines.length === 0) {
    execLines.push(`Dokumentierte Tagesleistungen aus "${doc.title}" vom ${doc.date}.`);
  }

  const decisions: string[] = [
    `Tagesablauf und Leistungsfortschritt gemäß Bautagesbericht vom ${doc.date} dokumentiert.`,
    'Schnittstellenkontrolle der anwesenden Gewerke durchgeführt.'
  ];

  const actionItems: ActionItemSummary[] = [];
  if (doc.hindrance) {
    actionItems.push({
      id: `act-${doc.id}-hindrance`,
      task: `Störung nachverfolgen: ${doc.hindrance.slice(0, 50)}...`,
      responsible: doc.authorOrSender || 'Bauleitung',
      deadline: 'Kommender Werktag',
      priority: 'Hoch',
      done: false,
      source: doc.title
    });
  }

  actionItems.push({
    id: `act-${doc.id}-report`,
    task: `Folgeprüfung für Arbeiten vom ${doc.date} einplanen`,
    responsible: doc.authorOrSender || 'Bauleitung',
    deadline: 'In 3 Werktagen',
    priority: 'Normal',
    done: true,
    source: doc.title
  });

  const vobRisks: VobRiskSummary[] = [];
  if (doc.hindrance) {
    vobRisks.push({
      title: `VOB-Hinweis aus Bericht vom ${doc.date}`,
      description: doc.hindrance,
      recommendation: 'Prüfen Sie, ob hierfür eine förmliche VOB-Behinderungsanzeige (§ 6 Abs. 1 VOB/B) oder Mehrkostenanmeldung (§ 2 Abs. 5/6 VOB/B) nötig ist.',
      linkType: 'delay'
    });
  }

  return {
    title,
    executiveSummary: execLines,
    keyDecisions: decisions,
    actionItems,
    vobRisks,
    traceabilityNotes: `Strukturiert aus "${doc.title}" (${doc.date}, Verfasser: ${doc.authorOrSender}) generiert.`
  };
}

import { api } from '../services/api';

export function saveProjectDocument(doc: ProjectDocumentItem): ProjectDocumentItem[] {
  const docs = getAllProjectDocuments();
  // Ensure the document has an associated summary attached
  if (!doc.summary) {
    doc.summary = getDocumentSummary(doc);
  }
  const updated = [doc, ...docs.filter((d) => d.id !== doc.id)];
  localStorage.setItem('projectDocuments', JSON.stringify(updated));
  // Synchronize to backend asynchronously
  api.saveDocument({
    id: doc.id,
    projectId: doc.projectId,
    type: doc.type,
    title: doc.title,
    date: doc.date,
    authorOrSender: doc.authorOrSender,
    content: doc.content,
    weather: doc.weather ?? null,
    workforceCount: doc.workforceCount ?? null,
    trades: doc.trades ?? null,
    hindrance: doc.hindrance ?? null,
    summary: doc.summary ?? null,
  }).catch(() => undefined);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('project-documents-updated'));
  }
  return updated;
}

export function deleteProjectDocument(docId: string): ProjectDocumentItem[] {
  const docs = getAllProjectDocuments();
  const updated = docs.filter((d) => d.id !== docId);
  localStorage.setItem('projectDocuments', JSON.stringify(updated));
  api.deleteDocument(docId).catch(() => undefined);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('project-documents-updated'));
  }
  return updated;
}

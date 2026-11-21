"""Soll/Ist-Abgleich mit dem Projektplan, Tagesanalyse (gut/schlecht) und Dashboard.

Alles Rechnen passiert hier in Code (CLAUDE.md: Soll/Ist-Vergleich und Alerts sind testbar):
- Soll %  = Anteil der bis zum Stichtag verstrichenen Werktage am geplanten Zeitraum.
- Ist %   = letzter gemeldeter Fortschritt (ReportProgress) bis zum Stichtag; Ist-Ende → 100 %.
- Verzug  = (Soll % − Ist %) / 100 × Dauer in Werktagen  (z. B. 45 % von 4 Tagen = 1,8 Tage).
VOB-Bezüge und Handlungsempfehlungen stehen als feste Texte in Code, nie vom LLM.
Nur die Tagesanalyse lässt die KI zusätzlich positive/negative Punkte aus dem Berichtstext ziehen.
"""

import datetime as dt
import json
from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session, select

from src.models import Contract, DailyReport, Defect, FormalNotice, PlanTask, Project, ReportProgress
from src.schemas.analysis import (
    Dashboard, DashboardAlert, DashboardKpis, DayAnalysis, DayItem, DayStats, DeviationItem,
    DraftType, ManpowerAvg, PlanAnalysis, WorkPackage,
)
from src.services import llm
from src.services.workforce import workforce_check
from src.services.reports import find_report, project_tasks, weather_text
from src.services.summary import RECOMMENDATIONS, _detect_link, report_label, resolve_period

HOURS_PER_WORKER = 8  # Annahme, wenn ein Bericht nur die Personalanzahl kennt

# Feste VOB-Bezüge je Brieftyp (kein LLM-Wortlaut zu Rechtlichem).
VOB_REFERENCES: dict[DraftType, str] = {
    "delay": "§ 6 Abs. 1 VOB/B (Behinderungsanzeige)",
    "cost": "§ 2 Abs. 5/6 VOB/B (Mehrkostenanmeldung)",
    "defect": "§ 4 Abs. 7 VOB/B (Mängelrüge)",
}
STANDSTILL_WORDS = ("steht", "stillstand", "blockiert", "eingestellt", "stoi", "przestój")


def _de(d: dt.date) -> str:
    return d.strftime("%d.%m.%Y")


def _json(value: str | None):
    try:
        return json.loads(value) if value else None
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------- Soll/Ist je Vorgang

def workdays(start: dt.date, end: dt.date) -> list[dt.date]:
    """Werktage (Mo–Fr) von start bis end, beide inklusive."""
    days, d = [], start
    while d <= end:
        if d.weekday() < 5:
            days.append(d)
        d += dt.timedelta(days=1)
    return days


def duration(task: PlanTask) -> int:
    if not task.planned_start or not task.planned_end:
        return 0
    return max(len(workdays(task.planned_start, task.planned_end)), 1)


def plan_percent(task: PlanTask, ref: dt.date) -> int:
    """Soll-Fortschritt am Ende des Stichtags (linear über Werktage, 0–100)."""
    total = duration(task)
    if total == 0 or ref < task.planned_start:
        return 0
    elapsed = len(workdays(task.planned_start, min(ref, task.planned_end)))
    return round(min(elapsed / total, 1.0) * 100)


def progress_history(session: Session, task: PlanTask, ref: dt.date) -> list[tuple[dt.date, int, DailyReport]]:
    """Gemeldete Stände (Datum, %, Bericht) bis zum Stichtag, chronologisch."""
    rows = session.exec(
        select(ReportProgress, DailyReport).join(DailyReport, ReportProgress.report_id == DailyReport.id)
        .where(ReportProgress.task_id == task.id, DailyReport.report_date <= ref)
        .order_by(DailyReport.report_date)
    ).all()
    return [(r.report_date, p.percent, r) for p, r in rows]


def actual_percent(task: PlanTask, history: list[tuple[dt.date, int, DailyReport]], ref: dt.date) -> int:
    if task.actual_end and task.actual_end <= ref:
        return 100
    return history[-1][1] if history else 0


def delay_days(task: PlanTask, plan_pct: int, actual_pct: int) -> float:
    return round(max(0.0, (plan_pct - actual_pct) / 100 * duration(task)), 1)


def _status(delay: float) -> Literal["delayed", "warning", "ontrack"]:
    return "delayed" if delay >= 1 else "warning" if delay > 0 else "ontrack"


def _actual_date(task: PlanTask, history, actual_pct: int, delay: float) -> str:
    if actual_pct >= 100:
        done = task.actual_end or next((d for d, pct, _ in history if pct >= 100), None)
        return _de(done) if done else "fertig"
    if delay > 0 and task.planned_end:
        # Prognose: geplantes Ende + Verzug (aufgerundet) in Werktagen.
        d, left = task.planned_end, int(-(-delay // 1))
        while left > 0:
            d += dt.timedelta(days=1)
            if d.weekday() < 5:
                left -= 1
        return f"Prognose {_de(d)}"
    return "offen"


class _TaskState(BaseModel):
    task_id: int
    plan: int
    actual: int
    delay: float
    last_report: str | None  # Quellen-Label des letzten Fortschrittsberichts


def evaluate_tasks(session: Session, project: Project, ref: dt.date) -> tuple[list[WorkPackage], list[_TaskState], list[PlanTask]]:
    contracts = session.exec(select(Contract).where(Contract.project_id == project.id)).all()
    by_trade = {(c.trade or "").lower(): c.contractor_name or "" for c in contracts if c.trade}
    packages, states = [], []
    tasks = project_tasks(session, project.id)
    for t in tasks:
        history = progress_history(session, t, ref)
        plan_pct, actual_pct = plan_percent(t, ref), actual_percent(t, history, ref)
        delay = delay_days(t, plan_pct, actual_pct)
        packages.append(WorkPackage(
            id=t.task_code or str(t.id), taskId=t.id, planId=t.plan_id, location=t.location,
            name=t.title, trade=t.trade or "",
            subcontractor=by_trade.get((t.trade or "").lower(), ""),
            planDate=_de(t.planned_end) if t.planned_end else "Ungeplant",
            actualDate=_actual_date(t, history, actual_pct, delay),
            planPercent=plan_pct, actualPercent=actual_pct, status=_status(delay), delayDays=delay,
        ))
        states.append(_TaskState(task_id=t.id, plan=plan_pct, actual=actual_pct, delay=delay,
                                 last_report=report_label(history[-1][2]) if history else None))
    return packages, states, tasks


# ---------------------------------------------------------------- Berichte & Abweichungen

def _hours(r: DailyReport) -> float | None:
    crews = _json(r.workforce)
    if isinstance(crews, list) and crews:
        return float(sum(float(c.get("hours") or 0) for c in crews if isinstance(c, dict)))
    if r.workforce_count is not None:
        return float(r.workforce_count * HOURS_PER_WORKER)
    return None


def _workers(r: DailyReport) -> int | None:
    if r.workforce_count is not None:
        return r.workforce_count
    crews = _json(r.workforce)
    if isinstance(crews, list) and crews:
        return sum(int(c.get("workers") or 0) for c in crews if isinstance(c, dict))
    return None


def _report_deviation(r: DailyReport, related: list[str], idx: int) -> DeviationItem:
    text = (r.deviations_incidents or "").strip()
    first = text.splitlines()[0]
    title = first if len(first) <= 90 else first[:87].rstrip() + "…"
    link: DraftType = _detect_link(text) or "delay"
    critical = any(w in text.lower() for w in STANDSTILL_WORDS)
    impact = "; ".join(related) if related else "Auswirkung auf Termine und Kosten prüfen."
    return DeviationItem(
        id=f"dev-r{r.id or idx}", severity="critical" if critical else "warning", title=title,
        sourceReport=report_label(r), reportDate=_de(r.report_date), cause=text, impact=impact,
        vobReference=VOB_REFERENCES[link], suggestedAction=RECOMMENDATIONS[link], draftType=link,
    )


def _task_deviation(task: PlanTask, state: _TaskState, ref: dt.date) -> DeviationItem:
    return DeviationItem(
        id=f"dev-t{task.id}", severity="critical" if state.delay >= 2 else "warning",
        title=f"Verzug {state.delay:.1f} AT bei {task.title}".replace(".", ",", 1),
        sourceReport=state.last_report or "Projektplan", reportDate=_de(ref),
        cause=f"Ist {state.actual} % statt Soll {state.plan} % am {_de(ref)}.",
        impact=f"Geplantes Ende {_de(task.planned_end)} gefährdet." if task.planned_end else "Terminrisiko.",
        vobReference=VOB_REFERENCES["delay"], suggestedAction=RECOMMENDATIONS["delay"], draftType="delay",
    )


def _related_task_text(tasks: list[PlanTask], states: list[_TaskState]) -> dict[int, str]:
    return {t.id: f"{t.title}: Ist {s.actual} % statt Soll {s.plan} % (Verzug {s.delay:.1f} AT)".replace(".", ",", 1)
            for t, s in zip(tasks, states) if s.delay > 0}


def _reports(session: Session, project_id: int, start: dt.date | None, end: dt.date) -> list[DailyReport]:
    q = select(DailyReport).where(DailyReport.project_id == project_id, DailyReport.report_date <= end)
    if start:
        q = q.where(DailyReport.report_date >= start)
    return list(session.exec(q.order_by(DailyReport.report_date)).all())


def _tasks_touched(session: Session, report: DailyReport) -> set[int]:
    return {p.task_id for p in session.exec(select(ReportProgress).where(ReportProgress.report_id == report.id)).all()}


def _planned_workforce(session: Session, project_id: int) -> float | None:
    values = [c.planned_workforce for c in session.exec(select(Contract).where(Contract.project_id == project_id)).all()
              if c.planned_workforce]
    return float(sum(values)) if values else None


# ---------------------------------------------------------------- Plan-Analyse

def analyze_plan(session: Session, project: Project, period: Literal["week", "all"], ref: dt.date) -> PlanAnalysis:
    """Soll/Ist aller Vorgänge zum Stichtag + Abweichungen aus den Berichten des Zeitraums."""
    packages, states, tasks = evaluate_tasks(session, project, ref)
    start = resolve_period("week", ref)[0] if period == "week" else None
    end = resolve_period("week", ref)[1] if period == "week" else ref
    end = min(end, ref)
    reports = _reports(session, project.id, start, end)

    related = _related_task_text(tasks, states)
    deviations: list[DeviationItem] = []
    explained: set[int] = set()  # Vorgänge, deren Verzug schon eine Berichts-Abweichung erklärt
    for i, r in enumerate(reports):
        if (r.deviations_incidents or "").strip():
            touched = _tasks_touched(session, r) & set(related)
            explained |= touched
            deviations.append(_report_deviation(r, [related[t] for t in touched], i))
    for t, s in zip(tasks, states):
        if s.delay > 0 and t.id not in explained:
            deviations.append(_task_deviation(t, s, ref))
    deviations.sort(key=lambda d: (d.severity != "critical", d.reportDate[6:] + d.reportDate[3:5] + d.reportDate[:2]))

    planned = sum(s.plan * duration(t) for t, s in zip(tasks, states))
    earned = sum(min(s.actual, 100) * duration(t) for t, s in zip(tasks, states))
    hours = [(r, _hours(r)) for r in reports]
    normal = [h for r, h in hours if h is not None and not (r.deviations_incidents or "").strip()]
    baseline = sum(normal) / len(normal) if normal else None
    lost = sum(max(0.0, baseline - h) for r, h in hours
               if baseline is not None and h is not None and (r.deviations_incidents or "").strip())
    workers = [w for w in (_workers(r) for r in reports) if w is not None]
    normal_workers = [_workers(r) for r in reports if not (r.deviations_incidents or "").strip() and _workers(r)]
    plan_workers = _planned_workforce(session, project.id)
    if plan_workers is None and normal_workers:
        plan_workers = sum(normal_workers) / len(normal_workers)  # ohne Vertrag: Ø ungestörter Tage

    return PlanAnalysis(
        overallDelta=-max((s.delay for s in states), default=0.0),
        spi=round(earned / planned, 2) if planned else 1.0,
        evaluatedReports=len(reports),
        criticalAlertsCount=sum(1 for d in deviations if d.severity == "critical"),
        lostHours=round(lost, 1),
        manpowerAvg=ManpowerAvg(plan=round(plan_workers or 0, 1),
                                actual=round(sum(workers) / len(workers), 1) if workers else 0.0),
        workPackages=packages, deviations=deviations, periodFrom=start, periodTo=end, refDate=ref,
    )


# ---------------------------------------------------------------- Tagesanalyse

class _LLMDay(BaseModel):
    wentWell: list[str]
    wentBadly: list[str]


DAY_PROMPT = """Du bewertest einen deutschen Bautagesbericht für den Bauleiter.
Nenne knapp (je 1 Satz, Deutsch), was heute GUT lief (erledigte Arbeiten, Fortschritt, Abnahmen)
und was SCHLECHT lief (Behinderungen, Stillstand, Verzug, Mängel, Wetter).
Streng nur Fakten aus dem Bericht: keine Bewertungen oder Details ergänzen, die dort nicht stehen
(z. B. NICHT "pünktlich", "erfolgreich", "ohne Beanstandung", wenn es nicht so im Text steht).
Keine Rechtsberatung. Leere Liste, wenn nichts zutrifft."""


async def analyze_day(session: Session, project: Project, date: dt.date, use_llm: bool = True) -> DayAnalysis:
    """Was lief am Tag gut/schlecht: Fakten aus Code (Plan, Personal, Wetter) + KI für den Freitext.

    use_llm=False: nur Regeln (z. B. für den Datei-Export – schnell, ohne Tokens, reproduzierbar).
    """
    report = find_report(session, project.id, date)
    title = f"Tagesanalyse {_de(date)} • {project.name}"
    if report is None:
        return DayAnalysis(date=date, title=title, wentWell=[], deviations=[], mode="offline",
                           wentBadly=[DayItem(text=f"Kein Tagesbericht für den {_de(date)} vorhanden.", source="System")],
                           stats=DayStats(workers=None, plannedWorkers=None, hours=None, weather=None))

    label = report_label(report)
    packages, states, tasks = evaluate_tasks(session, project, date)
    prev_states = {s.task_id: s for s in evaluate_tasks(session, project, date - dt.timedelta(days=1))[1]}
    touched = _tasks_touched(session, report)
    well: list[DayItem] = []
    bad: list[DayItem] = []

    for t, s in zip(tasks, states):
        if t.id not in touched:
            continue
        gained = s.actual - prev_states[t.id].actual
        if s.actual >= 100 and gained > 0:
            well.append(DayItem(text=f"{t.title} abgeschlossen (100 %).", source=label))
        elif s.delay > 0:
            delay = f"{s.delay:.1f}".replace(".", ",")
            bad.append(DayItem(text=f"{t.title}: Ist {s.actual} % statt Soll {s.plan} % (Verzug {delay} AT).",
                               source=label))
        elif gained > 0:
            well.append(DayItem(text=f"{t.title}: +{gained} % auf {s.actual} % (Soll {s.plan} %).", source=label))

    workers, hours = _workers(report), _hours(report)
    gaps = workforce_check(session, project, date)
    for g in gaps:  # Sollstärke je Firma (Vertrag) – genauer als der Projekt-Durchschnitt unten
        streak = f", {g.consecutiveDays}. Tag in Folge" if g.consecutiveDays > 1 else ""
        bad.append(DayItem(text=f"{g.company or g.trade}: {g.actual} statt {g.planned} Arbeitskräfte "
                                f"laut Vertrag (−{g.shortfallPercent} %{streak}).", source=g.source))
    plan_workers = _planned_workforce(session, project.id)
    if plan_workers is None:
        others = [_workers(r) for r in _reports(session, project.id, None, date)
                  if not (r.deviations_incidents or "").strip() and _workers(r)]
        plan_workers = round(sum(others) / len(others), 1) if others else None
    if not gaps and workers is not None and plan_workers and workers < 0.8 * plan_workers:
        bad.append(DayItem(text=f"Personal unter Soll: {workers} statt ca. {plan_workers:g} Personen.", source=label))

    weather = _json(report.weather)
    if isinstance(weather, dict) and (float(weather.get("rain_mm") or 0) > 5 or "stark" in str(weather.get("condition", "")).lower()):
        bad.append(DayItem(text=f"Witterung: {weather_text(report.weather)}.", source=label))

    deviations = []
    if (report.deviations_incidents or "").strip():
        related = _related_task_text(tasks, states)
        deviations.append(_report_deviation(report, [related[t] for t in touched & set(related)], 0))

    # Freitext (Leistung, Vorkommnisse, Lieferungen) → KI ergänzt gut/schlecht; offline: Regeln.
    text = "\n".join(f"{k}: {v.strip()}" for k, v in (("Ausgeführt", report.work_completed),
                     ("Vorkommnisse", report.deviations_incidents), ("Lieferungen/Abnahmen", report.deliveries))
                     if v and v.strip())
    mode: Literal["ai", "offline"] = "offline"
    result = await llm.complete_json(DAY_PROMPT, text, _LLMDay, max_tokens=600) if text and use_llm else None
    if result is not None:
        mode = "ai"
        well += [DayItem(text=s.strip(), source=label) for s in result.wentWell if s.strip()]
        bad += [DayItem(text=s.strip(), source=label) for s in result.wentBadly if s.strip()]
    else:
        for line in (report.deviations_incidents or "").splitlines():
            if line.strip():
                bad.append(DayItem(text=line.strip(), source=label))
        if report.deliveries and report.deliveries.strip():
            well.append(DayItem(text=report.deliveries.strip(), source=label))
        if report.work_completed and report.work_completed.strip() and not report.deviations_incidents:
            well.append(DayItem(text=report.work_completed.strip(), source=label))

    return DayAnalysis(date=date, title=title, wentWell=well, wentBadly=bad, deviations=deviations, mode=mode,
                       stats=DayStats(workers=workers, plannedWorkers=plan_workers, hours=hours,
                                      weather=weather_text(report.weather)), workforce=gaps)


# ---------------------------------------------------------------- Dashboard

def dashboard(session: Session, project: Project, ref: dt.date) -> Dashboard:
    """Kennzahlen + Warnungen für die Startseite (abgeleitet aus der Wochen-Analyse)."""
    a = analyze_plan(session, project, "week", ref)
    drafts = session.exec(select(FormalNotice).where(FormalNotice.project_id == project.id,
                                                     FormalNotice.status == "Entwurf")).all()
    today = find_report(session, project.id, ref)
    # Proaktiv: Briefvorschläge aus dem Sollstärke-Check zuerst, dann Abweichungen aus dem Plan.
    alerts = [DashboardAlert(
        severity="critical" if g.suggestion else "warning",
        title=g.suggestion.title if g.suggestion else f"{g.company or g.trade}: {g.actual} statt {g.planned} Arbeitskräfte",
        description=(f"Sollstärke laut {g.contractSource}: {g.planned}, Ist {g.actual} (−{g.shortfallPercent} %), "
                     f"{g.consecutiveDays} Tag(e) in Folge."),
        draftType="delay", source=g.source, prefillText=g.suggestion.prefillText if g.suggestion else None,
    ) for g in workforce_check(session, project, ref)]
    alerts += [DashboardAlert(severity=d.severity, title=d.title, description=d.impact, draftType=d.draftType,
                              source=d.sourceReport) for d in a.deviations[:5]]
    # Überfällige Mängel (Frist vorbei, weder behoben noch abgenommen) – Vorschlag: Mängelrüge / Nachfrist
    overdue = [m for m in session.exec(select(Defect).where(Defect.project_id == project.id)).all()
               if m.status in ("offen", "in_bearbeitung") and m.deadline and m.deadline < ref]
    alerts += [DashboardAlert(
        severity="critical" if (ref - m.deadline).days >= 3 or m.priority == "hoch" else "warning",
        title=f"Mangel überfällig: {m.title}",
        description=(f"{m.company or 'Firma offen'} · Frist {_de(m.deadline)} ({(ref - m.deadline).days} Tag(e) überschritten)"
                     f"{' · ' + ' · '.join(x for x in (m.house, m.level) if x) if m.house else ''}."),
        draftType="defect", source=f"Mangel #{m.id}",
        prefillText=(f"Mangel: {m.title}. Ort: {m.location or ' · '.join(x for x in (m.house, m.level) if x)}. "
                     f"Firma: {m.company or 'unbekannt'}. Frist {_de(m.deadline)} ist abgelaufen, Mangel nicht beseitigt."),
    ) for m in sorted(overdue, key=lambda m: m.deadline)]
    return Dashboard(
        kpis=DashboardKpis(delayDays=-a.overallDelta, spi=a.spi, criticalAlerts=a.criticalAlertsCount,
                           openDrafts=len(drafts), workersToday=_workers(today) if today else None),
        alerts=alerts, progress=a.workPackages,
    )

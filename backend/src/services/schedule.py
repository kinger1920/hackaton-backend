"""Tagesaufgaben + kommende Termine aus dem Bauzeitenplan (Board: "Tagesaufgaben aus Terminplan ableiten").

- days[]: je Werktag die Vorgänge, die laut Plan laufen – mit Soll-% am Tagesende, Ist-Stand,
  zuständiger Firma und Sollstärke aus dem Vertrag. Überfällige, unfertige Vorgänge bleiben als
  Restarbeiten drin (isOverdue), bis 100 % gemeldet sind.
- appointments[]: Jues SiteAppointment-Format für die Termin-Seite:
  Vorgangsbeginn/-ende (milestone), verspätete Vorgänge (deadline, dringend) und offene
  Sollstärke-Vorschläge "Behinderungsanzeige prüfen" (deadline, dringend).
Alles aus Plan, Berichten und Verträgen berechnet (Code, kein LLM). VOB-Bezüge sind feste Texte.
"""

import datetime as dt

from sqlmodel import Session, select

from src.models import ConstructionPlan, Contract, DailyReport, FormalNotice, PlanTask, Project
from src.schemas.reports import AttendanceItem
from src.schemas.schedule import DayTask, Schedule, ScheduleDay, SiteAppointment
from src.services.analysis import evaluate_tasks, plan_percent, workdays
from src.services.workforce import match_contract, workforce_check

VOB_DELAY = "§ 6 Abs. 1 VOB/B"


def _de(d: dt.date) -> str:
    return d.strftime("%d.%m.%Y")


def _fmt(days: float) -> str:
    return f"{days:.1f}".replace(".", ",")


def _plan_source(session: Session, task: PlanTask) -> str:
    plan = session.get(ConstructionPlan, task.plan_id)
    if plan is None:
        return "Bauzeitenplan"
    return f"{plan.title} v{plan.version}" if plan.version else plan.title


def _contract_for(task: PlanTask, contracts: list[Contract]) -> Contract | None:
    """Vertrag zum Gewerk des Vorgangs – nur wenn eindeutig (zwei Rohbau-Firmen → keine Angabe)."""
    if not task.trade:
        return None
    return match_contract(AttendanceItem(trade=task.trade, workers=0), contracts)


def _crew_text(contract: Contract | None) -> str:
    if contract is None:
        return ""
    name = contract.contractor_name or contract.title
    return f" · {name}" + (f", Sollstärke {contract.planned_workforce}" if contract.planned_workforce else "")


def _workforce_appointments(session: Session, project: Project, ref: dt.date, date_from: dt.date) -> list[SiteAppointment]:
    """Offene Briefvorschläge aus dem Sollstärke-Check am letzten Berichtstag bis ref."""
    reports = list(session.exec(select(DailyReport).where(
        DailyReport.project_id == project.id, DailyReport.report_date <= ref)
        .order_by(DailyReport.report_date.desc())).all())
    if not reports:
        return []
    result = []
    for gap in workforce_check(session, project, reports[0].report_date):
        if gap.suggestion is None:
            continue
        # Schon reagiert? Ein Behinderungs-Brief seit Beginn der Unterschreitung → kein Hinweis mehr.
        since = reports[min(gap.consecutiveDays, len(reports)) - 1].report_date
        handled = session.exec(select(FormalNotice).where(
            FormalNotice.project_id == project.id, FormalNotice.type == "delay")).all()
        if any(n.created_at.date() >= since for n in handled):
            continue
        result.append(SiteAppointment(
            id=f"workforce-{gap.contractId}", projectId=project.id, title=gap.suggestion.title,
            date=max(date_from, reports[0].report_date), category="deadline", trade=gap.trade,
            description=(f"{gap.company or gap.trade}: {gap.actual} statt {gap.planned} Arbeitskräfte "
                         f"({gap.consecutiveDays} Tage in Folge, {gap.source}). Behinderung unverzüglich "
                         f"schriftlich anzeigen."),
            vobReference=VOB_DELAY, isUrgent=True,
        ))
    return result


def schedule(session: Session, project: Project, date_from: dt.date, days: int, ref: dt.date) -> Schedule:
    """Fenster [date_from, date_from + days − 1]: Aufgaben je Werktag + Termine. Ist-Stand = Stand bis ref."""
    date_to = date_from + dt.timedelta(days=days - 1)
    contracts = list(session.exec(select(Contract).where(Contract.project_id == project.id)).all())
    _, states, tasks = evaluate_tasks(session, project, ref)
    state_by_task = {s.task_id: s for s in states}

    day_list = []
    for day in workdays(date_from, date_to):
        items = []
        for t in tasks:
            if not (t.planned_start and t.planned_end):
                continue
            c, s = _contract_for(t, contracts), state_by_task[t.id]
            overdue = day > t.planned_end and s.actual < 100  # Restarbeiten, bis 100 % gemeldet sind
            if not (t.planned_start <= day <= t.planned_end or overdue):
                continue
            status = "delayed" if s.delay >= 1 else "warning" if s.delay > 0 else "ontrack"
            items.append(DayTask(
                taskId=t.id, code=t.task_code or str(t.id), title=t.title, trade=t.trade,
                company=c.contractor_name if c else None, plannedWorkforce=c.planned_workforce if c else None,
                planPercent=plan_percent(t, day), actualPercent=s.actual, status=status,
                isStart=day == t.planned_start, isEnd=day == t.planned_end, isOverdue=overdue,
                source=_plan_source(session, t),
            ))
        day_list.append(ScheduleDay(date=day, tasks=items))

    appointments: list[SiteAppointment] = []
    for t in tasks:
        if not (t.planned_start and t.planned_end):
            continue
        c, s = _contract_for(t, contracts), state_by_task[t.id]
        crew = _crew_text(c)
        if date_from <= t.planned_start <= date_to:
            appointments.append(SiteAppointment(
                id=f"task-{t.id}-start", projectId=project.id, title=f"Beginn: {t.title}", date=t.planned_start,
                category="milestone", trade=t.trade,
                description=f"{t.task_code or ''} laut {_plan_source(session, t)}{crew}".strip()))
        if s.delay > 0 and t.planned_end <= date_to and s.actual < 100:
            # Verspätet: Plan-Ende im Fenster oder schon überschritten (dann am ersten Tag des Fensters zeigen).
            appointments.append(SiteAppointment(
                id=f"task-{t.id}-late", projectId=project.id, title=f"Verzug: {t.title}",
                date=max(t.planned_end, date_from), category="deadline", trade=t.trade,
                description=(f"Plan-Ende {_de(t.planned_end)}: Ist {s.actual} % statt Soll {s.plan} % "
                             f"({_fmt(s.delay)} AT Verzug, {s.last_report or 'ohne Bericht'}).{crew}"),
                vobReference=VOB_DELAY, isUrgent=True))
        elif date_from <= t.planned_end <= date_to:
            appointments.append(SiteAppointment(
                id=f"task-{t.id}-end", projectId=project.id, title=f"Fertig: {t.title}", date=t.planned_end,
                category="milestone", trade=t.trade,
                description=f"Geplante Fertigstellung laut {_plan_source(session, t)}{crew}"))

    appointments += _workforce_appointments(session, project, ref, date_from)
    appointments.sort(key=lambda a: (a.date, not a.isUrgent, a.title))
    return Schedule(projectId=project.id, dateFrom=date_from, dateTo=date_to, refDate=ref,
                    days=day_list, appointments=appointments)

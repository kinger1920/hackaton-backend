"""Anwesenheit je Firma/Gewerk und Sollstärke-Check (Soll laut Vertrag vs. Ist laut Tagesbericht).

- Anwesenheit steht im vorhandenen Feld `DailyReport.workforce` (JSON-Liste, Yannicks Modell):
  [{"company": "Erdbau Krause GmbH", "trade": "Erdbau", "workers": 3, "hours": 24}, ...]
- Soll = `Contract.planned_workforce` (vertragliche Sollstärke, Yannicks Verträge).
- Unterschreitung ≥ 20 % → Warnung. Ab dem 2. Tag in Folge → Vorschlag "Behinderungsanzeige"
  mit einem sachlichen Vorschlagstext (nur Fakten aus Bericht + Vertrag).
Alles Rechnen und alle VOB-Hinweise stehen hier fest in Code, nie vom LLM (CLAUDE.md §1).
Der eigentliche Brief entsteht wie immer über /api/capture → letters.py (Wortlaut aus Vorlagen).
"""

import datetime as dt
import json
import re

from sqlmodel import Session, select

from src.models import Company, Contract, DailyReport, Project
from src.schemas.analysis import WorkforceGap, WorkforceSuggestion
from src.schemas.reports import AttendanceItem

SHORTFALL_RATIO = 0.8  # Ist < 80 % vom Soll = Unterschreitung
SUGGEST_AFTER_DAYS = 2  # ab so vielen Berichtstagen in Folge → Briefvorschlag

# Feste Prüfhinweise (Code, kein LLM). Keine Rechtsberatung – nur Hinweise für den Bauleiter.
VOB_HINT_DELAY = ("§ 6 Abs. 1 VOB/B: Behinderung unverzüglich schriftlich anzeigen – sonst werden die "
                  "Umstände nur berücksichtigt, wenn sie dem Auftraggeber offenkundig bekannt waren.")
VOB_HINT_STAFF = ("§ 5 Abs. 3 VOB/B: Sind Arbeitskräfte so unzureichend, dass die Ausführungsfristen offenbar "
                  "nicht eingehalten werden können, muss der Auftragnehmer auf Verlangen unverzüglich Abhilfe "
                  "schaffen (Abhilfeaufforderung an die Firma prüfen).")

# Rechtsform-/Füllwörter, die beim Namensvergleich nicht zählen ("Fa. Krause" = "Erdbau Krause GmbH").
_STOP = {"fa", "firma", "firmy", "gmbh", "co", "kg", "ag", "mbh", "ug", "gbr", "ohg", "und", "the", "sp", "zoo", "z", "oo"}


def _de(d: dt.date) -> str:
    return d.strftime("%d.%m.%Y")


def tokens(name: str | None) -> set[str]:
    """Name → vergleichbare Wörter (klein, ohne Rechtsform, mind. 3 Zeichen)."""
    words = re.findall(r"[0-9a-zA-ZäöüßÄÖÜąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+", (name or "").lower())
    return {w for w in words if len(w) >= 3 and w not in _STOP}


def attendance_of(report: DailyReport | None) -> list[AttendanceItem]:
    """Anwesenheit aus dem workforce-JSON lesen (kaputte/alte Einträge werden übersprungen)."""
    if report is None or not report.workforce:
        return []
    try:
        rows = json.loads(report.workforce)
    except (ValueError, TypeError):
        return []
    items = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get("workers") is not None:
            try:
                items.append(AttendanceItem(company=row.get("company") or None, trade=row.get("trade") or None,
                                            workers=int(row["workers"]), hours=row.get("hours")))
            except (ValueError, TypeError):
                continue
    return items


def store_attendance(report: DailyReport, items: list[AttendanceItem]) -> None:
    report.workforce = json.dumps([i.model_dump(exclude_none=True) for i in items], ensure_ascii=False) if items else None


def contracts_with_target(session: Session, project_id: int) -> list[Contract]:
    """Verträge des Projekts mit hinterlegter Sollstärke."""
    return [c for c in session.exec(select(Contract).where(Contract.project_id == project_id)
                                     .order_by(Contract.id)).all() if c.planned_workforce]


def _unique(candidates: list[Contract]) -> Contract | None:
    return candidates[0] if len(candidates) == 1 else None  # mehrdeutig → lieber keine Zuordnung


def match_contract(item: AttendanceItem, contracts: list[Contract]) -> Contract | None:
    """Anwesenheit → Vertrag: erst über den Firmennamen, sonst über das Gewerk – nur wenn eindeutig.

    Gewerke-Wörter zählen beim Namensvergleich nicht ("BetonTech Rohbau" ≠ "Müller Rohbau").
    """
    trade_words = set().union(*(tokens(c.trade) for c in contracts)) if contracts else set()
    words = tokens(item.company) - trade_words
    if words:
        scores = [(len(words & (tokens(c.contractor_name) - trade_words)), c) for c in contracts]
        best = max((s for s, _ in scores), default=0)
        if best:
            return _unique([c for s, c in scores if s == best])
    trade = (item.trade or "").strip().lower()
    if trade:
        return _unique([c for c in contracts if (c.trade or "").strip().lower() == trade])
    # Gewerk als Firmenname diktiert ("Erdbau hat nur 3 Mann") → Gewerk des Vertrags vergleichen.
    if tokens(item.company):
        return _unique([c for c in contracts if tokens(item.company) & tokens(c.trade)])
    return None


def actual_for(contract: Contract, items: list[AttendanceItem], contracts: list[Contract]) -> int | None:
    """Arbeitskräfte dieses Vertrags laut Anwesenheit. None = Firma steht nicht in der Liste."""
    matched = [i.workers for i in items if match_contract(i, contracts) is contract]
    return sum(matched) if matched else None


def active_trades(session: Session, project_id: int, date: dt.date) -> set[str]:
    """Gewerke, die laut Bauzeitenplan an diesem Tag arbeiten sollen (klein geschrieben)."""
    from src.services.reports import project_tasks  # spät importieren: reports importiert dieses Modul

    return {(t.trade or "").strip().lower() for t in project_tasks(session, project_id)
            if t.trade and t.planned_start and t.planned_end and t.planned_start <= date <= t.planned_end}


def _staffed(contract: Contract, items: list[AttendanceItem], contracts: list[Contract],
             active: set[str]) -> int | None:
    """Ist-Stärke für den Vergleich – oder None, wenn heute kein Soll gilt.

    - Firma in der Liste → ihre Anzahl.
    - Firma fehlt, ihr Gewerk ist laut Plan aktiv und keine andere Firma desselben Gewerks ist da → 0.
    - sonst (Gewerk heute nicht dran / nicht eindeutig) → None = kein Vergleich.
    """
    n = actual_for(contract, items, contracts)
    if n is not None:
        return n
    trade = (contract.trade or "").strip().lower()
    if not trade or trade not in active:
        return None
    same_trade = [c for c in contracts if c is not contract and (c.trade or "").strip().lower() == trade]
    if any(actual_for(c, items, contracts) for c in same_trade):
        return None
    return 0


def _reports_until(session: Session, project_id: int, date: dt.date) -> list[DailyReport]:
    """Berichte bis einschließlich `date`, neueste zuerst."""
    return list(session.exec(select(DailyReport).where(
        DailyReport.project_id == project_id, DailyReport.report_date <= date)
        .order_by(DailyReport.report_date.desc())).all())


def _company_rules(session: Session, contract: Contract) -> str | None:
    words = tokens(contract.contractor_name)
    if not words:
        return None
    for company in session.exec(select(Company)).all():
        if company.vob_rules and words & tokens(company.name):
            return company.vob_rules
    return None


def _prefill(contract: Contract, days: list[tuple[DailyReport, int]], incidents: str | None) -> str:
    """Sachlicher Text für /api/capture (Diktat-Ersatz). Nur Fakten, kein juristischer Wortlaut."""
    name = contract.contractor_name or contract.trade or contract.title
    trade = f" ({contract.trade})" if contract.trade and contract.trade != name else ""
    per_day = ", ".join(f"{_de(r.report_date)}: {n}" for r, n in sorted(days, key=lambda x: x[0].report_date))
    text = (f"Personalunterschreitung {name}{trade}: an {len(days)} Arbeitstagen in Folge weniger Arbeitskräfte "
            f"als die vertraglich vereinbarte Sollstärke von {contract.planned_workforce} "
            f"(Vertrag „{contract.title}“). Ist-Stärke laut Tagesbericht – {per_day}.")
    if incidents and incidents.strip():
        text += f" Vorkommnis laut Tagesbericht: {incidents.strip()}"
    return text


def workforce_check(session: Session, project: Project, date: dt.date) -> list[WorkforceGap]:
    """Soll/Ist je Vertrag am Berichtstag. Leer, wenn es keinen Bericht, keine Anwesenheit oder keine Sollstärke gibt."""
    contracts = contracts_with_target(session, project.id)
    reports = _reports_until(session, project.id, date)
    if not contracts or not reports or reports[0].report_date != date:
        return []
    today = reports[0]
    if not attendance_of(today):
        return []  # unbekannt ≠ 0 Personen: ohne Anwesenheitsliste kein Vergleich

    gaps: list[WorkforceGap] = []
    for c in contracts:
        planned = int(c.planned_workforce)
        actual = _staffed(c, attendance_of(today), contracts, active_trades(session, project.id, date))
        if actual is None or actual >= SHORTFALL_RATIO * planned:
            continue
        # Wie viele Berichtstage in Folge (rückwärts ab heute) liegt diese Firma unter Soll?
        streak: list[tuple[DailyReport, int]] = []
        for r in reports:
            items = attendance_of(r)
            if not items:
                break
            n = _staffed(c, items, contracts, active_trades(session, project.id, r.report_date))
            if n is None or n >= SHORTFALL_RATIO * planned:
                break
            streak.append((r, n))

        hints = [VOB_HINT_DELAY, VOB_HINT_STAFF]
        if c.vob_notes:
            hints.append(f"Vertrag „{c.title}“: {c.vob_notes}")
        rules = _company_rules(session, c)
        if rules:
            hints.append(f"Firma {c.contractor_name}: {rules}")

        suggestion = None
        if len(streak) >= SUGGEST_AFTER_DAYS:
            suggestion = WorkforceSuggestion(
                draftType="delay",
                title=f"Behinderungsanzeige prüfen: {c.contractor_name or c.trade} seit {len(streak)} Tagen unter Sollstärke",
                prefillText=_prefill(c, streak, today.deviations_incidents),
            )
        gaps.append(WorkforceGap(
            company=c.contractor_name, trade=c.trade, contractId=c.id, contractTitle=c.title,
            planned=planned, actual=actual, shortfallPercent=round(100 * (planned - actual) / planned),
            consecutiveDays=len(streak), source=f"Tagesbericht {_de(date)}", contractSource=f"Vertrag „{c.title}“",
            vobHints=hints, suggestion=suggestion,
        ))
    return gaps

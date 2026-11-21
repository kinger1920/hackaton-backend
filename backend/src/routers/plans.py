from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from src.database import get_session
from src.models import (
    ConstructionPlan,
    ConstructionPlanCreate,
    ConstructionPlanRead,
    ConstructionPlanUpdate,
    PlanTask,
    Project,
)

router = APIRouter(prefix="/plans", tags=["Construction Plans"])


@router.get("", response_model=list[ConstructionPlanRead])
def list_construction_plans(
    project_id: int | None = None,
    session: Session = Depends(get_session),
):
    statement = select(ConstructionPlan)
    if project_id is not None:
        statement = statement.where(ConstructionPlan.project_id == project_id)
    return session.exec(statement).all()


@router.get("/{plan_id}", response_model=ConstructionPlanRead)
def get_construction_plan(
    plan_id: int,
    session: Session = Depends(get_session),
):
    plan = session.get(ConstructionPlan, plan_id)
    if not plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ConstructionPlan not found",
        )
    return plan


@router.post("", response_model=ConstructionPlanRead, status_code=status.HTTP_201_CREATED)
def create_construction_plan(
    plan: ConstructionPlanCreate,
    session: Session = Depends(get_session),
):
    if not session.get(Project, plan.project_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    db_plan = ConstructionPlan.model_validate(plan)
    session.add(db_plan)
    session.commit()
    session.refresh(db_plan)
    return db_plan


@router.patch("/{plan_id}", response_model=ConstructionPlanRead)
def update_construction_plan(
    plan_id: int,
    plan_update: ConstructionPlanUpdate,
    session: Session = Depends(get_session),
):
    db_plan = session.get(ConstructionPlan, plan_id)
    if not db_plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ConstructionPlan not found",
        )

    update_data = plan_update.model_dump(exclude_unset=True)
    db_plan.sqlmodel_update(update_data)
    session.add(db_plan)
    session.commit()
    session.refresh(db_plan)
    return db_plan


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_construction_plan(
    plan_id: int,
    session: Session = Depends(get_session),
):
    db_plan = session.get(ConstructionPlan, plan_id)
    if not db_plan:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="ConstructionPlan not found",
        )

    tasks = session.exec(select(PlanTask).where(PlanTask.plan_id == plan_id)).all()
    for task in tasks:
        session.delete(task)
    session.flush()

    session.delete(db_plan)
    session.commit()

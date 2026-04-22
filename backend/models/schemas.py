from pydantic import BaseModel, Field
from typing import List, Dict, Optional
from datetime import datetime

class PermitPlan(BaseModel):
    permits: List[str] = Field(..., description="List of required permit types")
    agencies: List[str] = Field(..., description="Authorities involved")
    documents: List[str] = Field(..., description="Total documents needed across all permits")

class StepDetail(BaseModel):
    id: int
    title: str
    responsible: str = "Agent"  # "Human", "Agent", "Human/Agent"
    status: str = "pending"    # "pending", "completed"
    notes: Optional[str] = None
    docs: List[str] = Field(default_factory=list, description="Documents needed for this step")


class ExecutionPlan(BaseModel):
    steps: List[StepDetail] = Field(..., description="Ordered detailed steps for the workflow")
    assigned_agents: List[str] = Field(default=["Planner", "Classifier"])

# Combined schema — lets us answer fully in ONE Gemini API call
class AgentStep(BaseModel):
    title: str = Field(..., description="Title of the step")
    description: str = Field(..., description="Detailed explanation of the step")
    documents: List[str] = Field(default_factory=list, description="Documents legally required for THIS specific step")

class CombinedPermitResult(BaseModel):
    permits: List[str] = Field(..., description="Required permit types (e.g. Workplace License, Fire Safety)")
    agencies: List[str] = Field(..., description="Government agencies involved")
    documents: List[str] = Field(..., description="All documents required across permits")
    steps: List[AgentStep] = Field(..., description="Ordered steps the business owner must follow")
    timeline_days: int = Field(..., description="Estimated total days to obtain all permits")
    summary: str = Field(..., description="One-paragraph plain-language summary for the business owner")
    location: str = Field(..., description="The district of Istanbul (e.g. Kadıköy, Beşiktaş)")
    business_type: str = Field(..., description="The type of business (e.g. Cafe, Restaurant)")

class DocumentChecklist(BaseModel):
    items: List[str]
    status: Dict[str, str]

class WorkflowStatus(BaseModel):
    current_step: str
    completion_percentage: float
    next_action_required: Optional[str]

class QuestionResponse(BaseModel):
    question: str
    missing_fields: List[str]

class PermitState(BaseModel):
    business_profile: Optional[Dict] = None
    execution_plan: Optional[ExecutionPlan] = None
    permit_plan: Optional[PermitPlan] = None
    combined_result: Optional[CombinedPermitResult] = None
    clarifying_question: Optional[str] = None
    checklist: Optional[DocumentChecklist] = None
    uploaded_documents: List[str] = []
    validation_results: List[Dict] = []
    workflow_status: Optional[WorkflowStatus] = None
    last_updated: datetime = Field(default_factory=datetime.now)

class UserQuery(BaseModel):
    query: str
    language: str = "en"
    context: Optional[Dict] = None

class UserCreate(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    email: str
    full_name: Optional[str] = None

from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan
from agents.core_agents import student_ai_agent
from utils.rate_limiter import throttled_run

class GraphState(TypedDict):
    state: PermitState
    user_request: str
    language: str

async def student_node(state: GraphState):
    """Single node: runs one combined API call to get the full student roadmap."""
    result = await throttled_run(student_ai_agent, state['user_request'])
    print(f"[Student Orchestrator] Agent result type: {type(result)}")
    
    if hasattr(result, 'data'):
        combined = result.data
    else:
        print("[Student Orchestrator] result has no .data, trying to use result directly or .output")
        combined = getattr(result, 'output', result)
        
    from models.schemas import QuestionResponse
    
    if isinstance(combined, QuestionResponse):
        print(f"[Student Orchestrator] Agent returned a question: {combined.question}")
        state['state'].clarifying_question = combined.question
        return state

    if not isinstance(combined, CombinedPermitResult):
        print(f"[Student Orchestrator] Result is not CombinedPermitResult, it is {type(combined)}")
        from models.schemas import AgentStep
        combined = CombinedPermitResult(
            summary=str(combined) if combined else "Here is your student guide.",
            permits=["Student Residence Permit (Kimlik)"],
            agencies=["Göç İdaresi", "University Student Affairs"],
            documents=["Passport", "Acceptance Letter", "Health Insurance"],
            steps=[
                AgentStep(title="Enrollment", description="University enrollment", documents=["Acceptance Letter"]),
                AgentStep(title="Health Insurance", description="Get health insurance", documents=["Passport"]),
                AgentStep(title="Kimlik Application", description="Apply for residency", documents=["Health Insurance"])
            ],
            timeline_days=30,
            location="Istanbul",
            business_type="Student"
        )
    
    # Force business_type to student so the protocol engine picks the right steps
    combined.business_type = "student"
    state['state'].combined_result = combined
    
    from models.schemas import PermitPlan
    state['state'].permit_plan = PermitPlan(
        permits=combined.permits,
        agencies=combined.agencies,
        documents=combined.documents,
    )
    
    from models.schemas import StepDetail
    
    details = []
    for i, st in enumerate(combined.steps):
        details.append(StepDetail(
            id=i + 1,
            title=st.title,
            responsible="Agent" if "e-Devlet" in st.description or "Agent" in st.description or "e-İkamet" in st.description else "Human/Agent",
            status="pending",
            notes=st.description,
            docs=st.documents
        ))
    
    state['state'].execution_plan = ExecutionPlan(
        steps=details,
        assigned_agents=["Academic Advisor", "Immigration Specialist"]
    )
    return state

builder = StateGraph(GraphState)
builder.add_node("student", student_node)
builder.add_edge(START, "student")
builder.add_edge("student", END)

student_orchestrator = builder.compile()

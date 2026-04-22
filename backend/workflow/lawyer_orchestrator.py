from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan
from agents.core_agents import lawyer_ai_agent
from utils.rate_limiter import throttled_run

class GraphState(TypedDict):
    state: PermitState
    user_request: str
    language: str

async def lawyer_node(state: GraphState):
    """Single node: runs one combined API call to get the full legal roadmap."""
    result = await throttled_run(lawyer_ai_agent, state['user_request'])
    print(f"[Lawyer Orchestrator] Agent result type: {type(result)}")
    
    if hasattr(result, 'data'):
        combined = result.data
    else:
        print("[Lawyer Orchestrator] result has no .data, trying to use result directly or .output")
        combined = getattr(result, 'output', result)
        
    from models.schemas import QuestionResponse
    
    if isinstance(combined, QuestionResponse):
        print(f"[Lawyer Orchestrator] Agent returned a question: {combined.question}")
        state['state'].clarifying_question = combined.question
        return state

    if not isinstance(combined, CombinedPermitResult):
        print(f"[Lawyer Orchestrator] Result is not CombinedPermitResult, it is {type(combined)}")
        from models.schemas import AgentStep
        combined = CombinedPermitResult(
            summary=str(combined) if combined else "Here is your legal guide.",
            permits=["Legal Advisory"],
            agencies=["Turkish Courts", "Notary Public"],
            documents=["ID", "Relevant Contracts", "Power of Attorney"],
            steps=[
                AgentStep(title="Initial Consultation", description="Meet with attorney", documents=["ID"]),
                AgentStep(title="Document Collection", description="Collect contracts", documents=["Contracts"]),
                AgentStep(title="Legal Action", description="Submit to court", documents=["Power of Attorney"])
            ],
            timeline_days=30,
            location="Turkey",
            business_type="Lawyer"
        )
    
    # Force business_type to lawyer so the protocol engine picks the right steps
    combined.business_type = "lawyer"
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
        assigned_agents=["Legal Advisor", "Notary"]
    )
    return state

builder = StateGraph(GraphState)
builder.add_node("lawyer", lawyer_node)
builder.add_edge(START, "lawyer")
builder.add_edge("lawyer", END)

lawyer_orchestrator = builder.compile()

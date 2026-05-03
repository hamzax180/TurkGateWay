from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan
from agents.core_agents import permit_agent
from utils.rate_limiter import throttled_run

class GraphState(TypedDict):
    state: PermitState
    user_request: str
    language: str

async def permit_node(state: GraphState):
    """Single node: runs one combined API call to get the full permit plan."""
    result = await throttled_run(permit_agent, state['user_request'])
    print(f"[Orchestrator] Agent result type: {type(result)}")
    
    # Handle different result types from pydantic-ai
    if hasattr(result, 'data'):
        combined = result.data
    else:
        print("[Orchestrator] result has no .data, trying to use result directly or .output")
        combined = getattr(result, 'output', result)
        
    from models.schemas import QuestionResponse
    
    if isinstance(combined, QuestionResponse):
        print(f"[Orchestrator] Agent returned a question: {combined.question}")
        state['state'].clarifying_question = combined.question
        return state

    if not isinstance(combined, CombinedPermitResult):
        print(f"[Orchestrator] Result is not CombinedPermitResult, it is {type(combined)}")
        # Fallback for string or invalid output
        from models.schemas import AgentStep
        combined = CombinedPermitResult(
            summary=str(combined),
            permits=["İşyeri Açma ve Çalışma Ruhsatı"],
            agencies=["Municipality", "Tax Office"],
            documents=["ID", "Lease", "Tax ID"],
            steps=[
                AgentStep(title="Tax ID", description="Get tax ID", documents=["ID"]),
                AgentStep(title="Registration", description="Company registration", documents=["Lease"]),
                AgentStep(title="Permit", description="Get permit", documents=["Tax ID"])
            ],
            timeline_days=30,
            location="Istanbul",
            business_type="Business"
        )
    
    state['state'].combined_result = combined
    # Also populate legacy fields so the dashboard still works
    from models.schemas import PermitPlan
    state['state'].permit_plan = PermitPlan(
        permits=combined.permits,
        agencies=combined.agencies,
        documents=combined.documents,
    )
    # Build dynamic steps based on agent's generated steps
    from models.schemas import StepDetail
    
    details = []
    for i, st in enumerate(combined.steps):
        details.append(StepDetail(
            id=i + 1,
            title=st.title,
            responsible="Agent" if "e-Devlet" in st.description or "Agent" in st.description else "Human/Agent",
            status="pending",
            notes=st.description,
            docs=st.documents
        ))
    
    # Use the structured steps as the final execution plan
    state['state'].execution_plan = ExecutionPlan(
        steps=details,
        assigned_agents=["Planner", "Classifier"]
    )
    return state

builder = StateGraph(GraphState)
builder.add_node("permit", permit_node)
builder.add_edge(START, "permit")
builder.add_edge("permit", END)

orchestrator = builder.compile()

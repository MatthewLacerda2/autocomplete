import os
import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from google import genai
from google.genai import types

from schemas import (
    CompleteRequest,
    CompleteResponse,
    ChatRequest,
    AssistantResponse,
)
from prompts import (
    AUTOCOMPLETE_SYSTEM_INSTRUCTION,
    CHAT_SYSTEM_INSTRUCTION,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("autocomplete-backend")

# Try loading from local directory or parent directory
load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

app = FastAPI(title="Gemini Autocomplete & Writing Assistant API")

# Configure CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Read default model and API key from environment
api_key = os.getenv("GEMINI_API_KEY")
default_model_name = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

if not api_key:
    logger.warning("GEMINI_API_KEY is not set in environment or .env file.")

# Initialize the Gemini Client
try:
    if api_key:
        client = genai.Client(api_key=api_key)
    else:
        client = genai.Client()
except Exception as e:
    logger.error(f"Failed to initialize GenAI Client: {e}")
    client = None


# --- Endpoints ---
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "default_model": default_model_name,
        "api_key_configured": bool(api_key or os.getenv("GEMINI_API_KEY"))
    }


@app.post("/api/complete", response_model=CompleteResponse)
async def get_autocomplete(request: CompleteRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="Gemini API Client is not configured. Please check your GEMINI_API_KEY."
        )
    
    text = request.text_before_cursor
    if not text.strip():
        return CompleteResponse(completion="")

    model_to_use = request.model or default_model_name
    
    # Enforce strictly supported models
    if model_to_use not in ["gemini-3.5-flash", "gemini-3.1-flash-lite"]:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported model: {model_to_use}. Aura Write only supports gemini-3.5-flash and gemini-3.1-flash-lite."
        )
    
    # We construct a strict system instruction to ensure the model behaves like a ghost text autocomplete
    system_instruction = AUTOCOMPLETE_SYSTEM_INSTRUCTION

    if request.chat_context and request.chat_context.strip():
        system_instruction += (
            f"\n\nCRITICAL CONTEXT FOR THIS DOCUMENT:\n"
            f"The user has defined the following structure or context for the document:\n"
            f"\"\"\"\n{request.chat_context.strip()}\n\"\"\"\n"
            f"Ensure your autocomplete suggestion strictly aligns with this structure, tone, and content goal."
        )

    # Construct structured FIM prompt
    prompt_elements = []
    prompt_elements.append("=== TEXT BEFORE CURSOR ===\n")
    prompt_elements.append(text)
    prompt_elements.append("\n==========================\n\n")
    
    if request.text_after_cursor and request.text_after_cursor.strip():
        prompt_elements.append("=== TEXT AFTER CURSOR ===\n")
        prompt_elements.append(request.text_after_cursor)
        prompt_elements.append("\n=========================\n\n")
        
        system_instruction += (
            "\n\nCRITICAL FILL-IN-THE-MIDDLE (FIM) RULE:\n"
            "Your autocomplete suggestion MUST fit seamlessly in the gap between 'TEXT BEFORE CURSOR' and 'TEXT AFTER CURSOR'.\n"
            "Do NOT repeat any text from the 'TEXT AFTER CURSOR'. Provide ONLY the suffix that immediately completes the "
            "text before the cursor and transitions naturally into the text after the cursor."
        )
        
    prompt_elements.append("Generate the immediate next suffix completion:")
    full_prompt = "".join(prompt_elements)

    try:
        logger.info(f"Generating completion using {model_to_use} for prompt length: {len(text)}")
        
        response = client.models.generate_content(
            model=model_to_use,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,  # Low temperature for highly deterministic completions
                max_output_tokens=150,  # Support longer suggestions up to 100 words
            )
        )
        
        completion_text = response.text or ""
        
        # Clean up any potential markdown backticks if the model slipped up
        if completion_text.startswith("```") and completion_text.endswith("```"):
            lines = completion_text.splitlines()
            if len(lines) > 2:
                completion_text = "\n".join(lines[1:-1])
        
        return CompleteResponse(completion=completion_text)
        
    except Exception as e:
        logger.error(f"Error calling Gemini API: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error generating autocomplete: {str(e)}"
        )


@app.post("/api/chat", response_model=AssistantResponse)
async def chat_assistant(request: ChatRequest):
    if not client:
        raise HTTPException(
            status_code=500,
            detail="Gemini API Client is not configured. Please check your GEMINI_API_KEY."
        )

    model_to_use = request.model or default_model_name
    
    # Enforce strictly supported models
    if model_to_use not in ["gemini-3.5-flash", "gemini-3.1-flash-lite"]:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported model: {model_to_use}. Aura Write only supports gemini-3.5-flash and gemini-3.1-flash-lite."
        )
        
    logger.info(f"Processing chat request using model {model_to_use}")

    system_instruction = CHAT_SYSTEM_INSTRUCTION

    # Construct the contextual chat prompt
    prompt_elements = []
    
    # 1. State the current document context with line numbers
    prompt_elements.append("=== CURRENT DOCUMENT TEXT IN EDITOR (WITH LINE NUMBERS) ===\n")
    if request.current_text.strip():
        lines = request.current_text.splitlines()
        for idx, line in enumerate(lines, 1):
            prompt_elements.append(f"{idx}: {line}\n")
    else:
        prompt_elements.append("(The editor is currently empty.)\n")
    prompt_elements.append("==========================================================\n\n")

    # 2. Add current structure/context
    prompt_elements.append("=== CURRENT DOCUMENT STRUCTURE & ABOUT CONTEXT ===\n")
    prompt_elements.append(request.chat_context if request.chat_context and request.chat_context.strip() else "(No structure/context defined yet.)")
    prompt_elements.append("\n==================================================\n\n")

    # 3. Add history context
    if request.history:
        prompt_elements.append("=== CHAT HISTORY ===\n")
        for msg in request.history:
            role_label = "User" if msg.role == "user" else "Assistant"
            prompt_elements.append(f"{role_label}: {msg.content}\n")
        prompt_elements.append("====================\n\n")

    # 4. Add latest user request
    prompt_elements.append(f"User's Latest Request: {request.message}\n")
    prompt_elements.append("Please generate your response matching the required schema.")

    full_prompt = "".join(prompt_elements)

    try:
        # Call Gemini using Structured JSON output schema mapped to Pydantic AssistantResponse
        response = client.models.generate_content(
            model=model_to_use,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=AssistantResponse,
                temperature=0.7,
            )
        )
        
        # Parse the structured JSON response
        result_text = response.text or "{}"
        logger.info(f"Received structured chat response: {result_text[:200]}...")
        
        # Return the parsed response directly, FastAPI handles Pydantic model serialization
        return AssistantResponse.model_validate_json(result_text)

    except Exception as e:
        logger.error(f"Error in chat assistant API: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error processing assistant response: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    # Bind to 0.0.0.0 for WiFi visibility
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)
